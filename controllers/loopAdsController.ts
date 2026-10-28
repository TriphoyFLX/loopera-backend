import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.js';
import {
  LOOP_AD_IMPRESSION_COST,
  LOOP_AD_MIN_BUDGET,
  createLoopAd,
  listMyLoopAds,
  setLoopAdStatus,
} from '../services/loopAdsService.js';

export const getLoopAdsMeta = async (_req: AuthRequest, res: Response) => {
  res.json({
    cost_per_impression: LOOP_AD_IMPRESSION_COST,
    min_budget: LOOP_AD_MIN_BUDGET,
    currency: 'RUB',
  });
};

export const createAd = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId || req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Не авторизован' });

    const loopId = parseInt(String(req.body.loop_id || req.body.loopId || ''), 10);
    const budget = parseInt(String(req.body.budget || ''), 10);
    if (!Number.isFinite(loopId)) {
      return res.status(400).json({ message: 'loop_id обязателен' });
    }

    const ad = await createLoopAd({ userId, loopId, budget });
    return res.status(201).json({
      ad,
      remaining: Math.max(0, Number(ad.budget_total) - Number(ad.budget_spent)),
      cost_per_impression: LOOP_AD_IMPRESSION_COST,
    });
  } catch (error: any) {
    const status = error?.status || 500;
    return res.status(status).json({
      message: error instanceof Error ? error.message : 'Не удалось создать рекламу',
    });
  }
};

export const listAds = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId || req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Не авторизован' });
    const ads = await listMyLoopAds(userId);
    return res.json({ ads, cost_per_impression: LOOP_AD_IMPRESSION_COST, min_budget: LOOP_AD_MIN_BUDGET });
  } catch (error) {
    return res.status(500).json({
      message: error instanceof Error ? error.message : 'Ошибка загрузки рекламы',
    });
  }
};

export const pauseAd = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId || req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Не авторизован' });
    const adId = parseInt(String(req.params.id), 10);
    const ad = await setLoopAdStatus(userId, adId, 'paused');
    return res.json({ ad });
  } catch (error: any) {
    return res.status(error?.status || 500).json({
      message: error instanceof Error ? error.message : 'Не удалось поставить на паузу',
    });
  }
};

export const resumeAd = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId || req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Не авторизован' });
    const adId = parseInt(String(req.params.id), 10);
    const ad = await setLoopAdStatus(userId, adId, 'active');
    return res.json({ ad });
  } catch (error: any) {
    return res.status(error?.status || 500).json({
      message: error instanceof Error ? error.message : 'Не удалось возобновить',
    });
  }
};
