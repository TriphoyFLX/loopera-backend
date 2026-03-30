import { Router } from 'express';
import { uploadLoop, getUserLoops, getAllLoops, deleteLoop } from '../controllers/loopController.ts';
import { simpleAuth } from '../middleware/simpleAuth.ts';

const router = Router();

// Загрузка лупа (требует авторизации)
router.post('/upload', simpleAuth, uploadLoop);

// Получение лупов текущего пользователя
router.get('/my', simpleAuth, getUserLoops);

// Получение всех лупов (публичный)
router.get('/', getAllLoops);

// Удаление лупа (требует авторизации)
router.delete('/:id', simpleAuth, deleteLoop);

export default router;