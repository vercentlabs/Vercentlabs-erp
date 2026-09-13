const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/**
 * Throws on anything that is not a strict UUID. Used before interpolating a
 * value into a raw `SET LOCAL` statement (which cannot take a bound
 * parameter) - this is the only thing standing between that interpolation
 * and a SQL-injection hole, so it must reject anything a UUID cannot be.
 */
export function assertValidUuid(value: string, label = 'value'): void {
  if (!isValidUuid(value)) {
    throw new Error(`${label} must be a valid UUID, got: "${value}"`);
  }
}
