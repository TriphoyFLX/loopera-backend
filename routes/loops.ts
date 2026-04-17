import { Router } from 'express';
import { uploadLoop, getUserLoops, getAllLoops, deleteLoop } from '../controllers/loopController.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

// Загрузка лупа (без авторизации, проверка в контроллере)
router.post('/upload', uploadLoop);

// Получение лупов текущего пользователя (без авторизации, проверка в контроллере)
router.get('/my', getUserLoops);

// Получение всех лупов (публичный)
router.get('/', getAllLoops);

// Удаление лупа (без авторизации, проверка в контроллере)
router.delete('/:id', deleteLoop);

export default router;