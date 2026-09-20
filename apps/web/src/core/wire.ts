// The Sales domain does its money arithmetic in fixed-point BigInt (scale 10^6,
// see services/api/src/core/decimal.js) so it never touches floating point. A
// BigInt cannot be JSON-serialised, and a domain function may return one inside
// a larger object (previewSalesDocument does). Converting at the response
// boundary -- to the same 6-decimal string asDatabaseDecimal() produces --
// means no route can 500 on "Do not know how to serialize a BigInt", and no
// caller ever receives a float.
// BigInt() rather than the 123n literal: the project targets ES2017, which has no BigInt literals.
const SCALE = BigInt(1000000);
const ZERO = BigInt(0);

export function scaledToDecimalString(value: bigint): string {
  const negative = value < ZERO;
  const absolute = negative ? -value : value;
  const whole = absolute / SCALE;
  const fraction = (absolute % SCALE).toString().padStart(6, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

export function toWire<T>(value: T): T {
  if (typeof value === "bigint") return scaledToDecimalString(value) as unknown as T;
  if (Array.isArray(value)) return value.map(toWire) as unknown as T;
  // Duck-typed, not `instanceof Date`: a Date created by the pg driver can come
  // from a different realm than this module under Next's server runtime, where
  // instanceof is false and the generic object branch below would flatten it to {}.
  if (value && typeof (value as { toISOString?: unknown }).toISOString === "function") return (value as unknown as Date).toISOString() as unknown as T;
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) output[key] = toWire(item);
    return output as T;
  }
  return value;
}
