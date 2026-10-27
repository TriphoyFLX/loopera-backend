import { Router } from 'express';
import { authenticate, optionalAuthenticate } from '../middleware/auth.js';
import {
  listNotifications,
  getUnreadCount,
  markNotificationRead,
  markAllNotificationsRead,
} from '../controllers/notificationController.js';

const router = Router();

router.get('/', optionalAuthenticate, listNotifications);
router.get('/unread-count', authenticate, getUnreadCount);
router.post('/read-all', authenticate, markAllNotificationsRead);
router.post('/:id/read', authenticate, markNotificationRead);

export default router;
