import { Router } from 'express';
import { register, login, getProfile, verifyEmail, resendVerificationCode, forgotPassword, resetPassword, refreshToken } from '../controllers/authController.js';
import { startGoogleAuth, googleAuthCallback } from '../controllers/googleAuthController.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

router.get('/google', startGoogleAuth);
router.get('/google/callback', googleAuthCallback);
router.post('/register', register);
router.post('/verify-email', verifyEmail);
router.post('/login', login);
router.post('/refresh', refreshToken);
router.post('/resend-verification', resendVerificationCode);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);
router.get('/profile', authenticate, getProfile);

export default router;
