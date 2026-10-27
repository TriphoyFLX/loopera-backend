import express from 'express';
import { listPublicHomePosts } from '../controllers/homePostController.js';

const router = express.Router();

router.get('/posts', listPublicHomePosts);

export default router;
