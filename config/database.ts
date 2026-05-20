import { Pool } from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, '..'); // Один уровень вверх от backend/config

// .env уже загружен в index.ts

const pool = new Pool({
  user: process.env.DB_USER || 'matveevdima',
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
        email_verified BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Добавляем недостающие колонки если они существуют
    try {
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS hashtag VARCHAR(100) UNIQUE`);
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url VARCHAR(500)`);
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT FALSE`);
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
        used BOOLEAN DEFAULT FALSE,
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
      CREATE INDEX IF NOT EXISTS idx_artist_subscriptions_artist_hashtag ON artist_subscriptions(artist_hashtag);
    `);
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_verification_codes_email ON verification_codes(email);
    `);
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_verification_codes_expires_at ON verification_codes(expires_at);
    `);

    // Таблица для кликов по Telegram
    await pool.query(`
      CREATE TABLE IF NOT EXISTS telegram_clicks (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        loop_id INTEGER REFERENCES loops(id) ON DELETE CASCADE,
        clicked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Индекс для кликов по Telegram
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_telegram_clicks_user_id ON telegram_clicks(user_id);
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_telegram_clicks_loop_id ON telegram_clicks(loop_id);
    `);

    // Таблица для паков с лупами
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sound_packs (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        price INTEGER NOT NULL CHECK (price >= 0),
        status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'pending', 'approved', 'rejected')),
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        cover_url VARCHAR(500),
        voice_tag VARCHAR(100),
        voice_tag_file VARCHAR(500),
        text_file VARCHAR(500),
        preview_url VARCHAR(500),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        moderated_at TIMESTAMP,
        moderated_by INTEGER REFERENCES users(id),
        rejection_reason TEXT
      )
    `);

    // Таблица для лупов в паках
    await pool.query(`
      CREATE TABLE IF NOT EXISTS pack_loops (
        id SERIAL PRIMARY KEY,
        pack_id INTEGER NOT NULL REFERENCES sound_packs(id) ON DELETE CASCADE,
        loop_id INTEGER NOT NULL REFERENCES loops(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(pack_id, loop_id)
      )
    `);

    // Таблица для баланса пользователей
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_balance (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        available_balance INTEGER DEFAULT 0 CHECK (available_balance >= 0),
        pending_balance INTEGER DEFAULT 0 CHECK (pending_balance >= 0),
        total_earned INTEGER DEFAULT 0 CHECK (total_earned >= 0),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Таблица для заказов
    await pool.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id SERIAL PRIMARY KEY,
        pack_id INTEGER NOT NULL REFERENCES sound_packs(id) ON DELETE CASCADE,
        buyer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        seller_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        price INTEGER NOT NULL,
        commission INTEGER NOT NULL,
        seller_earnings INTEGER NOT NULL,
        status VARCHAR(20) DEFAULT 'completed' CHECK (status IN ('pending', 'completed', 'refunded')),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Таблица для заявок на вывод средств
    await pool.query(`
      CREATE TABLE IF NOT EXISTS withdrawals (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        amount INTEGER NOT NULL CHECK (amount >= 1000),
        phone VARCHAR(20) NOT NULL,
        bank VARCHAR(100) NOT NULL,
        status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'rejected')),
        rejection_reason TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        processed_at TIMESTAMP,
        processed_by INTEGER REFERENCES users(id)
      )
    `);

    // Таблица для рейтингов паков
    await pool.query(`
      CREATE TABLE IF NOT EXISTS pack_ratings (
        id SERIAL PRIMARY KEY,
        pack_id INTEGER NOT NULL REFERENCES sound_packs(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
        review TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(pack_id, user_id)
      )
    `);

    // Таблица для жалоб на паки/пользователей
    await pool.query(`
      CREATE TABLE IF NOT EXISTS reports (
        id SERIAL PRIMARY KEY,
        reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        reported_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        pack_id INTEGER REFERENCES sound_packs(id) ON DELETE CASCADE,
        reason VARCHAR(50) NOT NULL CHECK (reason IN ('inappropriate_content', 'copyright', 'spam', 'scam', 'other')),
        description TEXT NOT NULL,
        status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'resolved', 'dismissed')),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        resolved_at TIMESTAMP,
        resolved_by INTEGER REFERENCES users(id)
      )
    `);

    // Индексы для магазина
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_sound_packs_user_id ON sound_packs(user_id);
    `);
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_sound_packs_status ON sound_packs(status);
    `);
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_sound_packs_created_at ON sound_packs(created_at DESC);
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_pack_loops_pack_id ON pack_loops(pack_id);
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_orders_buyer_id ON orders(buyer_id);
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_orders_seller_id ON orders(seller_id);
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_withdrawals_user_id ON withdrawals(user_id);
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON withdrawals(status);
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_pack_ratings_pack_id ON pack_ratings(pack_id);
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);
    `);

    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Database initialization error:', error);
    throw error;
  }
};

export default pool;
