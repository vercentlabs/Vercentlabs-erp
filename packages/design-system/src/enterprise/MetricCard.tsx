import type { ReactNode } from "react";
import { ArrowUp, ArrowDown } from "lucide-react";
import { cn } from "../utilities/cn.ts";

export interface MetricCardProps {
  className?: string;
  label: string;
  /** The formatted value — format currency/percentages/counts before
   * passing in (Intl.NumberFormat), don't let this component guess. */
  value: ReactNode;
  /** Change vs. a prior period, e.g. { direction: "up", label: "12% vs last month" }.
   * Omit rather than fabricating a comparison the backend doesn't provide. */
  change?: { direction: "up" | "down" | "flat"; label: string; isPositive?: boolean };
}

/** A single metric — always real, backend-provided data. Never render this
 * with a placeholder/fabricated number; if the metric genuinely isn't
 * available yet, use an ErrorState or omit the card, not a fake "--" value
 * dressed up as real. */
export function MetricCard({ className, label, value, change }: MetricCardProps) {
  const ChangeIcon = change?.direction === "up" ? ArrowUp : change?.direction === "down" ? ArrowDown : null;
  const changeIsGood = change?.isPositive ?? (change?.direction === "up");
  return (
    <div className={cn("flex flex-col gap-1 rounded-[var(--radius-card)] border border-border bg-surface p-4", className)}>
      <p className="text-xs font-medium text-text-muted">{label}</p>
      <p className="text-2xl font-semibold tabular-nums text-text">{value}</p>
      {change && (
        <p className={cn("flex items-center gap-1 text-xs font-medium", changeIsGood ? "text-success" : "text-danger")}>
          {ChangeIcon && <ChangeIcon className="size-3" aria-hidden="true" />}
          {change.label}
        </p>
      )}
    </div>
  );
}
