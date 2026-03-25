import { Router } from 'express';
import { register, login, getProfile, verifyEmail } from '../controllers/authController.ts';
import { authenticate } from '../middleware/auth.ts';

const router = Router();

router.post('/register', register);
router.post('/verify-email', verifyEmail);
router.post('/login', login);
router.get('/profile', authenticate, getProfile);

export default router;
