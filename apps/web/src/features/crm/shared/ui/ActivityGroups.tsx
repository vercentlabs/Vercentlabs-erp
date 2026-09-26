"use client";

import { StatusBadge } from "@vercentlabs/design-system";

import { dueLabel, dueState, formatDateTime, humanize } from "@/shared/format/human";

export type ActivityRow = { id: string; activityType: string; subject: string | null; status: string; dueAt: string | null; assignedName?: string | null; href: string | null };

const GROUPS: Array<{ key: "overdue" | "today" | "upcoming"; title: string }> = [
  { key: "overdue", title: "Overdue" },
  { key: "today", title: "Today" },
  { key: "upcoming", title: "Upcoming" },
];

// Overdue, Today and Upcoming as three visibly different groups. An overdue item is marked in words and an icon as
// well as colour, and never sits among ordinary planned work.
export function ActivityGroups({ activities, onOpen, showAssignee, emptyText }: { activities: ActivityRow[]; onOpen: (href: string) => void; showAssignee?: boolean; emptyText: string }) {
  const grouped = { overdue: [] as ActivityRow[], today: [] as ActivityRow[], upcoming: [] as ActivityRow[] };
  for (const a of activities) {
    const state = dueState(a.dueAt);
    grouped[state === "none" ? "upcoming" : state].push(a);
  }
  if (activities.length === 0) return <p className="text-sm text-text-muted">{emptyText}</p>;
  return (
    <div className="flex flex-col gap-4">
      {GROUPS.filter((g) => grouped[g.key].length > 0).map((group) => (
        <section key={group.key} aria-label={`${group.title} activities`} className="flex flex-col gap-1">
          <h3 className={`text-xs font-semibold uppercase tracking-wide ${group.key === "overdue" ? "text-danger" : "text-text-muted"}`}>
            {group.key === "overdue" ? "⚠ " : ""}
            {group.title} <span className="font-normal">({grouped[group.key].length})</span>
          </h3>
          <ul className="flex flex-col divide-y divide-border rounded-[var(--radius-control)] border border-border">
            {grouped[group.key].map((a) => (
              <li key={a.id} className={group.key === "overdue" ? "border-l-2 border-l-danger" : ""}>
                <button type="button" disabled={!a.href} onClick={() => a.href && onOpen(a.href)} className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left disabled:cursor-default">
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-sm text-text">{a.subject || "No subject"}</span>
                    <span className="text-xs text-text-muted">
                      {humanize(a.activityType)}
                      {showAssignee ? ` · ${a.assignedName || "Unassigned"}` : ""}
                      {a.dueAt ? ` · ${formatDateTime(a.dueAt)}` : ""}
                    </span>
                  </div>
                  <span className="flex shrink-0 items-center gap-2">
                    {group.key === "overdue" && <span className="text-xs font-medium text-danger">{dueLabel(a.dueAt)}</span>}
                    <StatusBadge tone={group.key === "overdue" ? "danger" : "neutral"}>{group.key === "overdue" ? "overdue" : a.status}</StatusBadge>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
