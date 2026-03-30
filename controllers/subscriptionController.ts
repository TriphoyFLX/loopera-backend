import express from 'express';
import { simpleAuth, type AuthRequest } from '../middleware/simpleAuth.ts';
import pool from '../config/database.ts';

type Response = express.Response;

// Получение подписок пользователя
export const getUserSubscriptions = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ 
        message: 'Не авторизован',
        error: 'User authentication required'
      });
    }

    const userId = req.user.id;

    const query = `
      SELECT id, artist_hashtag, created_at
      FROM artist_subscriptions 
      WHERE user_id = $1
      ORDER BY created_at DESC
    `;

    const result = await pool.query(query, [userId]);

    res.json({ 
      subscriptions: result.rows.map(row => ({
        id: row.id,
        artist_hashtag: row.artist_hashtag,
        created_at: row.created_at
      }))
    });
  } catch (error) {
    console.error('Get user subscriptions error:', error);
    res.status(500).json({ 
      message: 'Ошибка получения подписок',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

// Добавление подписки на артиста
export const addSubscription = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ 
        message: 'Не авторизован',
        error: 'User authentication required'
      });
    }

    const { artist_hashtag } = req.body;
    const userId = req.user.id;

    if (!artist_hashtag || !artist_hashtag.trim()) {
      return res.status(400).json({ 
        message: 'Хештег артиста обязателен',
        error: 'Artist hashtag is required'
      });
    }

    // Нормализуем хештег (убираем # если есть и приводим к нижнему регистру)
    const normalizedHashtag = artist_hashtag.startsWith('#') 
      ? artist_hashtag.substring(1).toLowerCase()
      : artist_hashtag.toLowerCase();

    // Проверяем, не существует ли уже такая подписка
    const existingSubscription = await pool.query(
      'SELECT id FROM artist_subscriptions WHERE user_id = $1 AND artist_hashtag = $2',
      [userId, normalizedHashtag]
    );

    if (existingSubscription.rows.length > 0) {
      return res.status(409).json({ 
        message: 'Вы уже подписаны на этого артиста',
        error: 'Subscription already exists'
      });
    }

    // Создаем подписку
    const createSubscriptionQuery = `
      INSERT INTO artist_subscriptions (user_id, artist_hashtag)
      VALUES ($1, $2)
      RETURNING id, artist_hashtag, created_at
    `;

    const result = await pool.query(createSubscriptionQuery, [userId, normalizedHashtag]);
    const subscription = result.rows[0];

    res.status(201).json({
      subscription: {
        id: subscription.id,
        artist_hashtag: subscription.artist_hashtag,
        created_at: subscription.created_at
      }
    });
  } catch (error) {
    console.error('Add subscription error:', error);
    res.status(500).json({ 
      message: 'Ошибка добавления подписки',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

// Удаление подписки
export const removeSubscription = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ 
        message: 'Не авторизован',
        error: 'User authentication required'
      });
    }

    const { subscriptionId } = req.params;
    const userId = req.user.id;

    if (!subscriptionId) {
      return res.status(400).json({ 
        message: 'ID подписки обязателен',
        error: 'Subscription ID is required'
      });
    }

    // Проверяем, принадлежит ли подписка пользователю
    const subscriptionCheck = await pool.query(
      'SELECT id FROM artist_subscriptions WHERE id = $1 AND user_id = $2',
      [subscriptionId, userId]
    );

    if (subscriptionCheck.rows.length === 0) {
      return res.status(404).json({ 
        message: 'Подписка не найдена',
        error: 'Subscription not found'
      });
    }

    // Удаляем подписку
    await pool.query(
      'DELETE FROM artist_subscriptions WHERE id = $1 AND user_id = $2',
      [subscriptionId, userId]
    );

    res.json({ message: 'Подписка удалена' });
  } catch (error) {
    console.error('Remove subscription error:', error);
    res.status(500).json({ 
      message: 'Ошибка удаления подписки',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

// Получение лупов от подписанных артистов
export const getSubscribedLoops = async (req: AuthRequest, res: Response) => {
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
        u.username as author
      FROM loops l
      JOIN users u ON l.user_id = u.id
      JOIN artist_subscriptions sub ON sub.user_id = $1
      WHERE (
        u.username = sub.artist_hashtag OR
        l.genre = sub.artist_hashtag OR
        l.tags::text LIKE '%' || sub.artist_hashtag || '%'
      )
      ORDER BY l.created_at DESC
      LIMIT $2 OFFSET $3
    `;

    const countQuery = `
      SELECT COUNT(*) as total
      FROM loops l
      JOIN users u ON l.user_id = u.id
      JOIN artist_subscriptions sub ON sub.user_id = $1
      WHERE (
        u.username = sub.artist_hashtag OR
        l.genre = sub.artist_hashtag OR
        l.tags::text LIKE '%' || sub.artist_hashtag || '%'
      )
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
    console.error('Get subscribed loops error:', error);
    res.status(500).json({ 
      message: 'Ошибка получения лупов',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};
