import { Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import archiver from 'archiver';
import pool from '../config/database';
import { AuthRequest } from '../middleware/auth';

// Настройка multer для загрузки файлов
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(process.cwd(), 'uploads', 'shop');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 500 * 1024 * 1024 // 500MB limit for archives
  },
  fileFilter: (req, file, cb) => {
    // Allow audio files, zip files, and text files
    const allowedExtensions = ['.mp3', '.wav', '.zip', '.txt', '.pdf'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedExtensions.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type'));
    }
  }
});

export { upload };

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

// Создать новый пак с архивом
export const createPack = async (req: AuthRequest, res: Response) => {
  const client = await pool.connect();
  
  try {
    const { title, description, price, voice_tag } = req.body;
    const userId = req.user!.userId;

    // Проверяем наличие архива
    const files = req.files as { [fieldname: string]: Express.Multer.File[] };
    if (!files || !files['archive']) {
      return res.status(400).json({ error: 'Archive file is required' });
    }

    const archiveFile = files['archive'][0];
    const previewFile1 = files['preview1'] ? files['preview1'][0] : undefined;
    const previewFile2 = files['preview2'] ? files['preview2'][0] : undefined;
    const voiceTagFile = files['voiceTag'] ? files['voiceTag'][0] : undefined;
    const textFile = files['textFile'] ? files['textFile'][0] : undefined;

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

    if (userResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'User not found' });
    }

    const userCreatedAt = new Date(userResult.rows[0].created_at);
    const daysSinceCreation = Math.floor((Date.now() - userCreatedAt.getTime()) / (1000 * 60 * 60 * 24));

    if (daysSinceCreation < 3) {
      return res.status(403).json({ error: 'Account must be at least 3 days old to create packs' });
    }

    // Проверяем что архив это zip файл
    if (!archiveFile.originalname.toLowerCase().endsWith('.zip')) {
      return res.status(400).json({ error: 'Archive must be a ZIP file' });
    }

    await client.query('BEGIN');

    // Создаем пак
    const packQuery = `
      INSERT INTO sound_packs (title, description, price, user_id, voice_tag, status, archive_url, preview_url, preview_url_2, voice_tag_file, text_file)
      VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7, $8, $9, $10)
      RETURNING *
    `;
    const packResult = await client.query(packQuery, [
      title, 
      description, 
      price, 
      userId, 
      voice_tag,
      `/uploads/shop/${archiveFile.filename}`,
      previewFile1 ? `/uploads/shop/${previewFile1.filename}` : null,
      previewFile2 ? `/uploads/shop/${previewFile2.filename}` : null,
      voiceTagFile ? `/uploads/shop/${voiceTagFile.filename}` : null,
      textFile ? `/uploads/shop/${textFile.filename}` : null
    ]);
    const pack = packResult.rows[0];

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
    const buyerId = req.user!.userId;

    console.log('Buy pack attempt - Pack ID:', id, 'Buyer ID:', buyerId);

    if (!buyerId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    // Получаем информацию о паке
    const packQuery = `
      SELECT sp.*, u.username as seller_name
      FROM sound_packs sp
      JOIN users u ON sp.user_id = u.id
      WHERE sp.id = $1 AND sp.status = 'approved'
    `;
    const packResult = await client.query(packQuery, [id]);

    if (packResult.rows.length === 0) {
      // Check if pack exists but is not approved
      const unapprovedPackQuery = `
        SELECT status
        FROM sound_packs
        WHERE id = $1
      `;
      const unapprovedResult = await client.query(unapprovedPackQuery, [id]);
      if (unapprovedResult.rows.length > 0) {
        return res.status(400).json({ error: 'Pack is not approved yet. Please wait for moderation.' });
      }
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
      console.log('Creating user_balance for buyerId:', buyerId);
      await client.query(`
        INSERT INTO user_balance (user_id, available_balance)
        VALUES ($1, 0)
      `, [buyerId]);
    }

    const currentBalance = balanceResult.rows[0]?.available_balance || 0;

    if (currentBalance < pack.price) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Insufficient balance. You have ${currentBalance} coins but need ${pack.price} coins.` });
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

    // Добавляем деньги продавцу в available_balance
    await client.query(`
      INSERT INTO user_balance (user_id, available_balance, total_earned)
      VALUES ($1, $2, $2)
      ON CONFLICT (user_id) DO UPDATE SET
        available_balance = user_balance.available_balance + $2,
        total_earned = user_balance.total_earned + $2,
        updated_at = CURRENT_TIMESTAMP
    `, [pack.user_id, sellerEarnings]);

    // Создаем заказ
    const invoiceId = `manual-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    await client.query(`
      INSERT INTO orders (pack_id, buyer_id, seller_id, invoice_id, amount, currency, commission, seller_earnings, status)
      VALUES ($1, $2, $3, $4, $5, 'coins', $6, $7, 'paid')
    `, [id, buyerId, pack.user_id, invoiceId, pack.price, commission, sellerEarnings]);

    // Добавляем пак в список купленных паков пользователя
    await client.query(`
      INSERT INTO user_packs (user_id, pack_id)
      VALUES ($1, $2)
      ON CONFLICT (user_id, pack_id) DO NOTHING
    `, [buyerId, id]);

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
    const userId = req.user!.userId;

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
    const userId = req.user!.userId;

    console.log('Getting packs for user:', userId);

    const query = `
      SELECT DISTINCT ON (sp.id) sp.*,
             o.created_at as purchase_date
      FROM orders o
      JOIN sound_packs sp ON o.pack_id = sp.id
      WHERE o.buyer_id = $1 AND o.status = 'paid'
      ORDER BY sp.id, o.created_at DESC
    `;

    const result = await pool.query(query, [userId]);
    console.log('Found purchased packs:', result.rows.length, result.rows);

    res.json({ packs: result.rows });
  } catch (error) {
    console.error('Error getting user packs:', error);
    res.status(500).json({ error: 'Failed to get user packs' });
  }
};

