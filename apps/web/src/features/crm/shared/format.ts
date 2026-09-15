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
