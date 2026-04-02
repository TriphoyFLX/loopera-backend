import express from 'express';
import { authenticate } from '../middleware/auth.ts';
import {
  toggleLike,
  getLikeStatus,
  getLikedLoops
} from '../controllers/likeController.ts';

const router = express.Router();

// Все маршруты требуют аутентификации
router.use(authenticate);

// Лайкнуть/дизлайкнуть луп
router.post('/loops/:loopId/like', toggleLike);

// Получить статус лайка для лупа
router.get('/loops/:loopId/like-status', getLikeStatus);

// Получить избранные лупы пользователя
router.get('/loops/liked', getLikedLoops);

export default router;
