import { Request, Response, NextFunction } from 'express';

type AuthRequest = Request & { user?: any };

// Whitelist of IPs allowed to access admin functions
const ADMIN_IPS = process.env.ADMIN_IPS?.split(',') || ['127.0.0.1', '::1'];

export const checkAdminIP = (req: AuthRequest, res: Response, next: NextFunction) => {
  const clientIP = req.ip || req.socket.remoteAddress || '';
  
  // Allow if no whitelist configured (development mode)
  if (ADMIN_IPS.length === 0 || (ADMIN_IPS.length === 1 && ADMIN_IPS[0] === '')) {
    return next();
  }
  
  // Check if IP is whitelisted
  const isAllowed = ADMIN_IPS.some(allowedIP => {
    if (allowedIP === clientIP) return true;
    // Handle IPv4-mapped IPv6 addresses
    if (clientIP.startsWith('::ffff:') && clientIP.slice(7) === allowedIP) return true;
    return false;
  });
  
  if (!isAllowed) {
    return res.status(403).json({ error: 'Access denied from this IP address' });
  }
  
  next();
};
