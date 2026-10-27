import type { Response } from 'express';
import pool from '../config/database.js';
import type { AuthRequest } from '../middleware/auth.js';

function getUserId(req: AuthRequest): number | null {
  const raw = req.user?.userId ?? req.user?.id;
  const id = typeof raw === 'string' ? parseInt(raw, 10) : Number(raw);
  return Number.isFinite(id) ? id : null;
}

/** Feed: personal notifications + global announcements. */
export const listNotifications = async (req: AuthRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    const limit = Math.min(Math.max(parseInt(String(req.query.limit || '30'), 10) || 30, 1), 50);

    const result = userId
      ? await pool.query(
          `SELECT n.id, n.title, n.body, n.created_at, n.kind, n.link,
                  (nr.notification_id IS NOT NULL) AS is_read,
                  u.username AS author_name
           FROM notifications n
           LEFT JOIN notification_reads nr
             ON nr.notification_id = n.id AND nr.user_id = $1
           LEFT JOIN users u ON u.id = n.created_by
           WHERE n.is_active = TRUE
             AND (n.target_user_id IS NULL OR n.target_user_id = $1)
           ORDER BY n.created_at DESC
           LIMIT $2`,
          [userId, limit],
        )
      : await pool.query(
          `SELECT n.id, n.title, n.body, n.created_at, n.kind, n.link,
                  TRUE AS is_read,
                  u.username AS author_name
           FROM notifications n
           LEFT JOIN users u ON u.id = n.created_by
           WHERE n.is_active = TRUE
             AND n.target_user_id IS NULL
           ORDER BY n.created_at DESC
           LIMIT $1`,
          [limit],
        );

    res.json({
      notifications: result.rows.map((row) => ({
        id: row.id,
        title: row.title,
        body: row.body,
        created_at: row.created_at,
        is_read: Boolean(row.is_read),
        author_name: row.author_name || null,
        kind: row.kind || 'announcement',
        link: row.link || null,
      })),
    });
  } catch (error) {
    console.error('listNotifications error:', error);
    res.status(500).json({ error: 'Failed to load notifications' });
  }
};

export const getUnreadCount = async (req: AuthRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.json({ count: 0 });
    }

    const result = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM notifications n
       WHERE n.is_active = TRUE
         AND (n.target_user_id IS NULL OR n.target_user_id = $1)
         AND NOT EXISTS (
           SELECT 1 FROM notification_reads nr
           WHERE nr.notification_id = n.id AND nr.user_id = $1
         )`,
      [userId],
    );

    res.json({ count: result.rows[0]?.count || 0 });
  } catch (error) {
    console.error('getUnreadCount error:', error);
    res.status(500).json({ error: 'Failed to load unread count' });
  }
};

export const markNotificationRead = async (req: AuthRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const id = parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: 'Invalid id' });
    }

    await pool.query(
      `INSERT INTO notification_reads (notification_id, user_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [id, userId],
    );

    res.json({ ok: true });
  } catch (error) {
    console.error('markNotificationRead error:', error);
    res.status(500).json({ error: 'Failed to mark as read' });
  }
};

export const markAllNotificationsRead = async (req: AuthRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    await pool.query(
      `INSERT INTO notification_reads (notification_id, user_id)
       SELECT n.id, $1
       FROM notifications n
       WHERE n.is_active = TRUE
         AND (n.target_user_id IS NULL OR n.target_user_id = $1)
         AND NOT EXISTS (
           SELECT 1 FROM notification_reads nr
           WHERE nr.notification_id = n.id AND nr.user_id = $1
         )`,
      [userId],
    );

    res.json({ ok: true });
  } catch (error) {
    console.error('markAllNotificationsRead error:', error);
    res.status(500).json({ error: 'Failed to mark all as read' });
  }
};

/** Staff: list including inactive */
export const adminListNotifications = async (_req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT n.id, n.title, n.body, n.created_at, n.is_active, n.kind, n.target_user_id, n.link,
              u.username AS author_name,
              (SELECT COUNT(*)::int FROM notification_reads nr WHERE nr.notification_id = n.id) AS reads_count
       FROM notifications n
       LEFT JOIN users u ON u.id = n.created_by
       ORDER BY n.created_at DESC
       LIMIT 100`,
    );

    res.json({ notifications: result.rows });
  } catch (error) {
    console.error('adminListNotifications error:', error);
    res.status(500).json({ error: 'Failed to load notifications' });
  }
};

export const createNotification = async (req: AuthRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    const title = String(req.body?.title || '').trim();
    const body = String(req.body?.body || '').trim();
    if (!title || !body) {
      return res.status(400).json({ error: 'title and body required' });
    }

    const result = await pool.query(
      `INSERT INTO notifications (title, body, created_by, is_active, kind)
       VALUES ($1, $2, $3, TRUE, 'announcement')
       RETURNING id, title, body, created_at, is_active`,
      [title.slice(0, 200), body.slice(0, 4000), userId],
    );

    res.status(201).json({ notification: result.rows[0] });
  } catch (error) {
    console.error('createNotification error:', error);
    res.status(500).json({ error: 'Failed to create notification' });
  }
};

export const deleteNotification = async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' });

    const result = await pool.query(
      `DELETE FROM notifications WHERE id = $1 RETURNING id`,
      [id],
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (error) {
    console.error('deleteNotification error:', error);
    res.status(500).json({ error: 'Failed to delete notification' });
  }
};
