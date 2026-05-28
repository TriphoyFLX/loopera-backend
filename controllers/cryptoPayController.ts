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
    const sellerId = pack.user_id;
    
    // Рассчитываем комиссию (20% платформе, 80% продавцу)
    const commission = amount * 0.20;
    const sellerEarnings = amount - commission;

    // Создаем invoice через Crypto Pay API
    const invoiceData = {
      asset: 'USDT',
      amount: amount,
      description: `Purchase pack: ${pack.title}`,
      paid_btn_name: 'callback',
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

    // Сохраняем информацию о заказе в базе данных
    const orderQuery = `
      INSERT INTO orders (buyer_id, pack_id, seller_id, invoice_id, amount, currency, commission, seller_earnings, status, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', NOW())
      RETURNING id
    `;
    const orderResult = await client.query(orderQuery, [
      userId,
      packId,
      sellerId,
      invoice.invoice_id,
      amount,
      'USDT',
      commission,
      sellerEarnings
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

      // Проверяем, существует ли такой заказ в базе
      const orderQuery = `
        SELECT id, buyer_id, seller_id, pack_id, seller_earnings, status
        FROM orders
        WHERE invoice_id = $1
      `;
      const orderResult = await client.query(orderQuery, [invoiceId]);

      if (orderResult.rows.length === 0) {
        console.log('Order not found in database:', invoiceId);
        return res.json({ ok: true });
      }

      const order = orderResult.rows[0];

      // Если заказ уже обработан
      if (order.status === 'paid') {
        return res.json({ ok: true });
      }

      await client.query('BEGIN');
      
      // Обновляем статус заказа
      const updateOrderQuery = `
        UPDATE orders
        SET status = 'paid', paid_at = NOW()
        WHERE id = $1
      `;
      await client.query(updateOrderQuery, [order.id]);

      // Добавляем запись о покупке пака
      const purchaseQuery = `
        INSERT INTO user_packs (user_id, pack_id, purchased_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (user_id, pack_id) DO NOTHING
      `;
      await client.query(purchaseQuery, [order.buyer_id, order.pack_id]);

      // Начисляем баланс продавцу (в internal balance)
      const balanceQuery = `
        INSERT INTO user_balance (user_id, available_balance, total_earned, created_at, updated_at)
        VALUES ($1, $2, $2, NOW(), NOW())
        ON CONFLICT (user_id) DO UPDATE SET
          available_balance = user_balance.available_balance + $2,
          total_earned = user_balance.total_earned + $2,
          updated_at = NOW()
      `;
      await client.query(balanceQuery, [order.seller_id, order.seller_earnings]);

      await client.query('COMMIT');

      console.log('Order paid:', invoiceId, 'Seller credited:', order.seller_earnings);
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

// Получить заказы пользователя
export const getUserPayments = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;

    const query = `
      SELECT o.*, sp.title as pack_title, u.username as seller_username
      FROM orders o
      LEFT JOIN sound_packs sp ON o.pack_id = sp.id
      LEFT JOIN users u ON o.seller_id = u.id
      WHERE o.buyer_id = $1
      ORDER BY o.created_at DESC
    `;
    const result = await pool.query(query, [userId]);

    res.json({
      success: true,
      orders: result.rows
    });

  } catch (error) {
    console.error('Error getting user orders:', error);
    res.status(500).json({ error: 'Failed to get orders' });
  }
};
