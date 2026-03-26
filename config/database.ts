import { Pool } from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, '..', '..'); // Два уровня вверх от backend/config

// .env уже загружен в index.ts

console.log('Database config:', {
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'loopera',
  password: process.env.DB_PASSWORD || '',
  port: parseInt(process.env.DB_PORT || '5432'),
});

const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'loopera',
  password: process.env.DB_PASSWORD || '',
  port: parseInt(process.env.DB_PORT || '5432'),
});

export const initDatabase = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        hashtag VARCHAR(100) UNIQUE,
        avatar_url VARCHAR(500),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Добавляем недостающие колонки если они существуют
    try {
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS hashtag VARCHAR(100) UNIQUE`);
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url VARCHAR(500)`);
    } catch (error) {
      console.log('Columns might already exist:', error);
    }

    await pool.query(`
      CREATE TABLE IF NOT EXISTS loops (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        filename VARCHAR(255) NOT NULL,
        original_name VARCHAR(255) NOT NULL,
        file_size INTEGER NOT NULL,
        duration DECIMAL(10,2),
        bpm INTEGER,
        key VARCHAR(10),
        genre VARCHAR(100),
        tags JSONB,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Таблица для кодов верификации email
    await pool.query(`
      CREATE TABLE IF NOT EXISTS verification_codes (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) NOT NULL,
        code VARCHAR(10) NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Таблица для чатов
    await pool.query(`
      CREATE TABLE IF NOT EXISTS chats (
        id SERIAL PRIMARY KEY,
        participant1_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        participant2_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(participant1_id, participant2_id)
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        chat_id INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
        sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        content TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        read_at TIMESTAMP
      )
    `);

    // Таблица для лайков лупов
    await pool.query(`
      CREATE TABLE IF NOT EXISTS loop_likes (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        loop_id INTEGER NOT NULL REFERENCES loops(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, loop_id)
      )
    `);

    // Таблица для подписок на артистов
    await pool.query(`
      CREATE TABLE IF NOT EXISTS artist_subscriptions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        artist_hashtag VARCHAR(100) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, artist_hashtag)
      )
    `);

    // Создаем индексы для оптимизации производительности
    // Сначала удаляем возможные конфликтующие индексы
    await pool.query(`
      DROP INDEX IF EXISTS idx_loops_title;
    `);
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_loops_user_id ON loops(user_id);
    `);
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_loops_created_at ON loops(created_at DESC);
    `);
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_loops_genre ON loops(genre);
    `);
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_loops_bpm ON loops(bpm);
    `);
    
    // Полнотекстовый индекс для поиска по названию
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_loops_title_gin ON loops USING gin(to_tsvector('english', title));
    `);

    // Индексы для чатов
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_chats_participant1 ON chats(participant1_id);
    `);
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_chats_participant2 ON chats(participant2_id);
    `);
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_chats_updated_at ON chats(updated_at DESC);
    `);

    // Индексы для сообщений
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON messages(chat_id);
    `);
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_messages_sender_id ON messages(sender_id);
    `);
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at DESC);
    `);

    // Индексы для лайков
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_loop_likes_user_id ON loop_likes(user_id);
    `);
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_loop_likes_loop_id ON loop_likes(loop_id);
    `);
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_loop_likes_created_at ON loop_likes(created_at DESC);
    `);

    // Индексы для подписок на артистов
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_artist_subscriptions_user_id ON artist_subscriptions(user_id);
    `);
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_artist_subscriptions_hashtag ON artist_subscriptions(artist_hashtag);
    `);

    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Database initialization error:', error);
    throw error;
  }
};

export default pool;
