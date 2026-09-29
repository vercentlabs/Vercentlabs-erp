import { useId, type ReactNode } from "react";
import { cn } from "../utilities/cn.ts";

export interface ChartCardProps {
  className?: string;
  title: string;
  /** What is plotted and over which period — say it plainly, e.g. "Open
   * opportunities by stage" or "Leads created in the selected period". */
  description?: ReactNode;
  actions?: ReactNode;
  /** When true the card shows `emptyText` instead of a chart frame. */
  isEmpty?: boolean;
  emptyText?: string;
  /** Refetching: the previous chart stays in place, dimmed, so nothing jumps. */
  isBusy?: boolean;
  children: ReactNode;
}

/** The frame every chart sits in: a titled section, its plain-language
 * description, and a real empty state (never an empty SVG). */
export function ChartCard({
  className,
  title,
  description,
  actions,
  isEmpty,
  emptyText = "Nothing to show yet.",
  isBusy,
  children,
}: ChartCardProps) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      aria-busy={isBusy || undefined}
      className={cn(
        "flex min-w-0 flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4",
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 id={headingId} className="text-sm font-semibold text-text">
            {title}
          </h2>
          {description && <p className="text-xs text-text-muted">{description}</p>}
        </div>
        {actions}
      </div>
      {isEmpty ? (
        <p className="flex min-h-40 flex-1 items-center justify-center rounded-[var(--radius-control)] bg-surface-muted px-4 py-8 text-center text-sm text-text-muted">
          {emptyText}
        </p>
      ) : (
        <div
          className={cn(
            "flex min-w-0 flex-1 flex-col gap-3 transition-opacity duration-[var(--motion-standard)] motion-reduce:transition-none",
            isBusy && "opacity-60",
          )}
        >
          {children}
        </div>
      )}
    </section>
  );
}