// Получить историю транзакций
export const getTransactionHistory = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;

    console.log('Getting transaction history for user:', userId);

    const query = `
      SELECT
        'purchase' as type,
        o.created_at,
        o.amount,
        o.currency,
        sp.title as description,
        o.invoice_id
      FROM orders o
      JOIN sound_packs sp ON o.pack_id = sp.id
      WHERE o.buyer_id = $1 AND o.status = 'paid'

      UNION ALL

      SELECT
        'sale' as type,
        o.created_at,
        o.seller_earnings as amount,
        o.currency,
        sp.title as description,
        o.invoice_id
      FROM orders o
      JOIN sound_packs sp ON o.pack_id = sp.id
      WHERE o.seller_id = $1 AND o.status = 'paid'

      UNION ALL

      SELECT
        'topup' as type,
        t.created_at,
        t.amount,
        t.currency,
        'Пополнение баланса' as description,
        t.invoice_id
      FROM top_ups t
      WHERE t.user_id = $1 AND t.status = 'completed'

      UNION ALL

      SELECT
        'withdrawal' as type,
        w.created_at,
        w.amount,
        w.currency,
        'Вывод средств' as description,
        w.id::text as invoice_id
      FROM withdrawals w
      WHERE w.user_id = $1

      ORDER BY created_at DESC
      LIMIT 50
    `;

    const result = await pool.query(query, [userId]);
    console.log('Found transactions:', result.rows.length, 'for user:', userId);

    res.json({ transactions: result.rows });
  } catch (error) {
    console.error('Error getting transaction history:', error);
    res.status(500).json({ error: 'Failed to get transaction history' });
  }
};

// Добавить рейтинг паку
export const ratePack = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { rating, review } = req.body;
    const userId = req.user!.userId;

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

