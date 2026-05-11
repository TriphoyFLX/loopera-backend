import { Router } from 'express';
import { uploadLoop, getUserLoops, getAllLoops, deleteLoop, getPopularHashtags } from '../controllers/loopController.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

// Загрузка лупа (требует авторизации)
router.post('/upload', authenticate, uploadLoop);

// Получение лупов текущего пользователя (требует авторизации)
router.get('/my', authenticate, getUserLoops);

// Получение всех лупов (публичный)
router.get('/', getAllLoops);

// Получение популярных хэштегов (публичный)
router.get('/hashtags/popular', getPopularHashtags);

// Удаление лупа (требует авторизации)
router.delete('/:id', authenticate, deleteLoop);

export default router;