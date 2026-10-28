import pool from '../config/database.js';

/** Rubles charged per feed impression */
export const LOOP_AD_IMPRESSION_COST = 2;
/** Minimum campaign budget in rubles */
export const LOOP_AD_MIN_BUDGET = 50;

export type LoopAdRow = {
  id: number;
  loop_id: number;
  user_id: number;
  budget_total: number;
  budget_spent: number;
  status: string;
  impressions: number;
  created_at: string;
};

export async function ensureLoopAdsTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS loop_ads (
      id SERIAL PRIMARY KEY,
      loop_id INTEGER NOT NULL REFERENCES loops(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      budget_total INTEGER NOT NULL CHECK (budget_total > 0),
      budget_spent INTEGER NOT NULL DEFAULT 0 CHECK (budget_spent >= 0),
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      impressions INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_loop_ads_active
    ON loop_ads(status, budget_spent, budget_total)
    WHERE status = 'active'
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_loop_ads_user ON loop_ads(user_id, created_at DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_loop_ads_loop ON loop_ads(loop_id)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS loop_ad_impressions (
      id SERIAL PRIMARY KEY,
      ad_id INTEGER NOT NULL REFERENCES loop_ads(id) ON DELETE CASCADE,
      viewer_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      cost INTEGER NOT NULL DEFAULT ${LOOP_AD_IMPRESSION_COST},
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_loop_ad_impressions_ad
    ON loop_ad_impressions(ad_id, created_at DESC)
  `);
}

export async function createLoopAd(opts: {
  userId: number;
  loopId: number;
  budget: number;
}): Promise<LoopAdRow> {
  const budget = Math.floor(Number(opts.budget));
  if (!Number.isFinite(budget) || budget < LOOP_AD_MIN_BUDGET) {
    throw Object.assign(new Error(`Минимальный бюджет — ${LOOP_AD_MIN_BUDGET} ₽`), {
      status: 400,
    });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const loopRes = await client.query(
      `SELECT id, user_id, title FROM loops WHERE id = $1 FOR SHARE`,
      [opts.loopId],
    );
    if (loopRes.rows.length === 0) {
      throw Object.assign(new Error('Луп не найден'), { status: 404 });
    }
    if (Number(loopRes.rows[0].user_id) !== opts.userId) {
      throw Object.assign(new Error('Можно рекламировать только свои лупы'), { status: 403 });
    }

    await client.query(
      `INSERT INTO user_balance (user_id, available_balance, total_earned)
       VALUES ($1, 0, 0)
       ON CONFLICT (user_id) DO NOTHING`,
      [opts.userId],
    );

    const bal = await client.query(
      `UPDATE user_balance
       SET available_balance = available_balance - $1,
           updated_at = NOW()
       WHERE user_id = $2 AND available_balance >= $1
       RETURNING available_balance`,
      [budget, opts.userId],
    );
    if (bal.rows.length === 0) {
      throw Object.assign(new Error('Недостаточно средств на балансе'), { status: 400 });
    }

    // Pause other active ads for this loop (one active campaign at a time)
    await client.query(
      `UPDATE loop_ads SET status = 'paused', updated_at = NOW()
       WHERE loop_id = $1 AND user_id = $2 AND status = 'active'`,
      [opts.loopId, opts.userId],
    );

    const inserted = await client.query(
      `INSERT INTO loop_ads (loop_id, user_id, budget_total, budget_spent, status)
       VALUES ($1, $2, $3, 0, 'active')
       RETURNING *`,
      [opts.loopId, opts.userId, budget],
    );

    await client.query('COMMIT');
    return inserted.rows[0] as LoopAdRow;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function listMyLoopAds(userId: number) {
  const result = await pool.query(
    `SELECT a.*, l.title AS loop_title, l.cover_url
     FROM loop_ads a
     JOIN loops l ON l.id = a.loop_id
     WHERE a.user_id = $1
     ORDER BY a.created_at DESC
     LIMIT 50`,
    [userId],
  );
  return result.rows.map((row) => ({
    ...row,
    remaining: Math.max(0, Number(row.budget_total) - Number(row.budget_spent)),
    cost_per_impression: LOOP_AD_IMPRESSION_COST,
  }));
}

export async function setLoopAdStatus(userId: number, adId: number, status: 'active' | 'paused') {
  const result = await pool.query(
    `UPDATE loop_ads
     SET status = $1, updated_at = NOW()
     WHERE id = $2 AND user_id = $3
       AND budget_spent < budget_total
     RETURNING *`,
    [status, adId, userId],
  );
  if (result.rows.length === 0) {
    throw Object.assign(new Error('Кампания не найдена или бюджет исчерпан'), { status: 404 });
  }
  return result.rows[0];
}

/** Pick one active sponsored loop not already in excludeIds */
export async function pickSponsoredLoop(excludeIds: number[] = []) {
  const result = await pool.query(
    `SELECT a.id AS ad_id, a.loop_id,
            l.id, l.title, l.filename, l.original_name, l.file_size, l.duration,
            l.bpm, l.key, l.genre, l.mood, l.tags, l.created_at, l.updated_at,
            l.instagram, l.telegram, l.cover_url, l.user_id,
            u.username AS author, u.id AS author_id,
            u.profile_theme AS author_profile_theme,
            COALESCE((
              SELECT ups.plan_slug FROM user_paid_subscriptions ups
              WHERE ups.user_id = u.id AND ups.status = 'active' AND ups.period_end > NOW()
              ORDER BY ups.period_end DESC LIMIT 1
            ), CASE WHEN u.id = 824 THEN 'business' ELSE 'free' END) AS author_plan
     FROM loop_ads a
     JOIN loops l ON l.id = a.loop_id
     JOIN users u ON u.id = l.user_id
     WHERE a.status = 'active'
       AND a.budget_spent + $1 <= a.budget_total
       AND COALESCE(u.is_banned, false) = false
       AND (
         cardinality(COALESCE($2::int[], ARRAY[]::int[])) = 0
         OR NOT (l.id = ANY($2::int[]))
       )
     ORDER BY random()
     LIMIT 1`,
    [LOOP_AD_IMPRESSION_COST, excludeIds],
  );
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return {
    ...row,
    is_ad: true,
    ad_id: row.ad_id,
  };
}

export async function chargeAdImpression(adId: number, viewerId?: number | null) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const updated = await client.query(
      `UPDATE loop_ads
       SET budget_spent = budget_spent + $1,
           impressions = impressions + 1,
           status = CASE
             WHEN budget_spent + $1 >= budget_total THEN 'exhausted'
             ELSE status
           END,
           updated_at = NOW()
       WHERE id = $2
         AND status = 'active'
         AND budget_spent + $1 <= budget_total
       RETURNING id`,
      [LOOP_AD_IMPRESSION_COST, adId],
    );
    if (updated.rows.length === 0) {
      await client.query('ROLLBACK');
      return false;
    }
    await client.query(
      `INSERT INTO loop_ad_impressions (ad_id, viewer_id, cost)
       VALUES ($1, $2, $3)`,
      [adId, viewerId || null, LOOP_AD_IMPRESSION_COST],
    );
    await client.query('COMMIT');
    return true;
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('chargeAdImpression error:', err);
    return false;
  } finally {
    client.release();
  }
}

/** Insert a sponsored loop into a feed page (~1 slot). */
export async function injectSponsoredIntoLoops(
  loops: any[],
  opts?: { viewerId?: number | null; chance?: number },
) {
  const chance = opts?.chance ?? 0.55;
  if (!loops.length || Math.random() > chance) return loops;

  const exclude = loops.map((l) => Number(l.id)).filter(Number.isFinite);
  const sponsored = await pickSponsoredLoop(exclude);
  if (!sponsored) return loops;

  const insertAt = Math.min(
    loops.length,
    Math.max(1, Math.floor(Math.random() * Math.min(loops.length, 8))),
  );
  const next = [...loops];
  next.splice(insertAt, 0, sponsored);

  void chargeAdImpression(Number(sponsored.ad_id), opts?.viewerId);

  return next;
}
