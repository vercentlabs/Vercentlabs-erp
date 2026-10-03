"use client";

// The lead dashboard and the CRM Leads by Status report. Every figure counts
// only the leads the signed-in user can see, and links to the list behind it.
import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ErrorState, LinkButton, MetricCard, PageHeader, Select } from "@vercentlabs/design-system";

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
  { value: "owner", label: "Owner" },
  { value: "source", label: "Source" },
  { value: "month", label: "Created month" },
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
              </div>
            </section>

            <div className="grid gap-6 lg:grid-cols-2">
              <Breakdown title="Leads by status" rows={dashboard.byStatus.map((row) => ({ label: row.label, total: row.total }))} />
              <Breakdown title="Leads by stage" rows={dashboard.byStage.map((row) => ({ label: row.label, total: row.total }))} />
              <Breakdown title="Leads by source" rows={dashboard.bySource} />
              <Breakdown title="Leads by owner" rows={dashboard.byOwner} />
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
  const [status, setStatus] = useState(ANY);
  const [stage, setStage] = useState(ANY);
  const [converted, setConverted] = useState(ANY);
  const [createdFrom, setCreatedFrom] = useState("");
  const [createdTo, setCreatedTo] = useState("");
  const optionsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "lead-options"), queryFn: getLeadOptions, staleTime: 60_000 });
  const options = optionsQuery.data;

  const filters: Record<string, string> = { groupBy };
  for (const [key, value] of Object.entries({ ownerId, sourceId, status, stage, converted })) if (value !== ANY) filters[key] = value;
  if (createdFrom) filters.createdFrom = createdFrom;
  if (createdTo) filters.createdTo = createdTo;

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
        <Select label="Source" selectedKey={sourceId} onSelectionChange={(key) => setSourceId(String(key))}
          options={any("Any source", (options?.sources ?? []).map((source) => ({ value: source.id, label: source.name })))} />
        <Select label="Status" selectedKey={status} onSelectionChange={(key) => setStatus(String(key))}
          options={any("Any status", (options?.statuses ?? []).map((entry) => ({ value: entry.code, label: entry.label })))} />
        <Select label="Stage" selectedKey={stage} onSelectionChange={(key) => setStage(String(key))}
          options={any("Any stage", (options?.stages ?? []).map((entry) => ({ value: entry.code, label: entry.label })))} />
        <Select label="Converted" selectedKey={converted} onSelectionChange={(key) => setConverted(String(key))}
          options={any("Converted or not", [{ value: "yes", label: "Converted only" }, { value: "no", label: "Not converted" }])} />
        <DateInput label="Created from" value={createdFrom} onChange={setCreatedFrom} />
        <DateInput label="Created to" value={createdTo} onChange={setCreatedTo} />
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
