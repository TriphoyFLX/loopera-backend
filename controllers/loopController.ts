import express from 'express';
import type { Request, Response } from 'express';
import multer from 'multer';
import { join } from 'path';
import { existsSync, mkdirSync, unlinkSync } from 'fs';
import pool from '../config/database.js';
import type { AuthRequest } from '../middleware/auth.js';

// Настройка multer для загрузки файлов
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = join(process.cwd(), 'uploads', 'loops');
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

// Фильтр для аудио файлов
const fileFilter = (req: express.Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const allowedMimes = [
    'audio/mpeg',      // MP3
    'audio/wav',       // WAV
    'audio/x-wav',     // WAV альтернативный
    'audio/wave',      // WAV еще один вариант
    'audio/x-pn-wav',  // WAV для Windows
    'audio/ogg',       // OGG Vorbis
    'audio/mp4',       // M4A
    'audio/webm',      // WebM Audio
    'audio/aac',       // AAC
    'audio/flac'       // FLAC
  ];
  
  const allowedExtensions = ['mp3', 'wav', 'ogg', 'm4a', 'webm', 'aac', 'flac'];
  
  // Проверяем по MIME типу или расширению файла
  const fileExtension = file.originalname.split('.').pop()?.toLowerCase();
  const mimeAllowed = allowedMimes.includes(file.mimetype);
  const extensionAllowed = fileExtension && allowedExtensions.includes(fileExtension);
  
  if (mimeAllowed || extensionAllowed) {
    cb(null, true);
  } else {
    cb(new Error('Разрешены только аудио файлы: MP3, WAV, OGG, M4A, WebM, AAC, FLAC'));
  }
};

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 4 * 1024 * 1024, // 4MB (Vercel limit)
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
  const { title, bpm, key, genre, tags, instagram, telegram } = body;
  
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
    tags: parseTags(tags),
    instagram: instagram || null,
    telegram: telegram || null
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

