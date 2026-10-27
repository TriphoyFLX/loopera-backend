import type { Request, Response, NextFunction } from 'express';
import pool from '../config/database.js';
import { PLATFORM_ADMIN_USER_ID } from '../services/planCatalog.js';

export type StaffRole = 'admin' | 'manager';

declare global {
  namespace Express {
    interface Request {
      user?: {
        userId?: number;
        id?: number;
        username?: string;
        email?: string;
        role?: string;
        [key: string]: unknown;
      };
      staffRole?: StaffRole;
    }
  }
}

function getUserId(req: Request): number | null {
  const raw = req.user?.userId ?? req.user?.id;
  const id = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(id) && id > 0 ? id : null;
}

/**
 * Loads role from DB (JWT role is not trusted for privilege).
 * Owner id 824 is always treated as admin.
 */
export async function resolveStaffRole(userId: number): Promise<StaffRole | null> {
  if (userId === PLATFORM_ADMIN_USER_ID) return 'admin';

  const result = await pool.query(
    `SELECT role, COALESCE(is_banned, false) AS is_banned
     FROM users WHERE id = $1`,
    [userId],
  );
  if (result.rows.length === 0) return null;
  if (result.rows[0].is_banned) return null;

  const role = String(result.rows[0].role || 'user').toLowerCase();
  if (role === 'admin' || role === 'manager') return role;
  return null;
}

/** Allow only listed staff roles. */
export const requireStaff =
  (...allowed: StaffRole[]) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const role = await resolveStaffRole(userId);
      if (!role || !allowed.includes(role)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      req.staffRole = role;
      req.user.role = role;
      req.user.userId = userId;
      req.user.id = userId;
      next();
    } catch (error) {
      console.error('requireStaff error:', error);
      return res.status(500).json({ error: 'Staff auth failed' });
    }
  };

/** Owner-only (full admin). */
export const requireAdmin = requireStaff('admin');

/** Admin or manager. */
export const requireAnyStaff = requireStaff('admin', 'manager');

/**
 * Backward-compatible alias: previously only user 824.
 * Now any DB role=admin (plus owner id).
 */
export const simpleAdmin = requireAdmin;
