import type { ReactNode } from "react";
import type { ChartValueFormatter } from "./chart-format.ts";

type TooltipEntry = {
  name?: string | number;
  value?: unknown;
  color?: string;
  fill?: string;
  dataKey?: unknown;
  payload?: unknown;
};

export interface ChartTooltipContentProps {
  active?: boolean;
  payload?: ReadonlyArray<TooltipEntry>;
  label?: ReactNode;
  valueFormatter?: ChartValueFormatter;
  /** Replaces the heading (defaults to the hovered category). */
  title?: (datum: unknown) => ReactNode;
  /** An extra line under the values, e.g. "4 opportunities". */
  footer?: (datum: unknown) => ReactNode;
}

/** The hover/focus card for Recharts charts, in design-system typography.
 * It repeats values that are always also in the chart's table or legend —
 * a tooltip is never the only way to read a number. */
export function ChartTooltipContent({ active, payload, label, valueFormatter, title, footer }: ChartTooltipContentProps) {
  if (!active || !payload?.length) return null;
  const datum = payload[0]?.payload;
  return (
    <div className="flex min-w-40 flex-col gap-1.5 rounded-[var(--radius-control)] border border-border bg-surface-raised px-3 py-2 text-xs shadow-[var(--shadow-panel)]">
      <p className="font-semibold text-text">{title ? title(datum) : label}</p>
      <ul className="flex flex-col gap-1">
        {payload.map((entry) => {
          const numeric = typeof entry.value === "number" ? entry.value : Number(entry.value);
          return (
            <li key={String(entry.dataKey ?? entry.name)} className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-1.5 text-text-secondary">
                <span
                  aria-hidden="true"
                  className="size-2.5 rounded-[3px]"
                  style={{ backgroundColor: entry.color ?? entry.fill }}
                />
                {entry.name}
              </span>
              <span className="font-medium tabular-nums text-text">
                {valueFormatter && Number.isFinite(numeric) ? valueFormatter(numeric) : String(entry.value ?? "")}
              </span>
            </li>
          );
        })}
      </ul>
      {footer && <p className="text-text-muted">{footer(datum)}</p>}
    </div>
  );
}
