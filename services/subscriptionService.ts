import type { PoolClient } from 'pg';
import pool from '../config/database.js';
import {
  getPlan,
  PLAN_PERIOD_DAYS,
  PLATFORM_ADMIN_USER_ID,
  type BillingPeriod,
  type PlanDefinition,
  type PlanSlug,
  type UsageAction,
} from './planCatalog.js';

export type ActiveSubscription = {
  plan: PlanDefinition;
  slug: PlanSlug;
  status: 'active' | 'expired' | 'none';
  period: BillingPeriod | null;
  period_start: string | null;
  period_end: string | null;
  payment_id: string | null;
};

export type UsageSnapshot = {
  uploads_count: number;
  downloads_count: number;
  looptok_count: number;
  period_start: string;
  limits: PlanDefinition['limits'];
  remaining: {
    uploads: number;
    downloads: number;
    looptok: number;
  };
};

function periodStartKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

async function isPlatformAdmin(userId: number): Promise<boolean> {
  if (userId === PLATFORM_ADMIN_USER_ID) return true;
  try {
    const result = await pool.query(`SELECT role FROM users WHERE id = $1`, [userId]);
    return result.rows[0]?.role === 'admin';
  } catch {
    return false;
  }
}

function businessActive(userId: number): ActiveSubscription {
  const start = new Date();
  const end = new Date(start.getTime() + 3650 * 24 * 60 * 60 * 1000);
  return {
    plan: getPlan('business'),
    slug: 'business',
    status: 'active',
    period: 'yearly',
    period_start: start.toISOString(),
    period_end: end.toISOString(),
    payment_id: `admin_default_${userId}`,
  };
}

export async function getActiveSubscription(userId: number): Promise<ActiveSubscription> {
  const result = await pool.query(
    `
    SELECT plan_slug, status, billing_period, period_start, period_end, payment_id
    FROM user_paid_subscriptions
    WHERE user_id = $1
      AND status = 'active'
      AND period_end > NOW()
    ORDER BY period_end DESC
    LIMIT 1
    `,
    [userId],
  );

  if (result.rows.length === 0) {
    if (await isPlatformAdmin(userId)) {
      return businessActive(userId);
    }
    return {
      plan: getPlan('free'),
      slug: 'free',
      status: 'none',
      period: null,
      period_start: null,
      period_end: null,
      payment_id: null,
    };
  }

  const row = result.rows[0];
  const raw = String(row.plan_slug || 'free').toLowerCase();
  const slug = (
    raw === 'elite' || raw === 'business'
      ? 'business'
      : raw === 'basic' || raw === 'pro'
        ? raw
        : 'free'
  ) as PlanSlug;
  return {
    plan: getPlan(slug),
    slug,
    status: 'active',
    period: row.billing_period === 'yearly' ? 'yearly' : 'monthly',
    period_start: row.period_start,
    period_end: row.period_end,
    payment_id: row.payment_id,
  };
}

async function ensureUsageRow(userId: number, client?: PoolClient) {
  const db = client || pool;
  const sub = await getActiveSubscription(userId);
  let startKey: string;
  if (sub.period_start) {
    startKey = new Date(sub.period_start).toISOString().slice(0, 10);
  } else {
    const d = new Date();
    startKey = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
  }

  await db.query(
    `
    INSERT INTO subscription_usage (user_id, period_start, uploads_count, downloads_count, looptok_count)
    VALUES ($1, $2::date, 0, 0, 0)
    ON CONFLICT (user_id, period_start) DO NOTHING
    `,
    [userId, startKey],
  );

  return startKey;
}

