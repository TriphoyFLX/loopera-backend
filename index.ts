import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Server } from 'http';

// Загружаем переменные окружения ПЕРЕД импортами, которые их используют
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// tsx (dev): __dirname = backend-repo; dist (prod): __dirname = backend-repo/dist
const envCandidates = [
  path.join(__dirname, '.env'),
  path.join(__dirname, '..', '.env'),
  path.join(__dirname, '..', '.env.production'),
  path.join(__dirname, '.env.production'),
];
for (const envPath of envCandidates) {
  const result = dotenv.config({ path: envPath });
  if (!result.error) break;
}

import pool, { initDatabase } from './config/database.js';
import { assertProductionEnv } from './config/prodEnv.js';
import { installProcessErrorHandlers, reportError } from './services/errorReporter.js';
import authRoutes from './routes/auth.js';
import loopsRoutes from './routes/loops.js';
import chatRoutes from './routes/chats.js';
import subscriptionRoutes from './routes/subscriptions.js';
import likeRoutes from './routes/likes.js';
import topUsersRoutes from './routes/topUsers.js';
import searchRoutes from './routes/search.js';
import adminRoutes from './routes/admin.js';
import shopRoutes from './routes/shop.js';
import adminShopRoutes from './routes/adminShop.js';
import artistTypesRoutes from './routes/artistTypes.js';
import onboardingRoutes from './routes/onboarding.js';
import packUploadRoutes from './routes/packUpload.js';
import beatRoutes from './routes/beats.js';
import melodyRoutes from './routes/melody.js';
import looptokRoutes from './routes/looptok.js';
import billingRoutes from './routes/billing.js';
import webhookRoutes from './routes/webhooks.js';
import notificationRoutes from './routes/notifications.js';
import homeRoutes from './routes/home.js';
import followRoutes from './routes/follows.js';
import { generalLimiter, authLimiter, getRedisStatus } from './middleware/rateLimit.js';
import { isObjectStorageEnabled } from './services/objectStorage.js';

installProcessErrorHandlers();

const app = express();
const PORT = parseInt(process.env.PORT || '5001', 10);

// За nginx/Caddy — иначе все запросы считаются с одного IP и быстро бьют 429
app.set('trust proxy', 1);

const allowedOrigins: (string | RegExp)[] = [
  'https://loopera.ru',
  'https://www.loopera.ru',
];

if (process.env.FRONTEND_URL && !allowedOrigins.includes(process.env.FRONTEND_URL)) {
  allowedOrigins.push(process.env.FRONTEND_URL);
}

if (process.env.NODE_ENV !== 'production') {
  allowedOrigins.push(/^http:\/\/(localhost|127\.0\.0\.1):[0-9]+$/);
  allowedOrigins.push(/^https:\/\/(localhost|127\.0\.0\.1):[0-9]+$/);
}

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  }),
);

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'", 'https:'],
        frameSrc: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }),
);

app.use(express.json({ limit: '1mb' }));

app.use('/api', generalLimiter);

app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/users', topUsersRoutes);
app.use('/api/loops', loopsRoutes);
app.use('/api/chats', chatRoutes);
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/likes', likeRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/artist-types', artistTypesRoutes);
app.use('/api/onboarding', onboardingRoutes);

app.use('/api/shop', shopRoutes);
app.use('/api/admin/shop', adminShopRoutes);
app.use('/api/pack-upload', packUploadRoutes);
app.use('/api/beats', beatRoutes);
app.use('/api/melody', melodyRoutes);
app.use('/api/looptok', looptokRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/webhooks', webhookRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/home', homeRoutes);
app.use('/api/follows', followRoutes);

app.use('/uploads/loops', express.static('uploads/loops'));
app.use('/uploads/beats', express.static('uploads/beats'));
app.use('/uploads/looptok', express.static('uploads/looptok'));
app.use('/uploads/avatars', express.static('uploads/avatars'));
app.use(
  '/uploads/shop',
  (req, res, next) => {
    if (/\.(zip|rar|7z|tar|gz)$/i.test(req.path)) {
      return res.status(403).json({ error: 'Direct archive download is not allowed' });
    }
    next();
  },
  express.static('uploads/shop'),
);

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({
      ok: true,
      status: 'healthy',
      db: 'up',
      redis: getRedisStatus(),
      storage: isObjectStorageEnabled() ? 's3' : 'local',
      uptime_s: Math.floor(process.uptime()),
    });
  } catch {
    res.status(503).json({ ok: false, status: 'degraded', db: 'down' });
  }
});

app.get('/api/readyz', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({
      ok: true,
      redis: getRedisStatus(),
      storage: isObjectStorageEnabled() ? 's3' : 'local',
    });
  } catch {
    res.status(503).json({ ok: false, reason: 'database_unavailable' });
  }
});

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'API route not found', path: req.path });
});

app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    console.error('Unhandled route error:', err);
    void reportError({ message: err.message, stack: err.stack, extra: { kind: 'express' } });
    res.status(500).json({ error: 'Internal server error' });
  },
);

let server: Server | null = null;
let shuttingDown = false;

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[shutdown] ${signal} received`);

  const forceTimer = setTimeout(() => {
    console.error('[shutdown] forced exit after timeout');
    process.exit(1);
  }, 20_000);
  forceTimer.unref();

  try {
    if (server) {
      await new Promise<void>((resolve) => {
        server!.close(() => resolve());
      });
    }
    await pool.end();
    console.log('[shutdown] clean');
    process.exit(0);
  } catch (err) {
    console.error('[shutdown] error', err);
    process.exit(1);
  }
}

const startServer = async () => {
  try {
    assertProductionEnv();
    await initDatabase();

    try {
      const client = await pool.connect();
      client.release();
    } catch (dbError) {
      console.error('Database connection failed:', dbError);
      if (process.env.NODE_ENV === 'production') {
        process.exit(1);
      }
    }

    server = app.listen(PORT, () => {
      if (process.env.NODE_ENV !== 'production') {
        console.log(`Server running on http://localhost:${PORT}`);
      } else {
        console.log(`Server listening on :${PORT}`);
      }
    });

    process.on('SIGTERM', () => void shutdown('SIGTERM'));
    process.on('SIGINT', () => void shutdown('SIGINT'));
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();
