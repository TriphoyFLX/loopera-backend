import express from 'express';
import { simpleAuth, type AuthRequest } from '../middleware/simpleAuth.ts';
import pool from '../config/database.ts';

type Response = express.Response;

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
        COUNT(DISTINCT ll.id) as total_likes
      FROM users u
      LEFT JOIN loops l ON u.id = l.user_id
      LEFT JOIN loop_likes ll ON l.id = ll.loop_id
      WHERE u.id IN (
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
    console.error('Get top users error:', error);
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
    console.error('Get user stats error:', error);
    res.status(500).json({ 
      message: 'Ошибка получения статистики пользователя',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};
