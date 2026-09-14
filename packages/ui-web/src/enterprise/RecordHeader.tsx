import type { ReactNode } from "react";

import { cn } from "../utils/cn";

// The shared "Record 360" header archetype (identity + status + score +
// indicators + primary action + secondary menu) -- see
// docs/ux/UI_REWRITE_TRACKER.md's Lead 360 spec. Deliberately generic:
// `metrics`/`indicators` are caller-rendered ReactNode slots rather than a
// fixed CRM-shaped prop list, since other modules' 360 pages need the same
// shell with different domain data.
export function RecordHeader({
  avatar,
  title,
  subtitle,
  status,
  indicators,
  metrics,
  primaryAction,
  secondaryActions,
  className,
}: {
  avatar?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Lifecycle/status badge(s), e.g. a StatusBadge for stage. */
  status?: ReactNode;
  /** Small inline flags -- duplicate warning, stale, sensitive-field lock, etc. */
  indicators?: ReactNode;
  /** Score/estimated-value/age -- rendered as MetricCard(s) by the caller. */
  metrics?: ReactNode;
  primaryAction?: ReactNode;
  /** A DropdownMenu trigger for the secondary action list. */
  secondaryActions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-4 rounded-[var(--radius-panel)] border border-[var(--color-border-default)] bg-[var(--color-surface)] p-5", className)}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          {avatar}
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[length:var(--text-xl)] font-semibold text-[var(--color-text-primary)]">{title}</h1>
              {status}
              {indicators}
            </div>
            {subtitle ? <p className="mt-1 text-[length:var(--text-sm)] text-[var(--color-text-secondary)]">{subtitle}</p> : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {primaryAction}
          {secondaryActions}
        </div>
      </div>
      {metrics ? <div className="flex flex-wrap gap-3">{metrics}</div> : null}
    </div>
  );
}
