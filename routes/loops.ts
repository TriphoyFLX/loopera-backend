import { Router } from 'express';
import { uploadLoop, getUserLoops, getLoopsByUser, getAllLoops, deleteLoop, getPopularHashtags, getRandomLoops, getUserStats, getUserStatsHistory, trackTelegramClick, trackLoopPlay, getForYouLoops, downloadLoop, getLoopById, getLoopComments, addLoopComment, toggleLoopCommentLike } from '../controllers/loopController.js';
import { authenticate, optionalAuthenticate } from '../middleware/auth.js';

const router = Router();

// Загрузка лупа (требует авторизации)
router.post('/upload', authenticate, uploadLoop);

// Static paths before /:id/*
router.get('/stats', authenticate, getUserStats);
router.get('/stats/history', authenticate, getUserStatsHistory);
router.post('/telegram-click/:loopId', authenticate, trackTelegramClick);
router.get('/my', authenticate, getUserLoops);
router.get('/for-you', authenticate, getForYouLoops);
router.get('/hashtags/popular', getPopularHashtags);
router.get('/random', getRandomLoops);
router.get('/user/:userId', getLoopsByUser);
router.get('/', getAllLoops);

// Parameterized
router.get('/:id/comments', optionalAuthenticate, getLoopComments);
router.post('/:id/comments', authenticate, addLoopComment);
router.post('/comments/:commentId/like', authenticate, toggleLoopCommentLike);
router.post('/:id/play', optionalAuthenticate, trackLoopPlay);
router.get('/:id/download', authenticate, downloadLoop);
router.get('/:id', getLoopById);
router.delete('/:id', authenticate, deleteLoop);

export default router;
