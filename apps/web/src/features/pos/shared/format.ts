// node-postgres returns NUMERIC columns as strings — coerce defensively
// (same rationale as apps/web/src/features/crm/shared/format.ts's money(),
// duplicated locally rather than cross-imported so POS doesn't depend on
// CRM's file layout).
export function money(currencyCode: string | null | undefined, value: number | string | null | undefined) {
  const numeric = typeof value === "number" ? value : Number(value ?? 0);
  const formatted = Number.isFinite(numeric) ? numeric.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : String(value);
  return `${currencyCode || ""} ${formatted}`.trim();
}
