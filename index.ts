import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Загружаем переменные окружения ПЕРЕД импортами, которые их используют
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, '..');
dotenv.config({ path: path.join(projectRoot, '.env') });

import pool, { initDatabase } from './config/database.js';
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
import packUploadRoutes from './routes/packUpload.js';
import testUploadRoutes from './routes/testUpload.js';
import beatRoutes from './routes/beats.js';
import { generalLimiter, authLimiter, sensitiveLimiter } from './middleware/rateLimit.js';

const app = express();
const PORT = parseInt(process.env.PORT || '5001');

// CORS конфигурация
const allowedOrigins: (string | RegExp)[] = [
  // Add your production domains here
  "https://loopera-lpr.vercel.app",
];

// Add frontend URL from environment if specified
if (process.env.FRONTEND_URL && !allowedOrigins.includes(process.env.FRONTEND_URL)) {
  allowedOrigins.push(process.env.FRONTEND_URL);
}

// В режиме разработки разрешаем все локальные адреса
if (process.env.NODE_ENV !== 'production') {
  allowedOrigins.push(/^http:\/\/(localhost|127\.0\.0\.1):[0-9]+$/);
  allowedOrigins.push(/^https:\/\/(localhost|127\.0\.0\.1):[0-9]+$/);
}

app.use(cors({
  origin: allowedOrigins,
  credentials: true
}));

// Security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

// Rate limiting
app.use(generalLimiter);

app.use(express.json());

// Test route to verify proxy (must be before all other routes)
app.get('/api/proxy-test', (req, res) => {
  res.json({ message: 'Proxy works!', time: new Date().toISOString() });
});

app.use('/api/auth', authRoutes);
app.use('/api/users', topUsersRoutes);
app.use('/api/loops', loopsRoutes);
app.use('/api/chats', chatRoutes);
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/likes', likeRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/admin', adminRoutes);

app.use('/api/shop', shopRoutes);
app.use('/api/admin/shop', adminShopRoutes);
app.use('/api/pack-upload', packUploadRoutes);
app.use('/api/beats', beatRoutes);

// Раздача статических файлов (загруженные лупы)
app.use('/uploads/loops', express.static('uploads/loops'));
app.use('/uploads', express.static('uploads'));
app.use('/uploads/beats', express.static('uploads/beats'));

app.get('/api/health', (req, res) => {
  res.json({ message: 'Server is running' });
});

// Catch-all for unmatched API routes
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'API route not found', path: req.path });
});

const startServer = async () => {
  try {
    // В продакшене включаем инициализацию БД
    if (process.env.NODE_ENV === 'production') {
      await initDatabase();
    }
    
    // Проверяем подключение к БД
    try {
      const client = await pool.connect();
      client.release();
    } catch (dbError) {
      // Silent fail for production
    }

    app.listen(PORT, () => {
      // Silent start for production
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();
