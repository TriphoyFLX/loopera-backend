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
  // Check if user is authenticated first
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  // Only allow specific admin user (TriphoyFLX with userId 824)
  const adminUserId = 824;
  if (req.user.userId !== adminUserId && req.user.id !== adminUserId) {
    return res.status(403).json({ error: 'Admin access denied' });
  }

  next();
};
