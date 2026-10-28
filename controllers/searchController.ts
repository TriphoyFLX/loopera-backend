import type { Request, Response } from 'express';
import pool from '../config/database.js';

function searchTerm(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const q = raw.trim();
  if (!q) return null;
  return q;
}

export const searchArtists = async (req: Request, res: Response) => {
  try {
    const q = searchTerm(req.query.q);
    if (!q) {
      return res.json({ artists: [] });
    }

    const query = `
      SELECT
        u.id,
        u.username,
        u.avatar_url,
        u.created_at,
        COUNT(l.id)::int as loops_count,
        STRING_AGG(DISTINCT l.genre, ', ') as genres,
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
      WHERE u.username ILIKE $1
         OR EXISTS (
           SELECT 1 FROM loops l2
           WHERE l2.user_id = u.id
           AND (
             l2.genre ILIKE $1
             OR l2.title ILIKE $1
             OR COALESCE(l2.tags::text, '') ILIKE $1
           )
         )
      GROUP BY u.id, u.username, u.avatar_url, u.created_at
      HAVING COUNT(l.id) > 0 OR u.username ILIKE $1
      ORDER BY loops_count DESC, u.username ASC
      LIMIT 30
    `;

    const result = await pool.query(query, [`%${q}%`]);

    const artists = result.rows.map((row) => ({
      id: row.id,
      username: row.username,
      avatar_url: row.avatar_url || null,
      hashtag: String(row.username || '')
        .toLowerCase()
        .replace(/[^a-z0-9а-яё]/gi, ''),
      loops_count: parseInt(row.loops_count, 10) || 0,
      genres: row.genres || '',
      created_at: row.created_at,
      plan_slug: row.plan_slug || 'free',
    }));

    res.json({ artists });
  } catch (error) {
    console.error('searchArtists error:', error);
    res.status(500).json({ message: 'Ошибка поиска артистов' });
  }
};

export const searchLoops = async (req: Request, res: Response) => {
  try {
    const q = searchTerm(req.query.q);
    if (!q) {
      return res.json({ loops: [] });
    }

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
        l.cover_url,
        l.created_at,
        l.user_id,
        u.username as author,
        u.id as author_id
      FROM loops l
      JOIN users u ON l.user_id = u.id
      WHERE l.title ILIKE $1
         OR COALESCE(l.genre, '') ILIKE $1
         OR COALESCE(l.key, '') ILIKE $1
         OR COALESCE(l.tags::text, '') ILIKE $1
         OR u.username ILIKE $1
      ORDER BY
        CASE WHEN l.title ILIKE $2 THEN 0 ELSE 1 END,
        l.created_at DESC
      LIMIT 60
    `;

    const result = await pool.query(query, [`%${q}%`, `${q}%`]);

    const loops = result.rows.map((row) => ({
      id: row.id,
      title: row.title,
      filename: row.filename,
      original_name: row.original_name,
      file_size: row.file_size,
      bpm: row.bpm,
      key: row.key,
      genre: row.genre,
      tags: row.tags,
      cover_url: row.cover_url || null,
      created_at: row.created_at,
      user_id: row.user_id,
      author: row.author,
      author_id: row.author_id,
      username: row.author,
    }));

    res.json({ loops });
  } catch (error) {
    console.error('searchLoops error:', error);
    res.status(500).json({ message: 'Ошибка поиска лупов' });
  }
};
