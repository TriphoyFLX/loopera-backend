import express from 'express';
import multer from 'multer';
import path from 'path';
import { authenticate } from '../middleware/auth.js';
import {
  createBeat,
  getAllBeats,
  getBeatById,
  getLoopCollaborations,
  deleteBeat
} from '../controllers/beatController.js';

const router = express.Router();

// Configure multer for beat uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(process.cwd(), 'uploads', 'beats');
    if (!require('fs').existsSync(uploadDir)) {
      require('fs').mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'beat-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 4 * 1024 * 1024 // 4MB limit (same as loops to avoid Vercel proxy issues)
  },
  fileFilter: function (req, file, cb) {
    const allowedTypes = ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp4', 'audio/webm', 'audio/aac', 'audio/flac'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only audio files are allowed.'));
    }
  }
});

// Routes
router.post('/', authenticate, upload.single('beat'), createBeat);
router.get('/', getAllBeats);
router.get('/:id', getBeatById);
router.get('/loop/:loopId/collaborations', getLoopCollaborations);
router.delete('/:id', authenticate, deleteBeat);

export default router;
