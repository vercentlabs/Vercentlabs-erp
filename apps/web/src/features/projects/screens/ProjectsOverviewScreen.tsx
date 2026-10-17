"use client";

// Projects home in CRM's shape: headline figures, the person's projects and what needs attention, the portfolio by status, and recent
// activity — all from the projects the person may see.
import { useQuery } from "@tanstack/react-query";
import { ErrorState, LinkButton, PermissionState } from "@vercentlabs/design-system";

import { formatDateTime } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { ActivityList, CountList, OverviewCards, OverviewHeader, OverviewPanel, TileGrid } from "@/shared/ui/overview";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { PROJECTS_BASE, errorMessage, errorStatus, getOverview } from "../api/projects-api";
import { PrioritySummary } from "../priority/PriorityViews";
import { call, qs } from "../api/projects-api";
import { getApprovals } from "../navigation/NavigationScreens";

const VIEW_OF: Record<string, string> = { DRAFT: "drafts", PLANNED: "active", IN_PROGRESS: "active", ON_HOLD: "on_hold", COMPLETED: "completed", CANCELLED: "cancelled" };

export function ProjectsOverviewScreen() {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "overview"), queryFn: getOverview });
  if (query.isLoading) return <LoadingState label="Loading projects" rows={6} />;
  if (query.isError || !query.data) {
    if (errorStatus(query.error) === 403) return <PermissionState title="You don't have access to projects" description="Ask an administrator for access." />;
    return <ErrorState title="Could not load projects" description={errorMessage(query.error)} />;
  }
  const { counts, attention, byStatus, recent, can } = query.data;
  const all = `${PROJECTS_BASE}/all`;
  return (
    <div className="flex flex-col gap-6">
      <OverviewHeader description={can.viewAll ? "Every project of the company: who leads it, where it stands and what needs attention." : "The projects you manage or work on."}
        action={can.create ? <LinkButton variant="primary" href={`${PROJECTS_BASE}/new`}>New project</LinkButton> : undefined} />
      <OverviewCards label="Projects at a glance" cards={[
        { label: "Active projects", value: counts.active, href: `${all}?view=active` }, { label: "On hold", value: counts.onHold, href: `${all}?view=on_hold` },
        { label: "Overdue", value: counts.overdue, href: `${all}?view=all&due=overdue` }, { label: "Due soon", value: counts.dueSoon, href: `${all}?view=all&due=soon` },
      ]} />
      <div className="grid gap-4 lg:grid-cols-2">
        <OverviewPanel title="My work" action={<LinkButton variant="ghost" size="compact" href={`${PROJECTS_BASE}/my`}>My projects</LinkButton>}>
          <CountList rows={[
            { label: "Projects I manage or work on", value: counts.mine, href: `${PROJECTS_BASE}/my` },
            { label: "Drafts to finish", value: counts.drafts, href: `${all}?view=drafts` },
            { label: "Waiting for approval", value: counts.pendingApproval, href: `${all}?view=drafts`, tone: "warning" },
            { label: "Completed this month", value: counts.completedThisMonth, href: `${all}?view=completed` },
          ]} />
        </OverviewPanel>
        <OverviewPanel title="Needs attention">
          <CountList rows={[
            { label: "Overdue", value: counts.overdue, href: `${all}?view=all&due=overdue`, tone: "danger" },
            { label: "At risk", value: counts.atRisk, href: `${all}?view=all&health=AT_RISK`, tone: "warning" },
            { label: "On hold", value: counts.onHold, href: `${all}?view=on_hold`, tone: "warning" },
            { label: "Without an active manager", value: counts.noManager, href: `${all}?view=active`, tone: "danger" },
          ]} />
          {attention.length > 0 && (
            <ul className="flex flex-col divide-y divide-border border-t border-border pt-1 text-sm">
              {attention.slice(0, 6).map((row) => (
                <li key={`${row.id}-${row.reason}`} className="flex flex-col py-1.5">
                  <a className="font-medium hover:underline" href={`${PROJECTS_BASE}/${row.id}`}>{row.name ?? "Untitled draft"} <span className="text-text-muted">{row.code}</span></a>
                  <span className="text-xs text-text-secondary">{row.reason}</span>
                </li>
              ))}
            </ul>
          )}
        </OverviewPanel>
      </div>
      <WorkPanel />
      <OverviewPanel title="By status" action={can.reports ? <LinkButton variant="ghost" size="compact" href={`${PROJECTS_BASE}/reports`}>Reports</LinkButton> : undefined}>
        <TileGrid tiles={byStatus.filter((row) => row.status !== "CANCELLED" || row.count > 0).map((row) => ({ key: row.status, label: row.label, value: String(row.count), href: `${all}?view=${VIEW_OF[row.status]}` }))} />
      </OverviewPanel>
      {can.reports && <PrioritySummary />}
      <OverviewPanel title="Recent activity">
        <ActivityList empty="Nothing has happened on your projects yet." entries={recent.map((row) => ({ key: row.id, href: `${PROJECTS_BASE}/${row.projectId}?tab=activity`, title: row.project,
          summary: row.summary ?? row.action.toLowerCase().replace(/_/g, " "), meta: `${row.actor} · ${formatDateTime(row.at)}` }))} />
      </OverviewPanel>
    </div>
  );
}

