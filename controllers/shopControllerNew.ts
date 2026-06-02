import { Request, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import pool from '../config/database';

// Создать пак
export const createPackNew = async (req: AuthRequest, res: Response) => {
  const client = await pool.connect();

  try {
    const { title, description, price, voice_tag } = req.body;
    const userId = req.user!.userId;

    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    if (!title || !price) {
      return res.status(400).json({ error: 'Title and price are required' });
    }

    if (price < 0) {
      return res.status(400).json({ error: 'Price must be positive' });
    }

    const files = req.files as { [fieldname: string]: Express.Multer.File[] };
    if (!files || !files['archive']) {
      return res.status(400).json({ error: 'Archive file is required' });
    }

    const archiveFile = files['archive'][0];
    const previewFile1 = files['preview1'] ? files['preview1'][0] : null;
    const previewFile2 = files['preview2'] ? files['preview2'][0] : null;
    const voiceTagFile = files['voiceTag'] ? files['voiceTag'][0] : null;
    const textFile = files['textFile'] ? files['textFile'][0] : null;

    await client.query('BEGIN');

    const packQuery = `
      INSERT INTO sound_packs (title, description, price, user_id, voice_tag, status, archive_url, preview_url, preview_url_2, voice_tag_file, text_file)
      VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7, $8, $9, $10)
      RETURNING *
    `;

    const archiveUrl = `/uploads/shop/${archiveFile.filename}`;
    const preview1Url = previewFile1 ? `/uploads/shop/${previewFile1.filename}` : null;
    const preview2Url = previewFile2 ? `/uploads/shop/${previewFile2.filename}` : null;
    const voiceTagUrl = voiceTagFile ? `/uploads/shop/${voiceTagFile.filename}` : null;
    const textFileUrl = textFile ? `/uploads/shop/${textFile.filename}` : null;

    const packResult = await client.query(packQuery, [
      title,
      description || '',
      parseInt(price),
      userId,
      voice_tag || '',
      archiveUrl,
      preview1Url,
      preview2Url,
      voiceTagUrl,
      textFileUrl
    ]);

    await client.query('COMMIT');

    res.status(201).json({
      ...packResult.rows[0],
      message: 'Pack submitted for moderation'
    });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Failed to create pack' });
  } finally {
    client.release();
  }
};

// Получить созданные паки пользователя
export const getUserCreatedPacksNew = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;

    const query = `
      SELECT sp.*, COUNT(DISTINCT o.id) as sales_count
      FROM sound_packs sp
      LEFT JOIN orders o ON sp.id = o.pack_id AND o.status = 'paid'
      WHERE sp.user_id = $1
      GROUP BY sp.id
      ORDER BY sp.created_at DESC
    `;

    const result = await pool.query(query, [userId]);

    res.json({ packs: result.rows });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get user created packs' });
  }
};

