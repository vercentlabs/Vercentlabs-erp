"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@vercentlabs/design-system";

import { ProjectsApiError, readView } from "@/features/projects/shared/client";
import { ProjectsAlert, ProjectsPanel } from "@/features/projects/shared/ProjectsUi";
import { calendarDate, label, money } from "@/features/projects/shared/format";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";

type Desk = Record<string, unknown>;
type Counts = Record<string, number>;

const ATTENTION: Array<[string, string, string]> = [
  ["myOpenTasks", "My open tasks", "/projects/tasks"],
  ["myOverdueTasks", "My overdue tasks", "/projects/tasks"],
  ["overdueTasks", "Overdue tasks", "/projects/tasks"],
  ["blockedTasks", "Blocked tasks", "/projects/tasks"],
  ["overdueProjects", "Projects past their end date", "/projects/all"],
  ["openIssues", "Open issues", "/projects/issues"],
  ["seriousIssues", "Serious open issues", "/projects/issues"],
  ["highRisks", "High-scoring risks", "/projects/risks"],
];
const APPROVALS: Array<[string, string, string]> = [
  ["timesheets", "Timesheets", "/projects/timesheets"],
  ["expenses", "Expenses", "/projects/expenses"],
  ["budgets", "Budgets", "/projects/budgets"],
  ["baselines", "Baselines", "/projects/workspace"],
  ["billing", "Billing lines", "/projects/billing"],
];
const SHORTCUTS = [["All projects", "/projects/all"], ["Tasks", "/projects/tasks"], ["Board and schedule", "/projects/workspace"], ["Time", "/projects/time"], ["Billing", "/projects/billing"], ["Reports", "/projects/reports"]] as const;

export function ProjectsDashboardScreen() {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "dashboard"), queryFn: async () => (await readView<{ dashboard: Desk }>("dashboard")).dashboard });
  const d = query.data;
  const error = query.error instanceof ProjectsApiError ? query.error.message : query.isError ? "The dashboard could not be loaded." : null;
  const approvals = (d?.pendingApprovals ?? null) as Counts | null;
  const milestones = (d?.upcomingMilestones ?? []) as Array<{ id: string; name: string; planned_date: string; project_number: string }>;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Projects" description="Planning, delivery, time, cost and billing across your projects." />
      {error && <ProjectsAlert>{error}</ProjectsAlert>}
      {d && (
        <>
          <ProjectsPanel title="Portfolio">
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {Object.entries((d.projectsByStatus ?? {}) as Counts).map(([k, v]) => (
                <div key={k}><dt className="text-xs text-text-muted">{label(k)}</dt><dd className="text-xl font-semibold tabular-nums">{v}</dd></div>
              ))}
              {Object.entries((d.activeByHealth ?? {}) as Counts).map(([k, v]) => (
                <div key={k}><dt className="text-xs text-text-muted">Live, {label(k).toLowerCase()}</dt><dd className="text-xl font-semibold tabular-nums">{v}</dd></div>
              ))}
            </dl>
          </ProjectsPanel>
          <ProjectsPanel title="Needs attention">
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-4">
              {ATTENTION.map(([key, text, href]) => (
                <li key={key}>
                  <Link href={href} className="flex items-baseline justify-between rounded-[var(--radius-control)] border border-border px-3 py-2 text-sm hover:bg-surface-hover">
                    <span>{text}</span>
                    <span className="text-lg font-semibold tabular-nums">{String(d[key] ?? 0)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </ProjectsPanel>
          {approvals && (
            <ProjectsPanel title="Waiting for your approval">
              <ul className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                {APPROVALS.map(([key, text, href]) => (
                  <li key={key}>
                    <Link href={href} className="flex items-baseline justify-between rounded-[var(--radius-control)] border border-border px-3 py-2 text-sm hover:bg-surface-hover">
                      <span>{text}</span>
                      <span className="text-lg font-semibold tabular-nums">{String(approvals[key] ?? 0)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </ProjectsPanel>
          )}
          {d.activeContractedRevenue !== undefined && (
            <ProjectsPanel title="Financial position of live projects">
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div><dt className="text-xs text-text-muted">Contracted revenue</dt><dd className="text-xl font-semibold tabular-nums">{money(d.activeContractedRevenue)}</dd></div>
                <div><dt className="text-xs text-text-muted">Approved budget</dt><dd className="text-xl font-semibold tabular-nums">{money(d.activeBudget)}</dd></div>
                <div><dt className="text-xs text-text-muted">Invoiced</dt><dd className="text-xl font-semibold tabular-nums">{money(d.invoiced)}</dd></div>
                <div><dt className="text-xs text-text-muted">Queued for billing</dt><dd className="text-xl font-semibold tabular-nums">{money(d.queuedForBilling)}</dd></div>
              </dl>
            </ProjectsPanel>
          )}
          <ProjectsPanel title="Milestones in the next 14 days">
            {milestones.length === 0 ? <p className="text-sm text-text-muted">None due.</p> : (
              <ul className="text-sm">{milestones.map((m) => <li key={m.id} className="flex justify-between border-b border-border/50 py-1"><span>{m.project_number} · {m.name}</span><span className="text-text-muted">{calendarDate(m.planned_date)}</span></li>)}</ul>
            )}
          </ProjectsPanel>
        </>
      )}
      <ProjectsPanel title="Go to">
        <div className="flex flex-wrap gap-2">
          {SHORTCUTS.map(([text, href]) => (
            <Link key={href} href={href} className="rounded-[var(--radius-control)] border border-border px-3 py-1.5 text-sm font-medium text-brand hover:bg-surface-hover">{text}</Link>
          ))}
        </div>
      </ProjectsPanel>
    </div>
  );
}
