import { Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import archiver from 'archiver';
import { randomUUID } from 'crypto';
import pool from '../config/database';
import { AuthRequest } from '../middleware/auth';
import { createPayment, isYookassaConfigured } from '../services/yookassaService';
import { buyPackLockKey, calcSaleCommission, completePackOrder } from '../services/packOrderService';
import { enrichPackWithPricing, calcPackPricing } from '../services/packPricingService';
import { notifyWithdrawalRequest } from '../services/emailService';
import { resolveStaffRole } from '../middleware/simpleAdmin';
import {
  getSignedDownloadUrl,
  isObjectStorageEnabled,
  localFileExists,
  localPathFromUploadUrl,
  persistMulterFile,
} from '../services/objectStorage';

function resolveUploadPath(uploadUrl: string): string {
  const relative = uploadUrl.replace(/^\/uploads\//, 'uploads/');
  return path.join(process.cwd(), relative);
}

function sanitizePackFilename(title: string): string {
  const name = title
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
  const base = name || 'Loopera Pack';
  return /\.zip$/i.test(base) ? base : `${base}.zip`;
}

function setZipDownloadHeaders(res: Response, filename: string) {
  const asciiFallback = filename
    .replace(/[^\x20-\x7E]/g, '_')
    .replace(/"/g, "'");
  const encoded = encodeURIComponent(filename);
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`
  );
}

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
    // Allow audio files, zip files, text files, and images
    const allowedExtensions = ['.mp3', '.wav', '.zip', '.txt', '.pdf', '.jpg', '.jpeg', '.png', '.webp'];
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
             COUNT(DISTINCT up.id) as sales_count
      FROM sound_packs sp
      JOIN users u ON sp.user_id = u.id
      LEFT JOIN pack_ratings pr ON sp.id = pr.pack_id
      LEFT JOIN user_packs up ON sp.id = up.pack_id
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
      packs: result.rows.map(enrichPackWithPricing),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
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
             COUNT(pr.id) as rating_count,
             COALESCE(SUM(CASE WHEN o.status = 'paid' THEN 1 ELSE 0 END), 0) as sales_count
      FROM sound_packs sp
      JOIN users u ON sp.user_id = u.id
      LEFT JOIN pack_ratings pr ON sp.id = pr.pack_id
      LEFT JOIN orders o ON sp.id = o.pack_id
      WHERE sp.id = $1 AND sp.status = 'approved'
      GROUP BY sp.id, u.username, u.hashtag, u.avatar_url
    `;

    const packResult = await pool.query(packQuery, [id]);

    if (packResult.rows.length === 0) {
      return res.status(404).json({ error: 'Pack not found' });
    }

    const pack = enrichPackWithPricing(packResult.rows[0]);
    delete pack.archive_url;
    delete pack.voice_tag_file;
    delete pack.text_file;

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
    res.status(500).json({ error: 'Failed to get pack' });
  }
};

// Создать новый пак с архивом
export const createPack = async (req: AuthRequest, res: Response) => {
  const client = await pool.connect();

  try {
    const { title, description, price, voice_tag } = req.body;
    const userId = req.user!.userId;

    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    // Проверяем минимальную цену пака
    if (!price || price < 50) {
      return res.status(400).json({ error: 'Минимальная цена пака: 50 ₽' });
    }

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
    const coverFile = files['cover'] ? files['cover'][0] : undefined;

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

    const archiveUrl = await persistMulterFile(archiveFile, 'shop');
    const previewUrl1 = previewFile1 ? await persistMulterFile(previewFile1, 'shop') : null;
    const previewUrl2 = previewFile2 ? await persistMulterFile(previewFile2, 'shop') : null;
    const voiceTagUrl = voiceTagFile ? await persistMulterFile(voiceTagFile, 'shop') : null;
    const textFileUrl = textFile ? await persistMulterFile(textFile, 'shop') : null;
    const coverUrl = coverFile ? await persistMulterFile(coverFile, 'shop') : null;

    await client.query('BEGIN');

    // Создаем пак
    const packQuery = `
      INSERT INTO sound_packs (title, description, price, user_id, voice_tag, status, archive_url, preview_url, preview_url_2, voice_tag_file, text_file, cover_url)
      VALUES ($1, $2, $3, $4, $5, 'approved', $6, $7, $8, $9, $10, $11)
      RETURNING *
    `;
    const packResult = await client.query(packQuery, [
      title,
      description,
      price,
      userId,
      voice_tag,
      archiveUrl,
      previewUrl1,
      previewUrl2,
      voiceTagUrl,
      textFileUrl,
      coverUrl,
    ]);
    const pack = packResult.rows[0];

    await client.query('COMMIT');

    res.status(201).json({
      ...pack,
      message: 'Pack published successfully'
    });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Failed to create pack' });
  } finally {
    client.release();
  }
};

// Купить пак: card (ЮKassa) или balance (кошелёк Loopera)
export const buyPack = async (req: AuthRequest, res: Response) => {
  const client = await pool.connect();

  try {
    const { id } = req.params;
    const packId = parseInt(String(id), 10);
    const buyerId = req.user!.userId;
    const paymentMethod = String(req.body?.payment_method || 'card').toLowerCase() === 'balance'
      ? 'balance'
      : 'card';

    if (!buyerId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }
    if (!Number.isFinite(packId) || packId < 1) {
      return res.status(400).json({ error: 'Invalid pack id' });
    }

    await client.query('BEGIN');
    // Serialize concurrent purchases of the same pack by the same buyer
    await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [
      buyPackLockKey(buyerId, packId).toString(),
    ]);

    const packQuery = `
      SELECT sp.*, u.username as seller_name
      FROM sound_packs sp
      JOIN users u ON sp.user_id = u.id
      WHERE sp.id = $1 AND sp.status = 'approved'
    `;
    const packResult = await client.query(packQuery, [packId]);

    if (packResult.rows.length === 0) {
      const unapprovedResult = await client.query(
        `SELECT status FROM sound_packs WHERE id = $1`,
        [packId]
      );
      await client.query('ROLLBACK');
      if (unapprovedResult.rows.length > 0) {
        return res.status(400).json({ error: 'Pack is not approved yet. Please wait for moderation.' });
      }
      return res.status(404).json({ error: 'Pack not found' });
    }

    const pack = packResult.rows[0];

    if (pack.user_id === buyerId) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Нельзя купить свой пак' });
    }

    if (!pack.price || pack.price < 1) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'У пака не задана цена' });
    }

    const existingPackResult = await client.query(
      `SELECT id FROM user_packs WHERE user_id = $1 AND pack_id = $2`,
      [buyerId, packId]
    );

    if (existingPackResult.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Вы уже приобрели этот пак. Проверьте раздел «Покупки» в профиле.' });
    }

    const recentPending = await client.query(
      `SELECT id FROM orders
       WHERE buyer_id = $1 AND pack_id = $2 AND status = 'pending'
         AND created_at > NOW() - INTERVAL '30 minutes'
       LIMIT 1`,
      [buyerId, packId],
    );
    if (recentPending.rows.length > 0 && paymentMethod === 'card') {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'Оплата этого пака уже создана. Завершите её или подождите несколько минут.',
        code: 'PENDING_PAYMENT',
      });
    }

    const pricing = calcPackPricing(pack.price, pack.discount_percent);
    const chargePrice = pricing.final_price;
    const { commission, sellerEarnings } = calcSaleCommission(chargePrice);

    if (paymentMethod === 'balance') {
      const debit = await client.query(
        `UPDATE user_balance
         SET available_balance = available_balance - $1,
             updated_at = CURRENT_TIMESTAMP
         WHERE user_id = $2 AND available_balance >= $1
         RETURNING available_balance`,
        [chargePrice, buyerId],
      );

      if (debit.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: 'Недостаточно средств на балансе. Пополните баланс или оплатите картой.',
          code: 'INSUFFICIENT_BALANCE',
        });
      }

      const invoiceId = `balance_${randomUUID()}`;
      await client.query(
        `INSERT INTO orders (pack_id, buyer_id, seller_id, invoice_id, amount, price, currency, commission, seller_earnings, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'RUB', $7, $8, 'pending')`,
        [packId, buyerId, pack.user_id, invoiceId, chargePrice, chargePrice, commission, sellerEarnings],
      );

      const completed = await completePackOrder(client, invoiceId);
      if (!completed.ok) {
        await client.query('ROLLBACK');
        return res.status(500).json({ error: 'Не удалось завершить покупку' });
      }

      await client.query('COMMIT');
      return res.json({
        message: 'Пак куплен',
        payment_method: 'balance',
        purchased: true,
        balance: debit.rows[0].available_balance,
      });
    }

    if (!isYookassaConfigured()) {
      await client.query('ROLLBACK');
      return res.status(503).json({ error: 'Платёжная система не настроена. Обратитесь к администратору.' });
    }

    // Release DB lock before calling YooKassa (network I/O)
    const packTitle = pack.title as string;
    const sellerId = pack.user_id as number;
    const listPrice = pack.price as number;
    const discountPercent = pricing.discount_percent;
    await client.query('COMMIT');

    const frontendUrl = (process.env.FRONTEND_URL || 'https://loopera.ru').replace(/\/$/, '');
    const returnUrl = `${frontendUrl}/shop/purchase/${packId}?payment=success`;

    const payment = await createPayment({
      amountRub: chargePrice,
      description: `Loopera: ${packTitle}`,
      returnUrl,
      metadata: {
        pack_id: String(packId),
        buyer_id: String(buyerId),
        type: 'pack_purchase',
        list_price: String(listPrice),
        discount_percent: String(discountPercent),
      },
    });

    if (!payment.confirmation?.confirmation_url) {
      return res.status(500).json({ error: 'Не удалось получить ссылку на оплату' });
    }

    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [
      buyPackLockKey(buyerId, packId).toString(),
    ]);

    const ownedAgain = await client.query(
      `SELECT id FROM user_packs WHERE user_id = $1 AND pack_id = $2`,
      [buyerId, packId],
    );
    if (ownedAgain.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Вы уже приобрели этот пак. Проверьте раздел «Покупки» в профиле.' });
    }

    await client.query(
      `INSERT INTO orders (pack_id, buyer_id, seller_id, invoice_id, amount, price, currency, commission, seller_earnings, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'RUB', $7, $8, 'pending')`,
      [packId, buyerId, sellerId, payment.id, chargePrice, chargePrice, commission, sellerEarnings]
    );

    await client.query('COMMIT');

    res.json({
      confirmation_url: payment.confirmation.confirmation_url,
      payment_id: payment.id,
      payment_method: 'card',
    });
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore
    }
    console.error('buyPack error:', error);
    const message = error instanceof Error ? error.message : 'Failed to buy pack';
    res.status(500).json({ error: message.includes('YooKassa') ? 'Ошибка платёжной системы. Попробуйте позже.' : 'Failed to buy pack' });
  } finally {
    client.release();
  }
};

