/**
 * Fail fast on weak / missing production secrets.
 * Soft-warn for payments/email so a soft launch can still boot,
 * but money & mail will not work until filled.
 */

const WEAK_JWT =
  /change.?me|secret|password|example|placeholder|GENERATE_|minimum_32|super_secure/i;

export type ProdEnvReport = {
  ok: boolean;
  errors: string[];
  warnings: string[];
};

export function validateProductionEnv(
  env: NodeJS.ProcessEnv = process.env,
): ProdEnvReport {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (env.NODE_ENV !== 'production') {
    return { ok: true, errors, warnings };
  }

  const jwt = env.JWT_SECRET || '';
  if (!jwt || jwt.length < 48 || WEAK_JWT.test(jwt)) {
    errors.push(
      'JWT_SECRET must be a strong random secret (≥48 chars). Use: openssl rand -hex 48',
    );
  }

  if (!env.DB_PASSWORD || /change_this|GENERATE_|your_secure/i.test(env.DB_PASSWORD)) {
    errors.push('DB_PASSWORD must be set to a strong password');
  }

  if (!env.FRONTEND_URL || !/^https:\/\//i.test(env.FRONTEND_URL)) {
    errors.push('FRONTEND_URL must be an https:// URL (e.g. https://loopera.ru)');
  }

  if (!env.YOOKASSA_SHOP_ID || !env.YOOKASSA_SECRET_KEY) {
    warnings.push('YOOKASSA_SHOP_ID / YOOKASSA_SECRET_KEY missing — payments disabled');
  }

  if (!env.RESEND_API_KEY && !env.SMTP_HOST && !env.EMAIL_PASS) {
    warnings.push('No email provider (RESEND_API_KEY / SMTP) — verification codes go to logs only');
  }

  if (!env.S3_BUCKET) {
    warnings.push('S3_BUCKET unset — media stored on local volume (ok for soft launch)');
  }

  if (!env.REDIS_URL) {
    warnings.push('REDIS_URL unset — rate limits use in-memory store (single replica only)');
  }

  if (!env.SENTRY_DSN) {
    warnings.push('SENTRY_DSN unset — backend crash reporting disabled');
  }

  return { ok: errors.length === 0, errors, warnings };
}

export function assertProductionEnv(): void {
  const report = validateProductionEnv();
  for (const w of report.warnings) {
    console.warn(`[prod-env] ⚠ ${w}`);
  }
  if (!report.ok) {
    for (const e of report.errors) {
      console.error(`[prod-env] ✖ ${e}`);
    }
    throw new Error('Production environment validation failed');
  }
}
