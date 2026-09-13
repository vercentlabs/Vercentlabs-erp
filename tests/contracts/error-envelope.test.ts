import { describe, expect, it } from 'vitest';
import {
  buildErrorEnvelope,
  errorCodeSchema,
  errorCodeToHttpStatus,
  type ErrorCode,
} from '@vercentlabs/contracts';

describe('API error contract (packages/contracts)', () => {
  it('maps every error code to exactly one HTTP status', () => {
    const codes = errorCodeSchema.options;
    for (const code of codes) {
      expect(errorCodeToHttpStatus[code]).toBeTypeOf('number');
    }
    expect(Object.keys(errorCodeToHttpStatus).length).toBe(codes.length);
  });

  it('every envelope built for a known code has the documented shape', () => {
    for (const code of errorCodeSchema.options as ErrorCode[]) {
      const envelope = buildErrorEnvelope(code, `example message for ${code}`);
      expect(envelope).toEqual({ error: { code, message: `example message for ${code}` } });
    }
  });

  it('round-trips through JSON without losing correlationId or details', () => {
    const envelope = buildErrorEnvelope('VALIDATION_ERROR', 'Invalid request', {
      correlationId: 'req-abc123',
      details: [{ field: 'email', message: 'is required' }],
    });

    const roundTripped = JSON.parse(JSON.stringify(envelope));
    expect(roundTripped).toEqual(envelope);
  });
});
