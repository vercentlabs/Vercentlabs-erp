/**
 * `JSON.stringify` throws on raw `bigint` values, and even if it did not,
 * round-tripping a 64-bit identifier through a JS `number` loses precision.
 * All bigint-backed identifiers must be converted through these helpers
 * before crossing a JSON boundary. See root governance rule 12.
 */
export function bigIntToJsonString(value: bigint): string {
  return value.toString();
}

export function jsonStringToBigInt(value: string): bigint {
  if (!/^-?\d+$/.test(value)) {
    throw new Error(`Invalid integer string for BigInt conversion: "${value}"`);
  }
  return BigInt(value);
}
