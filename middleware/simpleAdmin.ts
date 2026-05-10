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
  // Disable admin routes for security - they were allowing anyone to delete loops
  return res.status(403).json({ error: 'Admin routes are disabled for security' });
};
