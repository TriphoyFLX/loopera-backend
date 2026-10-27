import express from 'express';
import type { Request, Response } from 'express';
import multer from 'multer';
import { join } from 'path';
import { existsSync, mkdirSync, unlinkSync, createReadStream } from 'fs';
import pool from '../config/database.js';
import type { AuthRequest } from '../middleware/auth.js';
import {
  assertWithinLimit,
  incrementUsage,
  PlanLimitError,
} from '../services/subscriptionService.js';
import { buildMusicalTips } from '../utils/musicalTips.js';
import { persistMulterFile } from '../services/objectStorage.js';
import { notifyFollowersNewLoop } from '../services/notifyService.js';

// Настройка multer для загрузки файлов
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir =
      file.fieldname === 'cover'
        ? join(process.cwd(), 'uploads', 'loops', 'covers')
        : join(process.cwd(), 'uploads', 'loops');
    if (!existsSync(uploadDir)) {
      mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = file.originalname.split('.').pop();
    cb(null, file.fieldname + '-' + uniqueSuffix + '.' + ext);
  }
});

const AUDIO_MIMES = [
  'audio/mpeg',
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
  'audio/x-pn-wav',
  'audio/ogg',
  'audio/mp4',
  'audio/webm',
  'audio/aac',
  'audio/flac',
];
const AUDIO_EXTS = ['mp3', 'wav', 'ogg', 'm4a', 'webm', 'aac', 'flac'];
const COVER_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const COVER_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'gif'];

const fileFilter = (req: express.Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const fileExtension = file.originalname.split('.').pop()?.toLowerCase();

  if (file.fieldname === 'cover') {
    const ok =
      COVER_MIMES.includes(file.mimetype) ||
      (fileExtension != null && COVER_EXTS.includes(fileExtension));
    if (ok) return cb(null, true);
    return cb(new Error('Обложка: только JPG, PNG, WEBP или GIF'));
  }

  const mimeAllowed = AUDIO_MIMES.includes(file.mimetype);
  const extensionAllowed = fileExtension != null && AUDIO_EXTS.includes(fileExtension);
  if (mimeAllowed || extensionAllowed) {
    return cb(null, true);
  }
  cb(new Error('Разрешены только аудио файлы: MP3, WAV, OGG, M4A, WebM, AAC, FLAC'));
};

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 25 * 1024 * 1024, // Elite max; plan gate enforces per-tier limit
  },
  fileFilter: fileFilter
});

// Безопасное удаление файла
const safeUnlinkSync = (filePath: string): void => {
  try {
    if (existsSync(filePath)) {
      unlinkSync(filePath);
    }
  } catch (error) {
    // Не пробрасываем ошибку дальше, чтобы не прерывать основной процесс
  }
};

// Валидация и парсинг тегов
const parseTags = (tags: any): string[] => {
  if (!tags) return [];
  
  if (Array.isArray(tags)) {
    return tags.filter(tag => typeof tag === 'string' && tag.trim()).map(tag => tag.trim());
  }
  
  if (typeof tags === 'string') {
    try {
      // Пробуем распарсить JSON
      const parsed = JSON.parse(tags);
      if (Array.isArray(parsed)) {
        return parsed.filter(tag => typeof tag === 'string' && tag.trim()).map(tag => tag.trim());
      }
    } catch {
      // Если не JSON, то парсим как строку с запятыми
      return tags.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0);
    }
  }
  
  return [];
};

// Валидация параметров
const validateLoopParams = (body: any) => {
  const { title, bpm, key, genre, mood, tags, instagram, telegram } = body;
  
  if (!title || typeof title !== 'string' || title.trim().length === 0) {
    throw new Error('Название лупа обязательно и должно быть непустой строкой');
  }
  
  if (bpm && (isNaN(parseInt(bpm)) || parseInt(bpm) < 0)) {
    throw new Error('BPM должно быть положительным числом');
  }
  
  return {
    title: title.trim(),
    bpm: bpm ? parseInt(bpm) : null,
    key: key || null,
    genre: genre || null,
    mood: mood || null,
    tags: parseTags(tags),
    instagram: instagram || null,
    telegram: telegram || null
  };
};

const MOOD_SYNONYMS: Record<string, string[]> = {
  angry: ['angry', 'aggressive', 'rage', 'hard', 'evil', 'mad', 'злой', 'агрессивный', 'жесткий'],
  dark: ['dark', 'gloomy', 'sinister', 'night', 'темный', 'мрачный'],
  sad: ['sad', 'melancholy', 'depressed', 'cry', 'грустный', 'меланхоличный'],
  happy: ['happy', 'uplift', 'bright', 'joy', 'веселый', 'радостный'],
  chill: ['chill', 'calm', 'soft', 'ambient', 'спокойный', 'чилл'],
  energetic: ['energetic', 'hype', 'bouncy', 'fast', 'энергичный', 'драйв'],
  romantic: ['romantic', 'love', 'sensual', 'романтичный', 'любовный'],
};

const ARTIST_KEYWORDS = [
  'osamason', 'nettspend', 'destroy lonely', 'lonely', 'ken carson', 'kencarson',
  'yeat', 'carti', 'playboi carti', 'lucki', 'thxsomch', '2slimey', 'che',
];