export async function getUsageSnapshot(userId: number): Promise<UsageSnapshot> {
  const sub = await getActiveSubscription(userId);
  const periodStart = await ensureUsageRow(userId);
  const result = await pool.query(
    `
    SELECT uploads_count, downloads_count, looptok_count, period_start
    FROM subscription_usage
    WHERE user_id = $1 AND period_start = $2::date
    `,
    [userId, periodStart],
  );
  const row = result.rows[0] || {
    uploads_count: 0,
    downloads_count: 0,
    looptok_count: 0,
    period_start: periodStart,
  };
  const limits = sub.plan.limits;
  return {
    uploads_count: row.uploads_count,
    downloads_count: row.downloads_count,
    looptok_count: row.looptok_count,
    period_start: String(row.period_start).slice(0, 10),
    limits,
    remaining: {
      uploads: Math.max(0, limits.uploadsPerPeriod - row.uploads_count),
      downloads: Math.max(0, limits.downloadsPerPeriod - row.downloads_count),
      looptok: Math.max(0, limits.looptokPerPeriod - row.looptok_count),
    },
  };
}

export class PlanLimitError extends Error {
  code = 'PLAN_LIMIT';
  status = 403;
  action: UsageAction;
  plan: PlanSlug;

  constructor(action: UsageAction, plan: PlanSlug, message: string) {
    super(message);
    this.action = action;
    this.plan = plan;
  }
}

export async function assertWithinLimit(userId: number, action: UsageAction, fileSize?: number) {
  const sub = await getActiveSubscription(userId);
  const usage = await getUsageSnapshot(userId);
  const limits = sub.plan.limits;

  if (fileSize != null && fileSize > limits.maxFileBytes) {
    throw new PlanLimitError(
      action,
      sub.slug,
      `File too large for ${sub.plan.name}. Max ${(limits.maxFileBytes / (1024 * 1024)).toFixed(0)}MB.`,
    );
  }

  const used =
    action === 'upload'
      ? usage.uploads_count
      : action === 'download'
        ? usage.downloads_count
        : usage.looptok_count;
  const max =
    action === 'upload'
      ? limits.uploadsPerPeriod
      : action === 'download'
        ? limits.downloadsPerPeriod
        : limits.looptokPerPeriod;

  if (used >= max) {
    throw new PlanLimitError(
      action,
      sub.slug,
      `Plan limit reached for ${action}. Upgrade to continue.`,
    );
  }

  return { sub, usage };
}

export async function incrementUsage(userId: number, action: UsageAction) {
  const periodStart = await ensureUsageRow(userId);
  const column =
    action === 'upload' ? 'uploads_count' : action === 'download' ? 'downloads_count' : 'looptok_count';

  await pool.query(
    `
    UPDATE subscription_usage
    SET ${column} = ${column} + 1, updated_at = CURRENT_TIMESTAMP
    WHERE user_id = $1 AND period_start = $2::date
    `,
    [userId, periodStart],
  );
}

export async function activatePaidSubscription(
  client: PoolClient,
  params: {
    userId: number;
    planSlug: PlanSlug;
    billingPeriod: BillingPeriod;
    paymentId: string;
  },
) {
  const { userId, planSlug, billingPeriod, paymentId } = params;
  if (planSlug !== 'basic' && planSlug !== 'pro' && planSlug !== 'business') {
    return { ok: false as const, reason: 'invalid_plan' };
  }

  const existing = await client.query(
    `SELECT id FROM user_paid_subscriptions WHERE payment_id = $1`,
    [paymentId],
  );
  if (existing.rows.length > 0) {
    return { ok: true as const, already: true };
  }

  // expire previous active
  await client.query(
    `UPDATE user_paid_subscriptions SET status = 'expired', updated_at = CURRENT_TIMESTAMP
     WHERE user_id = $1 AND status = 'active'`,
    [userId],
  );

  const days = billingPeriod === 'yearly' ? 365 : PLAN_PERIOD_DAYS;
  const start = new Date();
  const end = new Date(start.getTime() + days * 24 * 60 * 60 * 1000);

  await client.query(
    `
    INSERT INTO user_paid_subscriptions (
      user_id, plan_slug, billing_period, status, period_start, period_end, payment_id
    ) VALUES ($1, $2, $3, 'active', $4, $5, $6)
    `,
    [userId, planSlug, billingPeriod, start.toISOString(), end.toISOString(), paymentId],
  );

  // seed usage period on subscription start day (do not reset counts if row exists)
  await client.query(
    `
    INSERT INTO subscription_usage (user_id, period_start, uploads_count, downloads_count, looptok_count)
    VALUES ($1, $2::date, 0, 0, 0)
    ON CONFLICT (user_id, period_start) DO NOTHING
    `,
    [userId, periodStartKey(start)],
  );

  return { ok: true as const, already: false };
}

