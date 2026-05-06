import express from 'express';
import { authenticate } from '../middleware/auth';
import {
  uploadPackLoops,
  uploadVoiceTag,
  uploadTextFile,
  createPackWithFiles,
  getTempUploadedFiles
} from '../controllers/packUploadController';

const router = express.Router();

// Все роуты требуют авторизации
router.use(authenticate);

// Загрузка лупов для пака
router.post('/loops', uploadPackLoops);

// Загрузка voice tag
router.post('/voice-tag', uploadVoiceTag);

// Загрузка текстового файла
router.post('/text-file', uploadTextFile);

// Создание пака с загруженными файлами
router.post('/create', createPackWithFiles);

// Получение временных файлов
router.get('/temp', getTempUploadedFiles);

export default router;
