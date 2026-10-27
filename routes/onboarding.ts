import express from 'express';
import { authenticate } from '../middleware/auth.js';
import {
  getOnboardingStatus,
  completeOnboarding,
  updateArtistPreferences,
  skipOnboarding,
} from '../controllers/onboardingController.js';

const router = express.Router();

router.use(authenticate);

router.get('/status', getOnboardingStatus);
router.post('/artists', completeOnboarding);
router.put('/artists', updateArtistPreferences);
router.post('/skip', skipOnboarding);

export default router;
