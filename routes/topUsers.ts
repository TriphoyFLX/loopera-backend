import express from 'express';
import {
  getTopUsers,
  getUserStats
} from '../controllers/topUsersController.ts';

const router = express.Router();

// Получить топ пользователей (публичный)
router.get('/top', getTopUsers);

// Получить статистику пользователя (публичный)
router.get('/:userId/stats', getUserStats);

export default router;