/** Admin grant / revoke paid plan (no YooKassa). */
export async function adminSetUserPlan(
  client: PoolClient,
  params: {
    userId: number;
    planSlug: PlanSlug;
    billingPeriod?: BillingPeriod;
    days?: number;
  },
) {
  const { userId, planSlug } = params;
  const billingPeriod: BillingPeriod = params.billingPeriod === 'yearly' ? 'yearly' : 'monthly';

  await client.query(
    `UPDATE user_paid_subscriptions SET status = 'expired', updated_at = CURRENT_TIMESTAMP
     WHERE user_id = $1 AND status = 'active'`,
    [userId],
  );

  if (planSlug === 'free') {
    return { ok: true as const, slug: 'free' as PlanSlug, period_end: null as string | null };
  }

  const days =
    typeof params.days === 'number' && params.days > 0
      ? Math.min(params.days, 3650)
      : billingPeriod === 'yearly'
        ? 365
        : PLAN_PERIOD_DAYS;

  const start = new Date();
  const end = new Date(start.getTime() + days * 24 * 60 * 60 * 1000);
  const paymentId = `admin_grant_${userId}_${Date.now()}`;

  await client.query(
    `
    INSERT INTO user_paid_subscriptions (
      user_id, plan_slug, billing_period, status, period_start, period_end, payment_id
    ) VALUES ($1, $2, $3, 'active', $4, $5, $6)
    `,
    [userId, planSlug, billingPeriod, start.toISOString(), end.toISOString(), paymentId],
  );

  await client.query(
    `
    INSERT INTO subscription_usage (user_id, period_start, uploads_count, downloads_count, looptok_count)
    VALUES ($1, $2::date, 0, 0, 0)
    ON CONFLICT (user_id, period_start) DO NOTHING
    `,
    [userId, periodStartKey(start)],
  );

  // Seed a cinematic theme for admins if empty
  if (planSlug === 'business' && (await isPlatformAdmin(userId))) {
    const theme = await client.query(`SELECT profile_theme FROM users WHERE id = $1`, [userId]);
    const current = theme.rows[0]?.profile_theme;
    const empty =
      !current ||
      (typeof current === 'object' && Object.keys(current).length === 0) ||
      current === '{}';
    if (empty) {
      await client.query(
        `UPDATE users SET profile_theme = $1::jsonb, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
        [
          JSON.stringify({
            accent_color: '#e8c36a',
            layout: 'cinematic',
            badge_style: 'business',
            show_stats: true,
            bio: 'Loopera · founder',
          }),
          userId,
        ],
      );
    }
  }

  return { ok: true as const, slug: planSlug, period_end: end.toISOString() };
}

export async function getPublicAuthorPlan(userId: number): Promise<{
  plan_slug: PlanSlug;
  badge: PlanDefinition['limits']['badge'];
  elite_card: boolean;
  pro_card: boolean;
  profile_theme: Record<string, unknown> | null;
}> {
  const sub = await getActiveSubscription(userId);
  const themeResult = await pool.query(
    `SELECT profile_theme FROM users WHERE id = $1`,
    [userId],
  );
  const theme = themeResult.rows[0]?.profile_theme || null;
  return {
    plan_slug: sub.slug,
    badge: sub.plan.limits.badge,
    elite_card: sub.plan.limits.eliteCard,
    pro_card: sub.plan.limits.proCard,
    profile_theme: sub.plan.limits.customProfile || sub.plan.limits.accentOnly ? theme : null,
  };
}
