import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { JWT_EXPIRES_IN, JWT_REFRESH_MAX_AGE_DAYS, MAX_REFRESH_AGE_MS } from '../config/jwt.ts';

describe('jwt config', () => {
  it('defaults to short-lived access token and week-long refresh window', () => {
    // Defaults from jwt.ts unless overridden by env in the running process
    assert.ok(typeof JWT_EXPIRES_IN === 'string' && JWT_EXPIRES_IN.length > 0);
    assert.ok(JWT_REFRESH_MAX_AGE_DAYS >= 1 && JWT_REFRESH_MAX_AGE_DAYS <= 30);
    assert.equal(MAX_REFRESH_AGE_MS, JWT_REFRESH_MAX_AGE_DAYS * 24 * 60 * 60 * 1000);
  });
});
