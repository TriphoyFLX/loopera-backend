import type { Response } from 'express';
import pool from '../config/database.js';
import type { AuthRequest } from '../middleware/auth.js';

const KINDS = new Set(['news', 'ad']);

function getUserId(req: AuthRequest): number | null {
  const id = Number(req.user?.id ?? req.user?.userId);
  return Number.isFinite(id) ? id : null;
}

function normalizeKind(raw: unknown): 'news' | 'ad' | null {
  const kind = String(raw || '').trim().toLowerCase();
  if (kind === 'news' || kind === 'ad') return kind;
  return null;
}

function sanitizeOptionalUrl(raw: unknown, max = 500): string | null {
  const value = String(raw || '').trim();
  if (!value) return null;
  if (value.length > max) return null;
  if (!/^https?:\/\//i.test(value) && !value.startsWith('/')) return null;
  return value;
}

/** Public: active home posts (news + ads) */
export const listPublicHomePosts = async (_req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT id, kind, title, body, cta_label, cta_url, image_url, created_at
       FROM home_posts
       WHERE is_active = TRUE
       ORDER BY sort_order DESC, created_at DESC
       LIMIT 20`,
    );
    res.json({ posts: result.rows });
  } catch (error) {
    console.error('listPublicHomePosts error:', error);
    res.status(500).json({ error: 'Failed to load home posts' });
  }
};

/** Staff: list all including hidden */
export const adminListHomePosts = async (_req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT p.id, p.kind, p.title, p.body, p.cta_label, p.cta_url, p.image_url,
              p.is_active, p.sort_order, p.created_at, p.updated_at,
              u.username AS author_name
       FROM home_posts p
       LEFT JOIN users u ON u.id = p.created_by
       ORDER BY p.sort_order DESC, p.created_at DESC
       LIMIT 100`,
    );
    res.json({ posts: result.rows });
  } catch (error) {
    console.error('adminListHomePosts error:', error);
    res.status(500).json({ error: 'Failed to load home posts' });
  }
};

export const createHomePost = async (req: AuthRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    const kind = normalizeKind(req.body?.kind);
    const title = String(req.body?.title || '').trim();
    const body = String(req.body?.body || '').trim();
    const ctaLabel = String(req.body?.cta_label || '').trim().slice(0, 80) || null;
    const ctaUrl = sanitizeOptionalUrl(req.body?.cta_url);
    const imageUrl = sanitizeOptionalUrl(req.body?.image_url);
    const sortOrder = Number.isFinite(Number(req.body?.sort_order))
      ? Math.trunc(Number(req.body.sort_order))
      : 0;

    if (!kind || !KINDS.has(kind)) {
      return res.status(400).json({ error: 'kind must be news or ad' });
    }
    if (!title || title.length > 200) {
      return res.status(400).json({ error: 'Title required (max 200)' });
    }
    if (!body || body.length > 4000) {
      return res.status(400).json({ error: 'Body required (max 4000)' });
    }
    if (req.body?.cta_url && !ctaUrl) {
      return res.status(400).json({ error: 'cta_url must start with http(s):// or /' });
    }
    if (req.body?.image_url && !imageUrl) {
      return res.status(400).json({ error: 'image_url must start with http(s):// or /' });
    }

    const result = await pool.query(
      `INSERT INTO home_posts
         (kind, title, body, cta_label, cta_url, image_url, sort_order, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, kind, title, body, cta_label, cta_url, image_url,
                 is_active, sort_order, created_at, updated_at`,
      [kind, title, body, ctaLabel, ctaUrl, imageUrl, sortOrder, userId],
    );

    res.status(201).json({ post: result.rows[0] });
  } catch (error) {
    console.error('createHomePost error:', error);
    res.status(500).json({ error: 'Failed to create home post' });
  }
};

export const updateHomePost = async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: 'Invalid id' });
    }

    const existing = await pool.query(`SELECT * FROM home_posts WHERE id = $1`, [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Not found' });
    }
    const row = existing.rows[0];

    const kind = req.body?.kind !== undefined ? normalizeKind(req.body.kind) : row.kind;
    if (!kind || !KINDS.has(kind)) {
      return res.status(400).json({ error: 'kind must be news or ad' });
    }

    const title =
      req.body?.title !== undefined ? String(req.body.title || '').trim() : row.title;
    const body =
      req.body?.body !== undefined ? String(req.body.body || '').trim() : row.body;
    if (!title || title.length > 200) {
      return res.status(400).json({ error: 'Title required (max 200)' });
    }
    if (!body || body.length > 4000) {
      return res.status(400).json({ error: 'Body required (max 4000)' });
    }

    let ctaLabel = row.cta_label;
    if (req.body?.cta_label !== undefined) {
      ctaLabel = String(req.body.cta_label || '').trim().slice(0, 80) || null;
    }

    let ctaUrl = row.cta_url;
    if (req.body?.cta_url !== undefined) {
      ctaUrl = sanitizeOptionalUrl(req.body.cta_url);
      if (req.body.cta_url && !ctaUrl) {
        return res.status(400).json({ error: 'cta_url must start with http(s):// or /' });
      }
    }

    let imageUrl = row.image_url;
    if (req.body?.image_url !== undefined) {
      imageUrl = sanitizeOptionalUrl(req.body.image_url);
      if (req.body.image_url && !imageUrl) {
        return res.status(400).json({ error: 'image_url must start with http(s):// or /' });
      }
    }

    const isActive =
      req.body?.is_active !== undefined ? Boolean(req.body.is_active) : row.is_active;
    const sortOrder =
      req.body?.sort_order !== undefined && Number.isFinite(Number(req.body.sort_order))
        ? Math.trunc(Number(req.body.sort_order))
        : row.sort_order;

    const result = await pool.query(
      `UPDATE home_posts
       SET kind = $1, title = $2, body = $3, cta_label = $4, cta_url = $5,
           image_url = $6, is_active = $7, sort_order = $8, updated_at = CURRENT_TIMESTAMP
       WHERE id = $9
       RETURNING id, kind, title, body, cta_label, cta_url, image_url,
                 is_active, sort_order, created_at, updated_at`,
      [kind, title, body, ctaLabel, ctaUrl, imageUrl, isActive, sortOrder, id],
    );

    res.json({ post: result.rows[0] });
  } catch (error) {
    console.error('updateHomePost error:', error);
    res.status(500).json({ error: 'Failed to update home post' });
  }
};

export const deleteHomePost = async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: 'Invalid id' });
    }

    const result = await pool.query(
      `UPDATE home_posts SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 RETURNING id`,
      [id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Not found' });
    }

    res.json({ ok: true });
  } catch (error) {
    console.error('deleteHomePost error:', error);
    res.status(500).json({ error: 'Failed to delete home post' });
  }
};
