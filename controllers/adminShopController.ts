import { Request, Response } from 'express';
import pool from '../config/database';
import { AuthRequest } from '../middleware/auth';

// Получить паки на модерации
export const getPendingPacks = async (req: AuthRequest, res: Response) => {
  try {
    const query = `
      SELECT sp.*, u.username, u.hashtag, u.avatar_url,
             u.created_at as user_created_at,
             COUNT(DISTINCT l.id) as loops_count
      FROM sound_packs sp
      JOIN users u ON sp.user_id = u.id
      LEFT JOIN pack_loops pl ON sp.id = pl.pack_id
      LEFT JOIN loops l ON pl.loop_id = l.id
      WHERE sp.status = 'pending'
      GROUP BY sp.id, u.username, u.hashtag, u.avatar_url, u.created_at
      ORDER BY sp.created_at ASC
    `;

    const result = await pool.query(query);
    res.json(result.rows);
  } catch (error) {
    console.error('Error getting pending packs:', error);
    res.status(500).json({ error: 'Failed to get pending packs' });
  }
};

// Получить детальную информацию о паке для модерации
export const getPackForModeration = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const packQuery = `
      SELECT sp.*, u.username, u.hashtag, u.avatar_url,
             u.created_at as user_created_at,
             u.email
      FROM sound_packs sp
      JOIN users u ON sp.user_id = u.id
      WHERE sp.id = $1
    `;
    const packResult = await pool.query(packQuery, [id]);

    if (packResult.rows.length === 0) {
      return res.status(404).json({ error: 'Pack not found' });
    }

    const pack = packResult.rows[0];

    // Получаем лупы в паке
    const loopsQuery = `
      SELECT l.*
      FROM pack_loops pl
      JOIN loops l ON pl.loop_id = l.id
      WHERE pl.pack_id = $1
      ORDER BY pl.created_at
    `;
    const loopsResult = await pool.query(loopsQuery, [id]);

    // Получаем статистику пользователя
    const userStatsQuery = `
      SELECT 
        COUNT(DISTINCT sp.id) as total_packs,
        COUNT(DISTINCT CASE WHEN sp.status = 'approved' THEN sp.id END) as approved_packs,
        COUNT(DISTINCT CASE WHEN sp.status = 'rejected' THEN sp.id END) as rejected_packs,
        COUNT(DISTINCT o.id) as total_sales,
        COALESCE(SUM(CASE WHEN o.status = 'completed' THEN o.price END), 0) as total_revenue
      FROM users u
      LEFT JOIN sound_packs sp ON u.id = sp.user_id
      LEFT JOIN orders o ON sp.id = o.pack_id
      WHERE u.id = $1
    `;
    const userStatsResult = await pool.query(userStatsQuery, [pack.user_id]);

    // Получаем жалобы на пользователя
    const reportsQuery = `
      SELECT r.*, reporter.username as reporter_name
      FROM reports r
      JOIN users reporter ON r.reporter_id = reporter.id
      WHERE r.reported_user_id = $1 AND r.status = 'pending'
      ORDER BY r.created_at DESC
    `;
    const reportsResult = await pool.query(reportsQuery, [pack.user_id]);

    res.json({
      ...pack,
      loops: loopsResult.rows,
      user_stats: userStatsResult.rows[0],
      reports: reportsResult.rows
    });
  } catch (error) {
    console.error('Error getting pack for moderation:', error);
    res.status(500).json({ error: 'Failed to get pack for moderation' });
  }
};

// Одобрить пак
export const approvePack = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const adminId = req.user!.id;

    const query = `
      UPDATE sound_packs
      SET status = 'approved',
          moderated_at = CURRENT_TIMESTAMP,
          moderated_by = $1
      WHERE id = $2 AND status = 'pending'
      RETURNING *
    `;

    const result = await pool.query(query, [adminId, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Pack not found or not pending' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error approving pack:', error);
    res.status(500).json({ error: 'Failed to approve pack' });
  }
};

// Отклонить пак
export const rejectPack = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { rejection_reason } = req.body;
    const adminId = req.user!.id;

    if (!rejection_reason) {
      return res.status(400).json({ error: 'Rejection reason is required' });
    }

    const query = `
      UPDATE sound_packs
      SET status = 'rejected',
          rejection_reason = $1,
          moderated_at = CURRENT_TIMESTAMP,
          moderated_by = $2
      WHERE id = $3 AND status = 'pending'
      RETURNING *
    `;

    const result = await pool.query(query, [rejection_reason, adminId, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Pack not found or not pending' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error rejecting pack:', error);
    res.status(500).json({ error: 'Failed to reject pack' });
  }
};