// Скачать пак (с проверкой покупки)
export const downloadPack = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user!.userId;

    // Проверяем, купил ли пользователь этот пак
    const purchaseCheckQuery = `
      SELECT 1 FROM orders
      WHERE buyer_id = $1 AND pack_id = $2 AND status = 'paid'
    `;
    const purchaseCheckResult = await pool.query(purchaseCheckQuery, [userId, id]);

    if (purchaseCheckResult.rows.length === 0) {
      return res.status(403).json({ error: 'You must purchase the pack to download it' });
    }

    // Получаем информацию о паке
    const packQuery = `
      SELECT sp.archive_url, sp.title, sp.voice_tag_file, sp.text_file
      FROM sound_packs sp
      WHERE sp.id = $1 AND sp.status = 'approved'
    `;
    const packResult = await pool.query(packQuery, [id]);

    if (packResult.rows.length === 0) {
      return res.status(404).json({ error: 'Pack not found' });
    }

    const pack = packResult.rows[0];

    if (!pack.archive_url) {
      return res.status(404).json({ error: 'Archive file not found' });
    }

    // Если есть дополнительные файлы, создаем новый архив
    if (pack.voice_tag_file || pack.text_file) {
      const archive = archiver('zip', { zlib: { level: 9 } });

      res.attachment(`${pack.title}.zip`);
      archive.pipe(res);

      // Добавляем основной архив
      const archivePath = path.join(process.cwd(), pack.archive_url);
      if (fs.existsSync(archivePath)) {
        archive.file(archivePath, { name: 'pack.zip' });
      }

      // Добавляем voicetag
      if (pack.voice_tag_file) {
        const voiceTagPath = path.join(process.cwd(), pack.voice_tag_file);
        if (fs.existsSync(voiceTagPath)) {
          archive.file(voiceTagPath, { name: 'voicetag.mp3' });
        }
      }

      // Добавляем текстовый файл
      if (pack.text_file) {
        const textFilePath = path.join(process.cwd(), pack.text_file);
        if (fs.existsSync(textFilePath)) {
          archive.file(textFilePath, { name: 'document.txt' });
        }
      }

      await archive.finalize();
    } else {
      // Если нет дополнительных файлов, скачиваем только основной архив
      const filePath = path.join(process.cwd(), pack.archive_url);

      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'File not found on server' });
      }

      res.download(filePath, `${pack.title}.zip`);
    }
  } catch (error) {
    console.error('Error downloading pack:', error);
    res.status(500).json({ error: 'Failed to download pack' });
  }
};

// Начислить баланс пользователю (для Python бота)
export const creditBalance = async (req: Request, res: Response) => {
  try {
    const { user_id, amount, invoice_id } = req.body;

    if (!user_id || !amount) {
      return res.status(400).json({ error: 'user_id and amount are required' });
    }

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Проверяем существует ли пользователь
      const userCheck = await client.query(
        'SELECT id FROM users WHERE telegram_id = $1',
        [user_id]
      );

      if (userCheck.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'User not found' });
      }

      const userId = userCheck.rows[0].id;

      // Начисляем баланс
      await client.query(
        `UPDATE user_balance 
         SET available_balance = available_balance + $1,
             updated_at = CURRENT_TIMESTAMP
         WHERE user_id = $2`,
        [amount, userId]
      );

      // Записываем транзакцию
      await client.query(
        `INSERT INTO top_ups (user_id, invoice_id, amount, currency, status)
         VALUES ($1, $2, $3, 'coins', 'completed')`,
        [userId, invoice_id, amount]
      );

      await client.query('COMMIT');

      res.json({ success: true, credited_amount: amount });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error crediting balance:', error);
    res.status(500).json({ error: 'Failed to credit balance' });
  }
};

