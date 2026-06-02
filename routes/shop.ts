import express from 'express';
import { authenticate } from '../middleware/auth';
import pool from '../config/database';
import {
  getPacks,
  getPackById,
  createPack,
  buyPack,
  getUserBalance,
  createWithdrawal,
  getUserPacks,
  getUserCreatedPacks,
  ratePack,
  reportPack,
  downloadPack,
  upload,
  manualCreditBalance,
  getBalanceByTelegramId,
  manualDebitBalance,
  searchUsers,
  getTransactionHistory,
  deletePack,
  getUserBalanceByUsername,
  getAllPacksAdmin
} from '../controllers/shopController';
import {
  getInvoiceStatus,
  handleWebhook,
  getUserPayments,
  createTopUpInvoice
} from '../controllers/cryptoPayController';

const router = express.Router();

// Crypto Pay роуты (должны быть перед :id)
router.post('/crypto/webhook', handleWebhook);

// Simple test endpoint to verify proxy works
router.get('/test', (req, res) => {
  res.json({ message: 'Proxy works!', time: new Date().toISOString() });
});

// Debug endpoint to test pack retrieval without auth (must be before authenticate)
router.get('/debug/packs/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const result = await pool.query('SELECT * FROM sound_packs WHERE user_id = $1 ORDER BY created_at DESC', [userId]);
    res.json({ packs: result.rows });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get packs' });
  }
});

// Публичные роуты
router.get('/', getPacks);

// Защищенные роуты (требуют авторизации)
router.use(authenticate);

// Маршруты с префиксом /balance/my (должны быть первыми)
router.get('/balance/my', getUserBalance);

// Маршруты с префиксом /my (должны быть перед :id)
router.get('/my/packs', getUserPacks);
router.get('/my/created-packs', getUserCreatedPacks);

// Маршрут /user-packs (должен быть перед :id)
router.get('/user-packs', getUserPacks);

// История транзакций (должна быть перед :id)
router.get('/history', getTransactionHistory);

// POST роуты
router.post('/', upload.fields([
  { name: 'archive', maxCount: 1 },
  { name: 'preview1', maxCount: 1 },
  { name: 'preview2', maxCount: 1 },
  { name: 'voiceTag', maxCount: 1 },
  { name: 'textFile', maxCount: 1 },
  { name: 'cover', maxCount: 1 }
]), createPack);
router.post('/:id/buy', buyPack);
router.post('/:id/rate', ratePack);
router.post('/:id/report', reportPack);
router.post('/withdrawals', createWithdrawal);

// DELETE роуты
router.delete('/:id', deletePack);

// GET роуты с динамическими параметрами (должны быть после статических)
router.get('/:id/download', downloadPack);

// Ручное управление балансом (только для админа)
router.post('/admin/credit-balance', manualCreditBalance);
router.post('/admin/debit-balance', manualDebitBalance);
router.get('/admin/search-users', searchUsers);
router.get('/admin/balance/:username', getUserBalanceByUsername);
router.get('/admin/packs/all', getAllPacksAdmin);

// Crypto Pay защищенные роуты
router.post('/crypto/topup', createTopUpInvoice);
router.get('/crypto/invoice/:invoiceId', getInvoiceStatus);
router.get('/crypto/orders', getUserPayments);

// Динамический роут для получения отдельного пака (всегда в конце)
router.get('/:id', getPackById);

// Публичный роут для получения баланса по Telegram ID
router.get('/balance/telegram/:telegram_id', getBalanceByTelegramId);

// Debug route to log all unmatched requests
router.use((req, res, next) => {
  console.log('Unmatched route:', req.method, req.path, req.originalUrl);
  next();
});

export default router;