// Execution and decisions at a glance — each count opens its list already filtered — and, for those who may see it, the portfolio's money.
const total = (path: string, params: Record<string, string>) => call<{ total: number }>(`${path}${qs({ ...params, pageSize: "1" })}`).then((r) => r.total).catch(() => null);
function WorkPanel() {
  const workspace = useWorkspaceContext();
  const counts = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "overview-work"), queryFn: async () => {
    const [overdue, blocked, review, milestonesDue, milestonesLate] = await Promise.all([total("/tasks", { view: "overdue" }), total("/tasks", { view: "blocked" }), total("/tasks", { view: "my_reviews" }),
      total("/milestones", { view: "upcoming" }), total("/milestones", { view: "overdue" })]);
    return { overdue, blocked, review, milestonesDue, milestonesLate };
  } });
  const approvals = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "approvals"), queryFn: getApprovals, retry: false });
  const money = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "financials-directory", "", ""), retry: false,
    queryFn: () => call<{ totals: { cost: { actual: string } | null; revenue: { contract: string; netInvoiced: string } | null; profitability: { contribution: string; margin: number | null } | null } }>("/financials") });
  const c = counts.data;
  const rupees = (v: string | null | undefined) => (v === null || v === undefined ? "—" : `₹${Number(v).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`);
  const t = money.data?.totals;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <OverviewPanel title="Work and decisions" action={<LinkButton variant="ghost" size="compact" href={`${PROJECTS_BASE}/my-work`}>My Work</LinkButton>}>
        <CountList rows={[
          ...(c?.overdue !== null && c?.overdue !== undefined ? [{ label: "Overdue tasks", value: c.overdue, href: `${PROJECTS_BASE}/tasks?view=overdue`, tone: "danger" as const }] : []),
          ...(c?.blocked !== null && c?.blocked !== undefined ? [{ label: "Blocked tasks", value: c.blocked, href: `${PROJECTS_BASE}/tasks?view=blocked`, tone: "warning" as const }] : []),
          ...(c?.review !== null && c?.review !== undefined ? [{ label: "Tasks waiting for my review", value: c.review, href: `${PROJECTS_BASE}/tasks?view=my_reviews` }] : []),
          ...(c?.milestonesDue !== null && c?.milestonesDue !== undefined ? [{ label: "Milestones due soon", value: c.milestonesDue, href: `${PROJECTS_BASE}/milestones?view=upcoming` }] : []),
          ...(c?.milestonesLate !== null && c?.milestonesLate !== undefined ? [{ label: "Overdue milestones", value: c.milestonesLate, href: `${PROJECTS_BASE}/milestones?view=overdue`, tone: "danger" as const }] : []),
          ...(approvals.data ? [{ label: "Decisions waiting for me", value: approvals.data.total, href: `${PROJECTS_BASE}/approvals`, tone: "warning" as const }] : []),
        ]} />
      </OverviewPanel>
      {t && (t.cost || t.revenue || t.profitability) && (
        <OverviewPanel title="Financial summary" action={<LinkButton variant="ghost" size="compact" href={`${PROJECTS_BASE}/financials`}>Project Financials</LinkButton>}>
          <CountList rows={[
            ...(t.revenue ? [{ label: "Contract value", value: rupees(t.revenue.contract), href: `${PROJECTS_BASE}/financials?tab=revenue` }, { label: "Net invoiced", value: rupees(t.revenue.netInvoiced), href: `${PROJECTS_BASE}/financials?tab=revenue` }] : []),
            ...(t.cost ? [{ label: "Actual cost", value: rupees(t.cost.actual), href: `${PROJECTS_BASE}/financials?tab=costs` }] : []),
            ...(t.profitability ? [{ label: `Contribution${t.profitability.margin === null ? "" : ` (${t.profitability.margin}%)`}`, value: rupees(t.profitability.contribution), href: `${PROJECTS_BASE}/financials?tab=profitability` }] : []),
          ]} />
        </OverviewPanel>
      )}
    </div>
  );
}
