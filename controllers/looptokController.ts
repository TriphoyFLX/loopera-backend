import express from 'express';
import type { Response } from 'express';
import multer from 'multer';
import { join } from 'path';
import { existsSync, mkdirSync, unlinkSync } from 'fs';
import {
  assertWithinLimit,
  incrementUsage,
  PlanLimitError,
} from '../services/subscriptionService.js';
import pool from '../config/database.js';
import type { AuthRequest } from '../middleware/auth.js';

const MAX_FILE_SIZE = 15 * 1024 * 1024; // 15MB

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const uploadDir = join(process.cwd(), 'uploads', 'looptok');
    if (!existsSync(uploadDir)) {
      mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const ext = file.originalname.split('.').pop()?.toLowerCase() || 'mp3';
    cb(null, `looptok-${uniqueSuffix}.${ext}`);
  },
});

const fileFilter = (
  _req: express.Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback,
) => {
  const allowedMimes = [
    'audio/mpeg',
    'audio/wav',
    'audio/x-wav',
    'audio/wave',
    'audio/x-pn-wav',
    'audio/ogg',
    'audio/mp4',
    'audio/x-m4a',
    'audio/webm',
    'audio/aac',
    'audio/flac',
    'video/mp4',
    'video/webm',
  ];
  const allowedExtensions = ['mp3', 'wav', 'ogg', 'm4a', 'mp4', 'webm', 'aac', 'flac'];
  const fileExtension = file.originalname.split('.').pop()?.toLowerCase();
  const mimeAllowed = allowedMimes.includes(file.mimetype);
  const extensionAllowed = !!fileExtension && allowedExtensions.includes(fileExtension);

  if (mimeAllowed || extensionAllowed) {
    cb(null, true);
  } else {
    cb(new Error('Only audio/video files are allowed: MP3, WAV, OGG, M4A, MP4, WebM, AAC, FLAC'));
  }
};

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter,
});

const safeUnlinkSync = (filePath: string): void => {
  try {
    if (existsSync(filePath)) unlinkSync(filePath);
  } catch {
    // ignore cleanup errors
  }
};

const parseTags = (tags: unknown): string[] => {
  if (!tags) return [];
  if (Array.isArray(tags)) {
    return tags
      .filter((tag): tag is string => typeof tag === 'string' && !!tag.trim())
      .map((tag) => tag.trim())
      .slice(0, 12);
  }
  if (typeof tags === 'string') {
    try {
      const parsed = JSON.parse(tags);
      if (Array.isArray(parsed)) return parseTags(parsed);
    } catch {
      return tags
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean)
        .slice(0, 12);
    }
  }
  return [];
};

const mapPostRow = (row: any) => ({
  id: row.id,
  title: row.title,
  caption: row.caption,
  filename: row.filename,
  original_name: row.original_name,
  file_size: row.file_size,
  duration: row.duration,
  mime_type: row.mime_type,
  bpm: row.bpm,
  key: row.key,
  tags: row.tags || [],
  view_count: row.view_count || 0,
  share_count: row.share_count || 0,
  like_count: row.like_count || 0,
  comment_count: row.comment_count || 0,
  is_liked: !!row.is_liked,
  loop_id: row.loop_id,
  score: row.score != null ? Number(row.score) : undefined,
  created_at: row.created_at,
  author: {
    id: row.user_id,
    username: row.username,
    avatar_url: row.avatar_url,
    hashtag: row.hashtag,
  },
  loop: row.loop_id
    ? {
        id: row.loop_id,
        title: row.loop_title,
        filename: row.loop_filename,
        bpm: row.loop_bpm,
        key: row.loop_key,
        author_username: row.loop_author_username,
      }
    : null,
});

export const loopTokUploadMiddleware = upload.single('clip');

