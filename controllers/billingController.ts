import type { Response } from 'express';
import pool from '../config/database.js';
import type { AuthRequest } from '../middleware/auth.js';
import { createPayment, getPayment, isYookassaConfigured } from '../services/yookassaService.js';
import {
  listPlans,
  normalizePlanSlug,
  priceFor,
  type BillingPeriod,
  type PlanSlug,
} from '../services/planCatalog.js';
import {
  activatePaidSubscription,
  getActiveSubscription,
  getPublicAuthorPlan,
  getUsageSnapshot,
} from '../services/subscriptionService.js';
import { notifySubscriptionPaid } from '../services/emailService.js';

export const getBillingPlans = async (_req: AuthRequest, res: Response) => {
  return res.json({
    plans: listPlans().map((p) => ({
      slug: p.slug,
      name: p.name,
      name_ru: p.nameRu,
      tagline: p.tagline,
      tagline_ru: p.taglineRu,
      price_monthly: p.priceMonthly,
      price_yearly: p.priceYearly,
      limits: p.limits,
    })),
  });
};

export const getMyBilling = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId || req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const sub = await getActiveSubscription(userId);
    const usage = await getUsageSnapshot(userId);
    const themeResult = await pool.query(`SELECT profile_theme FROM users WHERE id = $1`, [userId]);

    return res.json({
      subscription: {
        slug: sub.slug,
        status: sub.status,
        period: sub.period,
        period_start: sub.period_start,
        period_end: sub.period_end,
        plan: sub.plan,
      },
      usage,
      profile_theme: themeResult.rows[0]?.profile_theme || {},
    });
  } catch (error) {
    console.error('getMyBilling error:', error);
    return res.status(500).json({ message: 'Failed to load billing status' });
  }
};

export const checkoutPlan = async (req: AuthRequest, res: Response) => {
  const client = await pool.connect();
  try {
    const userId = req.user?.userId || req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    if (!isYookassaConfigured()) {
      return res.status(503).json({ message: 'Payment system is not configured' });
    }

    const planSlug = String(req.body?.plan || '').toLowerCase() as PlanSlug;
    const billingPeriod = (String(req.body?.period || 'monthly').toLowerCase() === 'yearly'
      ? 'yearly'
      : 'monthly') as BillingPeriod;

    if (planSlug !== 'basic' && planSlug !== 'pro' && planSlug !== 'business' && planSlug !== 'elite') {
      return res.status(400).json({ message: 'Choose basic, pro or business plan' });
    }
    const normalizedSlug = (planSlug === 'elite' ? 'business' : planSlug) as PlanSlug;

    const amountRub = priceFor(normalizedSlug, billingPeriod);
    if (amountRub <= 0) {
      return res.status(400).json({ message: 'Invalid plan price' });
    }

    const frontendUrl = process.env.FRONTEND_URL || 'https://loopera.ru';
    const returnUrl = `${frontendUrl.replace(/\/$/, '')}/pricing?payment=return&plan=${normalizedSlug}`;

    const payment = await createPayment({
      amountRub,
      description: `Loopera ${normalizedSlug.toUpperCase()} (${billingPeriod})`,
      returnUrl,
      metadata: {
        type: 'subscription',
        plan_slug: normalizedSlug,
        billing_period: billingPeriod,
        buyer_id: String(userId),
      },
    });

    if (!payment.confirmation?.confirmation_url) {
      return res.status(500).json({ message: 'Failed to get payment URL' });
    }

    return res.json({
      confirmation_url: payment.confirmation.confirmation_url,
      payment_id: payment.id,
      plan: normalizedSlug,
      period: billingPeriod,
      amount: amountRub,
    });
  } catch (error) {
    console.error('checkoutPlan error:', error);
    const message = error instanceof Error ? error.message : 'Checkout failed';
    return res.status(500).json({
      message: message.includes('YooKassa') ? 'Payment system error. Try later.' : message,
    });
  } finally {
    client.release();
  }
};

