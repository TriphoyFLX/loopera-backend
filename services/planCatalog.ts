/** Subscription plans: Free / Basic / Pro / Business */

export type PlanSlug = 'free' | 'basic' | 'pro' | 'business';
export type BillingPeriod = 'monthly' | 'yearly';
export type UsageAction = 'upload' | 'download' | 'looptok';

export type PlanLimits = {
  uploadsPerPeriod: number;
  downloadsPerPeriod: number;
  looptokPerPeriod: number;
  maxFileBytes: number;
  customProfile: boolean;
  accentOnly: boolean;
  eliteCard: boolean;
  proCard: boolean;
  badge: 'none' | 'basic' | 'pro' | 'business';
};

export type PlanDefinition = {
  slug: PlanSlug;
  name: string;
  nameRu: string;
  tagline: string;
  taglineRu: string;
  priceMonthly: number;
  priceYearly: number;
  limits: PlanLimits;
};

export const PLAN_PERIOD_DAYS = 30;

/** Hardcoded platform admin (same as simpleAdmin middleware). */
export const PLATFORM_ADMIN_USER_ID = 824;

export const PLANS: Record<PlanSlug, PlanDefinition> = {
  free: {
    slug: 'free',
    name: 'Free',
    nameRu: 'Free',
    tagline: 'Start droppin loops',
    taglineRu: 'Начни заливать лупы',
    priceMonthly: 0,
    priceYearly: 0,
    limits: {
      uploadsPerPeriod: 5,
      downloadsPerPeriod: 10,
      looptokPerPeriod: 3,
      maxFileBytes: 5 * 1024 * 1024,
      customProfile: false,
      accentOnly: false,
      eliteCard: false,
      proCard: false,
      badge: 'none',
    },
  },
  basic: {
    slug: 'basic',
    name: 'Basic',
    nameRu: 'Basic',
    tagline: 'More room to create',
    taglineRu: 'Больше места для релизов',
    priceMonthly: 99,
    priceYearly: 890,
    limits: {
      uploadsPerPeriod: 20,
      downloadsPerPeriod: 60,
      looptokPerPeriod: 10,
      maxFileBytes: 10 * 1024 * 1024,
      customProfile: false,
      accentOnly: false,
      eliteCard: false,
      proCard: false,
      badge: 'basic',
    },
  },
  pro: {
    slug: 'pro',
    name: 'Pro',
    nameRu: 'Pro',
    tagline: 'Upload more. Download more.',
    taglineRu: 'Больше загрузок и скачиваний',
    priceMonthly: 149,
    priceYearly: 1290,
    limits: {
      uploadsPerPeriod: 40,
      downloadsPerPeriod: 150,
      looptokPerPeriod: 20,
      maxFileBytes: 15 * 1024 * 1024,
      customProfile: false,
      accentOnly: true,
      eliteCard: false,
      proCard: true,
      badge: 'pro',
    },
  },
  business: {
    slug: 'business',
    name: 'Business',
    nameRu: 'Business',
    tagline: 'Profile = brand. Custom card & badge.',
    taglineRu: 'Профиль = бренд. Кастом-карточка и бейдж',
    priceMonthly: 349,
    priceYearly: 2990,
    limits: {
      uploadsPerPeriod: 500,
      downloadsPerPeriod: 2000,
      looptokPerPeriod: 500,
      maxFileBytes: 25 * 1024 * 1024,
      customProfile: true,
      accentOnly: true,
      eliteCard: true,
      proCard: true,
      badge: 'business',
    },
  },
};

export function listPlans(): PlanDefinition[] {
  return [PLANS.free, PLANS.basic, PLANS.pro, PLANS.business];
}

/** Resolve plan; maps legacy `elite` → business. */
export function getPlan(slug: string | null | undefined): PlanDefinition {
  const key = String(slug || 'free').toLowerCase();
  if (key === 'elite' || key === 'business') return PLANS.business;
  if (key === 'basic') return PLANS.basic;
  if (key === 'pro') return PLANS.pro;
  return PLANS.free;
}

export function priceFor(slug: PlanSlug, period: BillingPeriod): number {
  const plan = getPlan(slug);
  return period === 'yearly' ? plan.priceYearly : plan.priceMonthly;
}

export function normalizePlanSlug(slug: string | null | undefined): PlanSlug {
  const key = String(slug || 'free').toLowerCase();
  if (key === 'elite' || key === 'business') return 'business';
  if (key === 'basic') return 'basic';
  if (key === 'pro') return 'pro';
  return 'free';
}
