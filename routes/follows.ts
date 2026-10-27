import express from 'express';
import { authenticate, optionalAuthenticate } from '../middleware/auth.js';
import {
  followUser,
  unfollowUser,
  getFollowStatus,
  listMyFollowing,
  listFollowers,
  getFollowedLoops,
} from '../controllers/followController.js';

const router = express.Router();

router.get('/loops', optionalAuthenticate, getFollowedLoops);
router.get('/status/:usernameOrId', optionalAuthenticate, getFollowStatus);
router.get('/user/:usernameOrId/followers', listFollowers);

router.use(authenticate);

router.get('/me', listMyFollowing);
router.post('/:usernameOrId', followUser);
router.delete('/:usernameOrId', unfollowUser);

export default router;
