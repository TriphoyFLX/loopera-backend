import { Router } from 'express';
import { uploadLoop, getUserLoops, getAllLoops, deleteLoop } from '../controllers/loopController.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

// Загрузка лупа (без авторизации временно)
router.post('/upload', uploadLoop);

// Получение лупов текущего пользователя (без авторизации временно)
router.get('/my', getUserLoops);

// Получение всех лупов (публичный)
router.get('/', getAllLoops);

// Удаление лупа (без авторизации временно)
router.delete('/:id', deleteLoop);

export default router;