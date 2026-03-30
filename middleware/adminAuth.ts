import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import pool from '../config/database.ts';

declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: number;
        username: string;
        email: string;
        id: number;
      };
    }
  }
}

const ADMIN_EMAIL = 'roomop86@gmail.com';

export const adminAuth = (req: Request, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : authHeader;
    
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any;
    
    // Проверяем роль в базе данных
    pool.query('SELECT role FROM users WHERE id = $1', [decoded.userId])
      .then(result => {
        if (result.rows.length === 0 || result.rows[0].role !== 'admin') {
          return res.status(403).json({ error: 'Admin access required' });
        }
        req.user = { ...decoded, role: result.rows[0].role };
        next();
      })
      .catch(error => {
        console.error('Admin auth error:', error);
        return res.status(500).json({ error: 'Server error' });
      });
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};