// Получить approved паки для магазина
export const getApprovedPacksNew = async (req: AuthRequest, res: Response) => {
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
      LEFT JOIN orders o ON sp.id = o.pack_id AND o.status = 'paid'
      WHERE sp.status = 'approved'
    `;

    const params: any[] = [];

    if (search) {
      query += ` AND (sp.title ILIKE $${params.length + 1} OR sp.description ILIKE $${params.length + 1})`;
      params.push(`%${search}%`);
    }

    query += ` GROUP BY sp.id, u.username, u.hashtag, u.avatar_url`;

    const validSorts = ['created_at', 'title', 'price', 'avg_rating', 'sales_count'];
    const sortField = validSorts.includes(sort as string) ? sort : 'created_at';
    const sortOrder = order === 'ASC' ? 'ASC' : 'DESC';

    query += ` ORDER BY ${sortField} ${sortOrder}`;
    query += ` LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);

    res.json({
      packs: result.rows,
      pagination: {
        page,
        limit,
        total: result.rows.length
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get packs' });
  }
};

// Купить пак
export const buyPackNew = async (req: AuthRequest, res: Response) => {
  const client = await pool.connect();

  try {
    const { id } = req.params;
    const buyerId = req.user!.userId;


    const packQuery = `
      SELECT sp.*, u.username as seller_name
      FROM sound_packs sp
      JOIN users u ON sp.user_id = u.id
      WHERE sp.id = $1 AND sp.status = 'approved'
    `;
    const packResult = await client.query(packQuery, [id]);

    if (packResult.rows.length === 0) {
      return res.status(404).json({ error: 'Pack not found or not approved' });
    }

    const pack = packResult.rows[0];

    if (pack.user_id === buyerId) {
      return res.status(400).json({ error: 'Cannot buy your own pack' });
    }

    const existingOrderQuery = `
      SELECT id FROM orders
      WHERE pack_id = $1 AND buyer_id = $2 AND status = 'paid'
    `;
    const existingOrderResult = await client.query(existingOrderQuery, [id, buyerId]);

    if (existingOrderResult.rows.length > 0) {
      return res.status(400).json({ error: 'Pack already purchased' });
    }

    await client.query('BEGIN');

    const balanceQuery = `
      SELECT available_balance FROM user_balance WHERE user_id = $1
    `;
    const balanceResult = await client.query(balanceQuery, [buyerId]);
    const currentBalance = balanceResult.rows[0]?.available_balance || 0;

    if (currentBalance < pack.price) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Insufficient balance' });
    }

    const commission = Math.floor(pack.price * 0.15);
    const sellerEarnings = pack.price - commission;

    await client.query(`
      UPDATE user_balance
      SET available_balance = available_balance - $1
      WHERE user_id = $2
    `, [pack.price, buyerId]);

    await client.query(`
      INSERT INTO user_balance (user_id, available_balance, total_earned)
      VALUES ($1, $2, $2)
      ON CONFLICT (user_id) DO UPDATE SET
        available_balance = user_balance.available_balance + $2,
        total_earned = user_balance.total_earned + $2
    `, [pack.user_id, sellerEarnings]);

    const invoiceId = `manual-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    await client.query(`
      INSERT INTO orders (pack_id, buyer_id, seller_id, invoice_id, amount, currency, commission, seller_earnings, status)
      VALUES ($1, $2, $3, $4, $5, 'coins', $6, $7, 'paid')
    `, [id, buyerId, pack.user_id, invoiceId, pack.price, commission, sellerEarnings]);

    await client.query(`
      INSERT INTO user_packs (user_id, pack_id)
      VALUES ($1, $2)
      ON CONFLICT (user_id, pack_id) DO NOTHING
    `, [buyerId, id]);

    await client.query('COMMIT');

    res.json({ message: 'Pack purchased successfully' });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Failed to buy pack' });
  } finally {
    client.release();
  }
};

// Получить купленные паки
export const getUserPacksNew = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;

    const query = `
      SELECT DISTINCT ON (sp.id) sp.*,
             o.created_at as purchase_date,
             u.username as seller_username,
             u.avatar_url as seller_avatar,
             u.hashtag as seller_hashtag
      FROM orders o
      JOIN sound_packs sp ON o.pack_id = sp.id
      JOIN users u ON sp.user_id = u.id
      WHERE o.buyer_id = $1 AND o.status = 'paid'
      ORDER BY sp.id, o.created_at DESC
    `;

    const result = await pool.query(query, [userId]);
    res.json({ packs: result.rows });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get user packs' });
  }
};

// Скачать пак
export const downloadPackNew = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user!.userId;

    const purchaseCheckQuery = `
      SELECT 1 FROM orders
      WHERE buyer_id = $1 AND pack_id = $2 AND status = 'paid'
    `;
    const purchaseCheckResult = await pool.query(purchaseCheckQuery, [userId, id]);

    if (purchaseCheckResult.rows.length === 0) {
      return res.status(403).json({ error: 'You must purchase the pack to download it' });
    }

    const packQuery = `
      SELECT archive_url, title FROM sound_packs WHERE id = $1
    `;
    const packResult = await pool.query(packQuery, [id]);

    if (packResult.rows.length === 0) {
      return res.status(404).json({ error: 'Pack not found' });
    }

    const pack = packResult.rows[0];

    if (!pack.archive_url) {
      return res.status(404).json({ error: 'Archive not found' });
    }

    res.json({ downloadUrl: pack.archive_url, title: pack.title });
  } catch (error) {
    res.status(500).json({ error: 'Failed to download pack' });
  }
};
