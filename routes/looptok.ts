import express from 'express';
import multer from 'multer';
import { authenticate, optionalAuthenticate } from '../middleware/auth.js';
import {
  loopTokUploadMiddleware,
  uploadLoopTok,
  getLoopTokFeed,
  toggleLoopTokLike,
  trackLoopTokView,
  trackLoopTokShare,
  getLoopTokComments,
  addLoopTokComment,
  deleteLoopTokPost,
} from '../controllers/looptokController.js';
import { sensitiveLimiter } from '../middleware/rateLimit.js';

const router = express.Router();

router.get('/feed', optionalAuthenticate, getLoopTokFeed);

router.post(
  '/upload',
  authenticate,
  sensitiveLimiter,
  (req, res, next) => {
    loopTokUploadMiddleware(req, res, (err: unknown) => {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({
            message: 'File too large. Max 15MB — trim a fragment and try again.',
            error: 'FILE_TOO_LARGE',
            maxBytes: 15 * 1024 * 1024,
          });
        }
        return res.status(400).json({ message: err.message, error: err.code });
      }
      if (err) {
        return res.status(400).json({
          message: err instanceof Error ? err.message : 'Upload error',
        });
      }
      return next();
    });
  },
  uploadLoopTok,
);

router.get('/:id/comments', getLoopTokComments);
router.post('/:id/comments', authenticate, addLoopTokComment);
router.post('/:id/view', trackLoopTokView);
router.post('/:id/share', trackLoopTokShare);
router.post('/:id/like', authenticate, toggleLoopTokLike);
router.delete('/:id', authenticate, deleteLoopTokPost);

export default router;
