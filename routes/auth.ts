import { Router } from 'express';
import { register, login, getProfile, verifyEmail } from '../controllers/authController.ts';
import { simpleAuth } from '../middleware/simpleAuth.ts';

const router = Router();

router.post('/register', register);
router.post('/verify-email', verifyEmail);
router.post('/login', login);
router.get('/profile', simpleAuth, getProfile);

export default router;
