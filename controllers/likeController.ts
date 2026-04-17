import express from 'express';
import { simpleAuth, type AuthRequest } from '../middleware/simpleAuth.js';
import pool from '../config/database.js';

type Response = express.Response;

// Лайкнуть/дизлайкнуть луп
export const toggleLike = async (req: AuthRequest, res: Response) => {
  try {
    console.log('toggleLike - req.user:', req.user);
    console.log('toggleLike - req.user.id:', req.user?.id);
    
    if (!req.user || !req.user.id) {
      return res.status(401).json({ 
        message: 'Не авторизован',
        error: 'User authentication required'
      });
    }

    const { loopId } = req.params;
    const userId = req.user.id;

    if (!loopId) {
      return res.status(400).json({ 
        message: 'ID лупа обязателен',
        error: 'Loop ID is required'
      });
    }

    // Проверяем существует ли лайк
    const existingLike = await pool.query(
      'SELECT id FROM loop_likes WHERE user_id = $1 AND loop_id = $2',
      [userId, loopId]
    );

    let liked;
    let message;

    if (existingLike.rows.length > 0) {
      // Удаляем лайк
      await pool.query(
        'DELETE FROM loop_likes WHERE user_id = $1 AND loop_id = $2',
        [userId, loopId]
      );
      liked = false;
      message = 'Лайк удален';
    } else {
      // Добавляем лайк
      await pool.query(
        'INSERT INTO loop_likes (user_id, loop_id) VALUES ($1, $2)',
        [userId, loopId]
      );
      liked = true;
      message = 'Лайк добавлен';
    }

    // Получаем общее количество лайков
    const likesCount = await pool.query(
      'SELECT COUNT(*) as count FROM loop_likes WHERE loop_id = $1',
      [loopId]
    );

    res.json({
      message,
      liked,
      likes_count: parseInt(likesCount.rows[0].count)
    });
  } catch (error) {
    console.error('Toggle like error:', error);
    res.status(500).json({ 
      message: 'Ошибка при обработке лайка',
      error: (error as Error).message || 'Unknown error'
    });
  }
};

// Получить статус лайка для лупа
export const getLikeStatus = async (req: AuthRequest, res: Response) => {
  try {
    const { loopId } = req.params;
    const userId = req.user?.id;

    if (!loopId) {
      return res.status(400).json({ 
        message: 'ID лупа обязателен',
        error: 'Loop ID is required'
      });
    }

    // Получаем общее количество лайков
    const likesCount = await pool.query(
      'SELECT COUNT(*) as count FROM loop_likes WHERE loop_id = $1',
      [loopId]
    );

    let liked = false;

    if (userId) {
      // Проверяем лайкнул ли текущий пользователь
      const userLike = await pool.query(
        'SELECT id FROM loop_likes WHERE user_id = $1 AND loop_id = $2',
        [userId, loopId]
      );
      liked = userLike.rows.length > 0;
    }

    res.json({
      liked,
      likes_count: parseInt(likesCount.rows[0].count)
    });
  } catch (error) {
    console.error('Get like status error:', error);
    res.status(500).json({ 
      message: 'Ошибка получения статуса лайка',
      error: (error as Error).message || 'Unknown error'
    });
  }
};

// Получить избранные лупы пользователя
export const getLikedLoops = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ 
        message: 'Не авторизован',
        error: 'User authentication required'
      });
    }

    const userId = req.user.id;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;

    const query = `
      SELECT 
        l.id,
        l.title,
        l.filename,
        l.original_name,
        l.file_size,
        l.bpm,
        l.key,
        l.genre,
        l.tags,
        l.user_id,
        l.created_at,
        u.username as author,
        ll.created_at as liked_at
      FROM loops l
      JOIN users u ON l.user_id = u.id
      JOIN loop_likes ll ON l.id = ll.loop_id
      WHERE ll.user_id = $1
      ORDER BY ll.created_at DESC
      LIMIT $2 OFFSET $3
    `;

    const countQuery = `
      SELECT COUNT(*) as total
      FROM loop_likes
      WHERE user_id = $1
    `;

    const [loopsResult, countResult] = await Promise.all([
      pool.query(query, [userId, limit, offset]),
      pool.query(countQuery, [userId])
    ]);

    const total = parseInt(countResult.rows[0].total);

    res.json({
      loops: loopsResult.rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get liked loops error:', error);
    res.status(500).json({ 
      message: 'Ошибка получения избранных лупов',
      error: (error as Error).message || 'Unknown error'
    });
  }
};
