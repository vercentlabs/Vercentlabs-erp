import { describe, expect, it } from 'vitest';
import { isAuthenticatedSession } from '../src/index.js';

describe('isAuthenticatedSession', () => {
  it('accepts a well-formed session', () => {
    expect(
      isAuthenticatedSession({
        sessionId: 's1',
        userId: 'u1',
        organizationId: 'org1',
        issuedAt: '2026-01-01T00:00:00Z',
        expiresAt: '2026-01-02T00:00:00Z',
        mfaVerified: true,
      }),
    ).toBe(true);
  });

  it('rejects a value missing required fields', () => {
    expect(isAuthenticatedSession({ sessionId: 's1' })).toBe(false);
  });

  it('rejects a non-object value', () => {
    expect(isAuthenticatedSession(null)).toBe(false);
    expect(isAuthenticatedSession('session')).toBe(false);
  });
});
