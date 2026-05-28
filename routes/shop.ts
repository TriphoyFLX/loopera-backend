import express from 'express';
import { authenticate } from '../middleware/auth';
import multer from 'multer';
import path from 'path';
import {
  createPackNew,
  getApprovedPacksNew,
  buyPackNew,
  getUserPacksNew,
  getUserCreatedPacksNew,
  downloadPackNew
} from '../controllers/shopControllerNew';

const router = express.Router();

// Настройка multer для загрузки файлов
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(process.cwd(), 'uploads', 'shop');
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ storage });

// Публичные роуты
router.get('/', getApprovedPacksNew);

// Защищенные роуты
router.use(authenticate);

// Маршруты с префиксом /my
router.get('/my/packs', getUserPacksNew);
router.get('/my/created-packs', getUserCreatedPacksNew);

// Маршруты для покупки и скачивания
router.post('/:id/buy', buyPackNew);
router.get('/:id/download', downloadPackNew);

// Создание пака
router.post('/', upload.fields([
  { name: 'archive', maxCount: 1 },
  { name: 'preview1', maxCount: 1 },
  { name: 'preview2', maxCount: 1 },
  { name: 'voiceTag', maxCount: 1 },
  { name: 'textFile', maxCount: 1 }
]), createPackNew);

export default router;
