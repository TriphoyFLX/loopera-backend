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
  
  console.log('File MIME type:', file.mimetype);
  console.log('File originalname:', file.originalname);
  
  // Проверяем по MIME типу или расширению файла
  const fileExtension = file.originalname.split('.').pop()?.toLowerCase();
  const mimeAllowed = allowedMimes.includes(file.mimetype);
  const extensionAllowed = fileExtension && allowedExtensions.includes(fileExtension);
  
  if (mimeAllowed || extensionAllowed) {
    console.log('File allowed:', file.mimetype, 'extension:', fileExtension);
    cb(null, true);
  } else {
    console.log('File rejected:', file.mimetype, 'extension:', fileExtension);
    cb(new Error(`Неподдерживаемый формат файла: ${file.mimetype}. Разрешены: MP3, WAV, OGG, M4A, WEBM, AAC, FLAC`));
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
      console.log('Файл успешно удален:', filePath);
    }
  } catch (error) {
    console.error('Ошибка при удалении файла:', filePath, error);
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
  const { title, bpm, key, genre, tags } = body;
  
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
    tags: parseTags(tags)
  };
};

export const uploadLoop = [
  upload.single('loop'),
  async (req: AuthRequest, res: Response) => {
    let uploadedFilePath: string | null = null;
    
    try {
      console.log('=== НАЧАЛО ЗАГРУЗКИ ЛУПА ===');
      console.log('User ID:', req.user?.id);
      console.log('File:', req.file ? {
        originalname: req.file.originalname,
        filename: req.file.filename,
        size: req.file.size,
        mimetype: req.file.mimetype
      } : 'No file');
      console.log('Body keys:', Object.keys(req.body));
      console.log('Body values:', req.body);

      // Проверка авторизации
      const userId = req.user?.userId || req.user?.id;
      
      if (!req.user || !userId) {
        console.error('Ошибка: пользователь не авторизован или отсутствует ID');
        return res.status(401).json({ 
          message: 'Не авторизован',
          error: 'User authentication required'
        });
      }

      // Проверка файла
      if (!req.file) {
        console.error('Ошибка: файл не загружен');
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
        console.error('Ошибка валидации параметров:', validationError);
        safeUnlinkSync(uploadedFilePath);
        return res.status(400).json({ 
          message: validationError instanceof Error ? validationError.message : 'Ошибка валидации параметров',
          error: 'Validation failed'
        });
      }

      const { title, bpm, key, genre, tags } = validatedParams;
      
      console.log('Валидированные параметры:', { title, bpm, key, genre, tags });

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
          user_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING id, title, filename, original_name, file_size, bpm, key, genre, tags, user_id, created_at
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
        userId
      ];

      console.log('SQL Query:', sql);
      console.log('Params:', params);
      
      let result;
      try {
        result = await pool.query(sql, params);
      } catch (dbError) {
        console.error('Ошибка выполнения SQL запроса:', dbError);
        throw new Error(`Database error: ${dbError instanceof Error ? dbError.message : 'Unknown DB error'}`);
      }

      console.log('Результат запроса:', result.rows);

      if (result.rows.length === 0) {
        throw new Error('Не удалось вставить луп в базу данных');
      }

      const loop = result.rows[0];

      console.log('Луп успешно сохранен:', loop);
      console.log('=== КОНЕЦ ЗАГРУЗКИ ЛУПА ===');

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
      console.error('=== ОШИБКА ЗАГРУЗКИ ЛУПА ===');
      console.error('Тип ошибки:', error?.constructor?.name);
      console.error('Сообщение ошибки:', error instanceof Error ? error.message : error);
      console.error('Stack trace:', error instanceof Error ? error.stack : 'No stack trace');
      
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
    console.log('Получение лупов пользователя:', userId);

    if (!req.user || !userId) {
      return res.status(401).json({ 
        message: 'Не авторизован',
        error: 'User authentication required'
      });
    }

    const result = await pool.query(
      `SELECT id, title, filename, original_name, file_size, duration, bpm, key, genre, tags, created_at, updated_at,
              user_id
       FROM loops 
       WHERE user_id = $1 
       ORDER BY created_at DESC`,
      [userId]
    );

    console.log('Найдено лупов:', result.rows.length);

    res.json({
      loops: result.rows,
      total: result.rows.length
    });
  } catch (error) {
    console.error('Get user loops error:', error);
    res.status(500).json({ 
      message: 'Ошибка сервера при получении лупов пользователя',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

export const getAllLoops = async (req: express.Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 50); // Уменьшили лимит для производительности
    const offset = (page - 1) * limit;

    if (page < 1 || limit < 1) {
      return res.status(400).json({
        message: 'Некорректные параметры пагинации',
        error: 'Page and limit must be positive numbers'
      });
    }

    console.log(`Получение всех лупов: страница ${page}, лимит ${limit}`);

    // Проверим текущего пользователя базы данных
    try {
      const userResult = await pool.query('SELECT current_user');
      console.log('Текущий пользователь БД в getAllLoops:', userResult.rows[0].current_user);
    } catch (e) {
      console.log('Ошибка при получении текущего пользователя:', e);
    }

    // Оптимизированный запрос с индексацией
    const result = await pool.query(
      `SELECT l.id, l.title, l.filename, l.original_name, l.file_size, l.duration, l.bpm, l.key, l.genre, l.tags, l.created_at, l.updated_at,
              u.username as author, u.id as author_id, l.user_id
       FROM loops l 
       JOIN users u ON l.user_id = u.id 
       ORDER BY l.created_at DESC 
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    // Оптимизированный подсчет totalCount с кэшированием
    let totalCount;
    const cacheKey = 'loops_total_count';
    
    if (page === 1) {
      // Только для первой страницы считаем общее количество
      const countResult = await pool.query('SELECT COUNT(*) FROM loops');
      totalCount = parseInt(countResult.rows[0].count);
      // В будущем можно сохранить в Redis или другой кэш
    } else {
      // Для остальных страниц можно использовать приблизительный count или брать из кэша
      totalCount = null; // Позволяем фронтенду показать "Загрузить еще"
    }

    console.log('Найдено лупов:', result.rows.length, 'всего:', totalCount || 'не считано');

    res.json({
      loops: result.rows,
      pagination: {
        page,
        limit,
        total: totalCount,
        pages: totalCount ? Math.ceil(totalCount / limit) : null,
        hasMore: result.rows.length === limit // Для бесконечной прокрутки
      }
    });
  } catch (error) {
    console.error('Get all loops error:', error);
    res.status(500).json({ 
      message: 'Ошибка сервера при получении всех лупов',
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
    console.log(`Удаление лупа ${loopId} пользователем ${userId}`);

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

    console.log('Луп успешно удален');

    res.json({ message: 'Луп успешно удален' });
  } catch (error) {
    console.error('Delete loop error:', error);
    res.status(500).json({ 
      message: 'Ошибка сервера при удалении лупа',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};