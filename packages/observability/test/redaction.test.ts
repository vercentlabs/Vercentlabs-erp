import { Writable } from 'node:stream';
import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { isSensitiveKey, PINO_REDACT_PATHS, redactSensitiveFields } from '../src/redaction.js';

class CapturingStream extends Writable {
  lines: string[] = [];

  override _write(
    chunk: Buffer,
    _encoding: string,
    callback: (error?: Error | null) => void,
  ): void {
    this.lines.push(chunk.toString('utf8'));
    callback();
  }
}

describe('isSensitiveKey', () => {
  it('flags common credential field names regardless of case', () => {
    expect(isSensitiveKey('password')).toBe(true);
    expect(isSensitiveKey('userPassword')).toBe(true);
    expect(isSensitiveKey('AUTHORIZATION')).toBe(true);
    expect(isSensitiveKey('apiKey')).toBe(true);
    expect(isSensitiveKey('clientSecret')).toBe(true);
  });

  it('does not flag ordinary field names', () => {
    expect(isSensitiveKey('email')).toBe(false);
    expect(isSensitiveKey('organizationId')).toBe(false);
    expect(isSensitiveKey('passwordResetRequired')).toBe(true); // still contains "password" on purpose
  });
});

describe('redactSensitiveFields', () => {
  it('replaces sensitive keys at every nesting depth, including inside arrays', () => {
    const input = {
      email: 'user@example.com',
      password: 'super-secret',
      profile: { apiKey: 'sk-live-123', displayName: 'Ada' },
      // "sessions" (not "tokens") deliberately, so this exercises array
      // recursion rather than the whole-key redaction a field literally
      // named "tokens" would trigger on its own.
      sessions: [{ accessToken: 'abc.def.ghi' }],
    };

    const result = redactSensitiveFields(input) as typeof input;

    expect(result.email).toBe('user@example.com');
    expect(result.password).toBe('[REDACTED]');
    expect(result.profile.apiKey).toBe('[REDACTED]');
    expect(result.profile.displayName).toBe('Ada');
    expect((result.sessions[0] as Record<string, unknown>).accessToken).toBe('[REDACTED]');
  });

  it('redacts a whole container value when its own key name is sensitive, e.g. "tokens"', () => {
    const input = { tokens: [{ accessToken: 'abc.def.ghi' }] };
    const result = redactSensitiveFields(input);
    expect(result.tokens).toBe('[REDACTED]');
  });

  it('handles circular references without throwing', () => {
    const input: Record<string, unknown> = { name: 'root' };
    input['self'] = input;

    expect(() => redactSensitiveFields(input)).not.toThrow();
  });
});

describe('pino redact paths', () => {
  it('redacts an authorization header and password field in emitted log lines', () => {
    const stream = new CapturingStream();
    const logger = pino({ redact: { paths: PINO_REDACT_PATHS, censor: '[REDACTED]' } }, stream);

    logger.info(
      {
        password: 'super-secret',
        req: { headers: { authorization: 'Bearer abc.def.ghi' } },
      },
      'login attempt',
    );

    expect(stream.lines).toHaveLength(1);
    const parsed = JSON.parse(stream.lines[0]!);
    expect(parsed.password).toBe('[REDACTED]');
    expect(parsed.req.headers.authorization).toBe('[REDACTED]');
    expect(parsed.msg).toBe('login attempt');
  });
});
