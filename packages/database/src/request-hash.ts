import { createHash } from 'node:crypto';

/** Deterministically stringifies `value` with object keys sorted, so key order never affects the hash. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const entries = keys.map(
    (key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`,
  );
  return `{${entries.join(',')}}`;
}

/** A normalized hash of a request payload, used to detect an Idempotency-Key reused with a different body. */
export function computeRequestHash(payload: unknown): string {
  return createHash('sha256').update(stableStringify(payload)).digest('hex');
}
