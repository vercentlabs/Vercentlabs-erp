"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { EmptyState, ErrorState, PageHeader } from "@vercentlabs/design-system";

import { listFollowUps } from "@/features/crm/follow-ups/api/follow-ups-api";
import { listTasks } from "@/features/crm/tasks/api/tasks-api";
import { dueLabel, formatDateTime, humanize } from "@/features/crm/shared/human";
import { LoadingState } from "@/features/crm/shared/ui/LoadingState";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";

type Approval = { id: string; title: string; requested_at: string; entity_type: string };
type WorkItem = { id: string; subject: string; dueAt: string | null; href: string; kind: string };

async function fetchPendingApprovals(): Promise<Approval[]> {
  const response = await fetch("/api/approvals?status=pending");
  const payload = (await response.json()) as { ok: boolean; approvals?: Approval[]; message?: string };
  if (!response.ok || !payload.ok) throw new Error(payload.message || "Could not load approvals.");
  return payload.approvals ?? [];
}

const DUE_GROUPS = [
  { due: "overdue", title: "Overdue" },
  { due: "today", title: "Due today" },
  { due: "upcoming", title: "Coming up" },
] as const;

async function fetchCrmWork(due: "overdue" | "today" | "upcoming"): Promise<WorkItem[]> {
  const [tasks, followUps] = await Promise.all([listTasks({ mine: true, due, limit: 10 }), listFollowUps({ due, limit: 10 })]);
  return [
    ...tasks.rows.map((row) => ({ id: row.id, subject: row.subject, dueAt: row.dueAt, href: `/crm/tasks/${row.id}`, kind: "Task" })),
    ...followUps.rows.map((row) => ({ id: row.id, subject: row.subject, dueAt: row.dueAt, href: `/crm/follow-ups/${row.id}`, kind: "Follow-up" })),
  ].sort((a, b) => String(a.dueAt ?? "").localeCompare(String(b.dueAt ?? "")));
}

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4">
      <div>
        <h2 className="text-base font-semibold text-text">{title}</h2>
        {description && <p className="text-xs text-text-muted">{description}</p>}
      </div>
      {children}
    </section>
  );
}

function ApprovalsSection() {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "my-work", "approvals"), queryFn: fetchPendingApprovals, retry: false });
  return (
    <Section title="Waiting for your decision" description="Requests that need you to approve or reject.">
      {query.isLoading && <LoadingState label="Loading approvals" rows={2} onRetry={() => query.refetch()} />}
      {query.isError && <ErrorState title="Could not load approvals" action={{ label: "Try again", onPress: () => void query.refetch() }} />}
      {query.isSuccess && query.data.length === 0 && <p className="text-sm text-text-secondary">Nothing is waiting for you.</p>}
      {query.isSuccess && query.data.length > 0 && (
        <ul className="flex flex-col divide-y divide-border">
          {query.data.slice(0, 10).map((approval) => (
            <li key={approval.id} className="flex items-center justify-between gap-3 py-2">
              <Link href="/approvals" className="text-sm font-medium text-text hover:underline">{approval.title}</Link>
              <span className="shrink-0 text-xs text-text-secondary">{`${humanize(approval.entity_type)}, ${formatDateTime(approval.requested_at)}`}</span>
            </li>
          ))}
        </ul>
      )}
      {query.isSuccess && query.data.length > 10 && <Link href="/approvals" className="text-sm font-medium text-brand hover:underline">{`See all ${query.data.length} requests`}</Link>}
    </Section>
  );
}

function CrmWorkGroup({ due, title }: { due: "overdue" | "today" | "upcoming"; title: string }) {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "my-work", "crm", due), queryFn: () => fetchCrmWork(due), retry: false });
  if (query.isLoading) return <LoadingState label={`Loading ${title.toLowerCase()}`} rows={2} onRetry={() => query.refetch()} />;
  if (query.isError) return <ErrorState title={`Could not load ${title.toLowerCase()}`} action={{ label: "Try again", onPress: () => void query.refetch() }} />;
  if ((query.data ?? []).length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-sm font-semibold text-text">{title}</h3>
      <ul className="flex flex-col divide-y divide-border">
        {(query.data ?? []).map((item) => (
          <li key={`${item.kind}-${item.id}`} className="flex items-center justify-between gap-3 py-2">
            <Link href={item.href} className="min-w-0 truncate text-sm font-medium text-text hover:underline">{item.subject}</Link>
            <span className={`shrink-0 text-xs ${due === "overdue" ? "text-danger" : "text-text-secondary"}`}>{`${item.kind}, ${item.dueAt ? dueLabel(item.dueAt) : "no due date"}`}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CrmSection() {
  const workspace = useWorkspaceContext();
  const overdue = useQuery({ queryKey: scopedQueryKey(workspace, "my-work", "crm", "overdue"), queryFn: () => fetchCrmWork("overdue"), retry: false });
  const today = useQuery({ queryKey: scopedQueryKey(workspace, "my-work", "crm", "today"), queryFn: () => fetchCrmWork("today"), retry: false });
  const upcoming = useQuery({ queryKey: scopedQueryKey(workspace, "my-work", "crm", "upcoming"), queryFn: () => fetchCrmWork("upcoming"), retry: false });
  const settled = [overdue, today, upcoming].every((query) => query.isSuccess);
  const empty = settled && [overdue, today, upcoming].every((query) => (query.data ?? []).length === 0);
  return (
    <Section title="Tasks and follow-ups" description="From CRM, oldest first.">
      {empty ? (
        <EmptyState title="You are all caught up" description="No tasks or follow-ups are overdue, due today or coming up." />
      ) : (
        <div className="flex flex-col gap-4">
          {DUE_GROUPS.map((group) => (
            <CrmWorkGroup key={group.due} due={group.due} title={group.title} />
          ))}
        </div>
      )}
      <Link href="/crm/tasks" className="text-sm font-medium text-brand hover:underline">Open all tasks</Link>
    </Section>
  );
}

export function MyWorkScreen() {
  const workspace = useWorkspaceContext();
  const hasCrm = workspace.accessibleModuleKeys.includes("crm");
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="My work" description="What needs you today, gathered from the modules you use." />
      <ApprovalsSection />
      {hasCrm ? <CrmSection /> : <p className="text-sm text-text-secondary">Tasks from the other modules will appear here as they are connected.</p>}
    </div>
  );
}
