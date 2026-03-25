import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Загружаем переменные окружения ПЕРЕД импортами, которые их используют
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, '..', '..');
dotenv.config({ path: path.join(projectRoot, '.env') });

import pool, { initDatabase } from './config/database.js';
import authRoutes from './routes/auth';
import loopsRoutes from './routes/loops';
import chatRoutes from './routes/chats';
import subscriptionRoutes from './routes/subscriptions';
import likeRoutes from './routes/likes';
import topUsersRoutes from './routes/topUsers';
import searchRoutes from './routes/search';

const app = express();
const PORT = process.env.PORT || 5000;

// CORS конфигурация
const allowedOrigins: (string | RegExp)[] = [
  // Add your production domains here
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

app.use((req, res, next) => {
  console.log(`${req.method} ${req.path} - Origin: ${req.headers.origin}`);
  next();
});
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/users', topUsersRoutes);
app.use('/api/loops', loopsRoutes);
app.use('/api/chats', chatRoutes);
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/loops', likeRoutes);
app.use('/api/search', searchRoutes);

// Раздача статических файлов (загруженные лупы)
app.use('/uploads', express.static('uploads'));

app.get('/api/health', (req, res) => {
  res.json({ message: 'Server is running' });
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
      console.log('Database connection successful!');
      console.log('Database user:', process.env.DB_USER);
      const result = await client.query('SELECT current_user');
      console.log('Current database user:', result.rows[0].current_user);
      client.release();
    } catch (dbError) {
      console.error('Database connection failed:', dbError);
    }
    
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      console.log(`Database connected: PostgreSQL`);
      console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();
