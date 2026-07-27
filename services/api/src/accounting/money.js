const SCALE_DIGITS = 6;
const SCALE = 10n ** BigInt(SCALE_DIGITS);

function roundedDivide(numerator, denominator) {
  if (denominator === 0n) throw new RangeError("Division by zero.");
  const negative = (numerator < 0n) !== (denominator < 0n);
  const absoluteNumerator = numerator < 0n ? -numerator : numerator;
  const absoluteDenominator = denominator < 0n ? -denominator : denominator;
  const quotient = (absoluteNumerator + absoluteDenominator / 2n) / absoluteDenominator;
  return negative ? -quotient : quotient;
}

export function decimal(value) {
  if (typeof value === "bigint") return value;
  const text = String(value ?? "0").trim();
  if (!/^-?\d+(\.\d+)?$/.test(text)) throw new TypeError(`Invalid decimal value: ${text}`);
  const negative = text.startsWith("-");
  const unsigned = negative ? text.slice(1) : text;
  const [whole, fraction = ""] = unsigned.split(".");
  const padded = (fraction + "0".repeat(SCALE_DIGITS + 1)).slice(0, SCALE_DIGITS + 1);
  let scaled = BigInt(whole) * SCALE + BigInt(padded.slice(0, SCALE_DIGITS));
  if (Number(padded[SCALE_DIGITS] || "0") >= 5) scaled += 1n;
  return negative ? -scaled : scaled;
}

export function add(...values) { return values.reduce((total, value) => total + decimal(value), 0n); }
export function sub(left, right) { return decimal(left) - decimal(right); }
export function mul(left, right) { return roundedDivide(decimal(left) * decimal(right), SCALE); }
export function div(left, right) { return roundedDivide(decimal(left) * SCALE, decimal(right)); }
export function abs(value) { const amount = decimal(value); return amount < 0n ? -amount : amount; }
export function max(left, right) { return decimal(left) > decimal(right) ? decimal(left) : decimal(right); }
export function min(left, right) { return decimal(left) < decimal(right) ? decimal(left) : decimal(right); }

export function roundMoney(value, decimalPlaces = 2) {
  const places = Math.max(0, Math.min(SCALE_DIGITS, Number(decimalPlaces || 0)));
  const factor = 10n ** BigInt(SCALE_DIGITS - places);
  const amount = decimal(value);
  const negative = amount < 0n;
  const absolute = negative ? -amount : amount;
  const rounded = roundedDivide(absolute, factor) * factor;
  return negative ? -rounded : rounded;
}

export function formatDecimal(value, decimalPlaces = SCALE_DIGITS) {
  const places = Math.max(0, Math.min(SCALE_DIGITS, Number(decimalPlaces)));
  const amount = decimal(value);
  const negative = amount < 0n;
  const absolute = negative ? -amount : amount;
  const whole = absolute / SCALE;
  const fraction = String(absolute % SCALE).padStart(SCALE_DIGITS, "0").slice(0, places);
  return `${negative ? "-" : ""}${whole}${places ? `.${fraction}` : ""}`;
}

export function asDatabaseDecimal(value) { return formatDecimal(value, SCALE_DIGITS); }
export const MONEY_SCALE = SCALE;
export const MONEY_SCALE_DIGITS = SCALE_DIGITS;