export const uploadLoopTok = async (req: AuthRequest, res: Response) => {
  let uploadedFilePath: string | null = null;

  try {
    const userId = req.user?.userId || req.user?.id;
    if (!req.user || !userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    if (!req.file) {
      return res.status(400).json({ message: 'Audio/video file is required (field: clip)' });
    }

    uploadedFilePath = req.file.path;

    if (req.file.size > MAX_FILE_SIZE) {
      safeUnlinkSync(uploadedFilePath);
      return res.status(400).json({
        message: 'File too large. Max 15MB — trim a fragment and try again.',
        error: 'FILE_TOO_LARGE',
        maxBytes: MAX_FILE_SIZE,
      });
    }

    try {
      await assertWithinLimit(userId, 'looptok');
    } catch (limitError) {
      safeUnlinkSync(uploadedFilePath);
      if (limitError instanceof PlanLimitError) {
        return res.status(403).json({
          message: limitError.message,
          code: limitError.code,
          action: limitError.action,
          plan: limitError.plan,
        });
      }
      throw limitError;
    }

    const title =
      typeof req.body.title === 'string' && req.body.title.trim()
        ? req.body.title.trim().slice(0, 120)
        : req.file.originalname.replace(/\.[^.]+$/, '').slice(0, 120);

    const caption =
      typeof req.body.caption === 'string' ? req.body.caption.trim().slice(0, 500) : null;
    const bpm = req.body.bpm ? parseInt(String(req.body.bpm), 10) : null;
    const key = typeof req.body.key === 'string' ? req.body.key.slice(0, 10) : null;
    const duration = req.body.duration ? parseFloat(String(req.body.duration)) : null;
    const loopId = req.body.loop_id ? parseInt(String(req.body.loop_id), 10) : null;
    const tags = parseTags(req.body.tags);
    const fromShare = String(req.body.from_share || '') === '1';

    if (Number.isFinite(loopId)) {
      const loopCheck = await pool.query('SELECT id FROM loops WHERE id = $1', [loopId]);
      if (loopCheck.rows.length === 0) {
        safeUnlinkSync(uploadedFilePath);
        return res.status(400).json({ message: 'Attached loop not found' });
      }
    }

    const result = await pool.query(
      `
      INSERT INTO loop_tok_posts (
        user_id, loop_id, title, caption, filename, original_name,
        file_size, duration, mime_type, bpm, key, tags, share_count
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *
      `,
      [
        userId,
        Number.isFinite(loopId) ? loopId : null,
        title,
        caption,
        req.file.filename,
        req.file.originalname,
        req.file.size,
        Number.isFinite(duration) ? duration : null,
        req.file.mimetype || null,
        Number.isFinite(bpm as number) ? bpm : null,
        key,
        JSON.stringify(tags),
        fromShare ? 1 : 0,
      ],
    );

      const post = result.rows[0];
      await incrementUsage(userId, 'looptok');

      const userResult = await pool.query(
      'SELECT id, username, avatar_url, hashtag FROM users WHERE id = $1',
      [userId],
    );

    let attachedLoop = null;
    if (post.loop_id) {
      const loopRes = await pool.query(
        `
        SELECT l.id, l.title, l.filename, l.bpm, l.key, u.username AS author_username
        FROM loops l
        JOIN users u ON u.id = l.user_id
        WHERE l.id = $1
        `,
        [post.loop_id],
      );
      attachedLoop = loopRes.rows[0] || null;
    }

    return res.status(201).json({
      message: 'LoopTok clip uploaded',
      post: {
        ...post,
        like_count: 0,
        comment_count: 0,
        is_liked: false,
        author: userResult.rows[0] || null,
        loop: attachedLoop,
      },
    });
  } catch (error) {
    if (uploadedFilePath) safeUnlinkSync(uploadedFilePath);
    console.error('LoopTok upload failed:', error);
    return res.status(500).json({
      message: error instanceof Error ? error.message : 'Upload failed',
    });
  }
};

/** TikTok-style For You ranking: engagement + freshness + light randomness. */
export const getLoopTokFeed = async (req: AuthRequest, res: Response) => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const limit = Math.min(20, Math.max(1, parseInt(String(req.query.limit || '10'), 10) || 10));
    const offset = (page - 1) * limit;
    const userId = req.user?.userId || req.user?.id || null;
    const mode = String(req.query.mode || 'fyp').toLowerCase() === 'latest' ? 'latest' : 'fyp';

    const countResult = await pool.query('SELECT COUNT(*)::int AS total FROM loop_tok_posts');
    const total = countResult.rows[0]?.total || 0;

    const orderSql =
      mode === 'latest'
        ? 'ORDER BY p.created_at DESC'
        : `ORDER BY (
            COALESCE(lk.cnt, 0) * 3.2
            + COALESCE(cm.cnt, 0) * 5.5
            + COALESCE(p.view_count, 0) * 0.12
            + COALESCE(p.share_count, 0) * 4.0
            + EXP(-EXTRACT(EPOCH FROM (NOW() - p.created_at)) / 3600.0 / 28.0) * 55.0
            + (CASE WHEN $4::int IS NOT NULL AND sub.id IS NOT NULL THEN 18.0 ELSE 0.0 END)
            + random() * 10.0
          ) DESC, p.created_at DESC`;

    const result = await pool.query(
      `
      SELECT
        p.*,
        u.username,
        u.avatar_url,
        u.hashtag,
        COALESCE(lk.cnt, 0)::int AS like_count,
        COALESCE(cm.cnt, 0)::int AS comment_count,
        CASE WHEN $3::int IS NOT NULL AND ul.id IS NOT NULL THEN TRUE ELSE FALSE END AS is_liked,
        l.title AS loop_title,
        l.filename AS loop_filename,
        l.bpm AS loop_bpm,
        l.key AS loop_key,
        lu.username AS loop_author_username,
        (
          COALESCE(lk.cnt, 0) * 3.2
          + COALESCE(cm.cnt, 0) * 5.5
          + COALESCE(p.view_count, 0) * 0.12
          + COALESCE(p.share_count, 0) * 4.0
          + EXP(-EXTRACT(EPOCH FROM (NOW() - p.created_at)) / 3600.0 / 28.0) * 55.0
        ) AS score
      FROM loop_tok_posts p
      JOIN users u ON u.id = p.user_id
      LEFT JOIN loops l ON l.id = p.loop_id
      LEFT JOIN users lu ON lu.id = l.user_id
      LEFT JOIN (
        SELECT post_id, COUNT(*)::int AS cnt FROM loop_tok_likes GROUP BY post_id
      ) lk ON lk.post_id = p.id
      LEFT JOIN (
        SELECT post_id, COUNT(*)::int AS cnt FROM loop_tok_comments GROUP BY post_id
      ) cm ON cm.post_id = p.id
      LEFT JOIN loop_tok_likes ul
        ON ul.post_id = p.id AND ul.user_id = $3
      LEFT JOIN artist_subscriptions sub
        ON sub.user_id = $4
        AND (
          (u.hashtag IS NOT NULL AND sub.artist_hashtag = u.hashtag)
          OR sub.artist_hashtag = u.username
        )
      ${orderSql}
      LIMIT $1 OFFSET $2
      `,
      [limit, offset, userId, userId],
    );

    return res.json({
      posts: result.rows.map(mapPostRow),
      mode,
      pagination: {
        page,
        limit,
        total,
        hasMore: offset + result.rows.length < total,
      },
    });
  } catch (error) {
    console.error('LoopTok feed failed:', error);
    return res.status(500).json({ message: 'Failed to load LoopTok feed' });
  }
};