// Ручное начисление баланса администратором
export const manualCreditBalance = async (req: AuthRequest, res: Response) => {
  try {
    const { username, amount } = req.body;
    const adminId = req.user!.userId;

    // Проверяем что это админ
    if (req.user!.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    if (!username || !amount) {
      return res.status(400).json({ error: 'username and amount are required' });
    }

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Находим пользователя по username
      const userCheck = await client.query(
        'SELECT id FROM users WHERE username = $1',
        [username]
      );

      if (userCheck.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'User not found' });
      }

      const userId = userCheck.rows[0].id;

      // Начисляем баланс
      await client.query(
        `UPDATE user_balance 
         SET available_balance = available_balance + $1,
             updated_at = CURRENT_TIMESTAMP
         WHERE user_id = $2`,
        [amount, userId]
      );

      // Записываем транзакцию
      await client.query(
        `INSERT INTO top_ups (user_id, invoice_id, amount, currency, status)
         VALUES ($1, 'manual', $2, 'coins', 'completed')`,
        [userId, amount]
      );

      await client.query('COMMIT');

      res.json({ success: true, credited_amount: amount, username });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error manually crediting balance:', error);
    res.status(500).json({ error: 'Failed to manually credit balance' });
  }
};

// Получить баланс по Telegram ID
export const getBalanceByTelegramId = async (req: Request, res: Response) => {
  try {
    const { telegram_id } = req.params;

    const query = `
      SELECT ub.available_balance, ub.pending_balance
      FROM user_balance ub
      JOIN users u ON ub.user_id = u.id
      WHERE u.telegram_id = $1
    `;
    const result = await pool.query(query, [telegram_id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      available_balance: result.rows[0].available_balance,
      pending_balance: result.rows[0].pending_balance
    });
  } catch (error) {
    console.error('Error fetching balance by telegram ID:', error);
    res.status(500).json({ error: 'Failed to fetch balance' });
  }
};

// Поиск пользователей по username для автодополнения
export const searchUsers = async (req: AuthRequest, res: Response) => {
  try {
    const { q } = req.query;

    if (!q || typeof q !== 'string') {
      return res.status(400).json({ error: 'Query parameter is required' });
    }

    // Проверяем что это админ
    if (req.user!.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const query = `
      SELECT id, username, email
      FROM users
      WHERE username ILIKE $1
      ORDER BY username
      LIMIT 10
    `;
    const result = await pool.query(query, [`%${q}%`]);

    res.json({ users: result.rows });
  } catch (error) {
    console.error('Error searching users:', error);
    res.status(500).json({ error: 'Failed to search users' });
  }
};

// Ручное списание баланса с комиссией (для вывода средств)
export const manualDebitBalance = async (req: AuthRequest, res: Response) => {
  try {
    const { username, amount, currency } = req.body;
    const adminId = req.user!.userId;

    // Проверяем что это админ
    if (req.user!.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    if (!username || !amount) {
      return res.status(400).json({ error: 'username and amount are required' });
    }

    const withdrawalAmount = parseInt(amount);
    const commission = Math.round(withdrawalAmount * 0.2); // 20% commission
    const netAmount = withdrawalAmount - commission;

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Находим пользователя по username
      const userCheck = await client.query(
        'SELECT id, available_balance FROM users u LEFT JOIN user_balance ub ON u.id = ub.user_id WHERE u.username = $1',
        [username]
      );

      if (userCheck.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'User not found' });
      }

      const userId = userCheck.rows[0].id;
      const currentBalance = userCheck.rows[0].available_balance || 0;

      // Проверяем достаточно ли средств
      if (currentBalance < withdrawalAmount) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Insufficient balance' });
      }

      // Списываем баланс
      await client.query(
        `UPDATE user_balance
         SET available_balance = available_balance - $1,
             updated_at = CURRENT_TIMESTAMP
         WHERE user_id = $2`,
        [withdrawalAmount, userId]
      );

      // Записываем транзакцию вывода с указанием комиссии
      await client.query(
        `INSERT INTO withdrawals (user_id, amount, status, processed_by, processed_at)
         VALUES ($1, $2, 'completed', $3, CURRENT_TIMESTAMP)`,
        [userId, netAmount, adminId]
      );

      await client.query('COMMIT');

      res.json({
        success: true,
        debited_amount: withdrawalAmount,
        commission: commission,
        net_amount: netAmount,
        currency: currency || 'RUB',
        username
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error manually debiting balance:', error);
    res.status(500).json({ error: 'Failed to manually debit balance' });
  }
};

export const reportPack = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { reason, description } = req.body;
    const userId = req.user!.userId;

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
