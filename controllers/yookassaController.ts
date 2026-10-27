import { Request, Response } from 'express';
import pool from '../config/database';
import { getPayment } from '../services/yookassaService';
import { completePackOrder, completeBalanceTopUp } from '../services/packOrderService';
import { completeSubscriptionFromPayment } from './billingController.js';
import { notifyPackSale, notifySubscriptionPaid } from '../services/emailService.js';

export const yookassaWebhook = async (req: Request, res: Response) => {
  try {
    const { event, object } = req.body;

    if (event !== 'payment.succeeded' || !object?.id) {
      return res.status(200).send('');
    }

    const paymentId = object.id as string;
    let packResult: Awaited<ReturnType<typeof completePackOrder>> | null = null;
    let subResult: Awaited<ReturnType<typeof completeSubscriptionFromPayment>> | null = null;
    let topUpResult: Awaited<ReturnType<typeof completeBalanceTopUp>> | null = null;
    let paymentMeta: Record<string, string> | null = null;
    let paymentAmount: number | undefined;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const payment = await getPayment(paymentId);
      if (payment.status !== 'succeeded') {
        await client.query('ROLLBACK');
        return res.status(200).send('');
      }

      paymentMeta = (payment.metadata || {}) as Record<string, string>;
      paymentAmount = payment.amount?.value ? Number(payment.amount.value) : undefined;
      const metaType = paymentMeta.type;

      if (metaType === 'subscription') {
        subResult = await completeSubscriptionFromPayment(client, paymentId);
      } else if (metaType === 'balance_topup') {
        topUpResult = await completeBalanceTopUp(client, paymentId);
        if (!topUpResult.ok && topUpResult.reason !== 'topup_not_found') {
          await client.query('ROLLBACK');
          return res.status(500).json({ error: 'Failed to complete top-up' });
        }
      } else {
        packResult = await completePackOrder(client, paymentId);
        if (!packResult.ok && packResult.reason !== 'order_not_found') {
          await client.query('ROLLBACK');
          return res.status(500).json({ error: 'Failed to complete order' });
        }
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('YooKassa webhook error:', error);
      return res.status(500).json({ error: 'Webhook processing failed' });
    } finally {
      client.release();
    }

    if (topUpResult?.ok) {
      console.log(
        `[yookassa] balance top-up ok user=${topUpResult.userId} amount=${topUpResult.amount} already=${!!topUpResult.already}`,
      );
    }

    if (packResult?.ok) {
      void notifyPackSale({
        paymentId,
        orderId: packResult.orderId,
        price: packResult.price || paymentAmount || 0,
        commission: packResult.commission,
        sellerEarnings: packResult.sellerEarnings,
        packTitle: packResult.packTitle,
        buyerId: packResult.buyerId,
        sellerId: packResult.sellerId,
        already: packResult.already,
      });
    }

    if (subResult?.ok && paymentMeta) {
      void notifySubscriptionPaid({
        userId: parseInt(String(paymentMeta.buyer_id), 10),
        plan: String(paymentMeta.plan_slug || ''),
        period: String(paymentMeta.billing_period || 'monthly'),
        amount: paymentAmount,
        paymentId,
        already: subResult.already,
      });
    }

    res.status(200).send('');
  } catch (error) {
    console.error('YooKassa webhook error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
};

export const confirmPackPayment = async (req: Request, res: Response) => {
  const { payment_id } = req.body;

  if (!payment_id) {
    return res.status(400).json({ error: 'payment_id is required' });
  }

  const client = await pool.connect();
  try {
    const payment = await getPayment(payment_id);

    if (payment.status !== 'succeeded') {
      return res.json({ status: payment.status, purchased: false });
    }

    await client.query('BEGIN');
    const result = await completePackOrder(client, payment_id);
    await client.query('COMMIT');

    if (result.ok) {
      void notifyPackSale({
        paymentId: payment_id,
        orderId: result.orderId,
        price: result.price || Number(payment.amount?.value || 0),
        commission: result.commission,
        sellerEarnings: result.sellerEarnings,
        packTitle: result.packTitle,
        buyerId: result.buyerId,
        sellerId: result.sellerId,
        already: result.already,
      });
    }

    res.json({
      status: 'succeeded',
      purchased: result.ok,
      already: result.already ?? false,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Confirm payment error:', error);
    res.status(500).json({ error: 'Failed to confirm payment' });
  } finally {
    client.release();
  }
};
