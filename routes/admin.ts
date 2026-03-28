import express from 'express';
import { adminAuth } from '../middleware/adminAuth.js';
import { getAdminStats, getAllUsers, getAllLoops } from '../controllers/adminController.js';

const router = express.Router();

// Apply admin auth middleware to all routes
router.use(adminAuth);

// Get admin dashboard statistics
router.get('/stats', getAdminStats);

// Get all users with pagination
router.get('/users', getAllUsers);

// Get all loops with pagination
router.get('/loops', getAllLoops);

export default router;
