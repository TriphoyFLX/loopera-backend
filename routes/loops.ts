import { Router } from 'express';
import { uploadLoop, getUserLoops, getAllLoops, deleteLoop } from '../controllers/loopController.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

// Загрузка лупа (требует авторизации)
router.post('/upload', authenticate, uploadLoop);

// Получение лупов текущего пользователя
router.get('/my', authenticate, getUserLoops);

// Получение всех лупов (публичный)
router.get('/', getAllLoops);

// Удаление лупа (требует авторизации)
router.delete('/:id', authenticate, deleteLoop);

export default router;