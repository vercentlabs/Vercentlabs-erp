import { cn } from "../utilities/cn.ts";
import { followLink } from "../utilities/follow-link.ts";

export interface ChartLegendItem {
  key: string;
  label: string;
  /** A chart colour (chartSeriesColor / chartStateColor). Marks the swatch
   * only — the label and value always use text colours. */
  color: string;
  /** The exact figure, already formatted. */
  value?: string;
  /** A secondary figure, e.g. a percentage of the total. */
  detail?: string;
  /** The records behind this item. */
  href?: string;
}

export interface ChartLegendProps {
  className?: string;
  items: ChartLegendItem[];
  /** "inline" names the series of a bar chart; "list" is a donut's key,
   * one row per segment with its value. */
  variant?: "inline" | "list";
  /** Called instead of a full page load when an item link is followed
   * (e.g. the app router's push). Modified clicks still open normally. */
  onNavigate?: (href: string) => void;
  "aria-label"?: string;
}

function Swatch({ color }: { color: string }) {
  return <span aria-hidden="true" className="size-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: color }} />;
}

/** Names what each colour means, in words. Present on every chart with two
 * or more series, so no reader has to match colours to understand it. */
export function ChartLegend({ className, items, variant = "inline", onNavigate, ...rest }: ChartLegendProps) {
  if (variant === "inline")
    return (
      <ul aria-label={rest["aria-label"] ?? "Legend"} className={cn("flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-secondary", className)}>
        {items.map((item) => (
          <li key={item.key} className="flex items-center gap-1.5">
            <Swatch color={item.color} />
            {item.label}
            {item.value && <span className="tabular-nums text-text-muted">{item.value}</span>}
          </li>
        ))}
      </ul>
    );
  return (
    <ul aria-label={rest["aria-label"] ?? "Legend"} className={cn("flex flex-col divide-y divide-border text-sm", className)}>
      {items.map((item) => {
        const body = (
          <>
            <span className="flex min-w-0 items-center gap-2">
              <Swatch color={item.color} />
              <span className="truncate text-text">{item.label}</span>
            </span>
            <span className="flex shrink-0 items-baseline gap-2 tabular-nums">
              {item.value && <span className="font-semibold text-text">{item.value}</span>}
              {item.detail && <span className="text-xs text-text-muted">{item.detail}</span>}
            </span>
          </>
        );
        const rowClass = "flex min-h-10 items-center justify-between gap-3 px-1 py-2";
        return (
          <li key={item.key}>
            {item.href ? (
              <a
                href={item.href}
                onClick={(event) => followLink(event, item.href!, onNavigate)}
                className={cn(
                  rowClass,
                  "rounded-[var(--radius-control)] outline-none hover:bg-surface-muted focus-visible:ring-2 focus-visible:ring-brand",
                )}
              >
                {body}
              </a>
            ) : (
              <div className={rowClass}>{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
