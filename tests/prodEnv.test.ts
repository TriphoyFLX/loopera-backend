import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateProductionEnv } from '../config/prodEnv.ts';

describe('validateProductionEnv', () => {
  it('skips checks outside production', () => {
    const report = validateProductionEnv({ NODE_ENV: 'development' });
    assert.equal(report.ok, true);
    assert.equal(report.errors.length, 0);
  });

  it('rejects weak JWT and missing DB password in production', () => {
    const report = validateProductionEnv({
      NODE_ENV: 'production',
      JWT_SECRET: 'super_secure_jwt_secret_key_minimum_32_characters_long',
      DB_PASSWORD: 'change_this_to_secure_password',
      FRONTEND_URL: 'http://loopera.ru',
    });
    assert.equal(report.ok, false);
    assert.ok(report.errors.some((e) => e.includes('JWT_SECRET')));
    assert.ok(report.errors.some((e) => e.includes('DB_PASSWORD')));
    assert.ok(report.errors.some((e) => e.includes('FRONTEND_URL')));
  });

  it('accepts strong secrets and warns on missing payments', () => {
    const secret = 'a'.repeat(48);
    const report = validateProductionEnv({
      NODE_ENV: 'production',
      JWT_SECRET: secret,
      DB_PASSWORD: 'Tr0ub4dor&3-not-weak',
      FRONTEND_URL: 'https://loopera.ru',
      REDIS_URL: 'redis://redis:6379',
    });
    assert.equal(report.ok, true);
    assert.ok(report.warnings.some((w) => w.includes('YOOKASSA')));
  });
});
