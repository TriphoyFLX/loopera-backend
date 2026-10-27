import express from 'express';
import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.js';
import pool from '../config/database.js';

const normalizeSlug = (value: string) =>
  value.trim().replace(/^#/, '').toLowerCase();

export const getArtistTypes = async (_req: express.Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT id, name, slug, aliases, sort_order
       FROM artist_types
       WHERE is_active = TRUE
       ORDER BY sort_order ASC, name ASC`
    );

    res.json({ artists: result.rows });
  } catch (error) {
    res.status(500).json({
      message: 'Не удалось загрузить артистов',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

export const getAdminArtistTypes = async (_req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT id, name, slug, aliases, sort_order, is_active, created_at
       FROM artist_types
       ORDER BY sort_order ASC, name ASC`
    );

    res.json({ artists: result.rows });
  } catch (error) {
    res.status(500).json({
      message: 'Не удалось загрузить артистов',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

export const createArtistType = async (req: AuthRequest, res: Response) => {
  try {
    const { name, slug, aliases = [], sort_order = 100, is_active = true } = req.body;

    if (!name?.trim() || !slug?.trim()) {
      return res.status(400).json({ message: 'Название и slug обязательны' });
    }

    const normalizedSlug = normalizeSlug(slug);
    const normalizedAliases = Array.isArray(aliases)
      ? aliases.map((item: string) => normalizeSlug(item)).filter(Boolean)
      : [];

    const result = await pool.query(
      `INSERT INTO artist_types (name, slug, aliases, sort_order, is_active)
       VALUES ($1, $2, $3::jsonb, $4, $5)
       RETURNING id, name, slug, aliases, sort_order, is_active, created_at`,
      [name.trim(), normalizedSlug, JSON.stringify(normalizedAliases), sort_order, is_active]
    );

    res.status(201).json({ artist: result.rows[0] });
  } catch (error: any) {
    if (error?.code === '23505') {
      return res.status(409).json({ message: 'Артист с таким slug уже существует' });
    }
    res.status(500).json({
      message: 'Не удалось создать артиста',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

export const updateArtistType = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { name, slug, aliases, sort_order, is_active } = req.body;

    const result = await pool.query(
      `UPDATE artist_types
       SET
         name = COALESCE($2, name),
         slug = COALESCE($3, slug),
         aliases = COALESCE($4::jsonb, aliases),
         sort_order = COALESCE($5, sort_order),
         is_active = COALESCE($6, is_active)
       WHERE id = $1
       RETURNING id, name, slug, aliases, sort_order, is_active, created_at`,
      [
        id,
        name?.trim() || null,
        slug ? normalizeSlug(slug) : null,
        aliases ? JSON.stringify(aliases.map((item: string) => normalizeSlug(item)).filter(Boolean)) : null,
        sort_order ?? null,
        is_active ?? null,
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Артист не найден' });
    }

    res.json({ artist: result.rows[0] });
  } catch (error: any) {
    if (error?.code === '23505') {
      return res.status(409).json({ message: 'Артист с таким slug уже существует' });
    }
    res.status(500).json({
      message: 'Не удалось обновить артиста',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

export const deleteArtistType = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM artist_types WHERE id = $1 RETURNING id', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Артист не найден' });
    }

    res.json({ message: 'Артист удалён' });
  } catch (error) {
    res.status(500).json({
      message: 'Не удалось удалить артиста',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};
