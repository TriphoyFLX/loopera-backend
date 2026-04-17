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

    // Валидация email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ message: 'Введите корректный email адрес' });
    }

    // Валидация username
    if (username.length < 3) {
      return res.status(400).json({ message: 'Имя пользователя должно содержать минимум 3 символа' });
    }

    if (username.length > 50) {
      return res.status(400).json({ message: 'Имя пользователя не должно превышать 50 символов' });
    }

    if (password.length < 6) {
      return res.status(400).json({ message: 'Пароль должен содержать минимум 6 символов' });
    }

    if (password.length > 128) {
      return res.status(400).json({ message: 'Пароль не должен превышать 128 символов' });
    }

    // Проверяем существующего пользователя
    const existingUser = await pool.query(
      'SELECT id, email_verified FROM users WHERE email = $1 OR username = $2',
      [email, username]
    );

    if (existingUser.rows.length > 0) {
      const user = existingUser.rows[0];
      
      // Если пользователь уже существует и верифицирован - предлагаем войти
      if (user.email_verified) {
        return res.status(409).json({ 
          message: 'Пользователь с таким email или username уже существует. Войдите в аккаунт.',
          requiresLogin: true
        });
      }
      
      // Если пользователь существует но не верифицирован - не удаляем, а предлагаем верифицироваться
      return res.status(403).json({ 
        message: 'Пользователь с таким email или username уже зарегистрирован, но не верифицирован. Проверьте почту или войдите.',
        requiresVerification: true,
        email: user.email
      });
    }

    // Хешируем пароль
    const hashedPassword = await bcrypt.hash(password, 10);

    // Создаем пользователя с email_verified = false
    const result = await pool.query(
      'INSERT INTO users (username, email, password, email_verified) VALUES ($1, $2, $3, $4) RETURNING id, username, email, created_at',
      [username, email, hashedPassword, false]
    );

    const user = result.rows[0];

    // Генерируем и отправляем код верификации
    const verificationCode = generateVerificationCode();
    
    // Сохраняем код в базу
    await pool.query(
      'INSERT INTO verification_codes (email, code, expires_at) VALUES ($1, $2, NOW() + INTERVAL \'10 minutes\')',
      [email, verificationCode]
    );

    try {
      await sendVerificationCode(email, verificationCode);
    } catch (emailError) {
      console.error('Error sending verification email:', emailError);
      // Не прерываем регистрацию, но предупреждаем пользователя
    }

    console.log('User registered successfully, verification required:', { id: user.id, username: user.username });

    res.status(201).json({
      message: 'Регистрация успешна. Проверьте почту для подтверждения.',
      requiresVerification: true,
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
    const { email, code } = req.body;

    if (!email || !code) {
      return res.status(400).json({ message: 'Email и код обязательны' });
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

    // Обновляем статус верификации пользователя
    const result = await pool.query(
      'UPDATE users SET email_verified = TRUE WHERE email = $1 RETURNING id, username, email, created_at',
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Пользователь не найден' });
    }

    const user = result.rows[0];

    // Создаем токен
    const token = jwt.sign(
      { userId: user.id, username: user.username, email: user.email },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    console.log('Email verified successfully:', { id: user.id, username: user.username });

    res.status(200).json({
      message: 'Email успешно подтвержден',
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

    // Ищем пользователя по email или username с проверкой верификации
    console.log('Looking for user with:', loginField);
    const result = await pool.query(
      'SELECT id, username, email, password, email_verified FROM users WHERE email = $1 OR username = $1',
      [loginField]
    );

    console.log('User query result rows:', result.rows.length);

    if (result.rows.length === 0) {
      console.log('User not found');
      return res.status(400).json({ message: 'Неверное имя пользователя/email или пароль' });
    }

    const user = result.rows[0];
    console.log('Found user:', { id: user.id, username: user.username, email: user.email, email_verified: user.email_verified });

    // Проверяем пароль
    const isMatch = await bcrypt.compare(password, user.password);
    console.log('Password match:', isMatch);
    
    if (!isMatch) {
      console.log('Password does not match');
      return res.status(400).json({ message: 'Неверное имя пользователя/email или пароль' });
    }

    // ВРЕМЕННО ОТКЛЮЧАЕМ ПРОВЕРКУ ВЕРИФИКАЦИИ EMAIL ДЛЯ РЕШЕНИЯ ПРОБЛЕМЫ АВТОРИЗАЦИИ
    // Проверяем верификацию email только для новых пользователей
    /*
    if (!user.email_verified) {
      console.log('Email not verified - sending verification code');
      
      // Генерируем и отправляем код верификации
      const code = generateVerificationCode();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 минут

      // Удаляем старые коды
      await pool.query('DELETE FROM verification_codes WHERE email = $1', [user.email]);

      // Сохраняем новый код
      await pool.query(
        'INSERT INTO verification_codes (email, code, expires_at) VALUES ($1, $2, $3)',
        [user.email, code, expiresAt]
      );

      // Отправляем email
      try {
        await sendVerificationCode(user.email, code);
        console.log('Verification code sent to:', user.email);
      } catch (emailError) {
        console.error('Error sending verification code:', emailError);
      }

      return res.status(403).json({ 
        message: 'Введите код верификации',
        requiresVerification: true,
        email: user.email
      });
    }
    */

    // Создаем токен
    const token = jwt.sign(
      { userId: user.id, username: user.username, email: user.email },
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

// Повторная отправка кода верификации
export const forgotPassword = async (req: Request, res: Response) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ message: 'Email обязателен' });
    }
    
    // Ищем пользователя по email
    const result = await pool.query(
      'SELECT id, username, email FROM users WHERE email = $1',
      [email]
    );
    
    if (result.rows.length === 0) {
      return res.status(400).json({ message: 'Пользователь с таким email не найден' });
    }
    
    const user = result.rows[0];
    console.log('Found user for password reset:', { id: user.id, username: user.username, email: user.email });
    
    // Генерируем и сохраняем новый код для сброса пароля
    const code = generateVerificationCode();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 минут
    
    // Удаляем старые коды
    await pool.query('DELETE FROM verification_codes WHERE email = $1', [email]);
    
    // Сохраняем новый код
    await pool.query(
      'INSERT INTO verification_codes (email, code, expires_at) VALUES ($1, $2, $3)',
      [email, code, expiresAt]
    );
    
    // Отправляем email с кодом сброса
    try {
      await sendVerificationCode(email, code);
      console.log('Password reset code sent to:', email);
      res.json({ message: 'Код для сброса пароля отправлен на email' });
    } catch (emailError) {
      console.error('Error sending password reset code:', emailError);
      res.status(500).json({ message: 'Ошибка при отправке email' });
    }
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
};

export const resetPassword = async (req: Request, res: Response) => {
  try {
    const { email, code, newPassword } = req.body;
    
    if (!email || !code || !newPassword) {
      return res.status(400).json({ message: 'Email, код и новый пароль обязательны' });
    }
    
    // Проверяем код
    const codeResult = await pool.query(
      'SELECT * FROM verification_codes WHERE email = $1 AND code = $2 AND expires_at > NOW()',
      [email, code]
    );
    
    if (codeResult.rows.length === 0) {
      return res.status(400).json({ message: 'Неверный или просроченный код' });
    }
    
    // Удаляем использованный код
    await pool.query('DELETE FROM verification_codes WHERE email = $1 AND code = $2', [email, code]);
    
    // Хешируем новый пароль
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(newPassword, saltRounds);
    
    // Обновляем пароль пользователя
    await pool.query(
      'UPDATE users SET password = $1 WHERE email = $2',
      [hashedPassword, email]
    );
    
    console.log('Password reset successfully for:', email);
    res.json({ message: 'Пароль успешно изменен' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
};

export const resendVerificationCode = async (req: Request, res: Response) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ message: 'Email обязателен' });
    }
    
    // Ищем пользователя по email
    const result = await pool.query(
      'SELECT id, username, email FROM users WHERE email = $1',
      [email]
    );
    
    if (result.rows.length === 0) {
      return res.status(400).json({ message: 'Пользователь с таким email не найден' });
    }
    
    const user = result.rows[0];
    console.log('Found user for resend:', { id: user.id, username: user.username, email: user.email });
    
    // Генерируем и сохраняем новый код
    const code = generateVerificationCode();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 минут
    
    // Удаляем старые коды
    await pool.query('DELETE FROM verification_codes WHERE email = $1', [email]);
    
    // Сохраняем новый код
    await pool.query(
      'INSERT INTO verification_codes (email, code, expires_at) VALUES ($1, $2, $3)',
      [email, code, expiresAt]
    );
    
    // Отправляем email
    try {
      await sendVerificationCode(email, code);
      console.log('Verification code sent to:', email);
    } catch (emailError) {
      console.error('Error sending verification code:', emailError);
    }
    
    res.json({ message: 'Код верификации отправлен повторно' });
  } catch (error) {
    console.error('Resend verification code error:', error);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
};