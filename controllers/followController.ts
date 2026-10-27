import express from 'express';
import { type AuthRequest } from '../middleware/auth.js';
import pool from '../config/database.js';

type Response = express.Response;

function getUserId(req: AuthRequest): number | null {
  const id = Number(req.user?.userId ?? req.user?.id);
  return Number.isFinite(id) ? id : null;
}

async function resolveUserId(raw: string): Promise<{ id: number; username: string } | null> {
  const value = String(raw || '').trim();
  if (!value) return null;

  if (/^\d+$/.test(value)) {
    const byId = await pool.query(
      `SELECT id, username FROM users WHERE id = $1 AND COALESCE(is_banned, false) = false`,
      [Number(value)],
    );
    if (byId.rows[0]) return byId.rows[0];
  }

  const byName = await pool.query(
    `SELECT id, username FROM users
     WHERE lower(username) = lower($1) AND COALESCE(is_banned, false) = false
     LIMIT 1`,
    [value.replace(/^@/, '')],
  );
  return byName.rows[0] || null;
}

/** POST /api/follows/:usernameOrId */
export const followUser = async (req: AuthRequest, res: Response) => {
  try {
    const followerId = getUserId(req);
    if (!followerId) {
      return res.status(401).json({ message: 'Не авторизован' });
    }

    const target = await resolveUserId(String(req.params.usernameOrId || ''));
    if (!target) {
      return res.status(404).json({ message: 'Пользователь недоступен для подписки' });
    }
    if (target.id === followerId) {
      return res.status(400).json({ message: 'Нельзя подписаться на себя' });
    }

    const result = await pool.query(
      `INSERT INTO user_follows (follower_id, following_id)
       VALUES ($1, $2)
       ON CONFLICT (follower_id, following_id) DO NOTHING
       RETURNING id, created_at`,
      [followerId, target.id],
    );

    const counts = await getCounts(target.id);

    res.status(result.rows[0] ? 201 : 200).json({
      following: true,
      user: { id: target.id, username: target.username },
      created_at: result.rows[0]?.created_at || null,
      ...counts,
    });
  } catch (error) {
    console.error('followUser error:', error);
    res.status(500).json({ message: 'Ошибка подписки' });
  }
};

/** DELETE /api/follows/:usernameOrId */
export const unfollowUser = async (req: AuthRequest, res: Response) => {
  try {
    const followerId = getUserId(req);
    if (!followerId) {
      return res.status(401).json({ message: 'Не авторизован' });
    }

    const target = await resolveUserId(String(req.params.usernameOrId || ''));
    if (!target) {
      return res.status(404).json({ message: 'Пользователь не найден' });
    }

    await pool.query(
      `DELETE FROM user_follows WHERE follower_id = $1 AND following_id = $2`,
      [followerId, target.id],
    );

    const counts = await getCounts(target.id);

    res.json({
      following: false,
      user: { id: target.id, username: target.username },
      ...counts,
    });
  } catch (error) {
    console.error('unfollowUser error:', error);
    res.status(500).json({ message: 'Ошибка отписки' });
  }
};

/** GET /api/follows/status/:usernameOrId */
export const getFollowStatus = async (req: AuthRequest, res: Response) => {
  try {
    const viewerId = getUserId(req);
    const target = await resolveUserId(String(req.params.usernameOrId || ''));
    if (!target) {
      return res.status(404).json({ message: 'Пользователь не найден' });
    }

    const counts = await getCounts(target.id);
    let following = false;

    if (viewerId && viewerId !== target.id) {
      const row = await pool.query(
        `SELECT 1 FROM user_follows WHERE follower_id = $1 AND following_id = $2 LIMIT 1`,
        [viewerId, target.id],
      );
      following = row.rows.length > 0;
    }

    res.json({
      user: { id: target.id, username: target.username },
      following,
      is_self: viewerId === target.id,
      ...counts,
    });
  } catch (error) {
    console.error('getFollowStatus error:', error);
    res.status(500).json({ message: 'Ошибка статуса подписки' });
  }
};

