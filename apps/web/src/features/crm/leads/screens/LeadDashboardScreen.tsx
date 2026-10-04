"use client";

// The lead dashboard and the CRM Leads by Status report. Every figure counts
// only the leads the signed-in user can see, and links to the list behind it.
import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ErrorState, LinkButton, MetricCard, PageHeader, Select, TextField } from "@vercentlabs/design-system";

import { DateInput } from "@/features/crm/shared/ui/DateTimeInput";
import { formatMoney } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { getLeadDashboard, getLeadOptions, getLeadReport } from "../api/leads-api";
import { LIVE_LEAD_QUERY } from "../live-query";

const ANY = "any";
const GROUP_OPTIONS = [
  { value: "status", label: "Status" },
  { value: "stage", label: "Stage" },
  { value: "rating", label: "Rating" },
  { value: "qualification", label: "Qualification" },
  { value: "disqualificationReason", label: "Disqualification reason" },
  { value: "owner", label: "Owner" },
  { value: "team", label: "Team" },
  { value: "source", label: "Source" },
  { value: "month", label: "Created month" },
  { value: "assignedMonth", label: "Assigned month" },
];

function monthStart() {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1)).toISOString().slice(0, 10);
}

export function LeadDashboardScreen() {
  const workspace = useWorkspaceContext();
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const dashboardQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "leads", "dashboard", from, to),
    queryFn: () => getLeadDashboard({ from, to }),
    ...LIVE_LEAD_QUERY,
  });
  const dashboard = dashboardQuery.data;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Lead dashboard"
        description="How many leads you have, where they stand, and which need attention today."
        secondaryActions={<LinkButton variant="outline" href="/crm/leads">Open leads</LinkButton>}
      />

      {dashboardQuery.isLoading ? <LoadingState label="Loading dashboard" rows={6} />
        : dashboardQuery.isError || !dashboard ? <ErrorState title="Could not load the dashboard" description="Check your connection and try again." action={{ label: "Try again", onPress: () => void dashboardQuery.refetch() }} />
        : (
          <>
            <section className="flex flex-col gap-3">
              <h2 className="text-base font-semibold">Needs attention</h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <MetricLink href="/crm/leads?view=due_today" label="Follow-ups due today" value={dashboard.totals.followUpsDueToday} />
                <MetricLink href="/crm/leads?view=overdue" label="Overdue follow-ups" value={dashboard.totals.overdueFollowUps} />
                <MetricLink href="/crm/leads?view=unassigned" label="Unassigned leads" value={dashboard.totals.unassigned} />
                <MetricLink href="/crm/leads?view=new" label="New leads" value={dashboard.totals.new} />
                <MetricLink href="/crm/leads?view=no_activity" label="Assigned, no activity yet" value={dashboard.totals.noActivity} />
                <MetricCard label="Assigned today" value={dashboard.totals.assignedToday} />
              </div>
            </section>

            <section className="flex flex-col gap-3">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <h2 className="text-base font-semibold">Totals</h2>
                <div className="flex flex-wrap items-end gap-2">
                  <DateInput label="Created from" value={from} onChange={setFrom} />
                  <DateInput label="Created to" value={to} onChange={setTo} />
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <MetricLink href="/crm/leads" label="Total open leads" value={dashboard.totals.open} />
                <MetricCard label="Created this period" value={dashboard.totals.createdInPeriod} />
                <MetricLink href="/crm/leads?view=qualified" label="Qualified leads" value={dashboard.totals.qualified} />
                <MetricLink href="/crm/leads?view=disqualified" label="Disqualified leads" value={dashboard.totals.disqualified} />
                <MetricLink href="/crm/leads?view=converted" label="Converted leads" value={dashboard.totals.converted} />
                <MetricCard label="Conversion rate" value={`${dashboard.totals.conversionRate}%`} />
                <MetricLink href="/crm/leads?stale=yes" label={`Stale (no activity ${dashboard.totals.staleDays}+ days)`} value={dashboard.totals.stale} />
              </div>
            </section>

            <section className="flex flex-col gap-3">
              <h2 className="text-base font-semibold">Qualification</h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
                <MetricLink href="/crm/leads?qualificationStatus=not_started" label="Awaiting qualification" value={dashboard.totals.awaitingQualification} />
                <MetricLink href="/crm/leads?qualificationStatus=in_progress" label="In qualification" value={dashboard.totals.inQualification} />
                <MetricLink href="/crm/leads?qualificationStatus=qualified" label="Qualified (incl. converted)" value={dashboard.totals.qualifiedTotal} />
                <MetricLink href="/crm/leads?qualificationStatus=disqualified" label="Disqualified" value={dashboard.totals.disqualified} />
                <MetricCard label="Qualification rate" value={`${dashboard.totals.qualificationRate}%`} />
                <MetricCard label="Average days to qualify" value={dashboard.totals.averageDaysToQualify === null ? "–" : dashboard.totals.averageDaysToQualify} />
              </div>
            </section>

            <div className="grid gap-6 lg:grid-cols-2">
              <Breakdown title="Leads by status" rows={dashboard.byStatus.map((row) => ({ label: row.label, total: row.total }))} />
              <section className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4">
                <div>
                  <h2 className="text-base font-semibold">Open leads by stage</h2>
                  <p className="text-sm text-text-secondary">Stuck means in the same stage for more than {dashboard.totals.staleDays} days.</p>
                </div>
                <table className="w-full text-sm">
                  <thead className="text-left text-text-secondary">
                    <tr>
                      <th className="py-1 font-medium">Stage</th>
                      {["Open", "Mine", "Average days", "Stuck"].map((heading) => <th key={heading} className="py-1 text-right font-medium">{heading}</th>)}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {dashboard.byStage.map((row) => (
                      <tr key={row.key}>
                        <td className="py-1.5"><Link className="hover:underline" href={`/crm/leads?status=open&stage=${row.key}`}>{row.label}</Link></td>
                        <td className="py-1.5 text-right tabular-nums">{row.total}</td>
                        <td className="py-1.5 text-right tabular-nums"><Link className="hover:underline" href={`/crm/leads?view=mine&status=open&stage=${row.key}`}>{row.mine}</Link></td>
                        <td className="py-1.5 text-right tabular-nums">{row.averageAgeDays ?? "–"}</td>
                        <td className="py-1.5 text-right tabular-nums">{row.stuck}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
              <Breakdown title="Leads by source" rows={dashboard.bySource} />
              <Breakdown title="Leads by owner" rows={dashboard.byOwner} />
              <Breakdown title="Leads by team" rows={dashboard.byTeam} />
              <Breakdown title="Qualified leads by owner" rows={dashboard.qualifiedByOwner} />
              <Breakdown title="Qualified leads by source" rows={dashboard.qualifiedBySource} />
              <section className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4">
                <h2 className="text-base font-semibold">Active leads per salesperson</h2>
                {dashboard.workload.length === 0 ? <p className="text-sm text-text-secondary">No active leads.</p> : (
                  <table className="w-full text-sm">
                    <thead className="text-left text-text-secondary">
                      <tr>
                        <th className="py-1 font-medium">Owner</th>
                        {["Active", "Overdue follow-ups", "No activity"].map((heading) => <th key={heading} className="py-1 text-right font-medium">{heading}</th>)}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {dashboard.workload.map((row) => (
                        <tr key={row.userId ?? "unassigned"}>
                          <td className="py-1.5">
                            <Link className="hover:underline" href={row.userId ? `/crm/leads?ownerId=${row.userId}` : "/crm/leads?view=unassigned"}>{row.name}</Link>
                          </td>
                          {[row.openLeads, row.overdueFollowUps, row.noActivity].map((value, index) => <td key={index} className="py-1.5 text-right tabular-nums">{value}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
            </div>
          </>
        )}

      <LeadsByStatusReport />
    </div>
  );
}

function MetricLink({ href, label, value }: { href: string; label: string; value: number }) {
  return (
    <Link href={href} className="rounded-[var(--radius-card)] outline-none transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-brand">
      <MetricCard label={label} value={value} />
    </Link>
  );
}

function Breakdown({ title, rows }: { title: string; rows: Array<{ label: string; total: number }> }) {
  const max = Math.max(1, ...rows.map((row) => row.total));
  return (
    <section className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4">
      <h2 className="text-base font-semibold">{title}</h2>
      {rows.length === 0 ? <p className="text-sm text-text-secondary">No leads yet.</p> : (
        <ul className="flex flex-col gap-2 text-sm">
          {rows.map((row) => (
            <li key={row.label} className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-3">
              <span className="truncate">{row.label}</span>
              <span className="h-2 overflow-hidden rounded-pill bg-canvas-strong" aria-hidden="true">
                <span className="block h-full rounded-pill bg-brand" style={{ width: `${(row.total / max) * 100}%` }} />
              </span>
              <span className="tabular-nums font-medium">{row.total}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function LeadsByStatusReport() {
  const workspace = useWorkspaceContext();
  const [groupBy, setGroupBy] = useState("status");
  const [ownerId, setOwnerId] = useState(ANY);
  const [sourceId, setSourceId] = useState(ANY);
  const [teamId, setTeamId] = useState(ANY);
  const [rating, setRating] = useState(ANY);
  const [stageEnteredFrom, setStageEnteredFrom] = useState("");
  const [stageEnteredTo, setStageEnteredTo] = useState("");
  const [qualificationStatus, setQualificationStatus] = useState(ANY);
  const [disqualificationReason, setDisqualificationReason] = useState(ANY);
  const [productInterest, setProductInterest] = useState("");
  const [qualifiedFrom, setQualifiedFrom] = useState("");
  const [qualifiedTo, setQualifiedTo] = useState("");
  const [assignedFrom, setAssignedFrom] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [status, setStatus] = useState(ANY);
  const [stage, setStage] = useState(ANY);
  const [converted, setConverted] = useState(ANY);
  const [createdFrom, setCreatedFrom] = useState("");
  const [createdTo, setCreatedTo] = useState("");
  const optionsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "lead-options"), queryFn: getLeadOptions, staleTime: 60_000 });
  const options = optionsQuery.data;

  const filters: Record<string, string> = { groupBy };
  for (const [key, value] of Object.entries({ ownerId, teamId, sourceId, status, stage, rating, converted, qualificationStatus, disqualificationReason })) if (value !== ANY) filters[key] = value;
  if (createdFrom) filters.createdFrom = createdFrom;
  if (createdTo) filters.createdTo = createdTo;
  if (assignedFrom) filters.assignedFrom = assignedFrom;
  if (assignedTo) filters.assignedTo = assignedTo;
  if (stageEnteredFrom) filters.stageEnteredFrom = stageEnteredFrom;
  if (stageEnteredTo) filters.stageEnteredTo = stageEnteredTo;
  if (qualifiedFrom) filters.qualifiedFrom = qualifiedFrom;
  if (qualifiedTo) filters.qualifiedTo = qualifiedTo;
  if (productInterest.trim()) filters.productInterest = productInterest.trim();

  const reportQuery = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "leads", "report", filters), queryFn: () => getLeadReport(filters), ...LIVE_LEAD_QUERY });
  const report = reportQuery.data;
  const any = (label: string, list: Array<{ value: string; label: string }>) => [{ value: ANY, label }, ...list];

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold">CRM Leads by Status</h2>
        <p className="text-sm text-text-secondary">Lead counts and estimated value, grouped and filtered the way you need.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Select label="Group by" selectedKey={groupBy} onSelectionChange={(key) => setGroupBy(String(key))} options={GROUP_OPTIONS} />
        <Select label="Owner" selectedKey={ownerId} onSelectionChange={(key) => setOwnerId(String(key))}
          options={any("Any owner", [{ value: "unassigned", label: "Unassigned" }, ...(options?.users ?? []).map((user) => ({ value: user.id, label: user.name }))])} />
        <Select label="Team" selectedKey={teamId} onSelectionChange={(key) => setTeamId(String(key))}
          options={any("Any team", (options?.teams ?? []).map((team) => ({ value: team.id, label: team.name })))} />
        <Select label="Source" selectedKey={sourceId} onSelectionChange={(key) => setSourceId(String(key))}
          options={any("Any source", (options?.sources ?? []).map((source) => ({ value: source.id, label: source.name })))} />
        <Select label="Status" selectedKey={status} onSelectionChange={(key) => setStatus(String(key))}
          options={any("Any status", (options?.statuses ?? []).map((entry) => ({ value: entry.code, label: entry.label })))} />
        <Select label="Stage" selectedKey={stage} onSelectionChange={(key) => setStage(String(key))}
          options={any("Any stage", (options?.stages ?? []).map((entry) => ({ value: entry.code, label: entry.label })))} />
        <Select label="Rating" selectedKey={rating} onSelectionChange={(key) => setRating(String(key))}
          options={any("Any rating", [{ value: "cold", label: "Cold" }, { value: "warm", label: "Warm" }, { value: "hot", label: "Hot" }])} />
        <Select label="Converted" selectedKey={converted} onSelectionChange={(key) => setConverted(String(key))}
          options={any("Converted or not", [{ value: "yes", label: "Converted only" }, { value: "no", label: "Not converted" }])} />
        <DateInput label="Created from" value={createdFrom} onChange={setCreatedFrom} />
        <DateInput label="Created to" value={createdTo} onChange={setCreatedTo} />
        <DateInput label="Stage entered from" value={stageEnteredFrom} onChange={setStageEnteredFrom} />
        <DateInput label="Stage entered to" value={stageEnteredTo} onChange={setStageEnteredTo} />
        <DateInput label="Assigned from" value={assignedFrom} onChange={setAssignedFrom} />
        <DateInput label="Assigned to" value={assignedTo} onChange={setAssignedTo} />
        <Select label="Qualification" selectedKey={qualificationStatus} onSelectionChange={(key) => setQualificationStatus(String(key))}
          options={any("Any qualification", (options?.qualificationStatuses ?? []).map((entry) => ({ value: entry.code, label: entry.label })))} />
        <Select label="Disqualification reason" selectedKey={disqualificationReason} onSelectionChange={(key) => setDisqualificationReason(String(key))}
          options={any("Any reason", (options?.disqualificationReasons ?? []).map((entry) => ({ value: entry.code, label: entry.label })))} />
        <DateInput label="Qualified from" value={qualifiedFrom} onChange={setQualifiedFrom} />
        <DateInput label="Qualified to" value={qualifiedTo} onChange={setQualifiedTo} />
        <TextField label="Product / service interest" value={productInterest} onChange={setProductInterest} />
      </div>

      {reportQuery.isLoading ? <LoadingState label="Loading report" rows={4} />
        : reportQuery.isError || !report ? <ErrorState title="Could not load the report" description="You may need the View CRM reports permission." />
        : (
          <div className="overflow-x-auto rounded-[var(--radius-card)] border border-border">
            <table className="w-full text-sm">
              <thead className="bg-surface-muted text-left text-text-secondary">
                <tr>
                  <th className="px-3 py-2 font-medium">{report.groupLabel}</th>
                  {["Leads", "Open", "Qualified", "Disqualified", "Converted", "Conversion", "Estimated value"].map((heading) => (
                    <th key={heading} className="px-3 py-2 text-right font-medium">{heading}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {report.rows.length === 0 && <tr><td colSpan={8} className="px-3 py-6 text-center text-text-secondary">No leads match these filters.</td></tr>}
                {report.rows.map((row) => (
                  <tr key={row.group}>
                    <td className="px-3 py-2 font-medium">{row.group}</td>
                    {[row.total, row.open, row.qualified, row.disqualified, row.converted].map((value, index) => (
                      <td key={index} className="px-3 py-2 text-right tabular-nums">{value}</td>
                    ))}
                    <td className="px-3 py-2 text-right tabular-nums">{row.conversionRate}%</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatMoney(options?.baseCurrency, row.estimatedValue)}</td>
                  </tr>
                ))}
              </tbody>
              {report.rows.length > 0 && (
                <tfoot className="border-t border-border bg-surface-muted font-semibold">
                  <tr>
                    <td className="px-3 py-2">Total</td>
                    {[report.totals.total, report.totals.open, report.totals.qualified, report.totals.disqualified, report.totals.converted].map((value, index) => (
                      <td key={index} className="px-3 py-2 text-right tabular-nums">{value}</td>
                    ))}
                    <td className="px-3 py-2 text-right tabular-nums">{report.totals.total ? Math.round((report.totals.converted / report.totals.total) * 1000) / 10 : 0}%</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatMoney(options?.baseCurrency, report.totals.estimatedValue)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
    </section>
  );
}
