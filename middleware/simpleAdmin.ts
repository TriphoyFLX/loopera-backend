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

export const simpleAdmin = (req: Request, res: Response, next: NextFunction) => {
  // Просто пропускаем все запросы к админке
  req.user = { 
    userId: 11, 
    username: 'loopera_admin', 
    email: 'admin@loopera.com',
    id: 11
  };
  next();
};
