import express from 'express';
import {
  getTopUsers,
  getUserStats,
  uploadAvatar,
  avatarUploadMiddleware,
} from '../controllers/topUsersController.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

// Получить топ пользователей (публичный)
router.get('/top', getTopUsers);

router.post('/avatar', authenticate, (req, res, next) => {
  avatarUploadMiddleware(req, res, (err) => {
    if (err) {
      return res.status(400).json({ message: err.message || 'Ошибка загрузки' });
    }
    return next();
  });
}, uploadAvatar);

// Получить статистику пользователя (публичный)
router.get('/:userId/stats', getUserStats);

export default router;
