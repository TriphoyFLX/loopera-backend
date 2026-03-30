import { Router } from 'express';
import { searchArtists, searchLoops } from '../controllers/searchController.ts';
import { simpleAuth } from '../middleware/simpleAuth.ts';

const router = Router();

// Поиск артистов (требует авторизации)
router.get('/artists', simpleAuth, searchArtists);

// Поиск лупов (требует авторизации)
router.get('/loops', simpleAuth, searchLoops);

export default router;
