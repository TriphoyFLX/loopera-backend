import express from 'express';
import { type AuthRequest } from '../middleware/auth.js';
import pool from '../config/database.js';
import type { IUser } from '../models/User.js';

type Request = express.Request;
type Response = express.Response;

interface Message {
  id: number;
  chat_id: number;
  sender_id: number;
  content: string;
  created_at: string;
  updated_at: string;
  read_at?: string;
}

interface ChatWithDetails {
  id: number;
  participant1_id: number;
  participant2_id: number;
  created_at: string;
  updated_at: string;
  participant1: {
    id: number;
    username: string;
  };
  participant2: {
    id: number;
    username: string;
  };
  last_message?: {
    content: string;
    created_at: string;
    sender_id: number;
  };
  unread_count: number;
}

// Получение всех чатов пользователя с деталями
export const getUserChats = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId || req.user?.id;
    
    if (!req.user || !userId) {
      // Возвращаем пустой массив если не авторизован
      return res.json({ chats: [] });
    }

    const query = `
      SELECT 
        c.id,
        c.participant1_id,
        c.participant2_id,
        c.created_at,
        c.updated_at,
        u1.id as p1_id,
        u1.username as p1_username,
        u2.id as p2_id,
        u2.username as p2_username,
        m.content as last_message_content,
        m.created_at as last_message_created_at,
        m.sender_id as last_message_sender_id,
        (SELECT COUNT(*) 
         FROM messages 
         WHERE chat_id = c.id 
         AND sender_id != $1 
         AND read_at IS NULL) as unread_count
      FROM chats c
      JOIN users u1 ON c.participant1_id = u1.id
      JOIN users u2 ON c.participant2_id = u2.id
      LEFT JOIN LATERAL (
        SELECT content, created_at, sender_id
        FROM messages 
        WHERE chat_id = c.id 
        ORDER BY created_at DESC 
        LIMIT 1
      ) m ON true
      WHERE (c.participant1_id = $1 OR c.participant2_id = $1)
      ORDER BY c.updated_at DESC
    `;

    const result = await pool.query(query, [userId]);

    const chats: ChatWithDetails[] = result.rows.map(row => ({
      id: row.id,
      participant1_id: row.participant1_id,
      participant2_id: row.participant2_id,
      created_at: row.created_at,
      updated_at: row.updated_at,
      participant1: {
        id: row.p1_id,
        username: row.p1_username
      },
      participant2: {
        id: row.p2_id,
        username: row.p2_username
      },
      last_message: row.last_message_content ? {
        content: row.last_message_content,
        created_at: row.last_message_created_at,
        sender_id: row.last_message_sender_id
      } : undefined,
      unread_count: parseInt(row.unread_count) || 0
    }));

    res.json({ chats });
  } catch (error) {
    console.error('Get user chats error:', error);
    res.status(500).json({ 
      message: 'Ошибка получения чатов',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

// Получение сообщений конкретного чата
export const getChatMessages = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId || req.user?.id;
    
    if (!req.user || !userId) {
      return res.status(401).json({ 
        message: 'Не авторизован',
        error: 'User authentication required'
      });
    }

    const { chatId } = req.params;

    // Проверяем, имеет ли пользователь доступ к этому чату
    const chatCheck = await pool.query(
      'SELECT id FROM chats WHERE id = $1 AND (participant1_id = $2 OR participant2_id = $2)',
      [chatId, userId]
    );

    if (chatCheck.rows.length === 0) {
      return res.status(403).json({ 
        message: 'Доступ к чату запрещен',
        error: 'Access denied to this chat'
      });
    }

    // Получаем сообщения
    const messagesQuery = `
      SELECT 
        m.id,
        m.chat_id,
        m.sender_id,
        m.content,
        m.created_at,
        m.updated_at,
        m.read_at,
        u.username as sender_name
      FROM messages m
      JOIN users u ON m.sender_id = u.id
      WHERE m.chat_id = $1
      ORDER BY m.created_at ASC
    `;

    const messagesResult = await pool.query(messagesQuery, [chatId]);

    // Отмечаем сообщения как прочитанные
    await pool.query(
      'UPDATE messages SET read_at = CURRENT_TIMESTAMP WHERE chat_id = $1 AND sender_id != $2 AND read_at IS NULL',
      [chatId, userId]
    );

    const messages: Message[] = messagesResult.rows.map(row => ({
      id: row.id,
      chat_id: row.chat_id,
      sender_id: row.sender_id,
      content: row.content,
      created_at: row.created_at,
      updated_at: row.updated_at,
      read_at: row.read_at
    }));

    res.json({ messages });
  } catch (error) {
    console.error('Get chat messages error:', error);
    res.status(500).json({ 
      message: 'Ошибка получения сообщений',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

// Создание или получение чата с другим пользователем
export const createOrGetChat = async (req: AuthRequest, res: Response) => {
  try {
    const currentUserId = req.user?.userId || req.user?.id;
    
    if (!req.user || !currentUserId) {
      return res.status(401).json({ 
        message: 'Не авторизован',
        error: 'User authentication required'
      });
    }

    const { participantId } = req.body;

    if (!participantId) {
      return res.status(400).json({ 
        message: 'ID участника обязателен',
        error: 'Participant ID is required'
      });
    }

    if (participantId === currentUserId) {
      return res.status(400).json({ 
        message: 'Нельзя создать чат с самим собой',
        error: 'Cannot create chat with yourself'
      });
    }

    // Проверяем, существует ли пользователь
    const userCheck = await pool.query('SELECT id, username FROM users WHERE id = $1', [participantId]);
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ 
        message: 'Пользователь не найден',
        error: 'User not found'
      });
    }

    // Ищем существующий чат
    const existingChatQuery = `
      SELECT id, participant1_id, participant2_id, created_at, updated_at
      FROM chats 
      WHERE (participant1_id = $1 AND participant2_id = $2) 
         OR (participant1_id = $2 AND participant2_id = $1)
    `;
    
    const existingChat = await pool.query(existingChatQuery, [currentUserId, participantId]);

    if (existingChat.rows.length > 0) {
      const chat = existingChat.rows[0];
      return res.json({
        chat: {
          id: chat.id,
          participant1_id: chat.participant1_id,
          participant2_id: chat.participant2_id,
          created_at: chat.created_at,
          updated_at: chat.updated_at,
          participant1: {
            id: currentUserId,
            username: req.user.username
          },
          participant2: {
            id: participantId,
            username: userCheck.rows[0].username
          },
          last_message: undefined,
          unread_count: 0
        }
      });
    }

    // Создаем новый чат
    const createChatQuery = `
      INSERT INTO chats (participant1_id, participant2_id)
      VALUES ($1, $2)
      RETURNING id, participant1_id, participant2_id, created_at, updated_at
    `;

    const newChatResult = await pool.query(createChatQuery, [currentUserId, participantId]);
    const newChat = newChatResult.rows[0];

    res.status(201).json({
      chat: {
        id: newChat.id,
        participant1_id: newChat.participant1_id,
        participant2_id: newChat.participant2_id,
        created_at: newChat.created_at,
        updated_at: newChat.updated_at,
        participant1: {
          id: currentUserId,
          username: req.user.username
        },
        participant2: {
          id: participantId,
          username: userCheck.rows[0].username
        },
        last_message: undefined,
        unread_count: 0
      }
    });
  } catch (error) {
    console.error('Create or get chat error:', error);
    res.status(500).json({ 
      message: 'Ошибка создания чата',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

// Отправка сообщения
export const sendMessage = async (req: AuthRequest, res: Response) => {
  try {
    const senderId = req.user?.userId || req.user?.id;
    
    if (!req.user || !senderId) {
      return res.status(401).json({ 
        message: 'Не авторизован',
        error: 'User authentication required'
      });
    }

    const { chatId, content } = req.body;

    if (!chatId || !content || !content.trim()) {
      return res.status(400).json({ 
        message: 'ID чата и содержимое сообщения обязательны',
        error: 'Chat ID and content are required'
      });
    }

    // Проверяем, имеет ли пользователь доступ к этому чату
    const chatCheck = await pool.query(
      'SELECT id FROM chats WHERE id = $1 AND (participant1_id = $2 OR participant2_id = $2)',
      [chatId, senderId]
    );

    if (chatCheck.rows.length === 0) {
      return res.status(403).json({ 
        message: 'Доступ к чату запрещен',
        error: 'Access denied to this chat'
      });
    }

    // Создаем сообщение
    const createMessageQuery = `
      INSERT INTO messages (chat_id, sender_id, content)
      VALUES ($1, $2, $3)
      RETURNING id, chat_id, sender_id, content, created_at, updated_at
    `;

    const messageResult = await pool.query(createMessageQuery, [chatId, senderId, content.trim()]);
    const newMessage = messageResult.rows[0];

    // Обновляем время последнего обновления чата
    await pool.query(
      'UPDATE chats SET updated_at = CURRENT_TIMESTAMP WHERE id = $1',
      [chatId]
    );

    const message: Message = {
      id: newMessage.id,
      chat_id: newMessage.chat_id,
      sender_id: newMessage.sender_id,
      content: newMessage.content,
      created_at: newMessage.created_at,
      updated_at: newMessage.updated_at
    };

    res.status(201).json({ message });
  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({ 
      message: 'Ошибка отправки сообщения',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

// Получение информации о пользователе для чата
export const getUserInfo = async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({ 
        message: 'ID пользователя обязателен',
        error: 'User ID is required'
      });
    }

    // Проверяем, является ли userId числом или username
    const isNumeric = /^\d+$/.test(userId);
    
    const userQuery = isNumeric 
      ? `
        SELECT id, username, created_at
        FROM users 
        WHERE id = $1
      `
      : `
        SELECT id, username, created_at
        FROM users 
        WHERE username = $1
      `;

    const result = await pool.query(userQuery, [userId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ 
        message: 'Пользователь не найден',
        error: 'User not found'
      });
    }

    const user = result.rows[0];

    res.json({ 
      user: {
        id: user.id,
        username: user.username,
        created_at: user.created_at
      }
    });
  } catch (error) {
    console.error('Get user info error:', error);
    res.status(500).json({ 
      message: 'Ошибка получения информации о пользователе',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};
