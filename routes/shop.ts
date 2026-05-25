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
  createInvoice,
  getInvoiceStatus,
  handleWebhook,
  getUserPayments
} from '../controllers/cryptoPayController';

const router = express.Router();

// Публичные роуты
router.get('/', getPacks);
router.get('/:id', getPackById);

// Webhook для Crypto Pay (публичный)
router.post('/crypto/webhook', handleWebhook);

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

// Crypto Pay роуты
router.post('/crypto/invoice', createInvoice);
router.get('/crypto/invoice/:invoiceId', getInvoiceStatus);
router.get('/crypto/payments', getUserPayments);

export default router;