/** Пополнение баланса через ЮKassa */
export const createBalanceTopUp = async (req: AuthRequest, res: Response) => {
  const client = await pool.connect();
  try {
    const userId = req.user!.userId;
    const amount = Math.round(Number(req.body?.amount));

    if (!userId) {
      return res.status(401).json({ error: 'Не авторизован' });
    }
    if (!Number.isFinite(amount) || amount < 100 || amount > 100000) {
      return res.status(400).json({ error: 'Сумма пополнения: от 100 до 100 000 ₽' });
    }
    if (!isYookassaConfigured()) {
      return res.status(503).json({ error: 'Платёжная система не настроена' });
    }

    const frontendUrl = (process.env.FRONTEND_URL || 'https://loopera.ru').replace(/\/$/, '');
    const returnUrl = `${frontendUrl}/profile?topup=success`;

    await client.query('BEGIN');

    const payment = await createPayment({
      amountRub: amount,
      description: `Loopera: пополнение баланса ${amount} ₽`,
      returnUrl,
      metadata: {
        type: 'balance_topup',
        buyer_id: String(userId),
        amount: String(amount),
      },
    });

    if (!payment.confirmation?.confirmation_url) {
      await client.query('ROLLBACK');
      return res.status(500).json({ error: 'Не удалось создать платёж' });
    }

    await client.query(
      `INSERT INTO top_ups (user_id, invoice_id, amount, currency, status)
       VALUES ($1, $2, $3, 'RUB', 'pending')
       ON CONFLICT (invoice_id) DO NOTHING`,
      [userId, payment.id, amount],
    );

    await client.query('COMMIT');

    res.status(201).json({
      confirmation_url: payment.confirmation.confirmation_url,
      payment_id: payment.id,
      amount,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('createBalanceTopUp error:', error);
    res.status(500).json({ error: 'Не удалось создать пополнение' });
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
    res.status(500).json({ error: 'Failed to get balance' });
  }
};

// Создать заявку на вывод средств (резервирует сумму на балансе)
export const createWithdrawal = async (req: AuthRequest, res: Response) => {
  const client = await pool.connect();

  try {
    const { amount, phone, bank, withdrawal_method = 'sbp' } = req.body;
    const userId = req.user!.userId;
    const withdrawAmount = Number(amount);

    if (!phone || !bank) {
      return res.status(400).json({ error: 'Укажите телефон и банк для вывода' });
    }

    if (!withdrawAmount || withdrawAmount < 1000) {
      return res.status(400).json({ error: 'Минимальная сумма вывода: 1000 ₽' });
    }

    let platformCommission = Math.round(withdrawAmount * 0.15);
    let methodCommission = 0;
    switch (withdrawal_method) {
      case 'paypal':
        methodCommission = Math.round(withdrawAmount * 0.05);
        break;
      case 'card':
        methodCommission = Math.round(withdrawAmount * 0.02);
        break;
      case 'sbp':
      default:
        methodCommission = 0;
        break;
    }
    const commission = platformCommission + methodCommission;

    await client.query('BEGIN');

    const reserveResult = await client.query(
      `UPDATE user_balance
       SET available_balance = available_balance - $1,
           pending_balance = pending_balance + $1,
           updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $2 AND available_balance >= $1
       RETURNING available_balance, pending_balance`,
      [withdrawAmount, userId]
    );

    if (reserveResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Недостаточно средств на балансе' });
    }

    const withdrawalResult = await client.query(
      `INSERT INTO withdrawals (user_id, amount, phone, bank, withdrawal_method, commission)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [userId, withdrawAmount, phone, bank, withdrawal_method, commission]
    );

    await client.query('COMMIT');

    const usernameRow = await pool.query(`SELECT username FROM users WHERE id = $1`, [userId]);
    void notifyWithdrawalRequest({
      id: withdrawalResult.rows[0].id,
      userId,
      username: usernameRow.rows[0]?.username,
      amount: withdrawAmount,
      phone,
      bank,
      method: withdrawal_method,
    });

    res.status(201).json(withdrawalResult.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Failed to create withdrawal' });
  } finally {
    client.release();
  }
};

// Получить паки пользователя
export const getUserPacks = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;

    const query = `
      SELECT sp.*,
             up.purchased_at as purchase_date,
             u.username as seller_username,
             u.avatar_url as seller_avatar,
             u.hashtag as seller_hashtag
      FROM user_packs up
      JOIN sound_packs sp ON up.pack_id = sp.id
      JOIN users u ON sp.user_id = u.id
      WHERE up.user_id = $1 AND sp.user_id != $1
      ORDER BY up.purchased_at DESC
    `;

    const result = await pool.query(query, [userId]);

    res.json({ packs: result.rows });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get user packs' });
  }
};

// Получить паки созданные пользователем
export const getUserCreatedPacks = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;

    const query = `
      SELECT sp.*,
             COUNT(DISTINCT up.id) as sales_count
      FROM sound_packs sp
      LEFT JOIN user_packs up ON sp.id = up.pack_id
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

// Получить историю транзакций
export const getTransactionHistory = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;

    const query = `
      SELECT
        'purchase' as type,
        o.paid_at as created_at,
        o.amount::integer as amount,
        'RUB' as currency,
        sp.title as description,
        o.invoice_id
      FROM orders o
      JOIN sound_packs sp ON sp.id = o.pack_id
      WHERE o.buyer_id = $1 AND o.status = 'paid'

      UNION ALL

      SELECT
        'sale' as type,
        o.paid_at as created_at,
        o.seller_earnings::integer as amount,
        'RUB' as currency,
        sp.title as description,
        o.invoice_id
      FROM orders o
      JOIN sound_packs sp ON sp.id = o.pack_id
      WHERE o.seller_id = $1 AND o.status = 'paid'

      UNION ALL

      SELECT
        'withdrawal' as type,
        w.created_at,
        w.amount,
        'RUB' as currency,
        'Вывод средств' as description,
        w.id::text as invoice_id
      FROM withdrawals w
      WHERE w.user_id = $1 AND w.status IN ('pending', 'completed')

      ORDER BY created_at DESC
      LIMIT 50
    `;

    const result = await pool.query(query, [userId]);

    res.json({ transactions: result.rows });
  } catch (error) {
    console.error('getTransactionHistory error:', error);
    res.status(500).json({ error: 'Failed to get transaction history' });
  }
};

// Добавить рейтинг паку
export const ratePack = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { rating, review } = req.body;
    const userId = req.user!.userId;

    // Проверяем что пользователь купил пак (либо через orders, либо через user_packs)
    const purchaseCheckQuery = `
      SELECT id
      FROM orders
      WHERE pack_id = $1 AND buyer_id = $2 AND status = 'paid'
      UNION
      SELECT id
      FROM user_packs
      WHERE pack_id = $1 AND user_id = $2
    `;
    const purchaseCheckResult = await pool.query(purchaseCheckQuery, [id, userId]);

    if (purchaseCheckResult.rows.length === 0) {
      return res.status(403).json({ error: 'You must purchase the pack to rate it' });
    }

    // Проверяем есть ли уже оценка
    const existingRatingQuery = `
      SELECT rating, review
      FROM pack_ratings
      WHERE pack_id = $1 AND user_id = $2
    `;
    const existingRatingResult = await pool.query(existingRatingQuery, [id, userId]);

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
    res.status(500).json({ error: 'Failed to rate pack' });
  }
};

// Скачать пак (с проверкой покупки)
export const downloadPack = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user!.userId;

    const purchaseCheckQuery = `
      SELECT 1 FROM orders
      WHERE buyer_id = $1 AND pack_id = $2 AND status = 'paid'
      UNION
      SELECT 1 FROM user_packs
      WHERE user_id = $1 AND pack_id = $2
      LIMIT 1
    `;
    const purchaseCheckResult = await pool.query(purchaseCheckQuery, [userId, id]);

    if (purchaseCheckResult.rows.length === 0) {
      return res.status(403).json({ error: 'You must purchase the pack to download it' });
    }

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

    const downloadName = sanitizePackFilename(pack.title);

    // Prefer short-lived signed URL when object storage is enabled and no extras to bundle
    const voicePath = pack.voice_tag_file ? localPathFromUploadUrl(pack.voice_tag_file) : null;
    const textPath = pack.text_file ? localPathFromUploadUrl(pack.text_file) : null;
    const hasVoiceTag = Boolean(voicePath && fs.existsSync(voicePath));
    const hasTextFile = Boolean(textPath && fs.existsSync(textPath));

    if (!hasVoiceTag && !hasTextFile && isObjectStorageEnabled()) {
      const signed = await getSignedDownloadUrl(pack.archive_url, 600, downloadName);
      if (signed) {
        return res.json({ download_url: signed, expires_in: 600 });
      }
    }

    const archivePath = localFileExists(pack.archive_url)
      ? localPathFromUploadUrl(pack.archive_url)
      : resolveUploadPath(pack.archive_url);

    if (!fs.existsSync(archivePath)) {
      // Last resort: redirect to signed S3 even if we wanted to re-zip
      if (isObjectStorageEnabled()) {
        const signed = await getSignedDownloadUrl(pack.archive_url, 600, downloadName);
        if (signed) {
          return res.json({ download_url: signed, expires_in: 600 });
        }
      }
      return res.status(404).json({ error: 'File not found on server' });
    }

    if (!hasVoiceTag && !hasTextFile) {
      setZipDownloadHeaders(res, downloadName);
      fs.createReadStream(archivePath).pipe(res);
      return;
    }

    setZipDownloadHeaders(res, downloadName);
    const zip = archiver('zip', { zlib: { level: 9 } });

    zip.on('error', (err: Error) => {
      console.error('downloadPack archiver error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to create download archive' });
      } else {
        res.end();
      }
    });

    zip.pipe(res);

    const loopsName = downloadName.replace(/\.zip$/i, '') + ' - Loops.zip';
    zip.file(archivePath, { name: loopsName });

    if (hasVoiceTag && voicePath) {
      const voiceExt = path.extname(voicePath) || '.mp3';
      zip.file(voicePath, { name: `Voice Tag${voiceExt}` });
    }

    if (hasTextFile && textPath) {
      const textExt = path.extname(textPath) || '.txt';
      zip.file(textPath, { name: `Info${textExt}` });
    }

    await zip.finalize();
  } catch (error) {
    console.error('downloadPack error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to download pack' });
    }
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
    res.status(500).json({ error: 'Failed to credit balance' });
  }
};

