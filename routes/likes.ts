import express from 'express';
import { authenticate } from '../middleware/auth.js';
import {
  toggleLike,
  getLikeStatus,
  getLikedLoops
} from '../controllers/likeController.js';

const router = express.Router();

// Все маршруты требуют аутентификации
router.use(authenticate);

// Лайкнуть/дизлайкнуть луп
router.post('/likes/:loopId/like', toggleLike);

// Получить статус лайка для лупа
router.get('/likes/:loopId/like-status', getLikeStatus);

// Получить избранные лупы пользователя
router.get('/likes/liked', getLikedLoops);

export default router;