async function getCounts(userId: number) {
  const result = await pool.query(
    `SELECT
       (SELECT COUNT(*)::int FROM user_follows WHERE following_id = $1) AS followers_count,
       (SELECT COUNT(*)::int FROM user_follows WHERE follower_id = $1) AS following_count`,
    [userId],
  );
  return {
    followers_count: result.rows[0]?.followers_count ?? 0,
    following_count: result.rows[0]?.following_count ?? 0,
  };
}

/** GET /api/follows/me — whom I follow */
export const listMyFollowing = async (req: AuthRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ message: 'Не авторизован' });
    }

    const result = await pool.query(
      `SELECT u.id, u.username, u.avatar_url, u.hashtag, f.created_at AS followed_at,
              (SELECT COUNT(*)::int FROM loops l WHERE l.user_id = u.id) AS loops_count
       FROM user_follows f
       JOIN users u ON u.id = f.following_id
       WHERE f.follower_id = $1
         AND COALESCE(u.is_banned, false) = false
       ORDER BY f.created_at DESC
       LIMIT 200`,
      [userId],
    );

    res.json({ following: result.rows });
  } catch (error) {
    console.error('listMyFollowing error:', error);
    res.status(500).json({ message: 'Ошибка списка подписок' });
  }
};

/** GET /api/follows/user/:usernameOrId/followers */
export const listFollowers = async (req: AuthRequest, res: Response) => {
  try {
    const target = await resolveUserId(String(req.params.usernameOrId || ''));
    if (!target) {
      return res.status(404).json({ message: 'Пользователь не найден' });
    }

    const result = await pool.query(
      `SELECT u.id, u.username, u.avatar_url, f.created_at AS followed_at
       FROM user_follows f
       JOIN users u ON u.id = f.follower_id
       WHERE f.following_id = $1
         AND COALESCE(u.is_banned, false) = false
       ORDER BY f.created_at DESC
       LIMIT 100`,
      [target.id],
    );

    res.json({ user: target, followers: result.rows });
  } catch (error) {
    console.error('listFollowers error:', error);
    res.status(500).json({ message: 'Ошибка списка подписчиков' });
  }
};

/** GET /api/follows/loops — feed from followed loopmakers */
export const getFollowedLoops = async (req: AuthRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit || '20'), 10) || 20));
    const offset = (page - 1) * limit;

    if (!userId) {
      return res.json({
        loops: [],
        pagination: { page, limit, total: 0, totalPages: 0 },
      });
    }

    const query = `
      SELECT
        l.id, l.title, l.filename, l.original_name, l.file_size,
        l.bpm, l.key, l.genre, l.tags, l.cover_url, l.user_id, l.created_at,
        u.username AS author, u.avatar_url AS author_avatar
      FROM loops l
      JOIN users u ON u.id = l.user_id
      JOIN user_follows f ON f.following_id = l.user_id AND f.follower_id = $1
      WHERE COALESCE(u.is_banned, false) = false
      ORDER BY l.created_at DESC
      LIMIT $2 OFFSET $3
    `;

    const countQuery = `
      SELECT COUNT(*)::int AS total
      FROM loops l
      JOIN users u ON u.id = l.user_id
      JOIN user_follows f ON f.following_id = l.user_id AND f.follower_id = $1
      WHERE COALESCE(u.is_banned, false) = false
    `;

    const [loopsResult, countResult] = await Promise.all([
      pool.query(query, [userId, limit, offset]),
      pool.query(countQuery, [userId]),
    ]);

    const total = countResult.rows[0]?.total ?? 0;

    res.json({
      loops: loopsResult.rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 0,
      },
    });
  } catch (error) {
    console.error('getFollowedLoops error:', error);
    res.status(500).json({ message: 'Ошибка ленты подписок' });
  }
};
