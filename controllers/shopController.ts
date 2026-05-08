import { Request, Response } from 'express';
import pool from '../config/database';
import { AuthRequest } from '../middleware/auth';

// Получить все одобренные паки
export const getPacks = async (req: Request, res: Response) => {
  try {
    const { sort = 'created_at', order = 'DESC', search } = req.query;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;

    let query = `
      SELECT sp.*, u.username, u.hashtag, u.avatar_url,
             COALESCE(AVG(pr.rating), 0) as avg_rating,
             COUNT(pr.id) as rating_count,
             COUNT(DISTINCT o.id) as sales_count
      FROM sound_packs sp
      JOIN users u ON sp.user_id = u.id
      LEFT JOIN pack_ratings pr ON sp.id = pr.pack_id
      LEFT JOIN orders o ON sp.id = o.pack_id AND o.status = 'completed'
      WHERE sp.status = 'approved'
    `;

    const params: any[] = [];

    if (search) {
      query += ` AND (sp.title ILIKE $${params.length + 1} OR sp.description ILIKE $${params.length + 1})`;
      params.push(`%${search}%`);
    }

    query += ` GROUP BY sp.id, u.username, u.hashtag, u.avatar_url`;

    // Валидация сортировки
    const validSorts = ['created_at', 'title', 'price', 'avg_rating', 'sales_count'];
    const sortField = validSorts.includes(sort as string) ? sort : 'created_at';
    const sortOrder = order === 'ASC' ? 'ASC' : 'DESC';

    query += ` ORDER BY ${sortField} ${sortOrder}`;

    query += ` LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);

    // Получаем общее количество
    let countQuery = `
      SELECT COUNT(DISTINCT sp.id) as total
      FROM sound_packs sp
      WHERE sp.status = 'approved'
    `;

    if (search) {
      countQuery += ` AND (sp.title ILIKE $1 OR sp.description ILIKE $1)`;
    }

    const countResult = await pool.query(countQuery, search ? [`%${search}%`] : []);
    const total = parseInt(countResult.rows[0].total);

    res.json({
      packs: result.rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error getting packs:', error);
    res.status(500).json({ error: 'Failed to get packs' });
  }
};

// Получить детальную информацию о паке
export const getPackById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const packQuery = `
      SELECT sp.*, u.username, u.hashtag, u.avatar_url,
             COALESCE(AVG(pr.rating), 0) as avg_rating,
             COUNT(pr.id) as rating_count
      FROM sound_packs sp
      JOIN users u ON sp.user_id = u.id
      LEFT JOIN pack_ratings pr ON sp.id = pr.pack_id
      WHERE sp.id = $1 AND sp.status = 'approved'
      GROUP BY sp.id, u.username, u.hashtag, u.avatar_url
    `;

    const packResult = await pool.query(packQuery, [id]);

    if (packResult.rows.length === 0) {
      return res.status(404).json({ error: 'Pack not found' });
    }

    const pack = packResult.rows[0];

    // Получаем лупы в паке
    const loopsQuery = `
      SELECT l.*, pl.created_at as added_to_pack
      FROM pack_loops pl
      JOIN loops l ON pl.loop_id = l.id
      WHERE pl.pack_id = $1
      ORDER BY pl.created_at
    `;

    const loopsResult = await pool.query(loopsQuery, [id]);

    // Получаем отзывы
    const ratingsQuery = `
      SELECT pr.*, u.username, u.hashtag, u.avatar_url
      FROM pack_ratings pr
      JOIN users u ON pr.user_id = u.id
      WHERE pr.pack_id = $1
      ORDER BY pr.created_at DESC
    `;

    const ratingsResult = await pool.query(ratingsQuery, [id]);

    res.json({
      ...pack,
      loops: loopsResult.rows,
      ratings: ratingsResult.rows
    });
  } catch (error) {
    console.error('Error getting pack:', error);
    res.status(500).json({ error: 'Failed to get pack' });
  }
};

// Создать новый пак
export const createPack = async (req: AuthRequest, res: Response) => {
  const client = await pool.connect();
  
  try {
    const { title, description, price, voice_tag, loopIds } = req.body;
    const userId = req.user!.id;

    // Проверяем лимит на создание паков (3 в день)
    const todayPacksQuery = `
      SELECT COUNT(*) as count
      FROM sound_packs
      WHERE user_id = $1 AND DATE(created_at) = CURRENT_DATE
    `;
    const todayPacksResult = await client.query(todayPacksQuery, [userId]);
    const todayPacksCount = parseInt(todayPacksResult.rows[0].count);

    if (todayPacksCount >= 3) {
      return res.status(429).json({ error: 'Daily pack creation limit exceeded' });
    }

    // Проверяем возраст аккаунта (минимум 3 дня)
    const userQuery = `
      SELECT created_at
      FROM users
      WHERE id = $1
    `;
    const userResult = await client.query(userQuery, [userId]);
    const userCreatedAt = new Date(userResult.rows[0].created_at);
    const daysSinceCreation = Math.floor((Date.now() - userCreatedAt.getTime()) / (1000 * 60 * 60 * 24));

    if (daysSinceCreation < 3) {
      return res.status(403).json({ error: 'Account must be at least 3 days old to create packs' });
    }

    // Проверяем количество лупов (максимум 15)
    if (!loopIds || loopIds.length === 0 || loopIds.length > 15) {
      return res.status(400).json({ error: 'Pack must contain between 1 and 15 loops' });
    }

    // Проверяем что все лупы принадлежат пользователю
    const loopsCheckQuery = `
      SELECT COUNT(*) as count
      FROM loops
      WHERE id = ANY($1) AND user_id = $2
    `;
    const loopsCheckResult = await client.query(loopsCheckQuery, [loopIds, userId]);
    const validLoopsCount = parseInt(loopsCheckResult.rows[0].count);

    if (validLoopsCount !== loopIds.length) {
      return res.status(403).json({ error: 'All loops must belong to you' });
    }

    await client.query('BEGIN');

    // Создаем пак
    const packQuery = `
      INSERT INTO sound_packs (title, description, price, user_id, voice_tag, status)
      VALUES ($1, $2, $3, $4, $5, 'pending')
      RETURNING *
    `;
    const packResult = await client.query(packQuery, [title, description, price, userId, voice_tag]);
    const pack = packResult.rows[0];

    // Добавляем лупы в пак
    for (const loopId of loopIds) {
      await client.query(`
        INSERT INTO pack_loops (pack_id, loop_id)
        VALUES ($1, $2)
      `, [pack.id, loopId]);
    }

    await client.query('COMMIT');

    res.status(201).json(pack);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error creating pack:', error);
    res.status(500).json({ error: 'Failed to create pack' });
  } finally {
    client.release();
  }
};

// Купить пак
export const buyPack = async (req: AuthRequest, res: Response) => {
  const client = await pool.connect();
  
  try {
    const { id } = req.params;
    const buyerId = req.user!.id;

    // Получаем информацию о паке
    const packQuery = `
      SELECT sp.*, u.username as seller_name
      FROM sound_packs sp
      JOIN users u ON sp.user_id = u.id
      WHERE sp.id = $1 AND sp.status = 'approved'
    `;
    const packResult = await client.query(packQuery, [id]);

    if (packResult.rows.length === 0) {
      return res.status(404).json({ error: 'Pack not found' });
    }

    const pack = packResult.rows[0];

    // Проверяем что покупатель не продавец
    if (pack.user_id === buyerId) {
      return res.status(400).json({ error: 'Cannot buy your own pack' });
    }

    // Проверяем не купил ли уже
    const existingOrderQuery = `
      SELECT id
      FROM orders
      WHERE pack_id = $1 AND buyer_id = $2 AND status = 'completed'
    `;
    const existingOrderResult = await client.query(existingOrderQuery, [id, buyerId]);

    if (existingOrderResult.rows.length > 0) {
      return res.status(400).json({ error: 'Pack already purchased' });
    }

    await client.query('BEGIN');

    // Получаем баланс покупателя
    const balanceQuery = `
      SELECT available_balance
      FROM user_balance
      WHERE user_id = $1
    `;
    const balanceResult = await client.query(balanceQuery, [buyerId]);

    if (balanceResult.rows.length === 0) {
      await client.query(`
        INSERT INTO user_balance (user_id, available_balance)
        VALUES ($1, 0)
      `, [buyerId]);
    }

    const currentBalance = balanceResult.rows[0]?.available_balance || 0;

    if (currentBalance < pack.price) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Insufficient balance' });
    }

    // Рассчитываем комиссию и заработок продавца
    const commission = Math.floor(pack.price * 0.15);
    const sellerEarnings = pack.price - commission;

    // Списываем деньги у покупателя
    await client.query(`
      UPDATE user_balance
      SET available_balance = available_balance - $1,
          updated_at = CURRENT_TIMESTAMP
      WHERE user_id = $2
    `, [pack.price, buyerId]);

    // Добавляем деньги продавцу в pending_balance
    await client.query(`
      INSERT INTO user_balance (user_id, pending_balance, total_earned)
      VALUES ($1, $2, $2)
      ON CONFLICT (user_id) DO UPDATE SET
        pending_balance = user_balance.pending_balance + $2,
        total_earned = user_balance.total_earned + $2,
        updated_at = CURRENT_TIMESTAMP
    `, [pack.user_id, sellerEarnings]);

    // Создаем заказ
    await client.query(`
      INSERT INTO orders (pack_id, buyer_id, seller_id, price, commission, seller_earnings)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [id, buyerId, pack.user_id, pack.price, commission, sellerEarnings]);

    await client.query('COMMIT');

    res.json({ message: 'Pack purchased successfully' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error buying pack:', error);
    res.status(500).json({ error: 'Failed to buy pack' });
  } finally {
    client.release();
  }
};

// Получить баланс пользователя
export const getUserBalance = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;

    const balanceQuery = `
      SELECT *
      FROM user_balance
      WHERE user_id = $1
    `;
    const balanceResult = await pool.query(balanceQuery, [userId]);

    if (balanceResult.rows.length === 0) {
      // Создаем баланс если не существует
      await pool.query(`
        INSERT INTO user_balance (user_id)
        VALUES ($1)
      `, [userId]);
      
      return res.json({
        available_balance: 0,
        pending_balance: 0,
        total_earned: 0
      });
    }

    res.json(balanceResult.rows[0]);
  } catch (error) {
    console.error('Error getting balance:', error);
    res.status(500).json({ error: 'Failed to get balance' });
  }
};

