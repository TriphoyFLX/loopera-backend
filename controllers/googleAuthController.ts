import type { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import pool from '../config/database.js';
import { getJwtSecret } from '../config/jwt.js';
import { createAuthToken, formatAuthUser } from './authController.js';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';

const getGoogleConfig = () => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_ID ? process.env.GOOGLE_CLIENT_SECRET : undefined;
  const redirectUri =
    process.env.GOOGLE_REDIRECT_URI || 'https://loopera.ru/api/auth/google/callback';

  if (!clientId || !clientSecret) {
    return null;
  }

  return { clientId, clientSecret, redirectUri };
};

const createOAuthState = () =>
  jwt.sign({ provider: 'google' }, getJwtSecret(), { expiresIn: '10m' });

const verifyOAuthState = (state?: string) => {
  if (!state) return false;
  try {
    const payload = jwt.verify(state, getJwtSecret()) as { provider?: string };
    return payload.provider === 'google';
  } catch {
    return false;
  }
};

const sanitizeUsername = (value: string) =>
  value.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 40) || 'user';

const generateUniqueUsername = async (email: string, name?: string) => {
  const emailBase = sanitizeUsername(email.split('@')[0] || 'user');
  const nameBase = sanitizeUsername((name || '').replace(/\s+/g, '_'));
  const bases = [nameBase, emailBase].filter(Boolean);

  for (const base of bases) {
    const exists = await pool.query('SELECT id FROM users WHERE username = $1', [base]);
    if (exists.rows.length === 0) return base;
  }

  const seed = bases[0] || 'user';
  for (let i = 1; i <= 999; i += 1) {
    const candidate = `${seed}${i}`.slice(0, 50);
    const exists = await pool.query('SELECT id FROM users WHERE username = $1', [candidate]);
    if (exists.rows.length === 0) return candidate;
  }

  return `user${Date.now()}`.slice(0, 50);
};

const redirectWithError = (res: Response, message: string) => {
  const frontendUrl = process.env.FRONTEND_URL || 'https://loopera.ru';
  const url = new URL('/auth/oauth', frontendUrl);
  url.searchParams.set('error', message);
  return res.redirect(url.toString());
};

const redirectWithSuccess = (res: Response, token: string, user: Record<string, unknown>) => {
  const frontendUrl = process.env.FRONTEND_URL || 'https://loopera.ru';
  const hash = new URLSearchParams({
    token,
    user: JSON.stringify(user),
  }).toString();
  return res.redirect(`${frontendUrl}/auth/oauth#${hash}`);
};

export const startGoogleAuth = (req: Request, res: Response) => {
  const config = getGoogleConfig();
  if (!config) {
    return res.status(503).json({ message: 'Google авторизация не настроена' });
  }

  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'online',
    include_granted_scopes: 'true',
    prompt: 'select_account',
    state: createOAuthState(),
  });

  return res.redirect(`${GOOGLE_AUTH_URL}?${params.toString()}`);
};

export const googleAuthCallback = async (req: Request, res: Response) => {
  const config = getGoogleConfig();
  if (!config) {
    return redirectWithError(res, 'Google авторизация не настроена');
  }

  const oauthError = typeof req.query.error === 'string' ? req.query.error : null;
  if (oauthError) {
    return redirectWithError(res, 'Вход через Google отменён');
  }

  const code = typeof req.query.code === 'string' ? req.query.code : null;
  const state = typeof req.query.state === 'string' ? req.query.state : null;

  if (!code || !state || !verifyOAuthState(state)) {
    return redirectWithError(res, 'Некорректный ответ Google. Попробуйте снова.');
  }

  try {
    const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: config.redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    const tokenData = await tokenResponse.json();
    if (!tokenResponse.ok || !tokenData.access_token) {
      console.error('Google token exchange failed:', tokenData);
      return redirectWithError(res, 'Не удалось получить токен Google');
    }

    const profileResponse = await fetch(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const profile = await profileResponse.json();

    if (!profileResponse.ok || !profile.email || !profile.id) {
      console.error('Google profile fetch failed:', profile);
      return redirectWithError(res, 'Не удалось получить профиль Google');
    }

    if (profile.verified_email === false) {
      return redirectWithError(res, 'Email Google не подтверждён');
    }

    const googleId = String(profile.id);
    const email = String(profile.email).toLowerCase();
    const picture = typeof profile.picture === 'string' ? profile.picture : null;

    let userRow: {
      id: number;
      username: string;
      email: string;
      role?: string | null;
      onboarding_completed?: boolean | null;
      created_at?: string | Date;
    } | null = null;

    const byGoogle = await pool.query(
      `SELECT id, username, email, role, onboarding_completed, created_at
       FROM users WHERE google_id = $1`,
      [googleId],
    );

    if (byGoogle.rows.length > 0) {
      userRow = byGoogle.rows[0];
    } else {
      const byEmail = await pool.query(
        `SELECT id, username, email, role, onboarding_completed, created_at, google_id
         FROM users WHERE LOWER(email) = LOWER($1)`,
        [email],
      );

      if (byEmail.rows.length > 0) {
        const existing = byEmail.rows[0];
        if (existing.google_id && existing.google_id !== googleId) {
          return redirectWithError(res, 'Этот email уже привязан к другому Google-аккаунту');
        }

        const updated = await pool.query(
          `UPDATE users
           SET google_id = $1,
               email_verified = TRUE,
               avatar_url = COALESCE(avatar_url, $2),
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $3
           RETURNING id, username, email, role, onboarding_completed, created_at`,
          [googleId, picture, existing.id],
        );
        userRow = updated.rows[0];
      } else {
        const username = await generateUniqueUsername(email, profile.name);
        const randomPassword = await bcrypt.hash(
          `${googleId}:${Date.now()}:${Math.random()}`,
          10,
        );

        const created = await pool.query(
          `INSERT INTO users (username, email, password, google_id, email_verified, avatar_url)
           VALUES ($1, $2, $3, $4, TRUE, $5)
           RETURNING id, username, email, role, onboarding_completed, created_at`,
          [username, email, randomPassword, googleId, picture],
        );
        userRow = created.rows[0];
      }
    }

    if (!userRow) {
      return redirectWithError(res, 'Не удалось создать пользователя');
    }

    const token = createAuthToken(userRow);
    const user = formatAuthUser(userRow);
    return redirectWithSuccess(res, token, user);
  } catch (error) {
    console.error('Google auth callback error:', error);
    return redirectWithError(res, 'Ошибка входа через Google');
  }
};
