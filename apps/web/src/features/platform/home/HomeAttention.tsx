"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { listFollowUps } from "@/features/crm/follow-ups/api/follow-ups-api";
import { listTasks } from "@/features/crm/tasks/api/tasks-api";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";

type Card = { label: string; count: number | null; href: string; failed?: boolean; loading?: boolean; hint: string };

function AttentionCard({ card }: { card: Card }) {
  return (
    <Link href={card.href} className="flex flex-col gap-1 rounded-[var(--radius-card)] border border-border bg-surface p-4 hover:border-border-strong hover:bg-surface-muted">
      <span className="text-sm text-text-secondary">{card.label}</span>
      <span className="text-2xl font-semibold tabular-nums text-text">
        {card.loading ? <span className="text-text-muted">…</span> : card.failed ? <span className="text-base font-normal text-text-secondary">Unavailable</span> : card.count}
      </span>
      <span className="text-xs text-text-secondary">{card.failed ? "Could not be loaded. Open it to try again." : card.hint}</span>
    </Link>
  );
}

// The counts come from the same endpoints the pages behind them use, so a number here always matches what the person
// sees after opening it. Nothing is estimated.
export function HomeAttention({ pendingApprovals, unreadNotifications, canApprove }: { pendingApprovals: number; unreadNotifications: number; canApprove: boolean }) {
  const workspace = useWorkspaceContext();
  const hasCrm = workspace.accessibleModuleKeys.includes("crm");
  const overdueTasks = useQuery({
    queryKey: scopedQueryKey(workspace, "home", "overdue-tasks"),
    queryFn: async () => (await listTasks({ mine: true, due: "overdue", limit: 1 })).total,
    enabled: hasCrm,
    retry: false,
  });
  const overdueFollowUps = useQuery({
    queryKey: scopedQueryKey(workspace, "home", "overdue-follow-ups"),
    queryFn: async () => (await listFollowUps({ due: "overdue", limit: 1 })).total,
    enabled: hasCrm,
    retry: false,
  });

  const cards: Card[] = [];
  if (canApprove) cards.push({ label: "Waiting for your decision", count: pendingApprovals, href: "/approvals", hint: pendingApprovals === 0 ? "Nothing to approve" : "Open the approval queue" });
  cards.push({ label: "Unread notifications", count: unreadNotifications, href: "/notifications", hint: unreadNotifications === 0 ? "You are up to date" : "Open your notifications" });
  if (hasCrm) {
    cards.push({ label: "Overdue tasks", count: overdueTasks.data ?? null, loading: overdueTasks.isLoading, failed: overdueTasks.isError, href: "/crm/tasks?due=overdue", hint: overdueTasks.data === 0 ? "None overdue" : "Open your tasks" });
    cards.push({ label: "Overdue follow-ups", count: overdueFollowUps.data ?? null, loading: overdueFollowUps.isLoading, failed: overdueFollowUps.isError, href: "/crm/follow-ups", hint: overdueFollowUps.data === 0 ? "None overdue" : "Open your follow-ups" });
  }

  return (
    <section aria-label="Needs your attention" className="flex flex-col gap-3">
      <h2 className="text-base font-semibold text-text">Needs your attention</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => (
          <AttentionCard key={card.label} card={card} />
        ))}
      </div>
    </section>
  );
}
