import express from 'express';
import { authenticate } from '../middleware/auth.js';
import {
  getUserSubscriptions,
  addSubscription,
  removeSubscription,
  getSubscribedLoops
} from '../controllers/subscriptionController.js';

const router = express.Router();

// Все маршруты требуют аутентификации
router.use(authenticate);

// Получение подписок пользователя
router.get('/', getUserSubscriptions);

// Добавление подписки на артиста
router.post('/add', addSubscription);

// Удаление подписки
router.delete('/:subscriptionId', removeSubscription);

// Получение лупов от подписанных артистов
router.get('/loops', getSubscribedLoops);

export default router;
