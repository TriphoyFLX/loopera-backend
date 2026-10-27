import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { authenticate } from '../middleware/auth.js';
import { generateMelody, rewriteMelody, melodyHealth } from '../controllers/melodyController.js';
import { sensitiveLimiter } from '../middleware/rateLimit.js';

const router = express.Router();

const uploadDir = path.join(process.cwd(), 'uploads', 'melody-temp');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `beat-${uniqueSuffix}${path.extname(file.originalname)}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 12 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowedTypes = [
      'audio/mpeg',
      'audio/wav',
      'audio/ogg',
      'audio/mp4',
      'audio/webm',
      'audio/aac',
      'audio/flac',
    ];
    const ok =
      allowedTypes.includes(file.mimetype) ||
      file.mimetype === 'application/octet-stream' ||
      !file.mimetype;
    if (ok) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only audio files are allowed.'));
    }
  },
});

router.get('/health', melodyHealth);
router.post('/generate', authenticate, sensitiveLimiter, upload.single('beat'), generateMelody);
router.post('/rewrite', authenticate, sensitiveLimiter, upload.single('beat'), rewriteMelody);

export default router;
