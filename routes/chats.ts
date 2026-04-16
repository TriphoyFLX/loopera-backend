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

// Все маршруты требуют аутентификации
router.use(authenticate);

// Получение всех чатов пользователя
router.get('/', getUserChats);

// Получение сообщений конкретного чата
router.get('/:chatId/messages', getChatMessages);

// Создание или получение существующего чата
router.post('/create', createOrGetChat);

// Отправка сообщения
router.post('/send', sendMessage);

// Получение информации о пользователе
router.get('/user/:userId', getUserInfo);

export default router;
