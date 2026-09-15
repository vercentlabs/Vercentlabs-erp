// node-postgres returns NUMERIC/DECIMAL columns as strings (to avoid float
// precision loss), not numbers — no type parser override exists anywhere
// in this codebase (checked apps/web/src/core/db.ts, packages/database).
// Every ::numeric-cast aggregate this session's screens render (dashboard
// pipeline/weighted totals, stage/forecast amounts) is therefore a numeric
// string at runtime even though it's convenient to type it as `number`.
// Coerce defensively here rather than calling .toLocaleString() on what
// may actually be a string (harmless — String.prototype.toLocaleString()
// is a no-op — but renders with no thousands separators).
export function money(currencyCode: string | null | undefined, value: number | string) {
  const numeric = typeof value === "number" ? value : Number(value);
  const formatted = Number.isFinite(numeric) ? numeric.toLocaleString() : String(value);
  return `${currencyCode || ""} ${formatted}`.trim();
}

// F024/F025/F030 Tranche K numeric sweep — the same coercion boundary as
// money(), for call sites that need the actual number (arithmetic,
// sorting) rather than a currency-prefixed display string. Coercing
// `card.amount ?? 0` in a reduce() WITHOUT this was a real, live bug on
// the Pipeline board (not just a latent risk): `0 + "5000.00"` is
// JavaScript STRING concatenation, not addition, once amount is a
// numeric-column string — the accumulator silently became a garbled
// string across the whole reduce, not a sum.
export function toNumber(value: number | string | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}
