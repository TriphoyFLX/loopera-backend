import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

/** Mirrors authenticate / login gate: banned users must not get sessions. */
function canIssueSession(user: { is_banned?: boolean } | null): boolean {
  if (!user) return false;
  return !user.is_banned;
}

describe('session ban gate', () => {
  it('allows active users', () => {
    assert.equal(canIssueSession({ is_banned: false }), true);
  });

  it('blocks banned users', () => {
    assert.equal(canIssueSession({ is_banned: true }), false);
  });

  it('blocks missing users', () => {
    assert.equal(canIssueSession(null), false);
  });
});