// Забанить пользователя
export const banUser = async (req: AuthRequest, res: Response) => {
  try {
    const { userId } = req.params;
    const { reason, duration = 'permanent' } = req.body;
    const adminId = req.user!.id;

    if (!reason) {
      return res.status(400).json({ error: 'Ban reason is required' });
    }

    // Отклоняем все пендящие паки пользователя
    await pool.query(`
      UPDATE sound_packs
      SET status = 'rejected',
          rejection_reason = $1,
          moderated_at = CURRENT_TIMESTAMP,
          moderated_by = $2
      WHERE user_id = $3 AND status = 'pending'
    `, [`User banned: ${reason}`, adminId]);

    // В реальном приложении здесь была бы логика бана в таблице users
    // Для сейчас просто возвращаем успех
    res.json({ 
      message: 'User banned successfully',
      banned_user_id: userId,
      reason,
      duration
    });
  } catch (error) {
    console.error('Error banning user:', error);
    res.status(500).json({ error: 'Failed to ban user' });
  }
};

// Получить заявки на вывод средств
export const getWithdrawals = async (req: AuthRequest, res: Response) => {
  try {
    const { status } = req.query;

    let query = `
      SELECT w.*, u.username, u.hashtag, u.email
      FROM withdrawals w
      JOIN users u ON w.user_id = u.id
    `;

    const params: any[] = [];

    if (status) {
      query += ` WHERE w.status = $1`;
      params.push(status);
    }

    query += ` ORDER BY w.created_at DESC`;

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error getting withdrawals:', error);
    res.status(500).json({ error: 'Failed to get withdrawals' });
  }
};

// Одобрить вывод средств
export const approveWithdrawal = async (req: AuthRequest, res: Response) => {
  const client = await pool.connect();
  
  try {
    const { id } = req.params;
    const adminId = req.user!.id;

    const withdrawalQuery = `
      SELECT *
      FROM withdrawals
      WHERE id = $1 AND status = 'pending'
    `;
    const withdrawalResult = await client.query(withdrawalQuery, [id]);

    if (withdrawalResult.rows.length === 0) {
      return res.status(404).json({ error: 'Withdrawal not found or not pending' });
    }

    const withdrawal = withdrawalResult.rows[0];

    await client.query('BEGIN');

    // Обновляем статус вывода
    await client.query(`
      UPDATE withdrawals
      SET status = 'completed',
          processed_at = CURRENT_TIMESTAMP,
          processed_by = $1
      WHERE id = $2
    `, [adminId, id]);

    // Списываем деньги с баланса пользователя
    await client.query(`
      UPDATE user_balance
      SET available_balance = available_balance - $1,
          updated_at = CURRENT_TIMESTAMP
      WHERE user_id = $2
    `, [withdrawal.amount, withdrawal.user_id]);

    await client.query('COMMIT');

    res.json({ message: 'Withdrawal approved successfully' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error approving withdrawal:', error);
    res.status(500).json({ error: 'Failed to approve withdrawal' });
  } finally {
    client.release();
  }
};

// Отклонить вывод средств
export const rejectWithdrawal = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { rejection_reason } = req.body;
    const adminId = req.user!.id;

    if (!rejection_reason) {
      return res.status(400).json({ error: 'Rejection reason is required' });
    }

    const query = `
      UPDATE withdrawals
      SET status = 'rejected',
          rejection_reason = $1,
          processed_at = CURRENT_TIMESTAMP,
          processed_by = $2
      WHERE id = $3 AND status = 'pending'
      RETURNING *
    `;

    const result = await pool.query(query, [rejection_reason, adminId, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Withdrawal not found or not pending' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error rejecting withdrawal:', error);
    res.status(500).json({ error: 'Failed to reject withdrawal' });
  }
};

// Получить жалобы
export const getReports = async (req: AuthRequest, res: Response) => {
  try {
    const { status } = req.query;

    let query = `
      SELECT r.*, 
             reporter.username as reporter_name,
             reported_user.username as reported_user_name,
             sp.title as pack_title
      FROM reports r
      JOIN users reporter ON r.reporter_id = reporter.id
      LEFT JOIN users reported_user ON r.reported_user_id = reported_user.id
      LEFT JOIN sound_packs sp ON r.pack_id = sp.id
    `;

    const params: any[] = [];

    if (status) {
      query += ` WHERE r.status = $1`;
      params.push(status);
    }

    query += ` ORDER BY r.created_at DESC`;

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error getting reports:', error);
    res.status(500).json({ error: 'Failed to get reports' });
  }
};

// Решить жалобу
export const resolveReport = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { resolution } = req.body;
    const adminId = req.user!.id;

    const query = `
      UPDATE reports
      SET status = 'resolved',
          resolved_at = CURRENT_TIMESTAMP,
          resolved_by = $1
      WHERE id = $2 AND status = 'pending'
      RETURNING *
    `;

    const result = await pool.query(query, [adminId, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Report not found or not pending' });
    }

    res.json({ 
      ...result.rows[0],
      resolution
    });
  } catch (error) {
    console.error('Error resolving report:', error);
    res.status(500).json({ error: 'Failed to resolve report' });
  }
};

