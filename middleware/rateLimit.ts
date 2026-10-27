import rateLimit from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import Redis from 'ioredis';

const rateLimitMessage = {
  error: 'Too many requests',
  message: 'Слишком много запросов. Подождите минуту и обновите страницу.',
};

let redis: Redis | null = null;

function getRedis(): Redis | null {
  const url = process.env.REDIS_URL?.trim();
  if (!url) return null;
  if (redis) return redis;
  try {
    redis = new Redis(url, {
      maxRetriesPerRequest: 1,
      enableReadyCheck: true,
      lazyConnect: false,
    });
    redis.on('error', (err) => {
      console.error('Redis rate-limit error:', err.message);
    });
    return redis;
  } catch (err) {
    console.error('Redis init failed, using memory store:', err);
    return null;
  }
}

function optionalRedisStore(prefix: string) {
  const client = getRedis();
  if (!client) return undefined;
  return new RedisStore({
    // @ts-expect-error ioredis call typing vs rate-limit-redis sendCommand
    sendCommand: (...args: string[]) => client.call(...args),
    prefix: `rl:${prefix}:`,
  });
}

export const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5000,
  message: rateLimitMessage,
  standardHeaders: true,
  legacyHeaders: false,
  store: optionalRedisStore('general'),
  skip: (req) =>
    req.path === '/health' ||
    req.path.endsWith('/health') ||
    req.path.endsWith('/readyz'),
});

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: {
    error: 'Too many authentication attempts',
    message: 'Слишком много попыток входа. Попробуйте через 15 минут.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  store: optionalRedisStore('auth'),
});

export const sensitiveLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 100,
  message: {
    error: 'Too many sensitive operations',
    message: 'Слишком много операций. Попробуйте позже.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  store: optionalRedisStore('sensitive'),
});

export function getRedisStatus(): 'up' | 'disabled' | 'down' {
  if (!process.env.REDIS_URL?.trim()) return 'disabled';
  const client = getRedis();
  if (!client) return 'down';
  return client.status === 'ready' || client.status === 'connect' ? 'up' : 'down';
}
