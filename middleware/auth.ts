import express from 'express';
import jwt from 'jsonwebtoken';
import pool from '../config/database.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, '..', '..');

// Загружаем .env синхронно
import { config } from 'dotenv';
config({ path: path.join(projectRoot, '.env') });

type Request = express.Request;
type Response = express.Response;
type NextFunction = express.NextFunction;

const JWT_SECRET = process.env.JWT_SECRET!;

export type AuthRequest = Request & { user?: any };

export const authenticate = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({ message: 'Доступ запрещен. Токен не предоставлен.' });
    }

    const decoded = jwt.verify(token, JWT_SECRET) as any;
    req.user = decoded;
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(401).json({ message: 'Токен недействителен.' });
  }
};
