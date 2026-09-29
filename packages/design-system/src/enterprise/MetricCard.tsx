import type { ReactNode } from "react";
import { ArrowUp, ArrowDown } from "lucide-react";
import { cn } from "../utilities/cn.ts";
import { followLink } from "../utilities/follow-link.ts";

export interface MetricCardProps {
  className?: string;
  label: string;
  /** The formatted value — format currency/percentages/counts before
   * passing in (Intl.NumberFormat), don't let this component guess. */
  value: ReactNode;
  /** A supporting figure under the value, e.g. "₹4.2L weighted". */
  detail?: ReactNode;
  /** Change vs. a prior period, e.g. { direction: "up", label: "12% vs last month" }.
   * Omit rather than fabricating a comparison the backend doesn't provide. */
  change?: { direction: "up" | "down" | "flat"; label: string; isPositive?: boolean };
  /** The list of records behind the value; the whole card becomes a link. */
  href?: string;
  /** Called instead of a full page load when the card link is followed. */
  onNavigate?: (href: string) => void;
  /** Accessible name for the card link, when the visible text is not enough. */
  linkLabel?: string;
}

/** A single metric — always real, backend-provided data. Never render this
 * with a placeholder/fabricated number; if the metric genuinely isn't
 * available yet, use an ErrorState or omit the card, not a fake "--" value
 * dressed up as real. */
export function MetricCard({ className, label, value, detail, change, href, onNavigate, linkLabel }: MetricCardProps) {
  const ChangeIcon = change?.direction === "up" ? ArrowUp : change?.direction === "down" ? ArrowDown : null;
  const changeIsGood = change?.isPositive ?? (change?.direction === "up");
  const body = (
    <>
      <p className="text-xs font-medium text-text-muted">{label}</p>
      <p className="text-2xl font-semibold tabular-nums text-text">{value}</p>
      {detail && <p className="text-xs text-text-secondary">{detail}</p>}
      {change && (
        <p className={cn("flex items-center gap-1 text-xs font-medium", changeIsGood ? "text-success" : "text-danger")}>
          {ChangeIcon && <ChangeIcon className="size-3" aria-hidden="true" />}
          {change.label}
        </p>
      )}
    </>
  );
  const base = "flex flex-col gap-1 rounded-[var(--radius-card)] border border-border bg-surface p-4";
  if (!href) return <div className={cn(base, className)}>{body}</div>;
  return (
    <a
      href={href}
      aria-label={linkLabel}
      onClick={(event) => followLink(event, href, onNavigate)}
      className={cn(
        base,
        "outline-none transition-colors hover:border-brand-border hover:bg-surface-muted focus-visible:ring-2 focus-visible:ring-brand motion-reduce:transition-none",
        className,
      )}
    >
      {body}
    </a>
  );
}
