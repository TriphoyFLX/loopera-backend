import express from 'express';
import multer from 'multer';
import { existsSync, mkdirSync, unlinkSync } from 'fs';
import { join, extname } from 'path';
import { type AuthRequest } from '../middleware/auth.js';
import pool from '../config/database.js';
import { persistMulterFile } from '../services/objectStorage.js';

type Response = express.Response;

const avatarDir = join(process.cwd(), 'uploads', 'avatars');
if (!existsSync(avatarDir)) {
  mkdirSync(avatarDir, { recursive: true });
}

const avatarUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, avatarDir),
    filename: (_req, file, cb) => {
      const ext = extname(file.originalname || '').toLowerCase() || '.jpg';
      const safeExt = ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext) ? ext : '.jpg';
      cb(null, `avatar-${Date.now()}-${Math.round(Math.random() * 1e9)}${safeExt}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok =
      /^image\/(jpeg|png|webp|gif)$/i.test(file.mimetype) ||
      /\.(jpe?g|png|webp|gif)$/i.test(file.originalname || '');
    cb(ok ? null : new Error('Только изображения JPG, PNG, WEBP или GIF'), ok);
  },
});

export const avatarUploadMiddleware = avatarUpload.single('avatar');

export const uploadAvatar = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId || req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: 'Не авторизован' });
    }

    const file = req.file;
    if (!file) {
      return res.status(400).json({ message: 'Файл не загружен' });
    }

    const avatarUrl = await persistMulterFile(file, 'avatars');

    const prev = await pool.query('SELECT avatar_url FROM users WHERE id = $1', [userId]);
    const oldUrl = prev.rows[0]?.avatar_url as string | undefined;

    await pool.query(
      'UPDATE users SET avatar_url = $1, updated_at = NOW() WHERE id = $2',
      [avatarUrl, userId],
    );

    if (oldUrl && oldUrl.startsWith('/uploads/avatars/')) {
      const oldPath = join(process.cwd(), oldUrl.replace(/^\//, ''));
      try {
        if (existsSync(oldPath)) unlinkSync(oldPath);
      } catch {
        /* ignore */
      }
    }

    const userResult = await pool.query(
      'SELECT id, username, email, role, onboarding_completed, created_at, avatar_url FROM users WHERE id = $1',
      [userId],
    );

    return res.json({
      message: 'Аватар обновлён',
      avatar_url: avatarUrl,
      user: {
        id: userResult.rows[0].id,
        username: userResult.rows[0].username,
        email: userResult.rows[0].email,
        role: userResult.rows[0].role || 'user',
        onboarding_completed: !!userResult.rows[0].onboarding_completed,
        avatar_url: userResult.rows[0].avatar_url,
        created_at: userResult.rows[0].created_at,
      },
    });
  } catch (error) {
    if (req.file?.path) {
      try {
        unlinkSync(req.file.path);
      } catch {
        /* ignore */
      }
    }
    return res.status(500).json({
      message: 'Не удалось загрузить аватар',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

// Получить топ пользователей по количеству лупов и лайков
export const getTopUsers = async (req: AuthRequest, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 6;

    const query = `
      SELECT 
        u.id,
        u.username,
        u.email,
        u.hashtag,
        u.avatar_url,
        u.created_at,
        COUNT(DISTINCT l.id) as loops_count,
        COUNT(DISTINCT ll.id) as total_likes,
        (
          SELECT ups.plan_slug
          FROM user_paid_subscriptions ups
          WHERE ups.user_id = u.id
            AND ups.status = 'active'
            AND ups.period_end > NOW()
          ORDER BY ups.period_end DESC
          LIMIT 1
        ) as plan_slug
      FROM users u
      LEFT JOIN loops l ON u.id = l.user_id
      LEFT JOIN loop_likes ll ON l.id = ll.loop_id
      WHERE COALESCE(u.is_banned, false) = false
        AND u.id IN (
        SELECT DISTINCT user_id 
        FROM loops 
        WHERE user_id IS NOT NULL
      )
      GROUP BY u.id, u.username, u.email, u.hashtag, u.avatar_url, u.created_at
      HAVING COUNT(DISTINCT l.id) > 0
      ORDER BY 
        (COUNT(DISTINCT l.id) * 0.7 + COUNT(DISTINCT ll.id) * 0.3) DESC,
        u.created_at ASC
      LIMIT $1
    `;

    const result = await pool.query(query, [limit]);

    // Форматируем данные
    const users = result.rows.map(row => ({
      id: row.id,
      username: row.username,
      email: row.email,
      hashtag: row.hashtag,
      avatar_url: row.avatar_url,
      created_at: row.created_at,
      loops_count: parseInt(row.loops_count),
      total_likes: parseInt(row.total_likes),
      plan_slug: row.plan_slug || 'free',
      avg_rating: 0
    }));

    const totalQuery = `
      SELECT COUNT(*) as total
      FROM users u
      WHERE u.id IN (
        SELECT DISTINCT user_id 
        FROM loops 
        WHERE user_id IS NOT NULL
      )
      AND EXISTS (
        SELECT 1 FROM loops l WHERE l.user_id = u.id
      )
    `;

    const totalResult = await pool.query(totalQuery);
    const total = parseInt(totalResult.rows[0].total);

    res.json({
      users,
      pagination: {
        page: 1,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    res.status(500).json({ 
      message: 'Ошибка получения топ пользователей',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

// Получить статистику пользователя
export const getUserStats = async (req: AuthRequest, res: Response) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({ 
        message: 'ID пользователя обязателен',
        error: 'User ID is required'
      });
    }

    const query = `
      SELECT 
        COUNT(DISTINCT l.id) as loops_count,
        COUNT(DISTINCT ll.id) as total_likes
      FROM users u
      LEFT JOIN loops l ON u.id = l.user_id
      LEFT JOIN loop_likes ll ON l.id = ll.loop_id
      WHERE u.id = $1
      GROUP BY u.id
    `;

    const result = await pool.query(query, [userId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ 
        message: 'Пользователь не найден',
        error: 'User not found'
      });
    }

    const stats = {
      loops_count: parseInt(result.rows[0].loops_count),
      total_likes: parseInt(result.rows[0].total_likes),
      avg_rating: 0
    };

    res.json(stats);
  } catch (error) {
    res.status(500).json({ 
      message: 'Ошибка получения статистики пользователя',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};
