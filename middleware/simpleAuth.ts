import type { Request, Response, NextFunction } from 'express';

/**
 * DEV-ONLY stub. Disabled unless ENABLE_SIMPLE_AUTH=true and NODE_ENV !== production.
 * Never use in production — it previously spoofed an admin user.
 */
export type AuthRequest = Request;

export const simpleAuth = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (process.env.NODE_ENV === 'production' || process.env.ENABLE_SIMPLE_AUTH !== 'true') {
    return res.status(501).json({ error: 'simpleAuth is disabled' });
  }
  return res.status(501).json({
    error: 'simpleAuth stub removed — use real JWT authenticate middleware',
  });
};
