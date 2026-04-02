import express from 'express';
import type { Request, Response } from 'express';
import pool from '../config/database';

export const searchArtists = async (req: Request, res: Response) => {
  try {
    const { q } = req.query;

    if (!q || typeof q !== 'string' || q.length < 2) {
      return res.json({ artists: [] });
    }

    // Поиск артистов по имени пользователя или хештегу
    const query = `
      SELECT DISTINCT 
        u.id,
        u.username,
        u.created_at,
        COUNT(l.id) as loops_count,
        STRING_AGG(DISTINCT l.genre, ', ') as genres
      FROM users u
      LEFT JOIN loops l ON u.id = l.user_id
      WHERE u.username ILIKE $1 
         OR EXISTS (
           SELECT 1 FROM loops l2 
           WHERE l2.user_id = u.id 
           AND l2.genre ILIKE $1
         )
         OR EXISTS (
           SELECT 1 FROM loops l3 
           WHERE l3.user_id = u.id 
           AND l3.tags::text ILIKE $1
         )
      GROUP BY u.id, u.username, u.created_at
      ORDER BY loops_count DESC, u.username ASC
      LIMIT 20
    `;

    const result = await pool.query(query, [`%${q}%`]);

    const artists = result.rows.map(row => ({
      id: row.id,
      username: row.username,
      hashtag: row.username.toLowerCase().replace(/[^a-z0-9]/g, ''),
      loops_count: parseInt(row.loops_count) || 0,
      genres: row.genres || ''
    }));

    res.json({ artists });
  } catch (error) {
    console.error('Search artists error:', error);
    res.status(500).json({ message: 'Ошибка поиска артистов' });
  }
};

export const searchLoops = async (req: Request, res: Response) => {
  try {
    const { q } = req.query;

    if (!q || typeof q !== 'string' || q.length < 2) {
      return res.json({ loops: [] });
    }

    // Поиск лупов по названию, жанру, тегам
    const query = `
      SELECT 
        l.id,
        l.title,
        l.filename,
        l.original_name,
        l.bpm,
        l.key,
        l.genre,
        l.tags,
        l.created_at,
        u.username,
        u.id as user_id
      FROM loops l
      JOIN users u ON l.user_id = u.id
      WHERE l.title ILIKE $1 
         OR l.genre ILIKE $1
         OR l.tags::text ILIKE $1
         OR u.username ILIKE $1
      ORDER BY l.created_at DESC
      LIMIT 50
    `;

    const result = await pool.query(query, [`%${q}%`]);

    const loops = result.rows.map(row => ({
      id: row.id,
      title: row.title,
      filename: row.filename,
      original_name: row.original_name,
      bpm: row.bpm,
      key: row.key,
      genre: row.genre,
      tags: row.tags,
      created_at: row.created_at,
      username: row.username,
      user_id: row.user_id
    }));

    res.json({ loops });
  } catch (error) {
    console.error('Search loops error:', error);
    res.status(500).json({ message: 'Ошибка поиска лупов' });
  }
};
