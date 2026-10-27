import express from 'express';
import { authenticate } from '../middleware/auth';
import { requireAdmin, requireAnyStaff } from '../middleware/simpleAdmin.js';
import {
  getPendingPacks,
  getPackForModeration,
  approvePack,
  rejectPack,
  banUser,
  getWithdrawals,
  approveWithdrawal,
  rejectWithdrawal,
  getReports,
  resolveReport,
  getShopStats,
  getAllPacks,
  deletePack,
  setPackDiscount,
} from '../controllers/adminShopController';

const router = express.Router();

router.use(authenticate);

// Content moderation — admin + manager
router.get('/packs/pending', requireAnyStaff, getPendingPacks);
router.get('/packs/all', requireAnyStaff, getAllPacks);
router.get('/packs/:id/moderation', requireAnyStaff, getPackForModeration);
router.post('/packs/:id/approve', requireAnyStaff, approvePack);
router.post('/packs/:id/reject', requireAnyStaff, rejectPack);
router.get('/reports', requireAnyStaff, getReports);
router.post('/reports/:id/resolve', requireAnyStaff, resolveReport);
router.get('/stats', requireAnyStaff, getShopStats);

// Money / destructive / user punishment — admin only
router.patch('/packs/:id/discount', requireAdmin, setPackDiscount);
router.delete('/packs/:id', requireAdmin, deletePack);
router.post('/users/:userId/ban', requireAdmin, banUser);
router.get('/withdrawals', requireAdmin, getWithdrawals);
router.post('/withdrawals/:id/approve', requireAdmin, approveWithdrawal);
router.post('/withdrawals/:id/reject', requireAdmin, rejectWithdrawal);

export default router;
