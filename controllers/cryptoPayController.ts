import { Request, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import pool from '../config/database';

// Конфигурация Crypto Pay
const CRYPTO_PAY_API_KEY = '587082:AAIgjoqj1WcoCAY0TakHYyls5MCF9qcXA2S';
const CRYPTO_PAY_API_URL = 'https://pay.crypt.bot/api';

// Создать invoice для оплаты пака
export const createInvoice = async (req: AuthRequest, res: Response) => {
  const client = await pool.connect();
  
  try {
    const { packId } = req.body;
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!packId) {
      return res.status(400).json({ error: 'Pack ID is required' });
    }

    // Получаем информацию о паке
    const packQuery = `
      SELECT id, title, price
      FROM sound_packs
      WHERE id = $1 AND status = 'approved'
    `;
    const packResult = await client.query(packQuery, [packId]);

    if (packResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Pack not found' });
    }

    const pack = packResult.rows[0];
    const amount = pack.price || 10; // Цена в USDT

    // Создаем invoice через Crypto Pay API
    const invoiceData = {
      asset: 'USDT',
      amount: amount,
      description: `Purchase pack: ${pack.title}`,
      paid_btn_name: 'openUrl',
      paid_btn_url: `${process.env.FRONTEND_URL || 'https://loopera-lpr.vercel.app'}/shop`,
      allow_anonymous: false,
      expires_in: 3600 // 1 час
    };

    const response = await fetch(`${CRYPTO_PAY_API_URL}/createInvoice`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Crypto-Pay-API-Token': CRYPTO_PAY_API_KEY
      },
      body: JSON.stringify(invoiceData)
    });

    const invoiceResult = await response.json();

    console.log('Crypto Pay response:', invoiceResult);

    if (invoiceResult.ok !== true) {
      throw new Error(invoiceResult.error || 'Failed to create invoice');
    }

    const invoice = invoiceResult.result;

    // Сохраняем информацию о платеже в базе данных
    const paymentQuery = `
      INSERT INTO payments (user_id, pack_id, invoice_id, amount, currency, status, created_at)
      VALUES ($1, $2, $3, $4, $5, 'pending', NOW())
      RETURNING id
    `;
    const paymentResult = await client.query(paymentQuery, [
      userId,
      packId,
      invoice.invoice_id,
      amount,
      'USDT'
    ]);

    await client.query('COMMIT');

    res.json({
      success: true,
      invoice: {
        id: invoice.invoice_id,
        pay_url: invoice.pay_url,
        amount: invoice.amount,
        currency: invoice.asset,
        expires_at: new Date(invoice.expires * 1000).toISOString()
      }
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error creating invoice:', error);
    res.status(500).json({ error: 'Failed to create payment invoice' });
  } finally {
    client.release();
  }
};

// Получить статус invoice
export const getInvoiceStatus = async (req: Request, res: Response) => {
  try {
    const { invoiceId } = req.params;

    const response = await fetch(`${CRYPTO_PAY_API_URL}/getInvoices`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Crypto-Pay-API-Token': CRYPTO_PAY_API_KEY
      },
      body: JSON.stringify({
        invoice_ids: [invoiceId]
      })
    });

    const result = await response.json();

    if (result.ok !== true) {
      throw new Error(result.error || 'Failed to get invoice status');
    }

    const invoice = result.result.items[0];

    res.json({
      success: true,
      invoice: {
        id: invoice.invoice_id,
        status: invoice.status,
        amount: invoice.amount,
        currency: invoice.asset,
        paid_at: invoice.paid_at ? new Date(invoice.paid_at * 1000).toISOString() : null
      }
    });

  } catch (error) {
    console.error('Error getting invoice status:', error);
    res.status(500).json({ error: 'Failed to get invoice status' });
  }
};

// Обработка вебхуков от Crypto Pay
export const handleWebhook = async (req: Request, res: Response) => {
  const client = await pool.connect();
  
  try {
    const { update_type, payload } = req.body;

    if (update_type === 'invoice_paid') {
      const invoiceId = payload.invoice_id;
      const amount = payload.amount;
      const currency = payload.asset;

      // Проверяем, существует ли такой платеж в базе
      const paymentQuery = `
        SELECT id, user_id, pack_id, status
        FROM payments
        WHERE invoice_id = $1
      `;
      const paymentResult = await client.query(paymentQuery, [invoiceId]);

      if (paymentResult.rows.length === 0) {
        console.log('Payment not found in database:', invoiceId);
        return res.json({ ok: true });
      }

      const payment = paymentResult.rows[0];

      // Если платеж уже обработан
      if (payment.status === 'completed') {
        return res.json({ ok: true });
      }

      // Обновляем статус платежа
      await client.query('BEGIN');
      
      const updatePaymentQuery = `
        UPDATE payments
        SET status = 'completed', paid_at = NOW()
        WHERE id = $1
      `;
      await client.query(updatePaymentQuery, [payment.id]);

      // Добавляем запись о покупке пака
      const purchaseQuery = `
        INSERT INTO user_packs (user_id, pack_id, purchased_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (user_id, pack_id) DO NOTHING
      `;
      await client.query(purchaseQuery, [payment.user_id, payment.pack_id]);

      await client.query('COMMIT');

      console.log('Payment completed:', invoiceId);
    }

    res.json({ ok: true });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error handling webhook:', error);
    res.status(500).json({ error: 'Failed to handle webhook' });
  } finally {
    client.release();
  }
};

// Получить платежи пользователя
export const getUserPayments = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const query = `
      SELECT p.*, sp.title as pack_title
      FROM payments p
      LEFT JOIN sound_packs sp ON p.pack_id = sp.id
      WHERE p.user_id = $1
      ORDER BY p.created_at DESC
    `;
    const result = await pool.query(query, [userId]);

    res.json({
      success: true,
      payments: result.rows
    });

  } catch (error) {
    console.error('Error getting user payments:', error);
    res.status(500).json({ error: 'Failed to get payments' });
  }
};
