/** Formats a plotted number for an axis tick, tooltip or table cell. Money
 * formatting (currency symbol, locale) is the caller's to supply — the chart
 * primitives never guess a currency. */
export type ChartValueFormatter = (value: number) => string;

/** Series colours in their fixed order (packages/design-tokens chart.*).
 * Assign by the entity a series stands for, never by its rank, so a series
 * keeps its colour whatever else is shown beside it. */
export const chartSeriesColor = {
  1: "var(--color-chart-series-1)",
  2: "var(--color-chart-series-2)",
  3: "var(--color-chart-series-3)",
} as const;

/** Colours for a record state (e.g. a qualification decision). Always shown
 * with the state's name beside it — never colour alone. */
export const chartStateColor = {
  positive: "var(--color-chart-state-positive)",
  pending: "var(--color-chart-state-pending)",
  neutral: "var(--color-chart-state-neutral)",
} as const;

/** Numeric aggregates often arrive as strings (Postgres ::numeric). */
export function toChartNumber(value: number | string | null | undefined): number {
  if (value === null || value === undefined || value === "") return 0;
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

/** 1,284 → "1.3K" (en-IN: 1,28,400 → "1.3L"); whole numbers under 1,000 stay exact. */
export function formatCompactNumber(value: number, locale = "en-IN"): string {
  return new Intl.NumberFormat(locale, {
    notation: Math.abs(value) >= 1000 ? "compact" : "standard",
    maximumFractionDigits: Math.abs(value) >= 1000 ? 1 : 2,
  }).format(value);
}

/** A share of a total as a whole percentage; a non-zero share that rounds to
 * nothing reads "<1%" rather than a misleading "0%". */
export function formatShare(part: number, total: number): string {
  if (total <= 0 || part <= 0) return "0%";
  const percent = (part / total) * 100;
  if (percent < 1) return "<1%";
  return `${Math.round(percent)}%`;
}

/** True when there is nothing to plot: no rows, or every plotted value is 0.
 * A chart in that state shows its empty message instead of an empty frame. */
export function isChartEmpty<T extends object>(rows: readonly T[], keys: readonly (keyof T & string)[]): boolean {
  return rows.every((row) => keys.every((key) => toChartNumber(row[key] as number | string | null | undefined) === 0));
}

/** Shortens a category label for a narrow axis; the full label stays in the
 * tooltip and the data table. */
export function truncateLabel(label: string, maxCharacters: number): string {
  if (label.length <= maxCharacters) return label;
  return `${label.slice(0, Math.max(1, maxCharacters - 1)).trimEnd()}…`;
}

/** Round value-axis ticks from 0 (steps of 1, 2, 2.5 or 5 × 10ⁿ), so an axis
 * reads 0 / 50K / 100K rather than 0 / 65K / 130K. Counts get whole steps. */
export function niceTicks(max: number, targetCount = 4, integer = false): number[] {
  if (!(max > 0)) return [0, 1];
  const rough = max / targetCount;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step =
    [1, 2, 2.5, 5, 10].map((factor) => factor * magnitude).find((candidate) => candidate >= rough && (!integer || Number.isInteger(candidate))) ??
    10 * magnitude;
  const wholeStep = integer ? Math.max(1, Math.ceil(step)) : step;
  const ticks: number[] = [];
  for (let value = 0; value < max + wholeStep; value += wholeStep) {
    ticks.push(Number(value.toPrecision(12)));
    if (value >= max) break;
  }
  return ticks;
}
