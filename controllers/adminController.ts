import type { Request, Response } from 'express';
import pool from '../config/database.ts';

export const getAdminStats = async (req: Request, res: Response) => {
  try {
    const queries = {
      totalUsers: 'SELECT COUNT(*) as count FROM users',
      totalLoops: 'SELECT COUNT(*) as count FROM loops',
      totalStorage: 'SELECT SUM(file_size) as total FROM loops',
      recentUsers: `
        SELECT id, username, email, created_at 
        FROM users 
        ORDER BY created_at DESC 
        LIMIT 10
      `,
      recentLoops: `
        SELECT l.id, l.title, l.filename, l.file_size, l.created_at,
               u.username as artist_name
        FROM loops l
        JOIN users u ON l.user_id = u.id
        ORDER BY l.created_at DESC
        LIMIT 10
      `,
      topUsers: `
        SELECT u.id, u.username, u.email, u.created_at,
               COUNT(l.id) as loop_count,
               COALESCE(SUM(l.file_size), 0) as total_size
        FROM users u
        LEFT JOIN loops l ON u.id = l.user_id
        GROUP BY u.id, u.username, u.email, u.created_at
        ORDER BY loop_count DESC
        LIMIT 10
      `,
      storageByGenre: `
        SELECT genre, COUNT(*) as count, SUM(file_size) as total_size
        FROM loops
        WHERE genre IS NOT NULL
        GROUP BY genre
        ORDER BY count DESC
      `
    };

    const [
      totalUsersResult,
      totalLoopsResult,
      totalStorageResult,
      recentUsersResult,
      recentLoopsResult,
      topUsersResult,
      storageByGenreResult
    ] = await Promise.all([
      pool.query(queries.totalUsers),
      pool.query(queries.totalLoops),
      pool.query(queries.totalStorage),
      pool.query(queries.recentUsers),
      pool.query(queries.recentLoops),
      pool.query(queries.topUsers),
      pool.query(queries.storageByGenre)
    ]);

    const stats = {
      overview: {
        totalUsers: parseInt(totalUsersResult.rows[0].count),
        totalLoops: parseInt(totalLoopsResult.rows[0].count),
        totalStorage: parseInt(totalStorageResult.rows[0].total) || 0
      },
      recentUsers: recentUsersResult.rows,
      recentLoops: recentLoopsResult.rows,
      topUsers: topUsersResult.rows,
      storageByGenre: storageByGenreResult.rows
    };

    res.json(stats);
  } catch (error) {
    console.error('Error fetching admin stats:', error);
    res.status(500).json({ error: 'Failed to fetch admin statistics' });
  }
};

export const getAllUsers = async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;

    const usersQuery = `
      SELECT id, username, email, created_at,
             (SELECT COUNT(*) FROM loops WHERE user_id = users.id) as loop_count
      FROM users
      ORDER BY created_at DESC
      LIMIT $1 OFFSET $2
    `;

    const countQuery = 'SELECT COUNT(*) as total FROM users';

    const [usersResult, countResult] = await Promise.all([
      pool.query(usersQuery, [limit, offset]),
      pool.query(countQuery)
    ]);

    const totalUsers = parseInt(countResult.rows[0].total);
    const totalPages = Math.ceil(totalUsers / limit);

    res.json({
      users: usersResult.rows,
      pagination: {
        currentPage: page,
        totalPages,
        totalUsers,
        hasNext: page < totalPages,
        hasPrev: page > 1
      }
    });
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
};

export const getAllLoops = async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;

    const loopsQuery = `
      SELECT l.id, l.title, l.filename, l.file_size, l.bpm, l.key, 
             l.genre, l.created_at, l.duration,
             u.username as artist_name, u.email as artist_email
      FROM loops l
      JOIN users u ON l.user_id = u.id
      ORDER BY l.created_at DESC
      LIMIT $1 OFFSET $2
    `;

    const countQuery = 'SELECT COUNT(*) as total FROM loops';

    const [loopsResult, countResult] = await Promise.all([
      pool.query(loopsQuery, [limit, offset]),
      pool.query(countQuery)
    ]);

    const totalLoops = parseInt(countResult.rows[0].total);
    const totalPages = Math.ceil(totalLoops / limit);

    res.json({
      loops: loopsResult.rows,
      pagination: {
        currentPage: page,
        totalPages,
        totalLoops,
        hasNext: page < totalPages,
        hasPrev: page > 1
      }
    });
  } catch (error) {
    console.error('Error fetching loops:', error);
    res.status(500).json({ error: 'Failed to fetch loops' });
  }
};

export const deleteLoop = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    // Проверяем существование лупа
    const loopCheck = await pool.query('SELECT * FROM loops WHERE id = $1', [id]);
    
    if (loopCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Loop not found' });
    }

    // Удаляем луп и связанные данные
    await pool.query('DELETE FROM loop_likes WHERE loop_id = $1', [id]);
    await pool.query('DELETE FROM loops WHERE id = $1', [id]);

    res.json({ message: 'Loop deleted successfully' });
  } catch (error) {
    console.error('Error deleting loop:', error);
    res.status(500).json({ error: 'Failed to delete loop' });
  }
};

export const banUser = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    
    // Добавляем колонку is_banned если ее нет
    await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS is_banned BOOLEAN DEFAULT FALSE');
    await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS ban_reason TEXT');
    
    // Баним пользователя
    await pool.query(
      'UPDATE users SET is_banned = TRUE, ban_reason = $1 WHERE id = $2',
      [reason, id]
    );

    res.json({ message: 'User banned successfully' });
  } catch (error) {
    console.error('Error banning user:', error);
    res.status(500).json({ error: 'Failed to ban user' });
  }
};

export const unbanUser = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    await pool.query(
      'UPDATE users SET is_banned = FALSE, ban_reason = NULL WHERE id = $1',
      [id]
    );

    res.json({ message: 'User unbanned successfully' });
  } catch (error) {
    console.error('Error unbanning user:', error);
    res.status(500).json({ error: 'Failed to unban user' });
  }
};
