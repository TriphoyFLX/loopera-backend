import { Router } from 'express';
import { register, login, getProfile, verifyEmail, resendVerificationCode } from '../controllers/authController';
import { authenticate } from '../middleware/auth';

const router = Router();

router.post('/register', register);
router.post('/verify-email', verifyEmail);
router.post('/login', login);
router.post('/resend-verification', resendVerificationCode);
router.get('/profile', authenticate, getProfile);

export default router;
