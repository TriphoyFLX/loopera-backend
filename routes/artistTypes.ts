import express from 'express';
import { getArtistTypes } from '../controllers/artistTypeController.js';

const router = express.Router();

router.get('/', getArtistTypes);

export default router;
