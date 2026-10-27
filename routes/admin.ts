import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireAdmin, requireAnyStaff } from '../middleware/simpleAdmin.js';
import {
  getAdminStats,
  getAllUsers,
  getAllLoops,
  deleteLoop,
  banUser,
  unbanUser,
  setUserPlan,
} from '../controllers/adminController.js';
import {
  getAdminArtistTypes,
  createArtistType,
  updateArtistType,
  deleteArtistType,
} from '../controllers/artistTypeController.js';
import {
  adminListNotifications,
  createNotification,
  deleteNotification,
} from '../controllers/notificationController.js';
import {
  adminListHomePosts,
  createHomePost,
  updateHomePost,
  deleteHomePost,
} from '../controllers/homePostController.js';

const router = express.Router();

router.use(authenticate);

// Shared: overview + loop moderation (admin + manager)
router.get('/stats', requireAnyStaff, getAdminStats);
router.get('/loops', requireAnyStaff, getAllLoops);
router.delete('/loops/:id', requireAnyStaff, deleteLoop);

// Notifications (admin + manager)
router.get('/notifications', requireAnyStaff, adminListNotifications);
router.post('/notifications', requireAnyStaff, createNotification);
router.delete('/notifications/:id', requireAnyStaff, deleteNotification);

// Home news / ads (admin + manager)
router.get('/home-posts', requireAnyStaff, adminListHomePosts);
router.post('/home-posts', requireAnyStaff, createHomePost);
router.put('/home-posts/:id', requireAnyStaff, updateHomePost);
router.delete('/home-posts/:id', requireAnyStaff, deleteHomePost);

// Owner-only: users, bans, plans, artist types
router.get('/users', requireAdmin, getAllUsers);
router.post('/users/:id/ban', requireAdmin, banUser);
router.post('/users/:id/unban', requireAdmin, unbanUser);
router.post('/users/:id/plan', requireAdmin, setUserPlan);

router.get('/artist-types', requireAdmin, getAdminArtistTypes);
router.post('/artist-types', requireAdmin, createArtistType);
router.put('/artist-types/:id', requireAdmin, updateArtistType);
router.delete('/artist-types/:id', requireAdmin, deleteArtistType);

export default router;
