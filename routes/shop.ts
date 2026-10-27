import express from 'express';
import { authenticate } from '../middleware/auth';
import { requireAdmin, requireAnyStaff } from '../middleware/simpleAdmin.js';
import { yookassaWebhook, confirmPackPayment } from '../controllers/yookassaController';
import {
  getPacks,
  getPackById,
  createPack,
  buyPack,
  createBalanceTopUp,
  getUserBalance,
  createWithdrawal,
  getUserPacks,
  getUserCreatedPacks,
  ratePack,
  reportPack,
  downloadPack,
  upload,
  getBalanceByTelegramId,
  searchUsers,
  getTransactionHistory,
  deletePack,
  getUserBalanceByUsername,
  getAllPacksAdmin
} from '../controllers/shopController';

const router = express.Router();

// Public
router.get('/', getPacks);
router.post('/yookassa/webhook', yookassaWebhook);
// Gone — do not expose balances by telegram id
router.get('/balance/telegram/:telegram_id', getBalanceByTelegramId);

// Authenticated static paths MUST be before /:id
router.get('/history', authenticate, getTransactionHistory);
router.get('/balance/my', authenticate, getUserBalance);
router.post('/balance/top-up', authenticate, createBalanceTopUp);
router.get('/my/packs', authenticate, getUserPacks);
router.get('/my/created-packs', authenticate, getUserCreatedPacks);
router.get('/user-packs', authenticate, getUserPacks);
router.post('/payments/confirm', authenticate, confirmPackPayment);
router.post('/withdrawals', authenticate, createWithdrawal);
router.get('/admin/search-users', authenticate, requireAdmin, searchUsers);
router.get('/admin/balance/:username', authenticate, requireAdmin, getUserBalanceByUsername);
router.get('/admin/packs/all', authenticate, requireAnyStaff, getAllPacksAdmin);

router.post(
  '/',
  authenticate,
  upload.fields([
    { name: 'archive', maxCount: 1 },
    { name: 'preview1', maxCount: 1 },
    { name: 'preview2', maxCount: 1 },
    { name: 'voiceTag', maxCount: 1 },
    { name: 'textFile', maxCount: 1 },
    { name: 'cover', maxCount: 1 },
  ]),
  createPack,
);

// Parameterized pack routes (after static paths)
router.get('/:id', getPackById);
router.post('/:id/buy', authenticate, buyPack);
router.post('/:id/rate', authenticate, ratePack);
router.post('/:id/report', authenticate, reportPack);
router.delete('/:id', authenticate, deletePack);
router.get('/:id/download', authenticate, downloadPack);

export default router;
