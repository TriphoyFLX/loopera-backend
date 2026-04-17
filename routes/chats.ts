import express from 'express';
import { authenticate } from '../middleware/auth.js';
import {
  getUserChats,
  getChatMessages,
  createOrGetChat,
  sendMessage,
  getUserInfo
} from '../controllers/chatController.js';

const router = express.Router();

// Получение информации о пользователе (без авторизации)
router.get('/user/:userId', getUserInfo);

// Получение всех чатов пользователя (без авторизации, вернет пустой массив)
router.get('/', getUserChats);

// Все остальные маршруты требуют аутентификации
router.use(authenticate);

// Получение сообщений конкретного чата
router.get('/:chatId/messages', getChatMessages);

// Создание или получение существующего чата
router.post('/create', createOrGetChat);

// Отправка сообщения
router.post('/send', sendMessage);

export default router;
