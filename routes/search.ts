import { Router } from 'express';
import { searchArtists, searchLoops } from '../controllers/searchController';
import { authenticate } from '../middleware/auth';

const router = Router();

// Поиск артистов (требует авторизации)
router.get('/artists', authenticate, searchArtists);

// Поиск лупов (требует авторизации)
router.get('/loops', authenticate, searchLoops);

export default router;