// Ручное начисление баланса администратором
export const manualCreditBalance = async (req: AuthRequest, res: Response) => {
  try {
    const { username, amount } = req.body;
    const adminId = req.user!.userId;

    const staff = await resolveStaffRole(Number(adminId));
    if (staff !== 'admin') {
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

      // Проверяем есть ли запись в user_balance
      const balanceCheck = await client.query(
        'SELECT id FROM user_balance WHERE user_id = $1',
        [userId]
      );

      if (balanceCheck.rows.length === 0) {
        // Создаем запись если её нет
        await client.query(
          `INSERT INTO user_balance (user_id, available_balance, total_earned)
           VALUES ($1, $2, $2)`,
          [userId, amount]
        );
      } else {
        // Начисляем баланс
        await client.query(
          `UPDATE user_balance
           SET available_balance = available_balance + $1,
               updated_at = CURRENT_TIMESTAMP
           WHERE user_id = $2`,
          [amount, userId]
        );
      }

      // Записываем транзакцию с уникальным invoice_id
      const invoiceId = `manual_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      await client.query(
        `INSERT INTO top_ups (user_id, invoice_id, amount, currency, status)
         VALUES ($1, $2, $3, 'coins', 'completed')`,
        [userId, invoiceId, amount]
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
    res.status(500).json({ error: 'Failed to manually credit balance' });
  }
};

// Получить баланс по Telegram ID
/** Disabled: leaked balances by telegram id. Use authenticated /balance/my. */
export const getBalanceByTelegramId = async (_req: Request, res: Response) => {
  return res.status(410).json({
    error: 'Endpoint removed. Use GET /api/shop/balance/my with auth.',
    code: 'GONE',
  });
};

// Получить баланс пользователя по username (для админа)
export const getUserBalanceByUsername = async (req: AuthRequest, res: Response) => {
  try {
    const { username } = req.params;

    const userId = req.user?.userId ?? req.user?.id;
    const staff = userId ? await resolveStaffRole(Number(userId)) : null;
    if (staff !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const query = `
      SELECT u.username, u.email, ub.available_balance, ub.pending_balance, ub.total_earned
      FROM users u
      LEFT JOIN user_balance ub ON u.id = ub.user_id
      WHERE u.username = $1
    `;
    const result = await pool.query(query, [username]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = result.rows[0];
    res.json({
      username: user.username,
      email: user.email,
      available_balance: user.available_balance || 0,
      pending_balance: user.pending_balance || 0,
      total_earned: user.total_earned || 0
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get user balance' });
  }
};

// Поиск пользователей по username для автодополнения
export const searchUsers = async (req: AuthRequest, res: Response) => {
  try {
    const { q } = req.query;

    if (!q || typeof q !== 'string') {
      return res.status(400).json({ error: 'Query parameter is required' });
    }

    const userId = req.user?.userId ?? req.user?.id;
    const staff = userId ? await resolveStaffRole(Number(userId)) : null;
    if (staff !== 'admin') {
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
    res.status(500).json({ error: 'Failed to search users' });
  }
};

// Ручное списание баланса с комиссией (для вывода средств)
export const manualDebitBalance = async (req: AuthRequest, res: Response) => {
  try {
    const { username, amount, currency } = req.body;
    const adminId = req.user!.userId;

    const staff = await resolveStaffRole(Number(adminId));
    if (staff !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    if (!username || !amount) {
      return res.status(400).json({ error: 'username and amount are required' });
    }

    const withdrawalAmount = parseInt(amount);

    // Проверяем минимальную сумму вывода
    if (withdrawalAmount < 1000) {
      return res.status(400).json({ error: 'Минимальная сумма для вывода: 1000 ₽' });
    }

    const commission = Math.round(withdrawalAmount * 0.15); // 15% commission
    const netAmount = withdrawalAmount - commission;

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Находим пользователя по username
      const userCheck = await client.query(
        'SELECT u.id, ub.available_balance FROM users u LEFT JOIN user_balance ub ON u.id = ub.user_id WHERE u.username = $1',
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
        `INSERT INTO withdrawals (user_id, amount, phone, bank, status, processed_by, processed_at, withdrawal_method, commission)
         VALUES ($1, $2, 'manual', 'manual', 'completed', $3, CURRENT_TIMESTAMP, 'manual', $4)`,
        [userId, withdrawalAmount, adminId, commission]
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
    res.status(500).json({ error: 'Failed to report pack' });
  }
};

// Удалить пак (soft delete - только изменение статуса)
export const deletePack = async (req: AuthRequest, res: Response) => {
  const client = await pool.connect();

  try {
    const { id } = req.params;
    const userId = req.user!.userId;
    const isAdmin = req.user!.role === 'admin';

    // Получаем информацию о паке
    const packQuery = `
      SELECT sp.*, u.username
      FROM sound_packs sp
      JOIN users u ON sp.user_id = u.id
      WHERE sp.id = $1
    `;
    const packResult = await client.query(packQuery, [id]);

    if (packResult.rows.length === 0) {
      return res.status(404).json({ error: 'Pack not found' });
    }

    const pack = packResult.rows[0];

    // Проверяем права: либо владелец, либо админ
    if (pack.user_id !== userId && !isAdmin) {
      return res.status(403).json({ error: 'You can only delete your own packs' });
    }

    // Проверяем что пак не был куплен (защита от удаления проданных паков)
    const salesCheckQuery = `
      SELECT COUNT(*) as sales_count
      FROM user_packs
      WHERE pack_id = $1
    `;
    const salesCheckResult = await client.query(salesCheckQuery, [id]);
    const salesCount = parseInt(salesCheckResult.rows[0].sales_count);

    if (salesCount > 0 && !isAdmin) {
      return res.status(400).json({ error: 'Cannot delete pack that has been purchased. Contact admin for assistance.' });
    }

    await client.query('BEGIN');

    // Soft delete - меняем статус на 'deleted'
    const deleteQuery = `
      UPDATE sound_packs
      SET status = 'deleted',
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING *
    `;
    const deleteResult = await client.query(deleteQuery, [id]);

    await client.query('COMMIT');

    res.json({ message: 'Pack deleted successfully', pack: deleteResult.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Failed to delete pack' });
  } finally {
    client.release();
  }
};

// Получить все паки (для админа)
export const getAllPacksAdmin = async (req: AuthRequest, res: Response) => {
  const client = await pool.connect();

  try {
    const userId = req.user?.userId ?? req.user?.id;
    const staff = userId ? await resolveStaffRole(Number(userId)) : null;
    if (!staff) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { page = 1, limit = 50, status } = req.query;
    const offset = (parseInt(page as string) - 1) * parseInt(limit as string);

    let query = `
      SELECT sp.*, u.username, u.hashtag, u.avatar_url, u.email,
             COALESCE(AVG(pr.rating), 0) as avg_rating,
             COUNT(pr.id) as rating_count,
             COALESCE(SUM(CASE WHEN o.status = 'paid' THEN 1 ELSE 0 END), 0) as sales_count
      FROM sound_packs sp
      JOIN users u ON sp.user_id = u.id
      LEFT JOIN pack_ratings pr ON sp.id = pr.pack_id
      LEFT JOIN orders o ON sp.id = o.pack_id
    `;

    const params: any[] = [];
    let paramCount = 0;

    if (status && status !== 'all') {
      query += ` WHERE sp.status = $${++paramCount}`;
      params.push(status);
    }

    query += `
      GROUP BY sp.id, u.username, u.hashtag, u.avatar_url, u.email
      ORDER BY sp.created_at DESC
      LIMIT $${++paramCount} OFFSET $${++paramCount}
    `;

    params.push(parseInt(limit as string), offset);

    const result = await client.query(query, params);

    // Получаем общее количество
    let countQuery = 'SELECT COUNT(*) FROM sound_packs';
    const countParams: any[] = [];

    if (status && status !== 'all') {
      countQuery += ' WHERE status = $1';
      countParams.push(status);
    }

    const countResult = await client.query(countQuery, countParams);
    const totalPacks = parseInt(countResult.rows[0].count);

    res.json({
      packs: result.rows,
      pagination: {
        totalPacks,
        page: parseInt(page as string),
        limit: parseInt(limit as string),
        totalPages: Math.ceil(totalPacks / parseInt(limit as string))
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get packs' });
  } finally {
    client.release();
  }
};
