import { Request, Response } from 'express';
import pool from '../config/database.js';
import path from 'path';
import fs from 'fs';

export const createBeat = async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    const { title, loop_id, description, tags, bpm, key, genre, is_collaboration, collaboration_credit } = req.body;
    const file = req.file;
    const user_id = (req as any).userId;

    if (!file) {
      return res.status(400).json({ error: 'Audio file is required' });
    }

    if (!title) {
      return res.status(400).json({ error: 'Title is required' });
    }

    await client.query('BEGIN');

    const result = await client.query(
      `INSERT INTO beats (title, filename, file_size, user_id, loop_id, description, tags, bpm, key, genre, is_collaboration, collaboration_credit)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [
        title,
        file.filename,
        file.size,
        user_id,
        loop_id || null,
        description || null,
        tags ? JSON.stringify(tags) : '[]',
        bpm || null,
        key || null,
        genre || null,
        is_collaboration || false,
        collaboration_credit || null
      ]
    );

    await client.query('COMMIT');

    const beat = result.rows[0];
    
    // Get user info
    const userResult = await client.query('SELECT username FROM users WHERE id = $1', [user_id]);
    beat.author = userResult.rows[0]?.username;

    // Get loop info if collaboration
    if (loop_id) {
      const loopResult = await client.query(
        'SELECT title, user_id FROM loops WHERE id = $1',
        [loop_id]
      );
      if (loopResult.rows.length > 0) {
        const loopAuthorResult = await client.query(
          'SELECT username FROM users WHERE id = $1',
          [loopResult.rows[0].user_id]
        );
        beat.loop = {
          title: loopResult.rows[0].title,
          author: loopAuthorResult.rows[0]?.username
        };
      }
    }

    res.status(201).json({ beat });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Create beat error:', error);
    res.status(500).json({ error: 'Failed to create beat' });
  } finally {
    client.release();
  }
};

export const getAllBeats = async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = parseInt(req.query.offset as string) || 0;
    const user_id = req.query.user_id;

    let query = `
      SELECT b.*, u.username as author, 
             l.title as loop_title, lu.username as loop_author
      FROM beats b
      JOIN users u ON b.user_id = u.id
      LEFT JOIN loops l ON b.loop_id = l.id
      LEFT JOIN users lu ON l.user_id = lu.id
    `;
    let countQuery = 'SELECT COUNT(*) FROM beats b';
    const params: any[] = [];
    let paramCount = 1;

    if (user_id) {
      query += ` WHERE b.user_id = $${paramCount}`;
      countQuery += ` WHERE user_id = $${paramCount}`;
      params.push(user_id);
      paramCount++;
    }

    query += ` ORDER BY b.created_at DESC LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);
    const countResult = await pool.query(countQuery, user_id ? [user_id] : []);

    const beats = result.rows.map(beat => ({
      id: beat.id,
      title: beat.title,
      filename: beat.filename,
      file_size: beat.file_size,
      author: beat.author,
      user_id: beat.user_id,
      loop_id: beat.loop_id,
      loop_title: beat.loop_title,
      loop_author: beat.loop_author,
      description: beat.description,
      tags: beat.tags,
      bpm: beat.bpm,
      key: beat.key,
      genre: beat.genre,
      is_collaboration: beat.is_collaboration,
      collaboration_credit: beat.collaboration_credit,
      created_at: beat.created_at
    }));

    res.json({
      beats,
      pagination: {
        total: parseInt(countResult.rows[0].count),
        limit,
        offset
      }
    });
  } catch (error) {
    console.error('Get all beats error:', error);
    res.status(500).json({ error: 'Failed to get beats' });
  }
};

export const getBeatById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT b.*, u.username as author, 
              l.title as loop_title, lu.username as loop_author
       FROM beats b
       JOIN users u ON b.user_id = u.id
       LEFT JOIN loops l ON b.loop_id = l.id
       LEFT JOIN users lu ON l.user_id = lu.id
       WHERE b.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Beat not found' });
    }

    const beat = result.rows[0];

    res.json({
      beat: {
        id: beat.id,
        title: beat.title,
        filename: beat.filename,
        file_size: beat.file_size,
        author: beat.author,
        user_id: beat.user_id,
        loop_id: beat.loop_id,
        loop_title: beat.loop_title,
        loop_author: beat.loop_author,
        description: beat.description,
        tags: beat.tags,
        bpm: beat.bpm,
        key: beat.key,
        genre: beat.genre,
        is_collaboration: beat.is_collaboration,
        collaboration_credit: beat.collaboration_credit,
        created_at: beat.created_at
      }
    });
  } catch (error) {
    console.error('Get beat by id error:', error);
    res.status(500).json({ error: 'Failed to get beat' });
  }
};

export const getLoopCollaborations = async (req: Request, res: Response) => {
  try {
    const { loopId } = req.params;

    const result = await pool.query(
      `SELECT b.*, u.username as author
       FROM beats b
       JOIN users u ON b.user_id = u.id
       WHERE b.loop_id = $1
       ORDER BY b.created_at DESC`,
      [loopId]
    );

    const collaborations = result.rows.map(beat => ({
      id: beat.id,
      title: beat.title,
      filename: beat.filename,
      author: beat.author,
      user_id: beat.user_id,
      description: beat.description,
      is_collaboration: beat.is_collaboration,
      collaboration_credit: beat.collaboration_credit,
      created_at: beat.created_at
    }));

    res.json({ collaborations });
  } catch (error) {
    console.error('Get loop collaborations error:', error);
    res.status(500).json({ error: 'Failed to get collaborations' });
  }
};

export const deleteBeat = async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const user_id = (req as any).userId;

    // Check if beat belongs to user
    const beatResult = await client.query(
      'SELECT filename FROM beats WHERE id = $1 AND user_id = $2',
      [id, user_id]
    );

    if (beatResult.rows.length === 0) {
      return res.status(404).json({ error: 'Beat not found or unauthorized' });
    }

    const filename = beatResult.rows[0].filename;

    await client.query('BEGIN');

    // Delete from database
    await client.query('DELETE FROM beats WHERE id = $1', [id]);

    // Delete file
    const filePath = path.join(process.cwd(), 'uploads', 'beats', filename);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    await client.query('COMMIT');

    res.json({ message: 'Beat deleted successfully' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Delete beat error:', error);
    res.status(500).json({ error: 'Failed to delete beat' });
  } finally {
    client.release();
  }
};