const parseSmartQuery = (queryRaw: string) => {
  const normalized = queryRaw.toLowerCase().replace(/[^\p{L}\p{N}#\s]+/gu, ' ').replace(/\s+/g, ' ').trim();
  const terms = normalized.split(' ').filter((token) => token.length >= 2).slice(0, 10);
  const moods = Object.entries(MOOD_SYNONYMS)
    .filter(([, aliases]) => aliases.some((alias) => normalized.includes(alias)))
    .map(([mood]) => mood);
  const artistHints = ARTIST_KEYWORDS.filter((name) => normalized.includes(name));
  const tokenPatterns = Array.from(new Set(terms.map((term) => `%${term}%`)));
  return {
    phrasePattern: `%${queryRaw.trim()}%`,
    tokenPatterns,
    moods,
    artistHints,
  };
};

export const trackTelegramClick = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId || req.user?.id;
    const loopId = parseInt(req.params.loopId as string);

    if (!userId) {
      return res.status(401).json({ 
        message: 'Не авторизован',
        error: 'User authentication required'
      });
    }

    if (!loopId) {
      return res.status(400).json({ 
        message: 'ID лупа обязателен',
        error: 'Loop ID required'
      });
    }

    // Insert click record
    await pool.query(
      'INSERT INTO telegram_clicks (user_id, loop_id) VALUES ($1, $2)',
      [userId, loopId]
    );

    res.json({ message: 'Клик записан' });
  } catch (error) {
    res.status(500).json({ 
      message: 'Ошибка при записи клика',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

export const trackLoopPlay = async (req: AuthRequest, res: Response) => {
  try {
    const loopId = parseInt(String(req.params.id), 10);
    if (!Number.isFinite(loopId)) {
      return res.status(400).json({ message: 'Invalid loop id' });
    }

    const exists = await pool.query('SELECT id FROM loops WHERE id = $1', [loopId]);
    if (exists.rows.length === 0) {
      return res.status(404).json({ message: 'Loop not found' });
    }

    const listenedRaw = Number(req.body?.listened_seconds ?? 0);
    const durationRaw = req.body?.duration_seconds != null ? Number(req.body.duration_seconds) : null;
    const listenedSeconds = Math.max(0, Math.min(Number.isFinite(listenedRaw) ? listenedRaw : 0, 3600));
    const durationSeconds =
      durationRaw != null && Number.isFinite(durationRaw) && durationRaw > 0
        ? Math.min(durationRaw, 3600)
        : null;
    const completed = Boolean(
      req.body?.completed ||
        (durationSeconds != null && listenedSeconds >= Math.max(1, durationSeconds * 0.85)),
    );
    const listenerId = req.user?.userId || req.user?.id || null;

    // Ignore tiny accidental taps under 1s
    if (listenedSeconds < 1) {
      return res.json({ ok: true, ignored: true });
    }

    await pool.query(
      `INSERT INTO loop_plays (loop_id, listener_id, listened_seconds, duration_seconds, completed)
       VALUES ($1, $2, $3, $4, $5)`,
      [loopId, listenerId, listenedSeconds, durationSeconds, completed],
    );

    return res.json({ ok: true });
  } catch (error) {
    console.error('trackLoopPlay error:', error);
    return res.status(500).json({ message: 'Failed to track play' });
  }
};

export const getUserStatsHistory = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId || req.user?.id;
    const period = (req.query.period as string) || 'week';

    if (!userId) {
      return res.status(401).json({
        message: 'Не авторизован',
        error: 'User authentication required',
      });
    }

    let groupBy: string;
    let interval: string;

    switch (period) {
      case 'day':
        groupBy = 'hour';
        interval = '1 day';
        break;
      case 'month':
        groupBy = 'day';
        interval = '30 days';
        break;
      case 'week':
      default:
        groupBy = 'day';
        interval = '7 days';
    }

    const likesResult = await pool.query(
      `SELECT date_trunc('${groupBy}', created_at) as date, COUNT(*)::int as count
       FROM loop_likes
       WHERE loop_id IN (SELECT id FROM loops WHERE user_id = $1)
         AND created_at >= NOW() - INTERVAL '${interval}'
       GROUP BY 1 ORDER BY 1`,
      [userId],
    );

    const loopsResult = await pool.query(
      `SELECT date_trunc('${groupBy}', created_at) as date, COUNT(*)::int as count
       FROM loops
       WHERE user_id = $1 AND created_at >= NOW() - INTERVAL '${interval}'
       GROUP BY 1 ORDER BY 1`,
      [userId],
    );

    const telegramResult = await pool.query(
      `SELECT date_trunc('${groupBy}', clicked_at) as date, COUNT(*)::int as count
       FROM telegram_clicks
       WHERE loop_id IN (SELECT id FROM loops WHERE user_id = $1)
         AND clicked_at >= NOW() - INTERVAL '${interval}'
       GROUP BY 1 ORDER BY 1`,
      [userId],
    );

    const playsResult = await pool.query(
      `SELECT date_trunc('${groupBy}', p.created_at) as date,
              COUNT(*)::int as count,
              COALESCE(SUM(p.listened_seconds), 0)::float as listen_seconds
       FROM loop_plays p
       JOIN loops l ON l.id = p.loop_id
       WHERE l.user_id = $1 AND p.created_at >= NOW() - INTERVAL '${interval}'
       GROUP BY 1 ORDER BY 1`,
      [userId],
    );

    const downloadsResult = await pool.query(
      `SELECT date_trunc('${groupBy}', d.created_at) as date, COUNT(*)::int as count
       FROM loop_downloads d
       JOIN loops l ON l.id = d.loop_id
       WHERE l.user_id = $1 AND d.created_at >= NOW() - INTERVAL '${interval}'
       GROUP BY 1 ORDER BY 1`,
      [userId],
    );

    res.json({
      likes_over_time: likesResult.rows,
      loops_over_time: loopsResult.rows,
      telegram_clicks_over_time: telegramResult.rows,
      plays_over_time: playsResult.rows,
      downloads_over_time: downloadsResult.rows,
    });
  } catch (error) {
    res.status(500).json({
      message: 'Ошибка при получении истории статистики',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

export const getUserStats = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId || req.user?.id;

    if (!userId) {
      return res.status(401).json({
        message: 'Не авторизован',
        error: 'User authentication required',
      });
    }

    const [
      loopsResult,
      likesResult,
      telegramClicksResult,
      fileSizeResult,
      playsAgg,
      downloadsResult,
      commentsResult,
      topByPlays,
      topByLikes,
      topByListen,
      recentPlays,
    ] = await Promise.all([
      pool.query('SELECT COUNT(*)::int as count FROM loops WHERE user_id = $1', [userId]),
      pool.query(
        `SELECT COUNT(*)::int as count FROM loop_likes
         WHERE loop_id IN (SELECT id FROM loops WHERE user_id = $1)`,
        [userId],
      ),
      pool.query(
        `SELECT COUNT(*)::int as count FROM telegram_clicks
         WHERE loop_id IN (SELECT id FROM loops WHERE user_id = $1)`,
        [userId],
      ),
      pool.query('SELECT COALESCE(SUM(file_size), 0)::bigint as total_size FROM loops WHERE user_id = $1', [userId]),
      pool.query(
        `SELECT
           COUNT(*)::int as total_plays,
           COUNT(*) FILTER (WHERE completed)::int as completed_plays,
           COALESCE(AVG(listened_seconds), 0)::float as avg_listen_seconds,
           COALESCE(SUM(listened_seconds), 0)::float as total_listen_seconds,
           COUNT(DISTINCT listener_id) FILTER (WHERE listener_id IS NOT NULL)::int as unique_listeners
         FROM loop_plays p
         JOIN loops l ON l.id = p.loop_id
         WHERE l.user_id = $1`,
        [userId],
      ),
      pool.query(
        `SELECT COUNT(*)::int as count FROM loop_downloads d
         JOIN loops l ON l.id = d.loop_id WHERE l.user_id = $1`,
        [userId],
      ),
      pool.query(
        `SELECT COUNT(*)::int as count FROM loop_comments c
         JOIN loops l ON l.id = c.loop_id WHERE l.user_id = $1`,
        [userId],
      ),
      pool.query(
        `SELECT l.id, l.title, l.cover_url, l.bpm, l.key,
                COUNT(p.id)::int as plays,
                COALESCE(AVG(p.listened_seconds), 0)::float as avg_listen_seconds,
                COALESCE(SUM(p.listened_seconds), 0)::float as total_listen_seconds
         FROM loops l
         LEFT JOIN loop_plays p ON p.loop_id = l.id
         WHERE l.user_id = $1
         GROUP BY l.id
         ORDER BY plays DESC, total_listen_seconds DESC
         LIMIT 8`,
        [userId],
      ),
      pool.query(
        `SELECT l.id, l.title, l.cover_url, l.bpm, l.key,
                COUNT(ll.id)::int as likes
         FROM loops l
         LEFT JOIN loop_likes ll ON ll.loop_id = l.id
         WHERE l.user_id = $1
         GROUP BY l.id
         ORDER BY likes DESC, l.created_at DESC
         LIMIT 8`,
        [userId],
      ),
      pool.query(
        `SELECT l.id, l.title, l.cover_url,
                COALESCE(AVG(p.listened_seconds), 0)::float as avg_listen_seconds,
                COUNT(p.id)::int as plays
         FROM loops l
         JOIN loop_plays p ON p.loop_id = l.id
         WHERE l.user_id = $1
         GROUP BY l.id
         HAVING COUNT(p.id) >= 1
         ORDER BY avg_listen_seconds DESC
         LIMIT 8`,
        [userId],
      ),
      pool.query(
        `SELECT date_trunc('day', p.created_at)::date as day,
                COUNT(*)::int as plays,
                COALESCE(SUM(p.listened_seconds), 0)::float as listen_seconds
         FROM loop_plays p
         JOIN loops l ON l.id = p.loop_id
         WHERE l.user_id = $1 AND p.created_at >= NOW() - INTERVAL '14 days'
         GROUP BY 1
         ORDER BY 1 DESC
         LIMIT 14`,
        [userId],
      ),
    ]);

    const totalLoops = loopsResult.rows[0].count;
    const totalLikes = likesResult.rows[0].count;
    const playStats = playsAgg.rows[0] || {};

    res.json({
      total_loops: totalLoops,
      total_likes: totalLikes,
      total_telegram_clicks: telegramClicksResult.rows[0].count,
      total_file_size: Number(fileSizeResult.rows[0].total_size || 0),
      avg_likes_per_loop: totalLoops > 0 ? totalLikes / totalLoops : 0,
      total_plays: playStats.total_plays || 0,
      completed_plays: playStats.completed_plays || 0,
      avg_listen_seconds: playStats.avg_listen_seconds || 0,
      total_listen_seconds: playStats.total_listen_seconds || 0,
      unique_listeners: playStats.unique_listeners || 0,
      total_downloads: downloadsResult.rows[0].count,
      total_comments: commentsResult.rows[0].count,
      top_loops_by_plays: topByPlays.rows,
      top_loops_by_likes: topByLikes.rows,
      top_loops_by_listen: topByListen.rows,
      recent_days: recentPlays.rows,
    });
  } catch (error) {
    res.status(500).json({
      message: 'Ошибка при получении статистики',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

export const uploadLoop = [
  upload.fields([
    { name: 'loop', maxCount: 1 },
    { name: 'cover', maxCount: 1 },
  ]),
  async (req: AuthRequest, res: Response) => {
    let uploadedFilePath: string | null = null;
    let uploadedCoverPath: string | null = null;

    try {
      // Проверка авторизации
      const userId = req.user?.userId || req.user?.id;
      
      if (!req.user || !userId) {
        return res.status(401).json({ 
          message: 'Не авторизован',
          error: 'User authentication required'
        });
      }

      const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
      const audioFile = files?.loop?.[0];
      const coverFile = files?.cover?.[0];

      // Проверка файла
      if (!audioFile) {
        if (coverFile) safeUnlinkSync(coverFile.path);
        return res.status(400).json({ 
          message: 'Файл не загружен',
          error: 'No audio file provided'
        });
      }

      uploadedFilePath = audioFile.path;
      if (coverFile) uploadedCoverPath = coverFile.path;

      try {
        await assertWithinLimit(userId, 'upload', audioFile.size);
      } catch (limitError) {
        safeUnlinkSync(uploadedFilePath);
        if (uploadedCoverPath) safeUnlinkSync(uploadedCoverPath);
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

      // Валидация параметров
      let validatedParams;
      try {
        validatedParams = validateLoopParams(req.body);
      } catch (validationError) {
        safeUnlinkSync(uploadedFilePath);
        if (uploadedCoverPath) safeUnlinkSync(uploadedCoverPath);
        return res.status(400).json({ 
          message: validationError instanceof Error ? validationError.message : 'Ошибка валидации параметров',
          error: 'Validation failed'
        });
      }

      const { title, bpm, key, genre, mood, tags, instagram, telegram } = validatedParams;
      // Dual-write audio + cover to S3 when configured; filename stays local key for player URLs
      await persistMulterFile(audioFile, 'loops');
      const coverUrl = coverFile
        ? await persistMulterFile(coverFile, 'loops/covers')
        : null;

      // Проверка подключения к базе данных
      if (!pool) {
        throw new Error('Database connection not available');
      }

      // Сохраняем в базу данных
      const sql = `
        INSERT INTO loops (
          title,
          filename,
          original_name,
          file_size,
          bpm,
          key,
          genre,
          mood,
          tags,
          user_id,
          instagram,
          telegram,
          cover_url
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        RETURNING id, title, filename, original_name, file_size, bpm, key, genre, mood, tags, user_id, created_at, instagram, telegram, cover_url
      `;
      
      const params = [
        title,
        audioFile.filename,
        audioFile.originalname,
        audioFile.size,
        bpm,
        key,
        genre,
        mood,
        JSON.stringify(tags), // Преобразуем массив в JSON строку для JSONB поле
        userId,
        instagram,
        telegram,
        coverUrl,
      ];

      
      let result;
      try {
        result = await pool.query(sql, params);
      } catch (dbError) {
        throw new Error(`Database error: ${dbError instanceof Error ? dbError.message : 'Unknown DB error'}`);
      }


      if (result.rows.length === 0) {
        throw new Error('Не удалось вставить луп в базу данных');
      }

      const loop = result.rows[0];

      await incrementUsage(userId, 'upload');

      const authorRow = await pool.query(`SELECT username FROM users WHERE id = $1`, [userId]);
      const authorName = authorRow.rows[0]?.username || 'loopera';
      void notifyFollowersNewLoop({
        authorId: Number(userId),
        authorName,
        loopId: loop.id,
        loopTitle: loop.title || 'Untitled',
      });

      res.status(201).json({
        message: 'Луп успешно загружен',
        loop: {
          id: loop.id,
          title: loop.title,
          filename: loop.filename,
          original_name: loop.original_name,
          file_size: loop.file_size,
          bpm: loop.bpm,
          key: loop.key,
          genre: loop.genre,
          mood: loop.mood,
          tags: loop.tags,
          user_id: loop.user_id,
          created_at: loop.created_at,
          cover_url: loop.cover_url,
        }
      });
    } catch (error) {
      
      // Безопасное удаление файла при ошибке
      if (uploadedFilePath) {
        safeUnlinkSync(uploadedFilePath);
      }
      if (uploadedCoverPath) {
        safeUnlinkSync(uploadedCoverPath);
      }
      
      // Определяем статус ошибки
      let statusCode = 500;
      let errorMessage = 'Ошибка сервера при загрузке лупа';
      
      if (error instanceof Error) {
        if (error.message.includes('Неподдерживаемый формат файла')) {
          statusCode = 400;
          errorMessage = error.message;
        } else if (error.message.includes('File too large')) {
          statusCode = 413;
          errorMessage = 'Файл слишком большой. Максимальный размер: 5MB';
        } else if (error.message.includes('Database error')) {
          statusCode = 500;
          errorMessage = 'Ошибка базы данных';
        }
      }
      
      res.status(statusCode).json({ 
        message: errorMessage,
        error: error instanceof Error ? error.message : 'Unknown error',
        ...(process.env.NODE_ENV === 'development' && { stack: error instanceof Error ? error.stack : undefined })
      });
    }
  }
];

export const getUserLoops = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId || req.user?.id;

    if (!req.user || !userId) {
      return res.status(401).json({ 
        message: 'Не авторизован',
        error: 'User authentication required'
      });
    }

    const result = await pool.query(
      `SELECT id, title, filename, original_name, file_size, duration, bpm, key, genre, mood, tags, created_at, updated_at, instagram, telegram, cover_url,
              user_id
       FROM loops 
       WHERE user_id = $1 
       ORDER BY created_at DESC`,
      [userId]
    );


    res.json({
      loops: result.rows,
      total: result.rows.length
    });
  } catch (error) {
    res.status(500).json({ 
      message: 'Ошибка сервера при получении лупов пользователя',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

/** Public: loops for a profile by user id or username */
export const getLoopsByUser = async (req: express.Request, res: Response) => {
  try {
    const raw = String(req.params.userId || '').trim();
    if (!raw) {
      return res.status(400).json({ message: 'userId required' });
    }

    const page = Math.max(parseInt(String(req.query.page || '1'), 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(String(req.query.limit || '50'), 10) || 50, 1), 100);
    const offset = (page - 1) * limit;

    let userId: number | null = null;
    if (/^\d+$/.test(raw)) {
      userId = parseInt(raw, 10);
    } else {
      const userResult = await pool.query(
        `SELECT id FROM users WHERE username = $1 LIMIT 1`,
        [raw],
      );
      if (userResult.rows.length === 0) {
        return res.status(404).json({ message: 'User not found', loops: [], total: 0 });
      }
      userId = userResult.rows[0].id;
    }

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM loops WHERE user_id = $1`,
      [userId],
    );
    const total = countResult.rows[0]?.total || 0;

    const result = await pool.query(
      `SELECT ${LOOP_SELECT_FIELDS}
       FROM loops l
       JOIN users u ON l.user_id = u.id
       WHERE l.user_id = $1
       ORDER BY l.created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset],
    );

    res.json({
      loops: result.rows,
      total,
      page,
      limit,
      hasMore: offset + result.rows.length < total,
    });
  } catch (error) {
    console.error('getLoopsByUser error:', error);
    res.status(500).json({
      message: 'Ошибка сервера при получении лупов пользователя',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

const LOOP_SELECT_FIELDS = `
  l.id, l.title, l.filename, l.original_name, l.file_size, l.duration, l.bpm, l.key, l.genre, l.mood, l.tags,
  l.created_at, l.updated_at, l.instagram, l.telegram, l.cover_url,
  u.username as author, u.id as author_id, l.user_id,
  u.profile_theme as author_profile_theme,
  COALESCE((
    SELECT ups.plan_slug FROM user_paid_subscriptions ups
    WHERE ups.user_id = u.id AND ups.status = 'active' AND ups.period_end > NOW()
    ORDER BY ups.period_end DESC LIMIT 1
  ), CASE WHEN u.id = 824 THEN 'business' ELSE 'free' END) as author_plan
`;


export const getLoopById = async (req: Request, res: Response) => {
  try {
    const loopId = parseInt(String(req.params.id), 10);
    if (!Number.isFinite(loopId)) {
      return res.status(400).json({ message: 'Invalid loop id' });
    }

    const result = await pool.query(
      `SELECT ${LOOP_SELECT_FIELDS},
              COALESCE((SELECT COUNT(*)::int FROM loop_likes ll WHERE ll.loop_id = l.id), 0) AS like_count,
              COALESCE((SELECT COUNT(*)::int FROM loop_comments lc WHERE lc.loop_id = l.id), 0) AS comment_count,
              COALESCE((SELECT COUNT(*)::int FROM loop_downloads ld WHERE ld.loop_id = l.id), 0) AS download_count
       FROM loops l
       JOIN users u ON l.user_id = u.id
       WHERE l.id = $1`,
      [loopId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Loop not found' });
    }

    const loop = result.rows[0];
    const tips = buildMusicalTips({
      key: loop.key,
      bpm: loop.bpm,
      genre: loop.genre,
      tags: Array.isArray(loop.tags) ? loop.tags : null,
    });

    return res.json({ loop, tips });
  } catch (error) {
    console.error('getLoopById error:', error);
    return res.status(500).json({ message: 'Failed to load loop' });
  }
};

export const getLoopComments = async (req: AuthRequest, res: Response) => {
  try {
    const loopId = parseInt(String(req.params.id), 10);
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit || '30'), 10) || 30));
    const offset = (page - 1) * limit;
    const viewerId = req.user?.userId || req.user?.id || null;

    if (!Number.isFinite(loopId)) {
      return res.status(400).json({ message: 'Invalid loop id' });
    }

    const exists = await pool.query('SELECT id FROM loops WHERE id = $1', [loopId]);
    if (exists.rows.length === 0) {
      return res.status(404).json({ message: 'Loop not found' });
    }

    const result = await pool.query(
      `SELECT c.id, c.body, c.created_at, c.user_id, u.username, u.avatar_url,
              (SELECT COUNT(*)::int FROM loop_comment_likes lcl WHERE lcl.comment_id = c.id) AS likes_count,
              CASE
                WHEN $4::int IS NULL THEN FALSE
                ELSE EXISTS (
                  SELECT 1 FROM loop_comment_likes lcl
                  WHERE lcl.comment_id = c.id AND lcl.user_id = $4::int
                )
              END AS liked_by_me
       FROM loop_comments c
       JOIN users u ON u.id = c.user_id
       WHERE c.loop_id = $1
       ORDER BY c.created_at DESC
       LIMIT $2 OFFSET $3`,
      [loopId, limit, offset, viewerId],
    );

    const countResult = await pool.query(
      'SELECT COUNT(*)::int AS total FROM loop_comments WHERE loop_id = $1',
      [loopId],
    );

    return res.json({
      comments: result.rows.map((row) => ({
        id: row.id,
        body: row.body,
        created_at: row.created_at,
        likes_count: row.likes_count || 0,
        liked_by_me: Boolean(row.liked_by_me),
        author: {
          id: row.user_id,
          username: row.username,
          avatar_url: row.avatar_url,
        },
      })),
      total: countResult.rows[0]?.total || 0,
      page,
      limit,
    });
  } catch (error) {
    console.error('getLoopComments error:', error);
    return res.status(500).json({ message: 'Failed to load comments' });
  }
};

export const toggleLoopCommentLike = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId || req.user?.id;
    const commentId = parseInt(String(req.params.commentId), 10);
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    if (!Number.isFinite(commentId)) return res.status(400).json({ message: 'Invalid comment id' });

    const exists = await pool.query(`SELECT id FROM loop_comments WHERE id = $1`, [commentId]);
    if (exists.rows.length === 0) return res.status(404).json({ message: 'Comment not found' });

    const liked = await pool.query(
      `SELECT id FROM loop_comment_likes WHERE comment_id = $1 AND user_id = $2`,
      [commentId, userId],
    );

    if (liked.rows.length > 0) {
      await pool.query(`DELETE FROM loop_comment_likes WHERE comment_id = $1 AND user_id = $2`, [
        commentId,
        userId,
      ]);
    } else {
      await pool.query(
        `INSERT INTO loop_comment_likes (comment_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [commentId, userId],
      );
    }

    const count = await pool.query(
      `SELECT COUNT(*)::int AS cnt FROM loop_comment_likes WHERE comment_id = $1`,
      [commentId],
    );

    return res.json({
      liked: liked.rows.length === 0,
      likes_count: count.rows[0]?.cnt || 0,
    });
  } catch (error) {
    console.error('toggleLoopCommentLike error:', error);
    return res.status(500).json({ message: 'Failed to like comment' });
  }
};

export const addLoopComment = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId || req.user?.id;
    const loopId = parseInt(String(req.params.id), 10);
    const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';

    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    if (!Number.isFinite(loopId)) return res.status(400).json({ message: 'Invalid loop id' });
    if (!body) return res.status(400).json({ message: 'Comment is empty' });
    if (body.length > 500) return res.status(400).json({ message: 'Comment too long (max 500)' });

    const exists = await pool.query('SELECT id FROM loops WHERE id = $1', [loopId]);
    if (exists.rows.length === 0) return res.status(404).json({ message: 'Loop not found' });

    const result = await pool.query(
      `INSERT INTO loop_comments (loop_id, user_id, body)
       VALUES ($1, $2, $3)
       RETURNING id, body, created_at, user_id`,
      [loopId, userId, body.slice(0, 500)],
    );

    const userResult = await pool.query(
      'SELECT id, username, avatar_url FROM users WHERE id = $1',
      [userId],
    );

    const countResult = await pool.query(
      'SELECT COUNT(*)::int AS cnt FROM loop_comments WHERE loop_id = $1',
      [loopId],
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
    console.error('addLoopComment error:', error);
    return res.status(500).json({ message: 'Failed to add comment' });
  }
};

export const downloadLoop = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId || req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized', code: 'AUTH_REQUIRED' });
    }

    const loopId = parseInt(String(req.params.id), 10);
    if (!Number.isFinite(loopId)) {
      return res.status(400).json({ message: 'Invalid loop id' });
    }

    try {
      await assertWithinLimit(userId, 'download');
    } catch (limitError) {
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

    const result = await pool.query(
      `SELECT id, title, filename, original_name FROM loops WHERE id = $1`,
      [loopId],
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Loop not found' });
    }

    const loop = result.rows[0];
    const filePath = join(process.cwd(), 'uploads', 'loops', loop.filename);
    if (!existsSync(filePath)) {
      return res.status(404).json({ message: 'File missing on server' });
    }

    await incrementUsage(userId, 'download');

    try {
      await pool.query(
        `INSERT INTO loop_downloads (loop_id, user_id) VALUES ($1, $2)`,
        [loopId, userId],
      );
    } catch (logError) {
      console.warn('loop_downloads log failed:', logError);
    }

    const ext = String(loop.filename).split('.').pop() || 'mp3';
    const safeTitle = String(loop.title || 'loop')
      .replace(/[^\w\u0400-\u04FF\-\s]/g, '')
      .trim()
      .slice(0, 80) || 'loop';
    res.setHeader('Content-Disposition', `attachment; filename="loopera_${safeTitle}.${ext}"`);
    res.setHeader('Content-Type', 'application/octet-stream');
    createReadStream(filePath).pipe(res);
  } catch (error) {
    console.error('downloadLoop error:', error);
    return res.status(500).json({ message: 'Download failed' });
  }
};

const TRENDING_SCORE_SQL = `
  (
    COALESCE((SELECT COUNT(*)::float FROM loop_likes ll WHERE ll.loop_id = l.id), 0) * 3
    + COALESCE((SELECT COUNT(*)::float FROM loop_likes ll WHERE ll.loop_id = l.id AND ll.created_at > NOW() - INTERVAL '7 days'), 0) * 5
    + COALESCE((SELECT COUNT(*)::float FROM telegram_clicks tc WHERE tc.loop_id = l.id), 0) * 2
    + CASE WHEN l.created_at > NOW() - INTERVAL '48 hours' THEN 2 ELSE 0 END
  ) / POWER(GREATEST(EXTRACT(EPOCH FROM (NOW() - l.created_at)) / 3600.0, 1) + 2, 1.35)
`;

export const getAllLoops = async (req: express.Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
    const offset = (page - 1) * limit;
    const sortBy = req.query.sortBy as string || 'created_at'; // created_at | likes | trending | discover
    const tag = req.query.tag as string || null; // Фильтр по тегу
    const genre = req.query.genre as string || null; // Фильтр по жанру
    const mood = req.query.mood as string || null; // Фильтр по настроению
    const minBpm = parseInt(req.query.minBpm as string) || null; // Минимальный BPM
    const maxBpm = parseInt(req.query.maxBpm as string) || null; // Максимальный BPM
    const key = req.query.key as string || null; // Фильтр по тональности
    const search = req.query.search as string || null; // Поиск по названию/автору

    if (page < 1 || limit < 1) {
      return res.status(400).json({
        message: 'Некорректные параметры пагинации',
        error: 'Page and limit must be positive numbers'
      });
    }


    // Проверим текущего пользователя базы данных
    try {
      const userResult = await pool.query('SELECT current_user');
    } catch (e) {
    }

    // Оптимизированный запрос с индексацией
    // Проверяем существует ли таблица loop_likes перед использованием
    const likesTableExists = await pool.query(
      "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'loop_likes')"
    );
    const hasLikesTable = likesTableExists.rows[0].exists;

    // Определяем сортировку
    let orderByClause = 'l.created_at DESC';
    if (sortBy === 'likes' && hasLikesTable) {
      orderByClause = 'like_count DESC, l.created_at DESC';
    } else if (sortBy === 'trending' && hasLikesTable) {
      orderByClause = 'trending_score DESC, l.created_at DESC';
    } else if (sortBy === 'discover' && hasLikesTable) {
      orderByClause = 'discover_score DESC, l.created_at DESC';
    }

    // Строим WHERE clause с всеми фильтрами
    const conditions: string[] = ['COALESCE(u.is_banned, false) = false'];
    const params: any[] = [];
    let paramIndex = 1;

    if (tag) {
      conditions.push(`l.tags::text LIKE $${paramIndex}`);
      params.push(`%${tag}%`);
      paramIndex++;
    }

    if (genre) {
      conditions.push(`l.genre = $${paramIndex}`);
      params.push(genre);
      paramIndex++;
    }

    if (mood) {
      conditions.push(`lower(COALESCE(l.mood, '')) = lower($${paramIndex})`);
      params.push(mood);
      paramIndex++;
    }

    if (minBpm) {
      conditions.push(`l.bpm >= $${paramIndex}`);
      params.push(minBpm);
      paramIndex++;
    }

    if (maxBpm) {
      conditions.push(`l.bpm <= $${paramIndex}`);
      params.push(maxBpm);
      paramIndex++;
    }

    if (key) {
      conditions.push(`l.key = $${paramIndex}`);
      params.push(key);
      paramIndex++;
    }

    let searchRankSql: string | null = null;
    if (search) {
      const smartQuery = parseSmartQuery(search);
      const phraseParamIndex = paramIndex;
      params.push(smartQuery.phrasePattern);
      paramIndex++;
      const tokensParamIndex = paramIndex;
      params.push(smartQuery.tokenPatterns.length > 0 ? smartQuery.tokenPatterns : ['%']);
      paramIndex++;
      const moodsParamIndex = paramIndex;
      params.push(smartQuery.moods.length > 0 ? smartQuery.moods : ['']);
      paramIndex++;
      const artistsParamIndex = paramIndex;
      params.push(smartQuery.artistHints.length > 0 ? smartQuery.artistHints.map((v) => `%${v}%`) : ['']);
      paramIndex++;

      conditions.push(`(
        l.title ILIKE $${phraseParamIndex}
        OR u.username ILIKE $${phraseParamIndex}
        OR COALESCE(l.genre, '') ILIKE $${phraseParamIndex}
        OR COALESCE(l.mood, '') ILIKE $${phraseParamIndex}
        OR l.tags::text ILIKE $${phraseParamIndex}
        OR EXISTS (
          SELECT 1
          FROM unnest($${tokensParamIndex}::text[]) token
          WHERE l.title ILIKE token
            OR u.username ILIKE token
            OR COALESCE(l.genre, '') ILIKE token
            OR COALESCE(l.mood, '') ILIKE token
            OR l.tags::text ILIKE token
        )
      )`);

      searchRankSql = `(
        CASE WHEN l.title ILIKE $${phraseParamIndex} THEN 8 ELSE 0 END
        + CASE WHEN COALESCE(l.genre, '') ILIKE $${phraseParamIndex} THEN 6 ELSE 0 END
        + CASE WHEN COALESCE(l.mood, '') ILIKE $${phraseParamIndex} THEN 7 ELSE 0 END
        + CASE WHEN l.tags::text ILIKE $${phraseParamIndex} THEN 5 ELSE 0 END
        + CASE WHEN u.username ILIKE $${phraseParamIndex} THEN 4 ELSE 0 END
        + CASE WHEN lower(COALESCE(l.mood, '')) = ANY($${moodsParamIndex}::text[]) THEN 8 ELSE 0 END
        + CASE WHEN EXISTS (
          SELECT 1 FROM unnest($${artistsParamIndex}::text[]) artist_kw
          WHERE l.title ILIKE artist_kw OR COALESCE(l.genre, '') ILIKE artist_kw OR l.tags::text ILIKE artist_kw
        ) THEN 7 ELSE 0 END
        + COALESCE((SELECT COUNT(*) FROM unnest($${tokensParamIndex}::text[]) token WHERE l.title ILIKE token), 0) * 2
        + COALESCE((SELECT COUNT(*) FROM unnest($${tokensParamIndex}::text[]) token WHERE COALESCE(l.genre, '') ILIKE token), 0) * 2
        + COALESCE((SELECT COUNT(*) FROM unnest($${tokensParamIndex}::text[]) token WHERE l.tags::text ILIKE token), 0)
      )`;

      orderByClause = `search_rank DESC, ${orderByClause}`;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    let query = '';
    let queryParams: any[] = [...params, limit, offset];

    if (!query && hasLikesTable && sortBy === 'likes') {
      query = `
        SELECT ${LOOP_SELECT_FIELDS},
                (SELECT COUNT(*) FROM loop_likes WHERE loop_id = l.id) as like_count
                ${searchRankSql ? `, ${searchRankSql} AS search_rank` : ''}
         FROM loops l 
         JOIN users u ON l.user_id = u.id 
         ${whereClause}
         ORDER BY ${orderByClause}
         LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    } else if (!query && hasLikesTable && sortBy === 'trending') {
      query = `
        SELECT ${LOOP_SELECT_FIELDS},
                (SELECT COUNT(*) FROM loop_likes WHERE loop_id = l.id) as like_count,
                ${TRENDING_SCORE_SQL} AS trending_score
                ${searchRankSql ? `, ${searchRankSql} AS search_rank` : ''}
         FROM loops l
         JOIN users u ON l.user_id = u.id
         ${whereClause}
         ORDER BY ${orderByClause}
         LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    } else if (!query && hasLikesTable && sortBy === 'discover') {
      query = `
        SELECT ${LOOP_SELECT_FIELDS},
                (SELECT COUNT(*) FROM loop_likes WHERE loop_id = l.id) as like_count,
                (${TRENDING_SCORE_SQL}) * (0.65 + random() * 0.7) AS discover_score
                ${searchRankSql ? `, ${searchRankSql} AS search_rank` : ''}
         FROM loops l
         JOIN users u ON l.user_id = u.id
         ${whereClause}
         ORDER BY ${orderByClause}
         LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    } else if (!query) {
      query = `
        SELECT ${LOOP_SELECT_FIELDS}
               ${searchRankSql ? `, ${searchRankSql} AS search_rank` : ''}
         FROM loops l 
         JOIN users u ON l.user_id = u.id 
         ${whereClause}
         ORDER BY ${orderByClause}
         LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    }

    const result = await pool.query(query, queryParams);

    // Оптимизированный подсчет totalCount с кэшированием
    let totalCount;
    const cacheKey = 'loops_total_count';
    
    if (page === 1) {
      // Только для первой страницы считаем общее количество
      const countResult = await pool.query('SELECT COUNT(*) FROM loops');
      totalCount = parseInt(countResult.rows[0].count);
    } else {
      totalCount = null;
    }


    res.json({
      loops: result.rows,
      pagination: {
        page,
        limit,
        total: totalCount,
        pages: totalCount ? Math.ceil(totalCount / limit) : null,
        hasMore: result.rows.length === limit
      }
    });
  } catch (error) {
    res.status(500).json({ 
      message: 'Ошибка сервера при получении всех лупов',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

export const getForYouLoops = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId || req.user?.id;
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
    const offset = (page - 1) * limit;

    if (!userId) {
      return res.json({
        loops: [],
        pagination: { page: 1, limit, total: 0, pages: 0, hasMore: false },
      });
    }

    const query = `
      SELECT ${LOOP_SELECT_FIELDS},
             (SELECT COUNT(*) FROM loop_likes WHERE loop_id = l.id) as like_count,
             ${TRENDING_SCORE_SQL} AS trending_score,
             CASE
               WHEN EXISTS (
                 SELECT 1 FROM artist_subscriptions sub
                 WHERE sub.user_id = $1
                 AND (
                   lower(u.username) = sub.artist_hashtag OR
                   lower(COALESCE(l.genre, '')) LIKE '%' || sub.artist_hashtag || '%' OR
                   lower(l.title) LIKE '%' || sub.artist_hashtag || '%' OR
                   l.tags::text ILIKE '%' || sub.artist_hashtag || '%'
                 )
               ) THEN 1 ELSE 0
             END AS taste_match
      FROM loops l
      JOIN users u ON l.user_id = u.id
      ORDER BY taste_match DESC, trending_score DESC, l.created_at DESC
      LIMIT $2 OFFSET $3
    `;

    const countQuery = 'SELECT COUNT(*) FROM loops';
    const [loopsResult, countResult] = await Promise.all([
      pool.query(query, [userId, limit, offset]),
      pool.query(countQuery),
    ]);

    const total = parseInt(countResult.rows[0].count, 10);

    res.json({
      loops: loopsResult.rows,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
        hasMore: loopsResult.rows.length === limit,
      },
    });
  } catch (error) {
    res.status(500).json({
      message: 'Ошибка сервера при получении персональной ленты',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

export const getPopularHashtags = async (req: express.Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20;


    // Получаем все теги из всех лупов и подсчитываем их частоту
    // tags - это jsonb массив, поэтому используем jsonb_array_elements
    const result = await pool.query(
      `SELECT 
        jsonb_array_elements_text(tags) as tag,
        COUNT(*) as count
       FROM loops 
       WHERE tags IS NOT NULL AND jsonb_array_length(tags) > 0
       GROUP BY jsonb_array_elements_text(tags)
       ORDER BY count DESC
       LIMIT $1`,
      [limit]
    );


    res.json({
      hashtags: result.rows.map(row => ({
        tag: row.tag,
        count: parseInt(row.count)
      }))
    });
  } catch (error) {
    res.status(500).json({ 
      message: 'Ошибка сервера при получении популярных хэштегов',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

export const getRandomLoops = async (req: express.Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 10, 20);


    // Получаем случайные лупы с использованием ORDER BY RANDOM()
    const result = await pool.query(
      `SELECT l.id, l.title, l.filename, l.original_name, l.file_size, l.duration, l.bpm, l.key, l.genre, l.tags, l.created_at, l.updated_at, l.instagram, l.telegram, l.cover_url,
              u.username as author, u.id as author_id, l.user_id
       FROM loops l 
       JOIN users u ON l.user_id = u.id 
       ORDER BY RANDOM()
       LIMIT $1`,
      [limit]
    );


    res.json({
      loops: result.rows
    });
  } catch (error) {
    res.status(500).json({ 
      message: 'Ошибка сервера при получении случайных лупов',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

export const deleteLoop = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user?.userId || req.user?.id;

    if (!req.user || !userId) {
      return res.status(401).json({ 
        message: 'Не авторизован',
        error: 'User authentication required'
      });
    }

    const idString = id.toString();
    const loopId = parseInt(idString);

    // Проверяем, принадлежит ли луп пользователю
    const loopCheck = await pool.query(
      'SELECT filename FROM loops WHERE id = $1 AND user_id = $2',
      [loopId, userId]
    );

    if (loopCheck.rows.length === 0) {
      return res.status(404).json({ 
        message: 'Луп не найден или нет прав на удаление',
        error: 'Loop not found or access denied'
      });
    }

    // Удаляем файл
    const filename = loopCheck.rows[0].filename;
    const filePath = join(process.cwd(), 'uploads', 'loops', filename);
    
    safeUnlinkSync(filePath);

    // Удаляем запись из базы
    await pool.query('DELETE FROM loops WHERE id = $1', [loopId]);


    res.json({ message: 'Луп успешно удален' });
  } catch (error) {
    res.status(500).json({ 
      message: 'Ошибка сервера при удалении лупа',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};