export const toggleLoopTokLike = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId || req.user?.id;
    const postId = parseInt(String(req.params.id), 10);

    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    if (!Number.isFinite(postId)) return res.status(400).json({ message: 'Invalid post id' });

    const existing = await pool.query(
      'SELECT id FROM loop_tok_likes WHERE user_id = $1 AND post_id = $2',
      [userId, postId],
    );

    if (existing.rows.length > 0) {
      await pool.query('DELETE FROM loop_tok_likes WHERE user_id = $1 AND post_id = $2', [
        userId,
        postId,
      ]);
    } else {
      await pool.query(
        'INSERT INTO loop_tok_likes (user_id, post_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [userId, postId],
      );
    }

    const countResult = await pool.query(
      'SELECT COUNT(*)::int AS cnt FROM loop_tok_likes WHERE post_id = $1',
      [postId],
    );

    return res.json({
      liked: existing.rows.length === 0,
      like_count: countResult.rows[0]?.cnt || 0,
    });
  } catch (error) {
    console.error('LoopTok like failed:', error);
    return res.status(500).json({ message: 'Failed to toggle like' });
  }
};

export const trackLoopTokView = async (req: AuthRequest, res: Response) => {
  try {
    const postId = parseInt(String(req.params.id), 10);
    if (!Number.isFinite(postId)) return res.status(400).json({ message: 'Invalid post id' });

    await pool.query(
      'UPDATE loop_tok_posts SET view_count = COALESCE(view_count, 0) + 1, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
      [postId],
    );
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to track view' });
  }
};

