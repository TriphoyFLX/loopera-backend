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
  max: parseInt(process.env.DB_POOL_MAX || '20', 10) || 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
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
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN DEFAULT FALSE`);
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_skipped_at TIMESTAMP`);
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id VARCHAR(255) UNIQUE`);
      await pool.query(`ALTER TABLE users ALTER COLUMN password DROP NOT NULL`);
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
        mood VARCHAR(50),
        tags JSONB,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await pool.query(`ALTER TABLE loops ADD COLUMN IF NOT EXISTS mood VARCHAR(50)`);
    await pool.query(`ALTER TABLE loops ADD COLUMN IF NOT EXISTS instagram VARCHAR(255)`);
    await pool.query(`ALTER TABLE loops ADD COLUMN IF NOT EXISTS telegram VARCHAR(255)`);
    await pool.query(`ALTER TABLE loops ADD COLUMN IF NOT EXISTS cover_url VARCHAR(500)`);

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

    await pool.query(`
      CREATE TABLE IF NOT EXISTS artist_types (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        slug VARCHAR(100) UNIQUE NOT NULL,
        aliases JSONB DEFAULT '[]'::jsonb,
        sort_order INTEGER DEFAULT 100,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_artist_types_slug ON artist_types(slug);
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_artist_types_active ON artist_types(is_active, sort_order);
    `);

    const defaultArtists = [
      { name: 'Osamason', slug: 'osamason', aliases: ['osama', 'osamason type'], sort_order: 1 },
      { name: 'Che', slug: 'che', aliases: ['che type'], sort_order: 2 },
      { name: '2slimey', slug: '2slimey', aliases: ['slimey'], sort_order: 3 },
      { name: 'Ken Carson', slug: 'kencarson', aliases: ['ken', 'xman'], sort_order: 4 },
      { name: 'Yeat', slug: 'yeat', aliases: ['yeat type'], sort_order: 5 },
      { name: 'Playboi Carti', slug: 'carti', aliases: ['playboi carti', 'opium'], sort_order: 6 },
      { name: 'Destroy Lonely', slug: 'destroylonely', aliases: ['destroy lonely', 'lonely'], sort_order: 7 },
      { name: 'Nettspend', slug: 'nettspend', aliases: ['nett'], sort_order: 8 },
      { name: 'Lucki', slug: 'lucki', aliases: ['lucki type'], sort_order: 9 },
      { name: 'Thxsomch', slug: 'thxsomch', aliases: ['thx'], sort_order: 10 },
      { name: 'Tyloop', slug: 'tyloop', aliases: ['ty'], sort_order: 11 },
      { name: 'EsDeeKid', slug: 'esdeekid', aliases: ['esdee'], sort_order: 12 },
    ];

    for (const artist of defaultArtists) {
      await pool.query(
        `INSERT INTO artist_types (name, slug, aliases, sort_order, is_active)
         VALUES ($1, $2, $3::jsonb, $4, TRUE)
         ON CONFLICT (slug) DO NOTHING`,
        [artist.name, artist.slug, JSON.stringify(artist.aliases), artist.sort_order]
      );
    }

    // Таблица для подписок на артистов (онбординг / вкусовые теги)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS artist_subscriptions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        artist_hashtag VARCHAR(100) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, artist_hashtag)
      )
    `);

    // Подписки на лупмейкеров (user → user)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_follows (
        id SERIAL PRIMARY KEY,
        follower_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        following_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(follower_id, following_id),
        CHECK (follower_id <> following_id)
      )
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_user_follows_follower ON user_follows(follower_id)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_user_follows_following ON user_follows(following_id)
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
        preview_url_2 VARCHAR(500),
        archive_url VARCHAR(500),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        moderated_at TIMESTAMP,
        moderated_by INTEGER REFERENCES users(id),
        rejection_reason TEXT
      )
    `);

    await pool.query(`
      ALTER TABLE sound_packs 
      ADD COLUMN IF NOT EXISTS preview_url_2 VARCHAR(500),
      ADD COLUMN IF NOT EXISTS archive_url VARCHAR(500)
    `);
    await pool.query(`
      ALTER TABLE sound_packs
      ADD COLUMN IF NOT EXISTS discount_percent INTEGER NOT NULL DEFAULT 0
    `);
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'sound_packs_discount_percent_range'
        ) THEN
          ALTER TABLE sound_packs
          ADD CONSTRAINT sound_packs_discount_percent_range
          CHECK (discount_percent >= 0 AND discount_percent <= 100);
        END IF;
      END
      $$;
    `);
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

    // Таблица для заказов. Только расширяющие изменения: существующие заказы не удаляются.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id SERIAL PRIMARY KEY,
        pack_id INTEGER NOT NULL REFERENCES sound_packs(id) ON DELETE CASCADE,
        buyer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        seller_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        invoice_id VARCHAR(100) UNIQUE,
        amount DECIMAL(20,8),
        price INTEGER,
        currency VARCHAR(10),
        commission DECIMAL(20,8) DEFAULT 0,
        seller_earnings DECIMAL(20,8) DEFAULT 0,
        status VARCHAR(20) DEFAULT 'pending',
        paid_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS invoice_id VARCHAR(100)`);
    await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS amount DECIMAL(20,8)`);
    await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS price INTEGER`);
    await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS currency VARCHAR(10)`);
    await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS commission DECIMAL(20,8) DEFAULT 0`);
    await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS seller_earnings DECIMAL(20,8) DEFAULT 0`);
    await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS paid_at TIMESTAMP`);
    await pool.query(`
      UPDATE orders
      SET price = COALESCE(price, amount::INTEGER)
      WHERE price IS NULL AND amount IS NOT NULL
    `);
    await pool.query(`
      UPDATE orders
      SET amount = price
      WHERE amount IS NULL AND price IS NOT NULL
    `);
    await pool.query(`
      ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check
    `);
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'orders_status_allowed'
        ) THEN
          ALTER TABLE orders
          ADD CONSTRAINT orders_status_allowed
          CHECK (status IN ('pending', 'paid', 'completed', 'cancelled', 'refunded'));
        END IF;
      END
      $$;
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

    await pool.query(`ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS withdrawal_method VARCHAR(20) DEFAULT 'sbp'`);
    await pool.query(`ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS commission INTEGER DEFAULT 0`);

    // Таблица для пополнения (legacy, ручное начисление админом)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS top_ups (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        invoice_id VARCHAR(100) UNIQUE NOT NULL,
        amount DECIMAL(20,8) NOT NULL,
        currency VARCHAR(10) NOT NULL,
        status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed')),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_top_ups_user_id ON top_ups(user_id);
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_top_ups_invoice_id ON top_ups(invoice_id);
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_orders_buyer_id ON orders(buyer_id);
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_orders_pack_id ON orders(pack_id);
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_orders_seller_id ON orders(seller_id);
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_orders_invoice_id ON orders(invoice_id);
    `);

    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_invoice_id_unique
      ON orders(invoice_id)
      WHERE invoice_id IS NOT NULL;
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
    `);

    // Таблица для купленных паков пользователей
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_packs (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        pack_id INTEGER NOT NULL REFERENCES sound_packs(id) ON DELETE CASCADE,
        purchased_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, pack_id)
      )
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_user_packs_user_id ON user_packs(user_id);
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_user_packs_pack_id ON user_packs(pack_id);
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

    // LoopTok — short promo clips (TikTok-style feed)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS loop_tok_posts (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        loop_id INTEGER REFERENCES loops(id) ON DELETE SET NULL,
        title VARCHAR(255) NOT NULL,
        caption TEXT,
        filename VARCHAR(255) NOT NULL,
        original_name VARCHAR(255) NOT NULL,
        file_size INTEGER NOT NULL,
        duration DECIMAL(10,2),
        mime_type VARCHAR(100),
        bpm INTEGER,
        key VARCHAR(10),
        tags JSONB DEFAULT '[]'::jsonb,
        view_count INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS loop_tok_likes (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        post_id INTEGER NOT NULL REFERENCES loop_tok_posts(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, post_id)
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS loop_tok_comments (
        id SERIAL PRIMARY KEY,
        post_id INTEGER NOT NULL REFERENCES loop_tok_posts(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        body TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    try {
      await pool.query(`ALTER TABLE loop_tok_posts ADD COLUMN IF NOT EXISTS share_count INTEGER DEFAULT 0`);
    } catch {
      // ignore
    }

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_loop_tok_created ON loop_tok_posts(created_at DESC);
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_loop_tok_user ON loop_tok_posts(user_id);
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_loop_tok_likes_post ON loop_tok_likes(post_id);
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_loop_tok_comments_post ON loop_tok_comments(post_id, created_at DESC);
    `);

    // Paid subscriptions (Free/Pro/Elite) — separate from artist_subscriptions follows
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_paid_subscriptions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        plan_slug VARCHAR(20) NOT NULL,
        billing_period VARCHAR(20) NOT NULL DEFAULT 'monthly',
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        period_start TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        period_end TIMESTAMP NOT NULL,
        payment_id VARCHAR(255) UNIQUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS subscription_usage (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        period_start DATE NOT NULL,
        uploads_count INTEGER NOT NULL DEFAULT 0,
        downloads_count INTEGER NOT NULL DEFAULT 0,
        looptok_count INTEGER NOT NULL DEFAULT 0,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, period_start)
      )
    `);

    try {
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_theme JSONB DEFAULT '{}'::jsonb`);
    } catch {
      // ignore
    }

    // Staff roles: user | manager | admin
    try {
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'user'`);
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_banned BOOLEAN DEFAULT FALSE`);
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS ban_reason TEXT`);
      await pool.query(`UPDATE users SET role = 'user' WHERE role IS NULL OR role = ''`);
      // Owner always admin
      await pool.query(`UPDATE users SET role = 'admin' WHERE id = 824`);
    } catch (e) {
      console.warn('Role column seed skipped:', e);
    }

    // Optional staff bootstrap via env only (never hardcode passwords in source).
    // SEED_MANAGER_PASSWORD / SEED_ADMIN_PASSWORD — if set, create accounts if missing.
    // Rotate these env values after first boot; prefer creating staff via SQL/admin UI.
    try {
      const bcrypt = (await import('bcryptjs')).default;
      const seedStaff = async (opts: {
        username: string;
        email: string;
        role: 'manager' | 'admin';
        passwordEnv: string;
      }) => {
        const plain = process.env[opts.passwordEnv]?.trim();
        if (!plain || plain.length < 12) return;
        const existing = await pool.query(
          `SELECT id, role FROM users WHERE username = $1 OR email = $2 LIMIT 1`,
          [opts.username, opts.email],
        );
        if (existing.rows.length === 0) {
          const hash = await bcrypt.hash(plain, 12);
          await pool.query(
            `INSERT INTO users (username, email, password, role, email_verified, onboarding_completed)
             VALUES ($1, $2, $3, $4, TRUE, TRUE)`,
            [opts.username, opts.email, hash, opts.role],
          );
          console.log(`Seeded ${opts.role} account from env:`, opts.username);
        } else if (String(existing.rows[0].role).toLowerCase() !== opts.role) {
          await pool.query(`UPDATE users SET role = $1 WHERE id = $2`, [
            opts.role,
            existing.rows[0].id,
          ]);
        }
      };

      await seedStaff({
        username: process.env.SEED_MANAGER_USERNAME || 'seo_manager',
        email: process.env.SEED_MANAGER_EMAIL || 'seo@loopera.ru',
        role: 'manager',
        passwordEnv: 'SEED_MANAGER_PASSWORD',
      });
      await seedStaff({
        username: process.env.SEED_ADMIN_USERNAME || 'loopera_admin',
        email: process.env.SEED_ADMIN_EMAIL || 'admin@loopera.com',
        role: 'admin',
        passwordEnv: 'SEED_ADMIN_PASSWORD',
      });
    } catch (e) {
      console.warn('Optional staff seed skipped:', e);
    }

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_user_paid_subs_user ON user_paid_subscriptions(user_id, status);
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_subscription_usage_user ON subscription_usage(user_id, period_start);
    `);

    // Ensure platform admin has long Elite + cinematic theme
    try {
      const adminId = 824;
      const adminUser = await pool.query(`SELECT id, profile_theme FROM users WHERE id = $1`, [adminId]);
      if (adminUser.rows.length > 0) {
        const hasActive = await pool.query(
          `SELECT id FROM user_paid_subscriptions
           WHERE user_id = $1 AND status = 'active' AND period_end > NOW()
           LIMIT 1`,
          [adminId],
        );
        if (hasActive.rows.length === 0) {
          await pool.query(
            `UPDATE user_paid_subscriptions SET status = 'expired', updated_at = CURRENT_TIMESTAMP
             WHERE user_id = $1 AND status = 'active'`,
            [adminId],
          );
          const start = new Date();
          const end = new Date(start.getTime() + 3650 * 24 * 60 * 60 * 1000);
          await pool.query(
            `INSERT INTO user_paid_subscriptions (
              user_id, plan_slug, billing_period, status, period_start, period_end, payment_id
            ) VALUES ($1, 'business', 'yearly', 'active', $2, $3, $4)
            ON CONFLICT (payment_id) DO NOTHING`,
            [adminId, start.toISOString(), end.toISOString(), `admin_seed_${adminId}`],
          );
        }
        const theme = adminUser.rows[0].profile_theme;
        const empty =
          !theme ||
          (typeof theme === 'object' && Object.keys(theme).length === 0);
        if (empty) {
          await pool.query(
            `UPDATE users SET profile_theme = $1::jsonb WHERE id = $2`,
            [
              JSON.stringify({
                accent_color: '#e8c36a',
                layout: 'cinematic',
                badge_style: 'business',
                show_stats: true,
                bio: 'Loopera · founder',
              }),
              adminId,
            ],
          );
        }
      }
    } catch (e) {
      console.warn('Admin elite seed skipped:', e);
    }

    await pool.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id SERIAL PRIMARY KEY,
        title VARCHAR(200) NOT NULL,
        body TEXT NOT NULL,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        is_active BOOLEAN DEFAULT TRUE
      )
    `);
    await pool.query(`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS target_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE`);
    await pool.query(`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS kind VARCHAR(40) DEFAULT 'announcement'`);
    await pool.query(`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS link VARCHAR(500)`);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_notifications_target
      ON notifications(target_user_id, created_at DESC)
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS loop_comment_likes (
        id SERIAL PRIMARY KEY,
        comment_id INTEGER NOT NULL REFERENCES loop_comments(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(comment_id, user_id)
      )
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_loop_comment_likes_comment
      ON loop_comment_likes(comment_id)
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS notification_reads (
        notification_id INTEGER NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        read_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (notification_id, user_id)
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS loop_downloads (
        id SERIAL PRIMARY KEY,
        loop_id INTEGER NOT NULL REFERENCES loops(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_loop_downloads_created_at
      ON loop_downloads(created_at DESC)
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_loop_downloads_loop_id
      ON loop_downloads(loop_id)
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS loop_plays (
        id SERIAL PRIMARY KEY,
        loop_id INTEGER NOT NULL REFERENCES loops(id) ON DELETE CASCADE,
        listener_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        listened_seconds REAL NOT NULL DEFAULT 0,
        duration_seconds REAL,
        completed BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_loop_plays_loop_id
      ON loop_plays(loop_id, created_at DESC)
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_loop_plays_created_at
      ON loop_plays(created_at DESC)
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS loop_comments (
        id SERIAL PRIMARY KEY,
        loop_id INTEGER NOT NULL REFERENCES loops(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        body TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_loop_comments_loop_id
      ON loop_comments(loop_id, created_at DESC)
    `);

    await pool.query(`CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_notification_reads_user ON notification_reads(user_id)`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS home_posts (
        id SERIAL PRIMARY KEY,
        kind VARCHAR(20) NOT NULL DEFAULT 'news',
        title VARCHAR(200) NOT NULL,
        body TEXT NOT NULL,
        cta_label VARCHAR(80),
        cta_url VARCHAR(500),
        image_url VARCHAR(500),
        is_active BOOLEAN DEFAULT TRUE,
        sort_order INTEGER DEFAULT 0,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_home_posts_active
      ON home_posts(is_active, sort_order DESC, created_at DESC)
    `);

    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Database initialization error:', error);
    throw error;
  }
};

export default pool;
