import express from 'express';
import { authenticate } from '../middleware/auth.js';
import {
  getUserSubscriptions,
  addSubscription,
  removeSubscription,
  getSubscribedLoops
} from '../controllers/subscriptionController.js';

const router = express.Router();

// Получение лупов от подписанных артистов (без авторизации, вернет пустой массив если не авторизован)
router.get('/loops', getSubscribedLoops);

// Все остальные маршруты требуют аутентификации
router.use(authenticate);

// Получение подписок пользователя
router.get('/', getUserSubscriptions);

// Добавление подписки на артиста
router.post('/add', addSubscription);

// Удаление подписки
router.delete('/:subscriptionId', removeSubscription);

export default router;
