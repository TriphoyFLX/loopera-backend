import { Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { AuthRequest } from '../middleware/auth';
import pool from '../config/database';

// Настройка multer для загрузки файлов
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(process.cwd(), 'uploads', 'packs');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, `pack-${file.fieldname}-${uniqueSuffix}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB максимальный размер файла
  },
  fileFilter: (req, file, cb) => {
    const allowedAudioTypes = ['.mp3', '.wav', '.ogg', '.m4a', '.flac'];
    const allowedTextTypes = ['.txt', '.rtf'];
    
    const ext = path.extname(file.originalname).toLowerCase();
    
    if (file.fieldname === 'text_file') {
      if (allowedTextTypes.includes(ext)) {
        cb(null, true);
      } else {
        cb(new Error('Text file must be .txt or .rtf format'));
      }
    } else if (file.fieldname === 'voice_tag_file') {
      if (allowedAudioTypes.includes(ext)) {
        cb(null, true);
      } else {
        cb(new Error('Voice tag must be an audio file (.mp3, .wav, .ogg, .m4a, .flac)'));
      }
    } else if (file.fieldname === 'loops') {
      if (allowedAudioTypes.includes(ext)) {
        cb(null, true);
      } else {
        cb(new Error('Loop files must be audio files (.mp3, .wav, .ogg, .m4a, .flac)'));
      }
    } else {
      cb(new Error('Invalid file field'));
    }
  }
});

// Загрузка лупов для пака
export const uploadPackLoops = async (req: AuthRequest, res: Response) => {
  const uploadMiddleware = upload.array('loops', 15); // Максимум 15 лупов
  
  uploadMiddleware(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ error: err.message });
    }

    try {
      const userId = req.user!.userId;
      const files = req.files as Express.Multer.File[];
      
      if (!files || files.length === 0) {
        return res.status(400).json({ error: 'No files uploaded' });
      }

      const uploadedLoops = [];

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        
        // Используем базовые метаданные из имени файла
        const title = file.originalname.replace(/\.[^/.]+$/, '');
        const bpm = 120;
        const key = 'C';
        const genre = 'Unknown';


        // Создаем запись о лупе в базе данных
        const loopQuery = `
          INSERT INTO loops (title, filename, original_name, file_size, bpm, key, genre, user_id)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING *
        `;
        
        const loopResult = await pool.query(loopQuery, [
          title,
          file.filename,
          file.originalname,
          file.size,
          bpm,
          key,
          genre,
          userId
        ]);

        uploadedLoops.push(loopResult.rows[0]);
      }

      res.json({
        message: 'Loops uploaded successfully',
        loops: uploadedLoops
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to upload loops' });
    }
  });
};

// Загрузка voice tag файла
export const uploadVoiceTag = async (req: AuthRequest, res: Response) => {
  const uploadMiddleware = upload.single('voice_tag_file');
  
  uploadMiddleware(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ error: err.message });
    }

    try {
      const file = req.file as Express.Multer.File;
      
      if (!file) {
        return res.status(400).json({ error: 'No voice tag file uploaded' });
      }

      res.json({
        message: 'Voice tag uploaded successfully',
        filename: file.filename,
        originalName: file.originalname,
        size: file.size
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to upload voice tag' });
    }
  });
};

// Загрузка текстового файла
export const uploadTextFile = async (req: AuthRequest, res: Response) => {
  const uploadMiddleware = upload.single('text_file');
  
  uploadMiddleware(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ error: err.message });
    }

    try {
      const file = req.file as Express.Multer.File;
      
      if (!file) {
        return res.status(400).json({ error: 'No text file uploaded' });
      }

      // Читаем содержимое текстового файла
      const textContent = fs.readFileSync(file.path, 'utf8');

      res.json({
        message: 'Text file uploaded successfully',
        filename: file.filename,
        originalName: file.originalname,
        size: file.size,
        content: textContent
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to upload text file' });
    }
  });
};

// Создание пака с загруженными файлами
export const createPackWithFiles = async (req: AuthRequest, res: Response) => {
  const client = await pool.connect();
  
  try {
    const { 
      title, 
      description, 
      price, 
      voice_tag,
      voice_tag_file,
      text_file,
      loopIds,
      loopFiles 
    } = req.body;
    
    const userId = req.user!.userId;

    // Проверяем лимит на создание паков (3 в день)
    // Проверяем лимит на создание паков (отключено для тестирования)
    /*
    const todayPacksQuery = `
      SELECT COUNT(*) as count
      FROM sound_packs
      WHERE user_id = $1 AND DATE(created_at) = CURRENT_DATE
    `;
    const todayPacksResult = await client.query(todayPacksQuery, [userId]);
    const todayPacksCount = parseInt(todayPacksResult.rows[0].count);

    if (todayPacksCount >= 3) {
      return res.status(429).json({ error: 'Daily pack creation limit exceeded' });
    }
    */

    // Проверяем возраст аккаунта (минимум 3 дня)
    const userQuery = `
      SELECT created_at
      FROM users
      WHERE id = $1
    `;
    const userResult = await client.query(userQuery, [userId]);
    const userCreatedAt = new Date(userResult.rows[0].created_at);
    const daysSinceCreation = Math.floor((Date.now() - userCreatedAt.getTime()) / (1000 * 60 * 60 * 24));

    if (daysSinceCreation < 3) {
      return res.status(403).json({ error: 'Account must be at least 3 days old to create packs' });
    }

    // Собираем все лупы (существующие и новые)
    const allLoops: number[] = [];
    
    // Добавляем существующие лупы
    if (loopIds && Array.isArray(loopIds)) {
      allLoops.push(...loopIds.filter(id => typeof id === 'number'));
    }
    
    // Добавляем новые загруженные лупы
    if (loopFiles && Array.isArray(loopFiles)) {
      allLoops.push(...loopFiles.filter(id => typeof id === 'number'));
    }

    // Проверяем количество лупов (максимум 15)
    if (allLoops.length === 0 || allLoops.length > 15) {
      return res.status(400).json({ error: 'Pack must contain between 1 and 15 loops' });
    }

    // Проверяем что все лупы принадлежат пользователю
    const loopsCheckQuery = `
      SELECT COUNT(*) as count
      FROM loops
      WHERE id = ANY($1) AND user_id = $2
    `;
    const loopsCheckResult = await client.query(loopsCheckQuery, [allLoops, userId]);
    const validLoopsCount = parseInt(loopsCheckResult.rows[0].count);

    if (validLoopsCount !== allLoops.length) {
      return res.status(403).json({ error: 'All loops must belong to you' });
    }

    await client.query('BEGIN');

    // Создаем пак
    const packQuery = `
      INSERT INTO sound_packs (title, description, price, user_id, voice_tag, voice_tag_file, text_file, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
      RETURNING *
    `;
    const packResult = await client.query(packQuery, [
      title, 
      description, 
      price, 
      userId, 
      voice_tag, 
      voice_tag_file, 
      text_file
    ]);
    const pack = packResult.rows[0];

    // Добавляем лупы в пак
    for (const loopId of allLoops) {
      await client.query(`
        INSERT INTO pack_loops (pack_id, loop_id)
        VALUES ($1, $2)
      `, [pack.id, loopId]);
    }

    await client.query('COMMIT');

    res.status(201).json(pack);
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Failed to create pack' });
  } finally {
    client.release();
  }
};

// Получение временных загруженных файлов для сессии
export const getTempUploadedFiles = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    
    // Здесь можно реализовать получение временных файлов из сессии или временной таблицы
    // Пока просто вернем пустой массив
    res.json({
      loops: [],
      voice_tag: null,
      text_file: null
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get temp files' });
  }
};
