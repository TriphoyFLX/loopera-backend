import express from 'express';
import { authenticate, optionalAuthenticate } from '../middleware/auth.js';
import {
  getUserSubscriptions,
  addSubscription,
  removeSubscription,
  getSubscribedLoops
} from '../controllers/subscriptionController.js';

const router = express.Router();

// Лента от подписанных лупмейкеров (опциональный токен)
router.get('/loops', optionalAuthenticate, getSubscribedLoops);

// Все остальные маршруты требуют аутентификации
router.use(authenticate);

// Получение подписок пользователя
router.get('/', getUserSubscriptions);

// Добавление подписки на артиста
router.post('/add', addSubscription);

// Удаление подписки
router.delete('/:subscriptionId', removeSubscription);

export default router;
