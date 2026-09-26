"use client";

import { dueLabel, dueState, formatDateTime } from "@/shared/format/human";

// A due date with its urgency stated: overdue work is marked in words and an icon, in red, and never reads as ordinary
// planned work. Finished work shows the date only.
export function DueCell({ value, done, empty = "Not set" }: { value: string | null | undefined; done?: boolean; empty?: string }) {
  if (!value) return <span className="text-text-muted">{empty}</span>;
  const state = done ? "none" : dueState(value);
  return (
    <span className="flex flex-col">
      <span className={state === "overdue" ? "font-medium text-danger" : "text-text"}>{formatDateTime(value)}</span>
      {state === "overdue" && <span className="text-xs font-medium text-danger">{`⚠ ${dueLabel(value)}`}</span>}
      {state === "today" && <span className="text-xs font-medium text-warning">Due today</span>}
    </span>
  );
}
