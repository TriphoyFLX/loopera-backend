import express from 'express';
import jwt from 'jsonwebtoken';
import pool from '../config/database.js';
import { getJwtSecret } from '../config/jwt.js';

type Request = express.Request;
type Response = express.Response;
type NextFunction = express.NextFunction;

export type AuthUser = {
  userId: number;
  id: number;
  username: string;
  email: string;
  role: string;
};

export type AuthRequest = Request & { user?: AuthUser };

async function loadActiveUser(userId: number): Promise<AuthUser | null> {
  const result = await pool.query(
    `SELECT id, username, email, role, COALESCE(is_banned, false) AS is_banned
     FROM users WHERE id = $1`,
    [userId],
  );
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  if (row.is_banned) return null;
  return {
    userId: row.id,
    id: row.id,
    username: row.username,
    email: row.email,
    role: String(row.role || 'user').toLowerCase(),
  };
}

function decodeUserId(token: string): number | null {
  const decoded = jwt.verify(token, getJwtSecret()) as { userId?: number; id?: number };
  const raw = decoded.userId ?? decoded.id;
  const id = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export const authenticate = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.header('Authorization');
    const token = authHeader?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({ message: 'Доступ запрещен. Токен не предоставлен.' });
    }

    let userId: number | null;
    try {
      userId = decodeUserId(token);
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        return res.status(401).json({
          message: 'Сессия истекла. Войдите в аккаунт снова.',
          code: 'TOKEN_EXPIRED',
        });
      }
      return res.status(401).json({
        message: 'Сессия недействительна. Войдите в аккаунт снова.',
        code: 'TOKEN_INVALID',
      });
    }

    if (!userId) {
      return res.status(401).json({ message: 'Сессия недействительна. Войдите в аккаунт снова.' });
    }

    const user = await loadActiveUser(userId);
    if (!user) {
      return res.status(401).json({
        message: 'Аккаунт недоступен. Войдите снова или обратитесь в поддержку.',
        code: 'USER_INACTIVE',
      });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error('authenticate error:', error);
    res.status(401).json({ message: 'Сессия недействительна. Войдите в аккаунт снова.' });
  }
};

/** Attach user if token is valid; continue as guest otherwise. */
export const optionalAuthenticate = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.header('Authorization');
    const token = authHeader?.replace('Bearer ', '');
    if (!token) {
      return next();
    }
    const userId = decodeUserId(token);
    if (userId) {
      const user = await loadActiveUser(userId);
      if (user) req.user = user;
    }
  } catch {
    // ignore invalid/expired tokens for public feed
  }
  next();
};