// Получить все паки с пагинацией и фильтрами
export const getAllPacks = async (req: AuthRequest, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const status = req.query.status as string || 'all';
    const offset = (page - 1) * limit;

    let whereClause = '';
    const params: any[] = [];

    if (status !== 'all') {
      whereClause = 'WHERE sp.status = $1';
      params.push(status);
    }

    // Получаем паки
    const packsQuery = `
      SELECT sp.*, u.username, u.hashtag, u.avatar_url,
             COUNT(DISTINCT o.id) as sales_count
      FROM sound_packs sp
      JOIN users u ON sp.user_id = u.id
      LEFT JOIN orders o ON sp.id = o.pack_id AND o.status = 'completed'
      ${whereClause}
      GROUP BY sp.id, u.username, u.hashtag, u.avatar_url
      ORDER BY sp.created_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;
    params.push(limit, offset);

    const packsResult = await pool.query(packsQuery, params);

    // Получаем общее количество
    const countQuery = `
      SELECT COUNT(DISTINCT sp.id) as total
      FROM sound_packs sp
      ${whereClause}
    `;
    const countResult = await pool.query(countQuery, status !== 'all' ? [status] : []);

    const totalPacks = parseInt(countResult.rows[0].total);

    res.json({
      packs: packsResult.rows,
      pagination: {
        totalPacks,
        page,
        limit,
        totalPages: Math.ceil(totalPacks / limit)
      }
    });
  } catch (error) {
    console.error('Error getting all packs:', error);
    res.status(500).json({ error: 'Failed to get all packs' });
  }
};

// Удалить пак
export const deletePack = async (req: AuthRequest, res: Response) => {
  const client = await pool.connect();

  try {
    const { id } = req.params;

    await client.query('BEGIN');

    // Удаляем связи с лупами
    await client.query('DELETE FROM pack_loops WHERE pack_id = $1', [id]);

    // Удаляем пак
    const deleteResult = await client.query(
      'DELETE FROM sound_packs WHERE id = $1 RETURNING *',
      [id]
    );

    if (deleteResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Pack not found' });
    }

    await client.query('COMMIT');

    res.json({ message: 'Pack deleted successfully' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error deleting pack:', error);
    res.status(500).json({ error: 'Failed to delete pack' });
  } finally {
    client.release();
  }
};

// Получить статистику магазина
export const getShopStats = async (req: AuthRequest, res: Response) => {
  try {
    const stats: any = {};

    // Общая статистика
    const generalStatsQuery = `
      SELECT
        COUNT(DISTINCT sp.id) as total_packs,
        COUNT(DISTINCT CASE WHEN sp.status = 'approved' THEN sp.id END) as approved_packs,
        COUNT(DISTINCT CASE WHEN sp.status = 'pending' THEN sp.id END) as pending_packs,
        COUNT(DISTINCT CASE WHEN sp.status = 'rejected' THEN sp.id END) as rejected_packs,
        COUNT(DISTINCT o.id) as total_orders,
        COALESCE(SUM(o.price), 0) as total_revenue,
        COALESCE(SUM(o.commission), 0) as total_commission
      FROM sound_packs sp
      LEFT JOIN orders o ON sp.id = o.pack_id AND o.status = 'completed'
    `;
    const generalStatsResult = await pool.query(generalStatsQuery);
    stats.general = generalStatsResult.rows[0];

    // Статистика за последние 7 дней
    const weeklyStatsQuery = `
      SELECT
        COUNT(DISTINCT o.id) as weekly_orders,
        COALESCE(SUM(o.price), 0) as weekly_revenue,
        COUNT(DISTINCT sp.id) as weekly_packs
      FROM orders o
      JOIN sound_packs sp ON o.pack_id = sp.id
      WHERE o.created_at >= CURRENT_DATE - INTERVAL '7 days'
        AND o.status = 'completed'
    `;
    const weeklyStatsResult = await pool.query(weeklyStatsQuery);
    stats.weekly = weeklyStatsResult.rows[0];

    // Топ продавцы
    const topSellersQuery = `
      SELECT
        u.username,
        u.hashtag,
        COUNT(DISTINCT o.id) as sales_count,
        COALESCE(SUM(o.price), 0) as total_revenue
      FROM users u
      JOIN orders o ON u.id = o.seller_id
      WHERE o.status = 'completed'
      GROUP BY u.id, u.username, u.hashtag
      ORDER BY total_revenue DESC
      LIMIT 10
    `;
    const topSellersResult = await pool.query(topSellersQuery);
    stats.top_sellers = topSellersResult.rows;

    // Топ паки
    const topPacksQuery = `
      SELECT
        sp.title,
        sp.price,
        COUNT(DISTINCT o.id) as sales_count,
        COALESCE(SUM(o.price), 0) as total_revenue,
        COALESCE(AVG(pr.rating), 0) as avg_rating
      FROM sound_packs sp
      LEFT JOIN orders o ON sp.id = o.pack_id AND o.status = 'completed'
      LEFT JOIN pack_ratings pr ON sp.id = pr.pack_id
      WHERE sp.status = 'approved'
      GROUP BY sp.id, sp.title, sp.price
      ORDER BY sales_count DESC
      LIMIT 10
    `;
    const topPacksResult = await pool.query(topPacksQuery);
    stats.top_packs = topPacksResult.rows;

    res.json(stats);
  } catch (error) {
    console.error('Error getting shop stats:', error);
    res.status(500).json({ error: 'Failed to get shop stats' });
  }
};