export const getUserStatsHistory = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId || req.user?.id;
    const period = (req.query.period as string) || 'week'; // day, week, month

    if (!userId) {
      return res.status(401).json({ 
        message: 'Не авторизован',
        error: 'User authentication required'
      });
    }

    let groupBy: string;
    let interval: string;

    switch (period) {
      case 'day':
        groupBy = 'hour';
        interval = '1 hour';
        break;
      case 'week':
        groupBy = 'day';
        interval = '7 days';
        break;
      case 'month':
        groupBy = 'day';
        interval = '30 days';
        break;
      default:
        groupBy = 'day';
        interval = '7 days';
    }


    // Get likes over time
    const likesQuery = `
      SELECT 
        date_trunc('${groupBy}', created_at) as date,
        COUNT(*) as count
      FROM loop_likes
      WHERE loop_id IN (SELECT id FROM loops WHERE user_id = $1)
      AND created_at >= NOW() - INTERVAL '${interval}'
      GROUP BY date_trunc('${groupBy}', created_at)
      ORDER BY date
    `;

    const likesResult = await pool.query(likesQuery, [userId]);

    // Get loops uploaded over time
    const loopsQuery = `
      SELECT 
        date_trunc('${groupBy}', created_at) as date,
        COUNT(*) as count
      FROM loops
      WHERE user_id = $1
      AND created_at >= NOW() - INTERVAL '${interval}'
      GROUP BY date_trunc('${groupBy}', created_at)
      ORDER BY date
    `;

    const loopsResult = await pool.query(loopsQuery, [userId]);

    // Get telegram clicks over time
    const telegramQuery = `
      SELECT 
        date_trunc('${groupBy}', clicked_at) as date,
        COUNT(*) as count
      FROM telegram_clicks
      WHERE loop_id IN (SELECT id FROM loops WHERE user_id = $1)
      AND clicked_at >= NOW() - INTERVAL '${interval}'
      GROUP BY date_trunc('${groupBy}', clicked_at)
      ORDER BY date
    `;

    const telegramResult = await pool.query(telegramQuery, [userId]);

    res.json({
      likes_over_time: likesResult.rows,
      loops_over_time: loopsResult.rows,
      telegram_clicks_over_time: telegramResult.rows
    });
  } catch (error) {
    res.status(500).json({ 
      message: 'Ошибка при получении истории статистики',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

export const getUserStats = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId || req.user?.id;

    if (!userId) {
      return res.status(401).json({ 
        message: 'Не авторизован',
        error: 'User authentication required'
      });
    }

    // Get total loops count
    const loopsResult = await pool.query(
      'SELECT COUNT(*) as count FROM loops WHERE user_id = $1',
      [userId]
    );
    const totalLoops = parseInt(loopsResult.rows[0].count);

    // Get total likes on user's loops
    const likesResult = await pool.query(
      'SELECT COUNT(*) as count FROM loop_likes WHERE loop_id IN (SELECT id FROM loops WHERE user_id = $1)',
      [userId]
    );
    const totalLikes = parseInt(likesResult.rows[0].count);

    // Get total Telegram clicks on user's loops
    const telegramClicksResult = await pool.query(
      'SELECT COUNT(*) as count FROM telegram_clicks WHERE loop_id IN (SELECT id FROM loops WHERE user_id = $1)',
      [userId]
    );
    const totalTelegramClicks = parseInt(telegramClicksResult.rows[0].count);

    // Get total file size
    const fileSizeResult = await pool.query(
      'SELECT SUM(file_size) as total_size FROM loops WHERE user_id = $1',
      [userId]
    );
    const totalFileSize = fileSizeResult.rows[0].total_size || 0;

    // Get average likes per loop
    const avgLikes = totalLoops > 0 ? (totalLikes / totalLoops) : 0;

    res.json({
      total_loops: totalLoops,
      total_likes: totalLikes,
      total_telegram_clicks: totalTelegramClicks,
      total_file_size: totalFileSize,
      avg_likes_per_loop: avgLikes
    });
  } catch (error) {
    res.status(500).json({ 
      message: 'Ошибка при получении статистики',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

export const uploadLoop = [
  upload.single('loop'),
  async (req: AuthRequest, res: Response) => {
    let uploadedFilePath: string | null = null;
    
    try {
        originalname: req.file.originalname,
        filename: req.file.filename,
        size: req.file.size,
        mimetype: req.file.mimetype
      } : 'No file');

      // Проверка авторизации
      const userId = req.user?.userId || req.user?.id;
      
      if (!req.user || !userId) {
        return res.status(401).json({ 
          message: 'Не авторизован',
          error: 'User authentication required'
        });
      }

      // Проверка файла
      if (!req.file) {
        return res.status(400).json({ 
          message: 'Файл не загружен',
          error: 'No audio file provided'
        });
      }

      uploadedFilePath = req.file.path;

      // Валидация параметров
      let validatedParams;
      try {
        validatedParams = validateLoopParams(req.body);
      } catch (validationError) {
        safeUnlinkSync(uploadedFilePath);
        return res.status(400).json({ 
          message: validationError instanceof Error ? validationError.message : 'Ошибка валидации параметров',
          error: 'Validation failed'
        });
      }

      const { title, bpm, key, genre, tags, instagram, telegram } = validatedParams;
      

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
          tags,
          user_id,
          instagram,
          telegram
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING id, title, filename, original_name, file_size, bpm, key, genre, tags, user_id, created_at, instagram, telegram
      `;
      
      const params = [
        title,
        req.file.filename,
        req.file.originalname,
        req.file.size,
        bpm,
        key,
        genre,
        JSON.stringify(tags), // Преобразуем массив в JSON строку для JSONB поля
        userId,
        instagram,
        telegram
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
          tags: loop.tags,
          user_id: loop.user_id,
          created_at: loop.created_at
        }
      });
    } catch (error) {
      
      // Безопасное удаление файла при ошибке
      if (uploadedFilePath) {
        safeUnlinkSync(uploadedFilePath);
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
      `SELECT id, title, filename, original_name, file_size, duration, bpm, key, genre, tags, created_at, updated_at, instagram, telegram,
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

export const getAllLoops = async (req: express.Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
    const offset = (page - 1) * limit;
    const sortBy = req.query.sortBy as string || 'created_at'; // 'created_at' или 'likes'
    const tag = req.query.tag as string || null; // Фильтр по тегу
    const genre = req.query.genre as string || null; // Фильтр по жанру
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
    }

    // Строим WHERE clause с всеми фильтрами
    const conditions: string[] = [];
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

    if (search) {
      conditions.push(`(l.title ILIKE $${paramIndex} OR u.username ILIKE $${paramIndex})`);
      params.push(`%${search}%`);
      paramIndex++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    let query = '';
    let queryParams: any[] = [...params, limit, offset];

    if (hasLikesTable && sortBy === 'likes') {
      query = `
        SELECT l.id, l.title, l.filename, l.original_name, l.file_size, l.duration, l.bpm, l.key, l.genre, l.tags, l.created_at, l.updated_at, l.instagram, l.telegram,
                u.username as author, u.id as author_id, l.user_id,
                (SELECT COUNT(*) FROM loop_likes WHERE loop_id = l.id) as like_count
         FROM loops l 
         JOIN users u ON l.user_id = u.id 
         ${whereClause}
         ORDER BY like_count DESC, l.created_at DESC
         LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    } else {
      query = `
        SELECT l.id, l.title, l.filename, l.original_name, l.file_size, l.duration, l.bpm, l.key, l.genre, l.tags, l.created_at, l.updated_at, l.instagram, l.telegram,
                u.username as author, u.id as author_id, l.user_id
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
      `SELECT l.id, l.title, l.filename, l.original_name, l.file_size, l.duration, l.bpm, l.key, l.genre, l.tags, l.created_at, l.updated_at, l.instagram, l.telegram,
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