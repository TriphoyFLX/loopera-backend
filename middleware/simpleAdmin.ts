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
  console.log('simpleAdmin middleware - req.user:', req.user);
  console.log('simpleAdmin middleware - req.user.userId:', req.user?.userId);
  console.log('simpleAdmin middleware - req.user.id:', req.user?.id);
  
  // Check if user is authenticated first
  if (!req.user) {
    console.log('simpleAdmin middleware - No user found, returning 401');
    return res.status(401).json({ error: 'Authentication required' });
  }

  // Only allow specific admin user (Triphoy21 with userId 291)
  const adminUserId = 291;
  if (req.user.userId !== adminUserId && req.user.id !== adminUserId) {
    console.log('simpleAdmin middleware - User not authorized, returning 403');
    return res.status(403).json({ error: 'Admin access denied' });
  }

  console.log('simpleAdmin middleware - User authorized, proceeding');
  next();
};
