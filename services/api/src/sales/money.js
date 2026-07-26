const SCALE = 1_000_000n;

export function decimal(value) {
  if (typeof value === "bigint") return value;
  const text = String(value ?? "0").trim();
  if (!/^-?\d+(\.\d+)?$/.test(text)) throw new TypeError(`Invalid decimal value: ${text}`);
  const negative = text.startsWith("-");
  const unsigned = negative ? text.slice(1) : text;
  const [whole, fraction = ""] = unsigned.split(".");
  const scaled = BigInt(whole) * SCALE + BigInt((fraction + "000000").slice(0, 6));
  return negative ? -scaled : scaled;
}

export function add(...values) { return values.reduce((total, value) => total + decimal(value), 0n); }
export function sub(left, right) { return decimal(left) - decimal(right); }
export function mul(left, right) { return (decimal(left) * decimal(right) + SCALE / 2n) / SCALE; }
export function div(left, right) {
  const divisor = decimal(right);
  if (divisor === 0n) throw new RangeError("Division by zero.");
  return (decimal(left) * SCALE + divisor / 2n) / divisor;
}
export function percent(value, rate) { return div(mul(value, rate), 100); }
export function max(left, right) { return decimal(left) > decimal(right) ? decimal(left) : decimal(right); }
export function min(left, right) { return decimal(left) < decimal(right) ? decimal(left) : decimal(right); }

export function roundMoney(value, decimalPlaces = 2) {
  const places = Math.max(0, Math.min(6, Number(decimalPlaces || 0)));
  const factor = 10n ** BigInt(6 - places);
  const amount = decimal(value);
  const negative = amount < 0n;
  const absolute = negative ? -amount : amount;
  const rounded = ((absolute + factor / 2n) / factor) * factor;
  return negative ? -rounded : rounded;
}

export function formatDecimal(value, decimalPlaces = 6) {
  const places = Math.max(0, Math.min(6, Number(decimalPlaces)));
  const amount = decimal(value);
  const negative = amount < 0n;
  const absolute = negative ? -amount : amount;
  const whole = absolute / SCALE;
  const fraction = String(absolute % SCALE).padStart(6, "0").slice(0, places);
  return `${negative ? "-" : ""}${whole}${places ? `.${fraction}` : ""}`;
}

export function asDatabaseDecimal(value) { return formatDecimal(value, 6); }
export const MONEY_SCALE = SCALE;