// Создать заявку на вывод средств
export const createWithdrawal = async (req: AuthRequest, res: Response) => {
  try {
    const { amount, phone, bank } = req.body;
    const userId = req.user!.id;

    // Проверяем минимальную сумму вывода
    if (amount < 1000) {
      return res.status(400).json({ error: 'Minimum withdrawal amount is 1000 coins' });
    }

    // Получаем баланс
    const balanceQuery = `
      SELECT available_balance
      FROM user_balance
      WHERE user_id = $1
    `;
    const balanceResult = await pool.query(balanceQuery, [userId]);

    if (balanceResult.rows.length === 0 || balanceResult.rows[0].available_balance < amount) {
      return res.status(400).json({ error: 'Insufficient available balance' });
    }

    // Создаем заявку
    const withdrawalQuery = `
      INSERT INTO withdrawals (user_id, amount, phone, bank)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `;
    const withdrawalResult = await pool.query(withdrawalQuery, [userId, amount, phone, bank]);

    res.status(201).json(withdrawalResult.rows[0]);
  } catch (error) {
    console.error('Error creating withdrawal:', error);
    res.status(500).json({ error: 'Failed to create withdrawal' });
  }
};

// Получить паки пользователя
export const getUserPacks = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { status } = req.query;

    let query = `
      SELECT sp.*,
             COALESCE(AVG(pr.rating), 0) as avg_rating,
             COUNT(pr.id) as rating_count,
             COUNT(DISTINCT o.id) as sales_count
      FROM sound_packs sp
      LEFT JOIN pack_ratings pr ON sp.id = pr.pack_id
      LEFT JOIN orders o ON sp.id = o.pack_id AND o.status = 'completed'
      WHERE sp.user_id = $1
    `;

    const params: any[] = [userId];

    if (status) {
      query += ` AND sp.status = $2`;
      params.push(status);
    }

    query += ` GROUP BY sp.id ORDER BY sp.created_at DESC`;

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error getting user packs:', error);
    res.status(500).json({ error: 'Failed to get user packs' });
  }
};