export const trackLoopTokShare = async (req: AuthRequest, res: Response) => {
  try {
    const postId = parseInt(String(req.params.id), 10);
    if (!Number.isFinite(postId)) return res.status(400).json({ message: 'Invalid post id' });

    const result = await pool.query(
      `UPDATE loop_tok_posts
       SET share_count = COALESCE(share_count, 0) + 1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING share_count`,
      [postId],
    );
    return res.json({ share_count: result.rows[0]?.share_count || 0 });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to track share' });
  }
};

export const getLoopTokComments = async (req: AuthRequest, res: Response) => {
  try {
    const postId = parseInt(String(req.params.id), 10);
    if (!Number.isFinite(postId)) return res.status(400).json({ message: 'Invalid post id' });

    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit || '30'), 10) || 30));
    const offset = (page - 1) * limit;

    const result = await pool.query(
      `
      SELECT c.id, c.body, c.created_at, c.user_id,
             u.username, u.avatar_url
      FROM loop_tok_comments c
      JOIN users u ON u.id = c.user_id
      WHERE c.post_id = $1
      ORDER BY c.created_at DESC
      LIMIT $2 OFFSET $3
      `,
      [postId, limit, offset],
    );

    const countResult = await pool.query(
      'SELECT COUNT(*)::int AS total FROM loop_tok_comments WHERE post_id = $1',
      [postId],
    );

    return res.json({
      comments: result.rows.map((row) => ({
        id: row.id,
        body: row.body,
        created_at: row.created_at,
        author: {
          id: row.user_id,
          username: row.username,
          avatar_url: row.avatar_url,
        },
      })),
      total: countResult.rows[0]?.total || 0,
    });
  } catch (error) {
    console.error('LoopTok comments failed:', error);
    return res.status(500).json({ message: 'Failed to load comments' });
  }
};

export const addLoopTokComment = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId || req.user?.id;
    const postId = parseInt(String(req.params.id), 10);
    const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';

    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    if (!Number.isFinite(postId)) return res.status(400).json({ message: 'Invalid post id' });
    if (!body || body.length < 1) return res.status(400).json({ message: 'Comment is empty' });
    if (body.length > 500) return res.status(400).json({ message: 'Comment too long (max 500)' });

    const postCheck = await pool.query('SELECT id FROM loop_tok_posts WHERE id = $1', [postId]);
    if (postCheck.rows.length === 0) return res.status(404).json({ message: 'Post not found' });

    const result = await pool.query(
      `
      INSERT INTO loop_tok_comments (post_id, user_id, body)
      VALUES ($1, $2, $3)
      RETURNING id, body, created_at, user_id
      `,
      [postId, userId, body.slice(0, 500)],
    );

    const userResult = await pool.query(
      'SELECT id, username, avatar_url FROM users WHERE id = $1',
      [userId],
    );

    const countResult = await pool.query(
      'SELECT COUNT(*)::int AS cnt FROM loop_tok_comments WHERE post_id = $1',
      [postId],
    );

    return res.status(201).json({
      comment: {
        id: result.rows[0].id,
        body: result.rows[0].body,
        created_at: result.rows[0].created_at,
        author: userResult.rows[0],
      },
      comment_count: countResult.rows[0]?.cnt || 0,
    });
  } catch (error) {
    console.error('LoopTok add comment failed:', error);
    return res.status(500).json({ message: 'Failed to add comment' });
  }
};

export const deleteLoopTokPost = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId || req.user?.id;
    const postId = parseInt(String(req.params.id), 10);

    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    if (!Number.isFinite(postId)) return res.status(400).json({ message: 'Invalid post id' });

    const result = await pool.query(
      'DELETE FROM loop_tok_posts WHERE id = $1 AND user_id = $2 RETURNING filename',
      [postId, userId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Post not found' });
    }

    const filename = result.rows[0].filename as string;
    safeUnlinkSync(join(process.cwd(), 'uploads', 'looptok', filename));

    return res.json({ message: 'Deleted' });
  } catch (error) {
    console.error('LoopTok delete failed:', error);
    return res.status(500).json({ message: 'Failed to delete post' });
  }
};
