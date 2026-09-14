import { Circle } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "../utils/cn";

export interface ActivityTimelineItem {
  id: string;
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  timestamp: ReactNode;
  actor?: ReactNode;
}

// Shared vertical timeline shell for Record 360 activity feeds (calls,
// meetings, tasks, notes, follow-ups). Rendered as an <ol> so screen readers
// announce item count/position (SP032) rather than an unordered <div> soup.
export function ActivityTimeline({ items, emptyLabel = "No activity yet", className }: { items: ActivityTimelineItem[]; emptyLabel?: ReactNode; className?: string }) {
  if (items.length === 0) {
    return <p className="text-[length:var(--text-sm)] text-[var(--color-text-muted)]">{emptyLabel}</p>;
  }
  return (
    <ol className={cn("flex flex-col gap-4", className)}>
      {items.map((item) => (
        <li key={item.id} className="flex gap-3">
          <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-[var(--radius-pill)] bg-[var(--color-canvas-strong)] text-[var(--color-text-muted)]">
            {item.icon ?? <Circle className="size-3" aria-hidden="true" />}
          </span>
          <div className="flex-1">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-[length:var(--text-sm)] font-medium text-[var(--color-text-primary)]">{item.title}</p>
              <time className="text-[length:var(--text-xs)] text-[var(--color-text-muted)]">{item.timestamp}</time>
            </div>
            {item.description ? <p className="mt-0.5 text-[length:var(--text-sm)] text-[var(--color-text-secondary)]">{item.description}</p> : null}
            {item.actor ? <p className="mt-0.5 text-[length:var(--text-xs)] text-[var(--color-text-muted)]">{item.actor}</p> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

export interface AuditTimelineEntry {
  id: string;
  field: ReactNode;
  from: ReactNode;
  to: ReactNode;
  changedBy: ReactNode;
  timestamp: ReactNode;
}

// Audit history is a distinct data shape from a free-form activity feed
// (field-level before/after diffs, always attributed, never
// caller-omittable) -- so this is a real second component, not
// ActivityTimeline re-labeled.
export function AuditTimeline({ entries, emptyLabel = "No changes recorded", className }: { entries: AuditTimelineEntry[]; emptyLabel?: ReactNode; className?: string }) {
  if (entries.length === 0) {
    return <p className="text-[length:var(--text-sm)] text-[var(--color-text-muted)]">{emptyLabel}</p>;
  }
  return (
    <ol className={cn("flex flex-col gap-3", className)}>
      {entries.map((entry) => (
        <li key={entry.id} className="rounded-[var(--radius-card)] border border-[var(--color-border-default)] px-3 py-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-[length:var(--text-sm)] font-medium text-[var(--color-text-primary)]">{entry.field}</p>
            <time className="text-[length:var(--text-xs)] text-[var(--color-text-muted)]">{entry.timestamp}</time>
          </div>
          <p className="mt-0.5 text-[length:var(--text-sm)] text-[var(--color-text-secondary)]">
            <span className="line-through opacity-70">{entry.from}</span> &rarr; <span className="font-medium text-[var(--color-text-primary)]">{entry.to}</span>
          </p>
          <p className="mt-0.5 text-[length:var(--text-xs)] text-[var(--color-text-muted)]">{entry.changedBy}</p>
        </li>
      ))}
    </ol>
  );
}
