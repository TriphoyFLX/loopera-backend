import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { sensitiveLimiter } from '../middleware/rateLimit.js';
import {
  checkoutPlan,
  confirmSubscriptionPayment,
  getAuthorPlanPublic,
  getBillingPlans,
  getMyBilling,
  updateProfileTheme,
} from '../controllers/billingController.js';

const router = Router();

router.get('/plans', getBillingPlans);
router.get('/author/:userId', getAuthorPlanPublic);
router.get('/me', authenticate, getMyBilling);
router.post('/checkout', authenticate, sensitiveLimiter, checkoutPlan);
router.post('/confirm', authenticate, confirmSubscriptionPayment);
router.patch('/theme', authenticate, updateProfileTheme);

export default router;
