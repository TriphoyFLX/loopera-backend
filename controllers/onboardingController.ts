import express from 'express';
import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.js';
import pool from '../config/database.js';
import { notifyArtistTypesSelected } from '../services/emailService.js';

export const MIN_ARTIST_PREFERENCES = 3;
const REMIND_AFTER_HOURS = 24;

const normalizeSlug = (value: string) =>
  value.trim().replace(/^#/, '').toLowerCase().replace(/\s+/g, '');

const normalizeArtists = (artists: unknown): string[] => {
  if (!Array.isArray(artists)) return [];
  return [...new Set(
    artists
      .filter((item): item is string => typeof item === 'string')
      .map((item) => normalizeSlug(item))
      .filter(Boolean)
  )];
};

export const getOnboardingStatus = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId || req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: 'Не авторизован' });
    }

    const result = await pool.query(
      `SELECT onboarding_completed, onboarding_skipped_at
       FROM users WHERE id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Пользователь не найден' });
    }

    const user = result.rows[0];
    const subsResult = await pool.query(
      'SELECT COUNT(*)::int AS count FROM artist_subscriptions WHERE user_id = $1',
      [userId]
    );
    const subscriptionCount = subsResult.rows[0]?.count ?? 0;

    const skippedAt = user.onboarding_skipped_at ? new Date(user.onboarding_skipped_at) : null;
    const remindAfterMs = REMIND_AFTER_HOURS * 60 * 60 * 1000;
    const shouldRemindAfterSkip = !skippedAt || (Date.now() - skippedAt.getTime()) >= remindAfterMs;

    const should_prompt =
      !user.onboarding_completed &&
      subscriptionCount < MIN_ARTIST_PREFERENCES &&
      shouldRemindAfterSkip;

    res.json({
      onboarding_completed: !!user.onboarding_completed,
      should_prompt,
      subscription_count: subscriptionCount,
      min_required: MIN_ARTIST_PREFERENCES,
      skipped_at: user.onboarding_skipped_at,
      remind_after_hours: REMIND_AFTER_HOURS,
    });
  } catch (error) {
    res.status(500).json({
      message: 'Не удалось получить статус онбординга',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

const syncArtistPreferences = async (
  userId: number,
  normalizedArtists: string[],
  markCompleted: boolean
) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    if (normalizedArtists.length > 0) {
      await client.query(
        `DELETE FROM artist_subscriptions
         WHERE user_id = $1
         AND artist_hashtag <> ALL($2::text[])`,
        [userId, normalizedArtists]
      );
    } else {
      await client.query('DELETE FROM artist_subscriptions WHERE user_id = $1', [userId]);
    }

    for (const artistSlug of normalizedArtists) {
      await client.query(
        `INSERT INTO artist_subscriptions (user_id, artist_hashtag)
         VALUES ($1, $2)
         ON CONFLICT (user_id, artist_hashtag) DO NOTHING`,
        [userId, artistSlug]
      );
    }

    const userResult = await client.query(
      `UPDATE users
       SET
         onboarding_completed = CASE WHEN $2 THEN TRUE ELSE onboarding_completed END,
         onboarding_skipped_at = NULL,
         updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING id, username, email, role, onboarding_completed, created_at`,
      [userId, markCompleted]
    );

    await client.query('COMMIT');
    return userResult.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

export const completeOnboarding = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId || req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: 'Не авторизован' });
    }

    const normalizedArtists = normalizeArtists(req.body?.artists);

    if (normalizedArtists.length < MIN_ARTIST_PREFERENCES) {
      return res.status(400).json({
        message: `Выберите минимум ${MIN_ARTIST_PREFERENCES} артиста`,
        min_required: MIN_ARTIST_PREFERENCES,
      });
    }

    const user = await syncArtistPreferences(userId, normalizedArtists, true);

    void notifyArtistTypesSelected({
      id: user.id,
      username: user.username,
      email: user.email,
      artists: normalizedArtists,
    });

    res.json({
      message: 'Настройки сохранены',
      user,
      subscribed_count: normalizedArtists.length,
    });
  } catch (error) {
    res.status(500).json({
      message: 'Не удалось сохранить настройки',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

export const updateArtistPreferences = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId || req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: 'Не авторизован' });
    }

    const normalizedArtists = normalizeArtists(req.body?.artists);

    if (normalizedArtists.length < MIN_ARTIST_PREFERENCES) {
      return res.status(400).json({
        message: `Нужно минимум ${MIN_ARTIST_PREFERENCES} артиста`,
        min_required: MIN_ARTIST_PREFERENCES,
      });
    }

    const user = await syncArtistPreferences(userId, normalizedArtists, true);

    void notifyArtistTypesSelected({
      id: user.id,
      username: user.username,
      email: user.email,
      artists: normalizedArtists,
    });

    res.json({
      message: 'Тайпы обновлены',
      user,
      subscribed_count: normalizedArtists.length,
    });
  } catch (error) {
    res.status(500).json({
      message: 'Не удалось обновить тайпы',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

export const skipOnboarding = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId || req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: 'Не авторизован' });
    }

    const result = await pool.query(
      `UPDATE users
       SET onboarding_skipped_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING id, username, email, role, onboarding_completed, onboarding_skipped_at, created_at`,
      [userId]
    );

    res.json({
      message: 'Напомним позже',
      user: result.rows[0],
      remind_after_hours: REMIND_AFTER_HOURS,
    });
  } catch (error) {
    res.status(500).json({
      message: 'Не удалось пропустить онбординг',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};
