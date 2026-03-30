import type { Request, Response, NextFunction } from 'express';

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

export type AuthRequest = Request;

export const simpleAuth = (req: AuthRequest, res: Response, next: NextFunction) => {
  // Просто пропускаем все запросы
  req.user = { 
    userId: 11, 
    username: 'loopera_admin', 
    email: 'admin@loopera.com',
    id: 11
  };
  next();
};
