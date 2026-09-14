import { MetricCard, type MetricCardProps } from "./MetricCard.tsx";
import { cn } from "../utilities/cn.ts";

export interface MetricStripProps {
  className?: string;
  metrics: MetricCardProps[];
}

/** A row of MetricCards — module-home KPI strip. Keep this short (4-6
 * metrics); a long strip stops being scannable, which defeats the point. */
export function MetricStrip({ className, metrics }: MetricStripProps) {
  return (
    <div className={cn("grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4", className)}>
      {metrics.map((metric, i) => (
        <MetricCard key={i} {...metric} />
      ))}
    </div>
  );
}
