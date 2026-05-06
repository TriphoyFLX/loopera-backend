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
  reportPack
} from '../controllers/shopController';

const router = express.Router();

// Публичные роуты
router.get('/', getPacks);
router.get('/:id', getPackById);

// Защищенные роуты (требуют авторизации)
router.use(authenticate);

router.post('/', createPack);
router.post('/:id/buy', buyPack);
router.get('/balance/my', getUserBalance);
router.post('/withdrawals', createWithdrawal);
router.get('/my/packs', getUserPacks);
router.post('/:id/rate', ratePack);
router.post('/:id/report', reportPack);

export default router;
