import express from 'express';
import { authenticate } from '../middleware/auth.js';
import {
  toggleLike,
  getLikeStatus,
  getLikedLoops
} from '../controllers/likeController.js';

const router = express.Router();

// Получить статус лайка для лупа (без авторизации)
router.get('/:loopId/like-status', getLikeStatus);

// Все остальные маршруты требуют аутентификации
router.use(authenticate);

// Лайкнуть/дизлайкнуть луп
router.post('/:loopId/like', toggleLike);

// Получить избранные лупы пользователя
router.get('/liked', getLikedLoops);

export default router;
