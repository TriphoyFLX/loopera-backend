import { Router } from 'express';
import { searchArtists, searchLoops } from '../controllers/searchController.js';

const router = Router();

// Public search — guests and members
router.get('/artists', searchArtists);
router.get('/loops', searchLoops);

export default router;
