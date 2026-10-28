import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import {
  createAd,
  getLoopAdsMeta,
  listAds,
  pauseAd,
  resumeAd,
} from '../controllers/loopAdsController.js';

const router = Router();

router.get('/meta', getLoopAdsMeta);
router.get('/mine', authenticate, listAds);
router.post('/', authenticate, createAd);
router.post('/:id/pause', authenticate, pauseAd);
router.post('/:id/resume', authenticate, resumeAd);

export default router;
