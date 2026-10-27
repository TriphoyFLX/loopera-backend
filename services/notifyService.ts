import pool from '../config/database.js';

export type NotifyKind =
  | 'purchase'
  | 'sale'
  | 'new_loop'
  | 'follow'
  | 'message'
  | 'announcement';

/** Create a personal notification for a user (best-effort, never throws to callers). */
export async function notifyUser(opts: {
  userId: number;
  kind: NotifyKind;
  title: string;
  body: string;
  link?: string | null;
  createdBy?: number | null;
}): Promise<void> {
  try {
    if (!opts.userId || !opts.title) return;
    await pool.query(
      `INSERT INTO notifications (title, body, created_by, is_active, target_user_id, kind, link)
       VALUES ($1, $2, $3, TRUE, $4, $5, $6)`,
      [
        opts.title.slice(0, 200),
        opts.body.slice(0, 2000),
        opts.createdBy ?? null,
        opts.userId,
        opts.kind,
        opts.link ?? null,
      ],
    );
  } catch (err) {
    console.warn('notifyUser failed:', err);
  }
}

/** Notify followers that a loopmaker posted a new loop (cap 200). */
export async function notifyFollowersNewLoop(opts: {
  authorId: number;
  authorName: string;
  loopId: number;
  loopTitle: string;
}): Promise<void> {
  try {
    const followers = await pool.query(
      `SELECT follower_id FROM user_follows WHERE following_id = $1 LIMIT 200`,
      [opts.authorId],
    );
    for (const row of followers.rows) {
      await notifyUser({
        userId: row.follower_id,
        kind: 'new_loop',
        title: 'Новый луп',
        body: `${opts.authorName} выложил(а) «${opts.loopTitle}»`,
        link: `/loops/${opts.loopId}`,
        createdBy: opts.authorId,
      });
    }
  } catch (err) {
    console.warn('notifyFollowersNewLoop failed:', err);
  }
}
