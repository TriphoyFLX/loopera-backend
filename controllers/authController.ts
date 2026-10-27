import express from 'express';
import type { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import pool from '../config/database.js';
import { generateVerificationCode, sendVerificationCode, sendPasswordResetCode, notifyNewRegistration } from '../services/emailService.js';
import { getJwtSecret, JWT_EXPIRES_IN, MAX_REFRESH_AGE_MS } from '../config/jwt.js';

export const createAuthToken = (user: {
  id: number;
  username: string;
  email: string;
  role?: string | null;
}) =>
  jwt.sign(
    {
      userId: user.id,
      username: user.username,
      email: user.email,
      role: user.role || 'user',
    },
    getJwtSecret(),
    { expiresIn: JWT_EXPIRES_IN },
  );

export const formatAuthUser = (user: {
  id: number;
  username: string;
  email: string;
  role?: string | null;
  onboarding_completed?: boolean | null;
  created_at?: string | Date;
  avatar_url?: string | null;
}) => ({
  id: user.id,
  username: user.username,
  email: user.email,
  role: user.role || 'user',
  onboarding_completed: !!user.onboarding_completed,
  avatar_url: user.avatar_url || null,
  ...(user.created_at ? { created_at: user.created_at } : {}),
});

export const register = async (req: Request, res: Response) => {
  try {
    const { username, email, password } = req.body;

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
      // Не прерываем регистрацию, но предупреждаем пользователя
    }

    void notifyNewRegistration({
      id: user.id,
      username: user.username,
      email: user.email,
    });

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
      'UPDATE users SET email_verified = TRUE WHERE email = $1 RETURNING id, username, email, role, onboarding_completed, created_at',
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Пользователь не найден' });
    }

    const user = result.rows[0];

    const token = createAuthToken(user);

    res.status(200).json({
      message: 'Email успешно подтвержден',
      token,
      user: formatAuthUser(user),
    });

  } catch (error) {
    res.status(500).json({ message: 'Ошибка верификации email' });
  }
};

export const login = async (req: Request, res: Response) => {
  try {
    
    // Принимаем как email, так и username для входа
    const { username, email, password } = req.body;
    const loginField = username || email;


    if (!loginField || !password) {
      return res.status(400).json({ message: 'Имя пользователя/email и пароль обязательны' });
    }

    // Ищем пользователя по email или username с проверкой верификации
    const result = await pool.query(
      `SELECT id, username, email, password, email_verified, role, onboarding_completed, avatar_url,
              COALESCE(is_banned, false) AS is_banned
       FROM users WHERE email = $1 OR username = $1`,
      [loginField]
    );


    if (result.rows.length === 0) {
      return res.status(400).json({ message: 'Неверное имя пользователя/email или пароль' });
    }

    const user = result.rows[0];

    if (user.is_banned) {
      return res.status(403).json({ message: 'Аккаунт заблокирован', code: 'BANNED' });
    }

    if (!user.password) {
      return res.status(400).json({ message: 'Для этого аккаунта используйте вход через Google' });
    }

    // Проверяем пароль
    const isMatch = await bcrypt.compare(password, user.password);
    
    if (!isMatch) {
      return res.status(400).json({ message: 'Неверное имя пользователя/email или пароль' });
    }

    // Проверяем верификацию email
    if (!user.email_verified) {
      
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
      } catch (emailError) {
      }

      return res.status(403).json({ 
        message: 'Введите код верификации',
        requiresVerification: true,
        email: user.email
      });
    }

    const token = createAuthToken(user);

    const response = {
      message: 'Вход выполнен успешно',
      token,
      user: formatAuthUser(user),
    };

    res.json(response);
  } catch (error) {
    res.status(500).json({ message: 'Ошибка сервера при входе' });
  }
};

export const getProfile = async (req: Request & { user?: any }, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: 'Не авторизован' });
    }

    const userId = req.user.userId || req.user.id;

    const result = await pool.query(
      'SELECT id, username, email, role, onboarding_completed, created_at, avatar_url FROM users WHERE id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Пользователь не найден' });
    }

    const user = result.rows[0];

    res.json({
      user: formatAuthUser(user),
    });
  } catch (error) {
    res.status(500).json({ message: 'Ошибка сервера' });
  }
};

export const refreshToken = async (req: Request, res: Response) => {
  try {
    const authHeader = req.header('Authorization');
    const token = authHeader?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({ message: 'Токен не предоставлен.' });
    }

    let decoded: jwt.JwtPayload;
    try {
      decoded = jwt.verify(token, getJwtSecret()) as jwt.JwtPayload;
    } catch (error) {
      if (!(error instanceof jwt.TokenExpiredError)) {
        return res.status(401).json({ message: 'Сессия недействительна. Войдите в аккаунт снова.' });
      }

      decoded = jwt.verify(token, getJwtSecret(), { ignoreExpiration: true }) as jwt.JwtPayload;
      const expiredAt = (decoded.exp || 0) * 1000;
      if (!expiredAt || Date.now() - expiredAt > MAX_REFRESH_AGE_MS) {
        return res.status(401).json({ message: 'Сессия истекла. Войдите в аккаунт снова.' });
      }
    }

    const userId = decoded.userId || decoded.id;
    if (!userId) {
      return res.status(401).json({ message: 'Сессия недействительна. Войдите в аккаунт снова.' });
    }

    const result = await pool.query(
      `SELECT id, username, email, role, onboarding_completed, created_at,
              COALESCE(is_banned, false) AS is_banned
       FROM users WHERE id = $1`,
      [userId],
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ message: 'Пользователь не найден. Войдите в аккаунт снова.' });
    }

    const user = result.rows[0];
    if (user.is_banned) {
      return res.status(403).json({ message: 'Аккаунт заблокирован', code: 'BANNED' });
    }
    const newToken = createAuthToken(user);

    res.json({
      message: 'Сессия обновлена',
      token: newToken,
      user: formatAuthUser(user),
    });
  } catch (error) {
    res.status(500).json({ message: 'Ошибка обновления сессии' });
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
      await sendPasswordResetCode(email, code);
      res.json({ message: 'Код для сброса пароля отправлен на email' });
    } catch (emailError) {
      res.status(500).json({ message: 'Ошибка при отправке email' });
    }
  } catch (error) {
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
    
    res.json({ message: 'Пароль успешно изменен' });
  } catch (error) {
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
    } catch (emailError) {
    }
    
    res.json({ message: 'Код верификации отправлен повторно' });
  } catch (error) {
    res.status(500).json({ message: 'Ошибка сервера' });
  }
};