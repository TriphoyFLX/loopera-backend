import type { Request, Response } from 'express';
import pool from '../config/database.js';
import { adminSetUserPlan } from '../services/subscriptionService.js';
import type { BillingPeriod, PlanSlug } from '../services/planCatalog.js';

export const getAdminStats = async (req: Request, res: Response) => {
  try {
    const queries = {
      totalUsers: 'SELECT COUNT(*) as count FROM users',
      totalLoops: 'SELECT COUNT(*) as count FROM loops',
      totalStorage: 'SELECT SUM(file_size) as total FROM loops',
      totalPacks: `
        SELECT COUNT(*)::int as count
        FROM sound_packs
        WHERE COALESCE(status, 'approved') <> 'deleted'
      `,
      activeNotifications: `
        SELECT COUNT(*)::int as count
        FROM notifications
        WHERE is_active = TRUE
      `,
      downloadsToday: `
        SELECT COUNT(*)::int as count
        FROM loop_downloads
        WHERE created_at >= date_trunc('day', NOW())
      `,
      downloadsTotal: 'SELECT COUNT(*)::int as count FROM loop_downloads',
      uniqueDownloadersToday: `
        SELECT COUNT(DISTINCT user_id)::int as count
        FROM loop_downloads
        WHERE created_at >= date_trunc('day', NOW())
      `,
      recentUsers: `
        SELECT id, username, email, created_at 
        FROM users 
        ORDER BY created_at DESC 
        LIMIT 10
      `,
      recentLoops: `
        SELECT l.id, l.title, l.filename, l.file_size, l.created_at,
               u.username as artist_name
        FROM loops l
        JOIN users u ON l.user_id = u.id
        ORDER BY l.created_at DESC
        LIMIT 10
      `,
      topUsers: `
        SELECT u.id, u.username, u.email, u.created_at,
               COUNT(l.id) as loop_count,
               COALESCE(SUM(l.file_size), 0) as total_size
        FROM users u
        LEFT JOIN loops l ON u.id = l.user_id
        GROUP BY u.id, u.username, u.email, u.created_at
        ORDER BY loop_count DESC
        LIMIT 10
      `,
      storageByGenre: `
        SELECT genre, COUNT(*) as count, SUM(file_size) as total_size
        FROM loops
        WHERE genre IS NOT NULL
        GROUP BY genre
        ORDER BY count DESC
      `
    };

    const [
      totalUsersResult,
      totalLoopsResult,
      totalStorageResult,
      totalPacksResult,
      activeNotificationsResult,
      downloadsTodayResult,
      downloadsTotalResult,
      uniqueDownloadersTodayResult,
      recentUsersResult,
      recentLoopsResult,
      topUsersResult,
      storageByGenreResult
    ] = await Promise.all([
      pool.query(queries.totalUsers),
      pool.query(queries.totalLoops),
      pool.query(queries.totalStorage),
      pool.query(queries.totalPacks).catch(() => ({ rows: [{ count: 0 }] })),
      pool.query(queries.activeNotifications).catch(() => ({ rows: [{ count: 0 }] })),
      pool.query(queries.downloadsToday).catch(() => ({ rows: [{ count: 0 }] })),
      pool.query(queries.downloadsTotal).catch(() => ({ rows: [{ count: 0 }] })),
      pool.query(queries.uniqueDownloadersToday).catch(() => ({ rows: [{ count: 0 }] })),
      pool.query(queries.recentUsers),
      pool.query(queries.recentLoops),
      pool.query(queries.topUsers),
      pool.query(queries.storageByGenre)
    ]);

    const hideEmails = req.staffRole === 'manager';
    const stripEmail = <T extends Record<string, unknown>>(row: T) => {
      if (!hideEmails) return row;
      const { email: _email, ...rest } = row;
      return rest as T;
    };

    const stats = {
      overview: {
        totalUsers: parseInt(totalUsersResult.rows[0].count),
        totalLoops: parseInt(totalLoopsResult.rows[0].count),
        totalStorage: parseInt(totalStorageResult.rows[0].total) || 0,
        totalPacks: parseInt(String(totalPacksResult.rows[0]?.count ?? 0), 10) || 0,
        activeNotifications:
          parseInt(String(activeNotificationsResult.rows[0]?.count ?? 0), 10) || 0,
        downloadsToday: parseInt(String(downloadsTodayResult.rows[0]?.count ?? 0), 10) || 0,
        downloadsTotal: parseInt(String(downloadsTotalResult.rows[0]?.count ?? 0), 10) || 0,
        uniqueDownloadersToday:
          parseInt(String(uniqueDownloadersTodayResult.rows[0]?.count ?? 0), 10) || 0,
      },
      recentUsers: recentUsersResult.rows.map(stripEmail),
      recentLoops: recentLoopsResult.rows,
      topUsers: topUsersResult.rows.map(stripEmail),
      storageByGenre: storageByGenreResult.rows
    };

    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch admin statistics' });
  }
};

