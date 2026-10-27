import { Response } from 'express';
import fs from 'fs';
import type { AuthRequest } from '../middleware/auth.js';

const MELODY_SERVICE_URL = process.env.MELODY_SERVICE_URL || 'http://localhost:8001';
const MELODY_TIMEOUT_MS = 180_000;

async function proxyMelodyUpload(
  req: AuthRequest,
  res: Response,
  endpoint: '/generate' | '/rewrite',
) {
  const file = req.file;

  if (!file) {
    return res.status(400).json({ error: 'Audio file is required (field: beat)' });
  }

  try {
    const fileBuffer = fs.readFileSync(file.path);
    const formData = new FormData();
    const blob = new Blob([fileBuffer], { type: file.mimetype || 'audio/mpeg' });
    formData.append('file', blob, file.originalname);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), MELODY_TIMEOUT_MS);

    let apiResponse: globalThis.Response;
    try {
      apiResponse = await fetch(`${MELODY_SERVICE_URL}${endpoint}`, {
        method: 'POST',
        body: formData,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    const payload = await apiResponse.json().catch(() => null);

    if (!apiResponse.ok) {
      const detail =
        payload && typeof payload === 'object' && 'detail' in payload
          ? String((payload as { detail: unknown }).detail)
          : 'Melody service error';

      return res.status(apiResponse.status >= 400 ? apiResponse.status : 502).json({
        error: detail,
      });
    }

    return res.status(200).json(payload);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return res.status(504).json({
        error: 'Обработка заняла слишком много времени. Попробуй файл покороче (до 30 сек).',
      });
    }
    console.error(`Melody ${endpoint} failed:`, error);
    return res.status(503).json({
      error: 'Сервис генерации временно недоступен. Попробуй ещё раз.',
    });
  } finally {
    if (file.path && fs.existsSync(file.path)) {
      fs.unlinkSync(file.path);
    }
  }
}

export const generateMelody = async (req: AuthRequest, res: Response) =>
  proxyMelodyUpload(req, res, '/generate');

export const rewriteMelody = async (req: AuthRequest, res: Response) =>
  proxyMelodyUpload(req, res, '/rewrite');

export const melodyHealth = async (_req: AuthRequest, res: Response) => {
  try {
    const response = await fetch(`${MELODY_SERVICE_URL}/health`);
    const payload = await response.json();
    return res.status(response.ok ? 200 : 503).json(payload);
  } catch {
    return res.status(503).json({
      status: 'down',
      service: 'melody',
      url: MELODY_SERVICE_URL,
    });
  }
};
