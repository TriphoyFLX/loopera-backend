import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buyPackLockKey,
  calcSaleCommission,
  PLATFORM_SALE_COMMISSION_RATE,
} from '../services/packOrderService.ts';

describe('calcSaleCommission', () => {
  it('splits 15% platform / 85% seller on integer rubles', () => {
    const { commission, sellerEarnings } = calcSaleCommission(1000);
    assert.equal(PLATFORM_SALE_COMMISSION_RATE, 0.15);
    assert.equal(commission, 150);
    assert.equal(sellerEarnings, 850);
    assert.equal(commission + sellerEarnings, 1000);
  });

  it('rounds commission for odd prices', () => {
    const { commission, sellerEarnings } = calcSaleCommission(999);
    assert.equal(commission, Math.round(999 * 0.15));
    assert.equal(commission + sellerEarnings, 999);
  });
});

describe('buyPackLockKey', () => {
  it('is stable and distinct per buyer+pack', () => {
    const a = buyPackLockKey(42, 7);
    const b = buyPackLockKey(42, 7);
    const c = buyPackLockKey(42, 8);
    const d = buyPackLockKey(43, 7);
    assert.equal(a, b);
    assert.notEqual(a, c);
    assert.notEqual(a, d);
  });
});