export const getAllUsers = async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;
    const search = req.query.search as string || '';
    const status = req.query.status as string || 'all';

    let usersQuery = `
      SELECT id, username, email, created_at, is_banned,
             (SELECT COUNT(*) FROM loops WHERE user_id = users.id) as loop_count,
             COALESCE((
               SELECT ups.plan_slug FROM user_paid_subscriptions ups
               WHERE ups.user_id = users.id AND ups.status = 'active' AND ups.period_end > NOW()
               ORDER BY ups.period_end DESC LIMIT 1
             ), CASE WHEN users.id = 824 THEN 'business' ELSE 'free' END) as plan_slug,
             (
               SELECT ups.period_end FROM user_paid_subscriptions ups
               WHERE ups.user_id = users.id AND ups.status = 'active' AND ups.period_end > NOW()
               ORDER BY ups.period_end DESC LIMIT 1
             ) as plan_ends_at
      FROM users
      WHERE 1=1
    `;
    
    let countQuery = 'SELECT COUNT(*) as total FROM users WHERE 1=1';
    
    const params: any[] = [];
    let paramIndex = 1;

    // Add search filter
    if (search) {
      const searchCondition = ` AND (username ILIKE $${paramIndex} OR email ILIKE $${paramIndex})`;
      usersQuery += searchCondition;
      countQuery += searchCondition;
      params.push(`%${search}%`);
      paramIndex++;
    }

    // Add status filter
    if (status === 'banned') {
      const statusCondition = ` AND is_banned = true`;
      usersQuery += statusCondition;
      countQuery += statusCondition;
    } else if (status === 'active') {
      const statusCondition = ` AND is_banned = false`;
      usersQuery += statusCondition;
      countQuery += statusCondition;
    }

    usersQuery += ` ORDER BY created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);

    const [usersResult, countResult] = await Promise.all([
      pool.query(usersQuery, params),
      pool.query(countQuery, params.slice(0, paramIndex - 1))
    ]);

    const totalUsers = parseInt(countResult.rows[0].total);
    const totalPages = Math.ceil(totalUsers / limit);

    res.json({
      users: usersResult.rows,
      pagination: {
        currentPage: page,
        totalPages,
        totalUsers,
        hasNext: page < totalPages,
        hasPrev: page > 1
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch users' });
  }
};

export const getAllLoops = async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;

    const loopsQuery = `
      SELECT l.id, l.title, l.filename, l.file_size, l.bpm, l.key, 
             l.genre, l.created_at, l.duration,
             u.username as artist_name, u.email as artist_email
      FROM loops l
      JOIN users u ON l.user_id = u.id
      ORDER BY l.created_at DESC
      LIMIT $1 OFFSET $2
    `;

    const countQuery = 'SELECT COUNT(*) as total FROM loops';

    const [loopsResult, countResult] = await Promise.all([
      pool.query(loopsQuery, [limit, offset]),
      pool.query(countQuery)
    ]);

    const totalLoops = parseInt(countResult.rows[0].total);
    const totalPages = Math.ceil(totalLoops / limit);

    const loops =
      req.staffRole === 'manager'
        ? loopsResult.rows.map(({ artist_email: _email, ...loop }) => loop)
        : loopsResult.rows;

    res.json({
      loops,
      pagination: {
        currentPage: page,
        totalPages,
        totalLoops,
        hasNext: page < totalPages,
        hasPrev: page > 1
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch loops' });
  }
};

export const deleteLoop = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    // Проверяем существование лупа
    const loopCheck = await pool.query('SELECT * FROM loops WHERE id = $1', [id]);
    
    if (loopCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Loop not found' });
    }

    // Удаляем луп и связанные данные
    await pool.query('DELETE FROM loop_likes WHERE loop_id = $1', [id]);
    await pool.query('DELETE FROM loops WHERE id = $1', [id]);

    res.json({ message: 'Loop deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete loop' });
  }
};

export const banUser = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const targetId = parseInt(String(id), 10);
    if (!Number.isFinite(targetId)) {
      return res.status(400).json({ error: 'Invalid user id' });
    }

    // Добавляем колонку is_banned если ее нет
    await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS is_banned BOOLEAN DEFAULT FALSE');
    await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS ban_reason TEXT');

    // Нельзя банить владельца и staff-аккаунты
    const target = await pool.query(
      `SELECT id, role FROM users WHERE id = $1`,
      [targetId],
    );
    if (target.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    const role = String(target.rows[0].role || 'user').toLowerCase();
    if (targetId === 824 || role === 'admin' || role === 'manager') {
      return res.status(403).json({ error: 'Cannot ban staff accounts' });
    }

    await pool.query(
      'UPDATE users SET is_banned = TRUE, ban_reason = $1 WHERE id = $2',
      [reason, targetId]
    );

    res.json({ message: 'User banned successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to ban user' });
  }
};

export const unbanUser = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    await pool.query(
      'UPDATE users SET is_banned = FALSE, ban_reason = NULL WHERE id = $1',
      [id]
    );

    res.json({ message: 'User unbanned successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to unban user' });
  }
};

export const setUserPlan = async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    const userId = parseInt(String(req.params.id), 10);
    if (!Number.isFinite(userId)) {
      return res.status(400).json({ error: 'Invalid user id' });
    }

    const userCheck = await client.query(`SELECT id, username FROM users WHERE id = $1`, [userId]);
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const rawPlan = String(req.body?.plan || '').toLowerCase();
    const planSlug = (
      rawPlan === 'elite' || rawPlan === 'business'
        ? 'business'
        : rawPlan === 'basic' || rawPlan === 'pro' || rawPlan === 'free'
          ? rawPlan
          : ''
    ) as PlanSlug;
    if (!planSlug) {
      return res.status(400).json({ error: 'plan must be free, basic, pro, or business' });
    }

    const billingPeriod = (String(req.body?.period || 'monthly').toLowerCase() === 'yearly'
      ? 'yearly'
      : 'monthly') as BillingPeriod;

    const daysRaw = req.body?.days;
    const days =
      daysRaw != null && Number.isFinite(Number(daysRaw)) ? parseInt(String(daysRaw), 10) : undefined;

    await client.query('BEGIN');
    const result = await adminSetUserPlan(client, {
      userId,
      planSlug,
      billingPeriod,
      days,
    });
    await client.query('COMMIT');

    return res.json({
      message: 'Plan updated',
      user_id: userId,
      username: userCheck.rows[0].username,
      plan: result.slug,
      period_end: result.period_end,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('setUserPlan error:', error);
    return res.status(500).json({ error: 'Failed to set user plan' });
  } finally {
    client.release();
  }
};
