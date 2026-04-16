import express from 'express';
import { simpleAdmin } from '../middleware/simpleAdmin.js';
import { 
  getAdminStats, 
  getAllUsers, 
  getAllLoops, 
  deleteLoop, 
  banUser, 
  unbanUser 
} from '../controllers/adminController.js';

const router = express.Router();

// Apply simple admin middleware to all routes
router.use(simpleAdmin);

// Get admin dashboard statistics
router.get('/stats', getAdminStats);

// Get all users with pagination
router.get('/users', getAllUsers);

// Get all loops with pagination
router.get('/loops', getAllLoops);

// Delete a loop
router.delete('/loops/:id', deleteLoop);

// Ban a user
router.post('/users/:id/ban', banUser);

// Unban a user
router.post('/users/:id/unban', unbanUser);

export default router;
