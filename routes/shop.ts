import express from 'express';
import { authenticate } from '../middleware/auth';
import {
  getPacks,
  getPackById,
  createPack,
  buyPack,
  getUserBalance,
  createWithdrawal,
  getUserPacks,
  ratePack,
  reportPack,
  downloadPack,
  upload
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

// Публичные роуты
router.get('/', getPacks);
router.get('/:id', getPackById);

// Защищенные роуты (требуют авторизации)
router.use(authenticate);

router.post('/', upload.fields([
  { name: 'archive', maxCount: 1 },
  { name: 'preview1', maxCount: 1 },
  { name: 'preview2', maxCount: 1 },
  { name: 'voiceTag', maxCount: 1 },
  { name: 'textFile', maxCount: 1 }
]), createPack);
router.post('/:id/buy', buyPack);
router.get('/:id/download', downloadPack);
router.get('/balance/my', getUserBalance);
router.post('/withdrawals', createWithdrawal);
router.get('/my/packs', getUserPacks);
router.post('/:id/rate', ratePack);
router.post('/:id/report', reportPack);

// Crypto Pay защищенные роуты
router.post('/crypto/topup', createTopUpInvoice);
router.get('/crypto/invoice/:invoiceId', getInvoiceStatus);
router.get('/crypto/orders', getUserPayments);

export default router;
