import { Request, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import pool from '../config/database';

// Конфигурация Crypto Pay
const CRYPTO_PAY_API_KEY = '587082:AAIgjoqj1WcoCAY0TakHYyls5MCF9qcXA2S';
const CRYPTO_PAY_API_URL = 'https://pay.crypt.bot/api';

// Создать invoice для пополнения коинов
export const createTopUpInvoice = async (req: AuthRequest, res: Response) => {
  const client = await pool.connect();
  
  try {
    const { amount } = req.body; // amount in rubles = coins
    const userId = req.user!.userId;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!amount || amount < 1) {
      return res.status(400).json({ error: 'Amount must be at least 1 ruble' });
    }

    // Создаем invoice через Crypto Pay API
    const invoiceData = {
      asset: 'USDT',
      amount: amount / 100, // Convert rubles to USDT (approximate rate)
      description: `Top up ${amount} coins`,
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

    // Сохраняем информацию о пополнении в базе данных
    const topUpQuery = `
      INSERT INTO top_ups (user_id, invoice_id, amount, currency, status, created_at)
      VALUES ($1, $2, $3, $4, 'pending', NOW())
      RETURNING id
    `;
    const topUpResult = await client.query(topUpQuery, [
      userId,
      invoice.invoice_id,
      amount,
      'coins'
    ]);

    await client.query('COMMIT');

    res.json({
      success: true,
      invoice: {
        id: invoice.invoice_id,
        pay_url: invoice.pay_url,
        amount: amount,
        currency: 'coins',
        expires_at: invoice.expiration_date || invoice.expires
      }
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error creating top-up invoice:', error);
    res.status(500).json({ error: 'Failed to create top-up invoice' });
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

      // Проверяем, является ли это пополнением коинов
      const topUpQuery = `
        SELECT id, user_id, amount, status
        FROM top_ups
        WHERE invoice_id = $1
      `;
      const topUpResult = await client.query(topUpQuery, [invoiceId]);

      if (topUpResult.rows.length > 0) {
        const topUp = topUpResult.rows[0];

        // Если пополнение уже обработано
        if (topUp.status === 'completed') {
          return res.json({ ok: true });
        }

        await client.query('BEGIN');
        
        // Обновляем статус пополнения
        const updateTopUpQuery = `
          UPDATE top_ups
          SET status = 'completed'
          WHERE id = $1
        `;
        await client.query(updateTopUpQuery, [topUp.id]);

        // Начисляем коины пользователю
        const balanceQuery = `
          INSERT INTO user_balance (user_id, available_balance, total_earned, created_at, updated_at)
          VALUES ($1, $2, $2, NOW(), NOW())
          ON CONFLICT (user_id) DO UPDATE SET
            available_balance = user_balance.available_balance + $2,
            total_earned = user_balance.total_earned + $2,
            updated_at = NOW()
        `;
        await client.query(balanceQuery, [topUp.user_id, topUp.amount]);

        await client.query('COMMIT');

        console.log('Top-up completed:', invoiceId, 'User credited:', topUp.amount, 'coins');
        return res.json({ ok: true });
      }

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
      const sellerBalanceQuery = `
        INSERT INTO user_balance (user_id, available_balance, total_earned, created_at, updated_at)
        VALUES ($1, $2, $2, NOW(), NOW())
        ON CONFLICT (user_id) DO UPDATE SET
          available_balance = user_balance.available_balance + $2,
          total_earned = user_balance.total_earned + $2,
          updated_at = NOW()
      `;
      await client.query(sellerBalanceQuery, [order.seller_id, order.seller_earnings]);

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
