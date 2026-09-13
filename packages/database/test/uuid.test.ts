import { describe, expect, it } from 'vitest';
import { assertValidUuid, isValidUuid } from '../src/uuid.js';

describe('isValidUuid', () => {
  it('accepts a well-formed UUID', () => {
    expect(isValidUuid('00000000-0000-4000-8000-000000000001')).toBe(true);
  });

  it('rejects a non-UUID string, including SQL-injection-shaped input', () => {
    expect(isValidUuid('not-a-uuid')).toBe(false);
    expect(isValidUuid("'; DROP TABLE platform.organizations; --")).toBe(false);
    expect(isValidUuid('00000000-0000-4000-8000-000000000001; DROP TABLE x')).toBe(false);
  });
});

describe('assertValidUuid', () => {
  it('does not throw for a valid UUID', () => {
    expect(() => assertValidUuid('00000000-0000-4000-8000-000000000001')).not.toThrow();
  });

  it('throws for an invalid value', () => {
    expect(() => assertValidUuid('not-a-uuid')).toThrow();
  });
});
