import { MetricCard, type MetricCardProps } from "./MetricCard.tsx";
import { cn } from "../utilities/cn.ts";

export interface MetricStripProps {
  className?: string;
  metrics: MetricCardProps[];
}

/** A row of MetricCards — module-home KPI strip. Keep this short (4-6
 * metrics); a long strip stops being scannable, which defeats the point.
 * Uses auto-fit so a count that doesn't evenly divide the row (5, 6, …)
 * stretches to fill it instead of leaving a partial row with dead,
 * empty grid cells trailing off to the right. */
export function MetricStrip({ className, metrics }: MetricStripProps) {
  return (
    <div className={cn("grid grid-cols-[repeat(auto-fit,minmax(200px,280px))] gap-3", className)}>
      {metrics.map((metric, i) => (
        <MetricCard key={i} {...metric} />
      ))}
    </div>
  );
}
