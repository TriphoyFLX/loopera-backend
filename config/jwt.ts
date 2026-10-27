import jwt from 'jsonwebtoken';

/** Access token lifetime. Prefer short-lived (hours), refresh via /auth/refresh. */
export const JWT_EXPIRES_IN = (process.env.JWT_EXPIRES_IN || '12h') as jwt.SignOptions['expiresIn'];

/** How long an expired token may still be refreshed (days). */
export const JWT_REFRESH_MAX_AGE_DAYS = Math.max(
  1,
  Math.min(30, parseInt(process.env.JWT_REFRESH_MAX_AGE_DAYS || '7', 10) || 7),
);

export const MAX_REFRESH_AGE_MS = JWT_REFRESH_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;

export const getJwtSecret = (): string => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is not configured');
  }
  if (
    process.env.NODE_ENV === 'production' &&
    (secret.length < 32 || /change.?this|example|super_secure_jwt/i.test(secret))
  ) {
    throw new Error('JWT_SECRET is weak or placeholder — set a strong secret in production');
  }
  return secret;
};
