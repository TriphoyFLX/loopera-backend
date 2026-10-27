import type { PoolClient } from 'pg';
import { notifyUser } from './notifyService.js';

export const PLATFORM_SALE_COMMISSION_RATE = 0.15;

export function calcSaleCommission(price: number): { commission: number; sellerEarnings: number } {
  const commission = Math.round(price * PLATFORM_SALE_COMMISSION_RATE);
  const sellerEarnings = price - commission;
  return { commission, sellerEarnings };
}

/** Stable advisory lock key for concurrent buy of same buyer+pack. */
export function buyPackLockKey(buyerId: number, packId: number): bigint {
  // Two 32-bit halves into one bigint key for pg_advisory_xact_lock(bigint)
  const a = BigInt(buyerId >>> 0);
  const b = BigInt(packId >>> 0);
  return (a << 32n) | b;
}

export async function completePackOrder(
  client: PoolClient,
  paymentId: string
): Promise<{
  ok: boolean;
  already?: boolean;
  reason?: string;
  orderId?: number;
  price?: number;
  commission?: number;
  sellerEarnings?: number;
  packTitle?: string;
  buyerId?: number;
  sellerId?: number;
  sellerCredited?: boolean;
}> {
  const orderResult = await client.query(
    `SELECT o.*, sp.title AS pack_title
     FROM orders o
     LEFT JOIN sound_packs sp ON sp.id = o.pack_id
     WHERE o.invoice_id = $1
     FOR UPDATE OF o`,
    [paymentId]
  );

  if (orderResult.rows.length === 0) {
    return { ok: false, reason: 'order_not_found' };
  }

  const order = orderResult.rows[0];

  if (order.status === 'paid' || order.status === 'completed') {
    return {
      ok: true,
      already: true,
      orderId: order.id,
      price: Number(order.price ?? order.amount),
      buyerId: order.buyer_id,
      sellerId: order.seller_id,
      packTitle: order.pack_title,
      sellerCredited: false,
    };
  }

  const buyerId = order.buyer_id;
  const packId = order.pack_id;
  const sellerId = order.seller_id;
  const price = Number(order.price ?? order.amount);
  const { commission, sellerEarnings } = calcSaleCommission(price);

  // Grant ownership once. Only credit seller when this is a new grant —
  // prevents double-credit if two payments race for the same buyer+pack.
  const packGrant = await client.query(
    `INSERT INTO user_packs (user_id, pack_id) VALUES ($1, $2)
     ON CONFLICT (user_id, pack_id) DO NOTHING
     RETURNING id`,
    [buyerId, packId]
  );
  const isNewOwnership = packGrant.rows.length > 0;

  if (isNewOwnership) {
    await client.query(
      `INSERT INTO user_balance (user_id, available_balance, total_earned)
       VALUES ($1, $2, $2)
       ON CONFLICT (user_id) DO UPDATE SET
         available_balance = user_balance.available_balance + $2,
         total_earned = user_balance.total_earned + $2,
         updated_at = CURRENT_TIMESTAMP`,
      [sellerId, sellerEarnings]
    );
  }

  await client.query(
    `UPDATE orders
     SET status = 'paid',
         commission = $1,
         seller_earnings = $2,
         paid_at = CURRENT_TIMESTAMP,
         currency = 'RUB'
     WHERE id = $3`,
    [isNewOwnership ? commission : 0, isNewOwnership ? sellerEarnings : 0, order.id]
  );

  if (isNewOwnership) {
    const title = order.pack_title || 'Пак';
    // Fire-and-forget after commit path — callers may still be in txn; schedule microtask
    setImmediate(() => {
      void notifyUser({
        userId: buyerId,
        kind: 'purchase',
        title: 'Покупка оформлена',
        body: `Вы купили «${title}»`,
        link: `/shop/pack/${packId}`,
      });
      void notifyUser({
        userId: sellerId,
        kind: 'sale',
        title: 'Новая продажа',
        body: `Кто-то купил ваш пак «${title}» · +${sellerEarnings} ₽`,
        link: `/shop/pack/${packId}`,
      });
    });
  }

  return {
    ok: true,
    orderId: order.id,
    price,
    commission: isNewOwnership ? commission : 0,
    sellerEarnings: isNewOwnership ? sellerEarnings : 0,
    packTitle: order.pack_title,
    buyerId,
    sellerId,
    sellerCredited: isNewOwnership,
  };
}

/** Idempotent wallet top-up after YooKassa payment.succeeded */
export async function completeBalanceTopUp(
  client: PoolClient,
  paymentId: string,
): Promise<{ ok: boolean; already?: boolean; reason?: string; userId?: number; amount?: number }> {
  const topUp = await client.query(
    `SELECT * FROM top_ups WHERE invoice_id = $1 FOR UPDATE`,
    [paymentId],
  );

  if (topUp.rows.length === 0) {
    return { ok: false, reason: 'topup_not_found' };
  }

  const row = topUp.rows[0];
  const amount = Math.round(Number(row.amount));
  const userId = row.user_id;

  if (row.status === 'completed') {
    return { ok: true, already: true, userId, amount };
  }

  await client.query(
    `INSERT INTO user_balance (user_id, available_balance, total_earned)
     VALUES ($1, $2, 0)
     ON CONFLICT (user_id) DO UPDATE SET
       available_balance = user_balance.available_balance + $2,
       updated_at = CURRENT_TIMESTAMP`,
    [userId, amount],
  );

  await client.query(
    `UPDATE top_ups SET status = 'completed' WHERE id = $1`,
    [row.id],
  );

  return { ok: true, userId, amount };
}