// Добавить рейтинг паку
export const ratePack = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { rating, review } = req.body;
    const userId = req.user!.id;

    // Проверяем что пользователь купил пак
    const purchaseCheckQuery = `
      SELECT id
      FROM orders
      WHERE pack_id = $1 AND buyer_id = $2 AND status = 'completed'
    `;
    const purchaseCheckResult = await pool.query(purchaseCheckQuery, [id, userId]);

    if (purchaseCheckResult.rows.length === 0) {
      return res.status(403).json({ error: 'You must purchase the pack to rate it' });
    }

    // Добавляем или обновляем рейтинг
    const ratingQuery = `
      INSERT INTO pack_ratings (pack_id, user_id, rating, review)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (pack_id, user_id) DO UPDATE SET
        rating = $3,
        review = $4,
        created_at = CURRENT_TIMESTAMP
      RETURNING *
    `;
    const ratingResult = await pool.query(ratingQuery, [id, userId, rating, review]);

    res.status(201).json(ratingResult.rows[0]);
  } catch (error) {
    console.error('Error rating pack:', error);
    res.status(500).json({ error: 'Failed to rate pack' });
  }
};

// Пожаловаться на пак
export const reportPack = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { reason, description } = req.body;
    const userId = req.user!.id;

    const reportQuery = `
      INSERT INTO reports (reporter_id, pack_id, reason, description)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `;
    const reportResult = await pool.query(reportQuery, [userId, id, reason, description]);

    res.status(201).json(reportResult.rows[0]);
  } catch (error) {
    console.error('Error reporting pack:', error);
    res.status(500).json({ error: 'Failed to report pack' });
  }
};
