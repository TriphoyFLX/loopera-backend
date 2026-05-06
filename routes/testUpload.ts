import express from 'express';
import { authenticate } from '../middleware/auth';
import { testUpload } from '../controllers/testUploadController';

const router = express.Router();

router.use(authenticate);
router.post('/test-loops', testUpload);

export default router;
