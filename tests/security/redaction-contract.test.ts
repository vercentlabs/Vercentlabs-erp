import { describe, expect, it } from 'vitest';
import { isSensitiveKey, PINO_REDACT_PATHS } from '@vercentlabs/observability';

/**
 * Guards against a future refactor silently shrinking the redaction
 * surface. If a credential-shaped field name below stops being caught, this
 * test - not a production incident - should be what catches it.
 */
const REQUIRED_SENSITIVE_FIELD_NAMES = [
  'password',
  'secret',
  'token',
  'authorization',
  'apiKey',
  'clientSecret',
  'privateKey',
  'sessionId',
  'creditCard',
  'cvv',
];

describe('credential redaction contract', () => {
  it('flags every required sensitive field name', () => {
    const notFlagged = REQUIRED_SENSITIVE_FIELD_NAMES.filter((name) => !isSensitiveKey(name));
    expect(notFlagged).toEqual([]);
  });

  it('pino redact paths still cover the authorization header and password field', () => {
    expect(PINO_REDACT_PATHS).toContain('password');
    expect(PINO_REDACT_PATHS).toContain('req.headers.authorization');
  });
});
