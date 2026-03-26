import express from 'express';
import type { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import pool from '../config/database.js';
import { generateVerificationCode, sendVerificationCode } from '../services/emailService.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, '..', '..');

import('dotenv').then(dotenv => {
  dotenv.config({ path: path.join(projectRoot, '.env') });
});

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

export const register = async (req: Request, res: Response) => {
  try {
    const { username, email, password } = req.body;

    console.log('Register request:', { username, email, password: '***' });

    if (!username || !email || !password) {
      return res.status(400).json({ message: 'Все поля обязательны' });
    }

    if (password.length < 6) {
      return res.status(400).json({ message: 'Пароль должен содержать минимум 6 символов' });
    }

    // Проверяем существующего пользователя
    const existingUser = await pool.query(
      'SELECT id FROM users WHERE email = $1 OR username = $2',
      [email, username]
    );

    if (existingUser.rows.length > 0) {
      return res.status(400).json({ 
        message: 'Пользователь с таким email или username уже существует' 
      });
    }

    // Хешируем пароль
    const hashedPassword = await bcrypt.hash(password, 10);

    // Создаем пользователя сразу
    const result = await pool.query(
      'INSERT INTO users (username, email, password) VALUES ($1, $2, $3) RETURNING id, username, email, created_at',
      [username, email, hashedPassword]
    );

    const user = result.rows[0];

    // Создаем токен
    const token = jwt.sign(
      { userId: user.id, username: user.username },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    console.log('User registered successfully:', { id: user.id, username: user.username });

    res.status(201).json({
      message: 'Регистрация успешна',
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        created_at: user.created_at
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ message: 'Ошибка сервера при регистрации' });
  }
};

export const verifyEmail = async (req: Request, res: Response) => {
  try {
    const { email, code, tempData } = req.body;

    if (!email || !code || !tempData) {
      return res.status(400).json({ message: 'Все поля обязательны' });
    }

    // Проверяем код верификации
    const verificationResult = await pool.query(
      `SELECT id FROM verification_codes 
       WHERE email = $1 AND code = $2 AND expires_at > NOW() AND used = FALSE`,
      [email, code]
    );

    if (verificationResult.rows.length === 0) {
      return res.status(400).json({ message: 'Неверный или просроченный код верификации' });
    }

    // Помечаем код как использованный
    await pool.query(
      'UPDATE verification_codes SET used = TRUE WHERE email = $1 AND code = $2',
      [email, code]
    );

    // Создаем пользователя
    const result = await pool.query(
      'INSERT INTO users (username, email, password) VALUES ($1, $2, $3) RETURNING id, username, email, created_at',
      [tempData.username, tempData.email, tempData.password]
    );

    const user = result.rows[0];

    // Создаем токен
    const token = jwt.sign(
      { userId: user.id, username: user.username },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    console.log('User registered and verified successfully:', { id: user.id, username: user.username });

    res.status(201).json({
      message: 'Регистрация успешно завершена',
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        created_at: user.created_at
      }
    });

  } catch (error) {
    console.error('Verification error:', error);
    res.status(500).json({ message: 'Ошибка верификации email' });
  }
};

export const login = async (req: Request, res: Response) => {
  try {
    console.log('Login request body:', req.body);
    
    // Принимаем как email, так и username для входа
    const { username, email, password } = req.body;
    const loginField = username || email;

    console.log('Login field:', loginField);

    if (!loginField || !password) {
      console.log('Missing login field or password');
      return res.status(400).json({ message: 'Имя пользователя/email и пароль обязательны' });
    }

    // Ищем пользователя по email или username
    console.log('Looking for user with:', loginField);
    const result = await pool.query(
      'SELECT id, username, email, password FROM users WHERE email = $1 OR username = $1',
      [loginField]
    );

    console.log('User query result rows:', result.rows.length);

    if (result.rows.length === 0) {
      console.log('User not found');
      return res.status(400).json({ message: 'Неверное имя пользователя/email или пароль' });
    }

    const user = result.rows[0];
    console.log('Found user:', { id: user.id, username: user.username, email: user.email });

    // Проверяем пароль
    const isMatch = await bcrypt.compare(password, user.password);
    console.log('Password match:', isMatch);
    
    if (!isMatch) {
      console.log('Password does not match');
      return res.status(400).json({ message: 'Неверное имя пользователя/email или пароль' });
    }

    // Создаем токен
    const token = jwt.sign(
      { userId: user.id, username: user.username },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    const response = {
      message: 'Вход выполнен успешно',
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email
      }
    };

    console.log('Sending successful login response');
    res.json(response);
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Ошибка сервера при входе' });
  }
};

export const getProfile = async (req: Request & { user?: any }, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: 'Не авторизован' });
    }

    const result = await pool.query(
      'SELECT id, username, email, created_at FROM users WHERE id = $1',
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Пользователь не найден' });
    }

    const user = result.rows[0];

    res.json({
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        createdAt: user.created_at
      }
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
};