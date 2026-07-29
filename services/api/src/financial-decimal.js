const SCALE_DIGITS = 6;
const SCALE = 10n ** BigInt(SCALE_DIGITS);

function absolute(value) {
  return value < 0n ? -value : value;
}

function roundedDivide(numerator, denominator) {
  if (denominator === 0n) throw new RangeError("Division by zero.");
  const negative = (numerator < 0n) !== (denominator < 0n);
  const quotient = (absolute(numerator) + absolute(denominator) / 2n) / absolute(denominator);
  return negative ? -quotient : quotient;
}

export function decimal(value) {
  if (typeof value === "bigint") return value;
  const text = String(value ?? "0").trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(text)) {
    throw new TypeError(`Invalid decimal value: ${text}`);
  }
  const negative = text.startsWith("-");
  const unsigned = negative ? text.slice(1) : text;
  const [whole, fraction = ""] = unsigned.split(".");
  const padded = `${fraction}${"0".repeat(SCALE_DIGITS + 1)}`;
  let scaled = BigInt(whole) * SCALE + BigInt(padded.slice(0, SCALE_DIGITS));
  if (Number(padded[SCALE_DIGITS] || "0") >= 5) scaled += 1n;
  return negative ? -scaled : scaled;
}

export function add(...values) {
  return values.reduce((total, value) => total + decimal(value), 0n);
}

export function sub(left, right) {
  return decimal(left) - decimal(right);
}

export function mul(left, right) {
  return roundedDivide(decimal(left) * decimal(right), SCALE);
}

export function div(left, right) {
  return roundedDivide(decimal(left) * SCALE, decimal(right));
}

export function percent(value, rate) {
  return div(mul(value, rate), 100);
}

export function abs(value) {
  return absolute(decimal(value));
}

export function max(left, right) {
  return decimal(left) > decimal(right) ? decimal(left) : decimal(right);
}

export function min(left, right) {
  return decimal(left) < decimal(right) ? decimal(left) : decimal(right);
}

export function roundMoney(value, decimalPlaces = 2) {
  const places = Math.max(0, Math.min(SCALE_DIGITS, Number(decimalPlaces || 0)));
  const factor = 10n ** BigInt(SCALE_DIGITS - places);
  const amount = decimal(value);
  const rounded = roundedDivide(absolute(amount), factor) * factor;
  return amount < 0n ? -rounded : rounded;
}

export function formatDecimal(value, decimalPlaces = SCALE_DIGITS) {
  const places = Math.max(0, Math.min(SCALE_DIGITS, Number(decimalPlaces)));
  const amount = decimal(value);
  const negative = amount < 0n;
  const unsigned = absolute(amount);
  const whole = unsigned / SCALE;
  const fraction = String(unsigned % SCALE).padStart(SCALE_DIGITS, "0").slice(0, places);
  return `${negative ? "-" : ""}${whole}${places ? `.${fraction}` : ""}`;
}

export function format(value, decimalPlaces = 2) {
  return formatDecimal(roundMoney(value, decimalPlaces), decimalPlaces);
}

export function asDatabaseDecimal(value) {
  return formatDecimal(value, SCALE_DIGITS);
}

export function allocate(total, weights) {
  const amount = decimal(total);
  const normalizedWeights = weights.map(decimal);
  const weightTotal = normalizedWeights.reduce((sum, weight) => sum + weight, 0n);
  if (weightTotal <= 0n) throw new TypeError("Allocation weights must be positive.");
  let assigned = 0n;
  return normalizedWeights.map((weight, index) => {
    if (index === normalizedWeights.length - 1) return amount - assigned;
    const share = (amount * weight) / weightTotal;
    assigned += share;
    return share;
  });
}

export const MONEY_SCALE = SCALE;
export const MONEY_SCALE_DIGITS = SCALE_DIGITS;
