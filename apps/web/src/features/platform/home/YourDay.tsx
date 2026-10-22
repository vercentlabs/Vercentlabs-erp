"use client";

// Home's "Your day": the few numbers someone acts on first, each a link to the work — their overdue and due-today CRM to-dos (when they
// have CRM), approvals waiting for them and unread notifications (only when there are some). Laid out like the to-do queue strip; a
// zero is shown quietly, a count that needs attention in its colour. Nothing to show, nothing rendered.
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

type Card = { key: string; label: string; count: number; href: string; tone: "danger" | "warning" | "brand" };
// Full class names (not built from the count) so Tailwind keeps them.
const COLUMNS: Record<number, string> = { 1: "grid-cols-1", 2: "grid-cols-2", 3: "grid-cols-2 sm:grid-cols-3", 4: "grid-cols-2 sm:grid-cols-4" };
const TONE: Record<Card["tone"], string> = { danger: "text-danger", warning: "text-warning", brand: "text-brand" };

async function myTodoCounts(): Promise<{ overdue: number; today: number }> {
  const response = await fetch("/api/crm/todos?scope=mine&queue=open&limit=1", { credentials: "same-origin" });
  if (!response.ok) throw new Error("To-dos could not be counted.");
  const { counts } = (await response.json()) as { counts: { overdue: number; today: number } };
  return counts;
}

export function YourDay({ crm, pendingApprovalCount, unreadNotificationCount }: { crm: boolean; pendingApprovalCount: number; unreadNotificationCount: number }) {
  const workspace = useWorkspaceContext();
  // Someone with CRM but no to-do permission gets a refusal: their CRM cards are simply left out.
  const todos = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "todos", "home-counts"), queryFn: myTodoCounts, enabled: crm, retry: false, staleTime: 60_000 });

  const cards: Card[] = [
    ...(todos.data ? [
      { key: "overdue", label: "Overdue to-dos", count: todos.data.overdue, href: "/crm/activities?scope=mine&queue=overdue", tone: "danger" as const },
      { key: "today", label: "Due today", count: todos.data.today, href: "/crm/activities?scope=mine&queue=today", tone: "warning" as const },
    ] : []),
    ...(pendingApprovalCount > 0 ? [{ key: "approvals", label: "Approvals waiting", count: pendingApprovalCount, href: "/approvals", tone: "brand" as const }] : []),
    ...(unreadNotificationCount > 0 ? [{ key: "notifications", label: "Unread notifications", count: unreadNotificationCount, href: "/notifications", tone: "brand" as const }] : []),
  ];
  if (!cards.length) return null;

  return (
    <section aria-labelledby="your-day" className="flex w-full max-w-2xl flex-col gap-2">
      <h2 id="your-day" className="text-center text-sm font-semibold text-text-secondary">Your day</h2>
      <ul className={`grid gap-px overflow-hidden rounded-[var(--radius-card)] border border-border bg-border ${COLUMNS[cards.length]}`}>
        {cards.map((card) => (
          <li key={card.key} className="flex">
            <Link href={card.href} className="flex flex-1 flex-col gap-1 bg-surface px-4 py-3 outline-none transition-colors hover:bg-surface-muted focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-inset">
              <span className="truncate text-xs font-medium text-text-secondary">{card.label}</span>
              <span className={`text-xl leading-7 font-semibold tabular-nums ${card.count ? TONE[card.tone] : "text-text-muted"}`}>{card.count}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
