import { describe, expect, it } from 'vitest';
import { computeRequestHash } from '../src/request-hash.js';

describe('computeRequestHash', () => {
  it('is deterministic for the same payload', () => {
    const payload = { tenantKey: 'ACME', displayName: 'Acme Inc' };
    expect(computeRequestHash(payload)).toBe(computeRequestHash(payload));
  });

  it('is independent of object key order', () => {
    const a = computeRequestHash({ tenantKey: 'ACME', displayName: 'Acme Inc' });
    const b = computeRequestHash({ displayName: 'Acme Inc', tenantKey: 'ACME' });
    expect(a).toBe(b);
  });

  it('differs when the payload differs', () => {
    const a = computeRequestHash({ tenantKey: 'ACME' });
    const b = computeRequestHash({ tenantKey: 'GLOBEX' });
    expect(a).not.toBe(b);
  });

  it('handles nested objects and arrays consistently regardless of key order', () => {
    const a = computeRequestHash({ a: 1, nested: { x: 1, y: 2 }, list: [1, 2, 3] });
    const b = computeRequestHash({ nested: { y: 2, x: 1 }, list: [1, 2, 3], a: 1 });
    expect(a).toBe(b);
  });

  it('produces a fixed-length hex digest', () => {
    const hash = computeRequestHash({ anything: true });
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
