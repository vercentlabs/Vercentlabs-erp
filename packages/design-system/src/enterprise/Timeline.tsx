import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Circle } from "lucide-react";
import { cn } from "../utilities/cn.ts";

export interface TimelineEntry {
  id: string;
  icon?: LucideIcon;
  tone?: "neutral" | "info" | "success" | "warning" | "danger";
  /** The actor + verb + object line, e.g. "Alex Rivera changed stage to Qualified". */
  title: ReactNode;
  description?: ReactNode;
  /** Pre-formatted timestamp (e.g. "2 hours ago" or a localized date) —
   * this component doesn't format dates itself. */
  timestamp: ReactNode;
}

const toneClasses = {
  neutral: "bg-canvas-strong text-text-secondary",
  info: "bg-info-soft text-info",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
};

export interface TimelineProps {
  className?: string;
  entries: TimelineEntry[];
  emptyMessage?: string;
}

/**
 * Shared vertical timeline rendering — ActivityTimeline/AuditTimeline/
 * ApprovalTimeline below are the same visual pattern with different entry
 * semantics, not different implementations, per the "don't build five
 * components for the same behavior" instruction.
 */
export function Timeline({ className, entries, emptyMessage = "No activity yet" }: TimelineProps) {
  if (entries.length === 0) {
    return <p className={cn("text-sm text-text-muted", className)}>{emptyMessage}</p>;
  }
  return (
    <ol className={cn("flex flex-col", className)}>
      {entries.map((entry, i) => {
        const Icon = entry.icon ?? Circle;
        const isLast = i === entries.length - 1;
        return (
          <li key={entry.id} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-full", toneClasses[entry.tone ?? "neutral"])}>
                <Icon className="size-3.5" aria-hidden="true" />
              </span>
              {!isLast && <span className="w-px flex-1 bg-border" aria-hidden="true" />}
            </div>
            <div className={cn("flex flex-col gap-0.5", isLast ? "pb-0" : "pb-4")}>
              <p className="text-sm text-text">{entry.title}</p>
              {entry.description && <p className="text-sm text-text-secondary">{entry.description}</p>}
              <p className="text-xs text-text-muted">{entry.timestamp}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export { Timeline as ActivityTimeline, Timeline as AuditTimeline, Timeline as ApprovalTimeline };
export type { TimelineProps as ActivityTimelineProps, TimelineProps as AuditTimelineProps, TimelineProps as ApprovalTimelineProps };