export const confirmSubscriptionPayment = async (req: AuthRequest, res: Response) => {
  const paymentId = String(req.body?.payment_id || '');
  if (!paymentId) return res.status(400).json({ message: 'payment_id is required' });

  const client = await pool.connect();
  try {
    const payment = await getPayment(paymentId);
    if (payment.status !== 'succeeded') {
      return res.json({ status: payment.status, activated: false });
    }

    const meta = payment.metadata || {};
    if (meta.type !== 'subscription') {
      return res.status(400).json({ message: 'Not a subscription payment' });
    }

    const userId = parseInt(String(meta.buyer_id), 10);
    const planSlug = normalizePlanSlug(String(meta.plan_slug || ''));
    const billingPeriod = (meta.billing_period === 'yearly' ? 'yearly' : 'monthly') as BillingPeriod;

    if (!userId || planSlug === 'free') {
      return res.status(400).json({ message: 'Invalid payment metadata' });
    }

    await client.query('BEGIN');
    const result = await activatePaidSubscription(client, {
      userId,
      planSlug,
      billingPeriod,
      paymentId,
    });
    await client.query('COMMIT');

    if (result.ok) {
      void notifySubscriptionPaid({
        userId,
        plan: planSlug,
        period: billingPeriod,
        amount: payment.amount?.value ? Number(payment.amount.value) : undefined,
        paymentId,
        already: result.already,
      });
    }

    return res.json({
      status: 'succeeded',
      activated: result.ok,
      already: result.already ?? false,
      plan: planSlug,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('confirmSubscriptionPayment error:', error);
    return res.status(500).json({ message: 'Failed to confirm subscription' });
  } finally {
    client.release();
  }
};

export const updateProfileTheme = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId || req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const sub = await getActiveSubscription(userId);
    const isAdmin = userId === 824;
    if (!isAdmin && !sub.plan.limits.customProfile && !sub.plan.limits.accentOnly) {
      return res.status(403).json({
        message: 'Profile customization requires Pro or Elite',
        code: 'PLAN_LIMIT',
        plan: sub.slug,
      });
    }

    const body = req.body || {};
    const current = await pool.query(`SELECT profile_theme FROM users WHERE id = $1`, [userId]);
    const prev = (current.rows[0]?.profile_theme || {}) as Record<string, unknown>;

    const next: Record<string, unknown> = { ...prev };
    const fullCustom = isAdmin || sub.plan.limits.customProfile;

    if (typeof body.accent_color === 'string' && /^#[0-9a-fA-F]{6}$/.test(body.accent_color)) {
      next.accent_color = body.accent_color;
    }

    if (fullCustom) {
      if (typeof body.banner_url === 'string') {
        next.banner_url = body.banner_url.slice(0, 500);
      }
      if (body.layout === 'classic' || body.layout === 'cinematic' || body.layout === 'glass') {
        next.layout = body.layout;
      }
      if (typeof body.badge_style === 'string') {
        next.badge_style = body.badge_style.slice(0, 40);
      }
      if (typeof body.show_stats === 'boolean') {
        next.show_stats = body.show_stats;
      }
      if (body.featured_loop_id === null) {
        next.featured_loop_id = null;
      } else if (body.featured_loop_id != null) {
        const loopId = parseInt(String(body.featured_loop_id), 10);
        if (Number.isFinite(loopId)) {
          const loopCheck = await pool.query(
            `SELECT id FROM loops WHERE id = $1 AND user_id = $2`,
            [loopId, userId],
          );
          if (loopCheck.rows.length === 0) {
            return res.status(400).json({ message: 'Featured loop not found' });
          }
          next.featured_loop_id = loopId;
        }
      }
      if (typeof body.bio === 'string') {
        next.bio = body.bio.trim().slice(0, 280);
      }
    }

    await pool.query(`UPDATE users SET profile_theme = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`, [
      JSON.stringify(next),
      userId,
    ]);

    return res.json({ profile_theme: next });
  } catch (error) {
    console.error('updateProfileTheme error:', error);
    return res.status(500).json({ message: 'Failed to update theme' });
  }
};

export const getAuthorPlanPublic = async (req: AuthRequest, res: Response) => {
  try {
    const userId = parseInt(String(req.params.userId), 10);
    if (!Number.isFinite(userId)) return res.status(400).json({ message: 'Invalid user id' });
    const data = await getPublicAuthorPlan(userId);
    return res.json(data);
  } catch (error) {
    return res.status(500).json({ message: 'Failed to load author plan' });
  }
};

/** Activate from webhook metadata (called with transaction client). */
export async function completeSubscriptionFromPayment(
  client: import('pg').PoolClient,
  paymentId: string,
) {
  const payment = await getPayment(paymentId);
  if (payment.status !== 'succeeded') {
    return { ok: false as const, reason: 'not_succeeded' };
  }
  const meta = payment.metadata || {};
  if (meta.type !== 'subscription') {
    return { ok: false as const, reason: 'not_subscription' };
  }
  const userId = parseInt(String(meta.buyer_id), 10);
  const planSlug = normalizePlanSlug(String(meta.plan_slug || ''));
  const billingPeriod = (meta.billing_period === 'yearly' ? 'yearly' : 'monthly') as BillingPeriod;
  if (!userId || planSlug === 'free') {
    return { ok: false as const, reason: 'bad_meta' };
  }
  return activatePaidSubscription(client, {
    userId,
    planSlug,
    billingPeriod,
    paymentId,
  });
}
