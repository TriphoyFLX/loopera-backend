import express from 'express';
import { authenticate } from '../middleware/auth';
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
  deletePack
} from '../controllers/adminShopController';

const router = express.Router();

// Все роуты требуют авторизации
router.use(authenticate);

// Модерация паков
router.get('/packs/pending', getPendingPacks);
router.get('/packs/all', getAllPacks);
router.get('/packs/:id/moderation', getPackForModeration);
router.post('/packs/:id/approve', approvePack);
router.post('/packs/:id/reject', rejectPack);
router.delete('/packs/:id', deletePack);
router.post('/users/:userId/ban', banUser);

// Вывод средств
router.get('/withdrawals', getWithdrawals);
router.post('/withdrawals/:id/approve', approveWithdrawal);
router.post('/withdrawals/:id/reject', rejectWithdrawal);

// Жалобы
router.get('/reports', getReports);
router.post('/reports/:id/resolve', resolveReport);

// Статистика
router.get('/stats', getShopStats);

export default router;
