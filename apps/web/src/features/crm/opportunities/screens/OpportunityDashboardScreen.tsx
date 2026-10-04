"use client";

// The opportunity dashboard and the CRM Opportunities by Stage report. Every
// figure counts only the opportunities the signed-in user can see, and links
// to the list behind it.
import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ErrorState, LinkButton, MetricCard, PageHeader, Select, TextField } from "@vercentlabs/design-system";

import { AccountPicker } from "@/features/crm/accounts/components/AccountPicker";
import { DateInput } from "@/features/crm/shared/ui/DateTimeInput";
import { formatMoney } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { getOpportunityDashboard, getOpportunityOptions, getOpportunityReport } from "../api/opportunities-api";
import { LIVE_OPPORTUNITY_QUERY } from "../live-query";
import { PRIORITY_OPTIONS, days } from "../opportunity-format";

const ANY = "any";
const GROUP_OPTIONS = [
  { value: "stage", label: "Stage" },
  { value: "status", label: "Status" },
  { value: "owner", label: "Owner" },
  { value: "team", label: "Team" },
  { value: "source", label: "Source" },
  { value: "account", label: "Account" },
  { value: "product", label: "Product / service" },
  { value: "priority", label: "Priority" },
  { value: "closeMonth", label: "Expected close month" },
  { value: "lostReason", label: "Lost reason" },
];

export function OpportunityDashboardScreen() {
  const workspace = useWorkspaceContext();
  const optionsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "opportunity-options"), queryFn: getOpportunityOptions, staleTime: 60_000 });
  const dashboardQuery = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "opportunities", "dashboard"), queryFn: getOpportunityDashboard, ...LIVE_OPPORTUNITY_QUERY });
  const dashboard = dashboardQuery.data;
  const currency = optionsQuery.data?.baseCurrency;
  const money = (amount: number) => formatMoney(currency, amount);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Opportunity dashboard"
        description="The open pipeline, what is closing, and which deals need attention."
        secondaryActions={<><LinkButton variant="outline" href="/crm/opportunities">Open opportunities</LinkButton><LinkButton variant="outline" href="/crm/opportunities?layout=board">Open board</LinkButton></>}
      />

      {dashboardQuery.isLoading ? <LoadingState label="Loading dashboard" rows={6} />
        : dashboardQuery.isError || !dashboard ? <ErrorState title="Could not load the dashboard" description="Check your connection and try again." action={{ label: "Try again", onPress: () => void dashboardQuery.refetch() }} />
        : (
          <>
            <section className="flex flex-col gap-3">
              <h2 className="text-base font-semibold">Pipeline</h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <MetricLink href="/crm/opportunities?view=open" label="Open opportunities" value={dashboard.totals.open} />
                <MetricLink href="/crm/opportunities?view=open" label="Open pipeline value" value={money(dashboard.totals.openValue)} />
                <MetricLink href="/crm/opportunities?view=open" label="Weighted pipeline value" value={money(dashboard.totals.weightedValue)} />
                <MetricLink href="/crm/opportunities?view=closing_this_month" label="Closing this month" value={dashboard.totals.closingThisMonth} />
              </div>
            </section>

            <section className="flex flex-col gap-3">
              <h2 className="text-base font-semibold">Needs attention</h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <MetricLink href="/crm/opportunities?view=overdue" label="Overdue (past expected close)" value={dashboard.totals.overdue} />
                <MetricLink href="/crm/opportunities?view=stale" label={`Stale (no activity ${dashboard.totals.staleDays}+ days)`} value={dashboard.totals.stale} />
              </div>
            </section>

            <section className="flex flex-col gap-3">
              <h2 className="text-base font-semibold">Results</h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <MetricLink href="/crm/opportunities?view=won" label="Won this month" value={`${dashboard.totals.wonThisMonth} · ${money(dashboard.totals.wonValueThisMonth)}`} />
                <MetricLink href="/crm/opportunities?view=lost" label="Lost this month" value={dashboard.totals.lostThisMonth} />
                <MetricCard label="Win rate" value={`${dashboard.totals.winRate}%`} />
                <MetricCard label="Loss rate" value={`${dashboard.totals.lossRate}%`} />
                <MetricCard label="Average deal size (won)" value={money(dashboard.totals.averageDealSize)} />
                <MetricCard label="Average sales cycle" value={dashboard.totals.averageSalesCycleDays === null ? "–" : days(dashboard.totals.averageSalesCycleDays)} />
              </div>
            </section>

            <section className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4">
              <h2 className="text-base font-semibold">Open opportunities by stage</h2>
              <table className="w-full text-sm">
                <thead className="text-left text-text-secondary">
                  <tr>
                    <th className="py-1 font-medium">Stage</th>
                    {["Open", "Value", "Weighted value"].map((heading) => <th key={heading} className="py-1 text-right font-medium">{heading}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {dashboard.byStage.map((row) => (
                    <tr key={row.stageId}>
                      <td className="py-1.5"><Link className="hover:underline" href={`/crm/opportunities?view=open&stageId=${row.stageId}`}>{row.label}</Link></td>
                      <td className="py-1.5 text-right tabular-nums">{row.total}</td>
                      <td className="py-1.5 text-right tabular-nums">{money(row.value)}</td>
                      <td className="py-1.5 text-right tabular-nums">{money(row.weightedValue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </>
        )}

      <OpportunitiesByStageReport />
    </div>
  );
}

function MetricLink({ href, label, value }: { href: string; label: string; value: number | string }) {
  return (
    <Link href={href} className="rounded-[var(--radius-card)] outline-none transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-brand">
      <MetricCard label={label} value={value} />
    </Link>
  );
}

function OpportunitiesByStageReport() {
  const workspace = useWorkspaceContext();
  const [groupBy, setGroupBy] = useState("stage");
  const [choices, setChoices] = useState({ status: ANY, stageId: ANY, ownerId: ANY, teamId: ANY, sourceId: ANY, priority: ANY, lostReasonId: ANY });
  const [text, setText] = useState({ accountId: "", product: "", expectedCloseFrom: "", expectedCloseTo: "", closedFrom: "", closedTo: "", valueMin: "", valueMax: "", createdFrom: "", createdTo: "" });
  const optionsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "opportunity-options"), queryFn: getOpportunityOptions, staleTime: 60_000 });
  const options = optionsQuery.data;

  const filters: Record<string, string> = { groupBy };
  for (const [key, value] of Object.entries(choices)) if (value !== ANY) filters[key] = value;
  for (const [key, value] of Object.entries(text)) if (value.trim()) filters[key] = value.trim();

  const reportQuery = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "opportunities", "report", filters), queryFn: () => getOpportunityReport(filters), ...LIVE_OPPORTUNITY_QUERY });
  const report = reportQuery.data;
  const money = (amount: number) => formatMoney(options?.baseCurrency, amount);
  const any = (label: string, list: Array<{ value: string; label: string }>) => [{ value: ANY, label }, ...list];
  const choose = (key: keyof typeof choices) => (selected: unknown) => setChoices((current) => ({ ...current, [key]: String(selected) }));
  const type = (key: keyof typeof text) => (value: string) => setText((current) => ({ ...current, [key]: value }));

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold">CRM Opportunities by Stage</h2>
        <p className="text-sm text-text-secondary">Opportunity counts, value and weighted value, grouped and filtered the way you need.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Select label="Group by" selectedKey={groupBy} onSelectionChange={(key) => setGroupBy(String(key))} options={GROUP_OPTIONS} />
        <Select label="Stage" selectedKey={choices.stageId} onSelectionChange={choose("stageId")} options={any("Any stage", (options?.stages ?? []).map((entry) => ({ value: entry.id, label: entry.name })))} />
        <Select label="Status" selectedKey={choices.status} onSelectionChange={choose("status")} options={any("Any status", (options?.statuses ?? []).map((entry) => ({ value: entry.code, label: entry.label })))} />
        <Select label="Owner" selectedKey={choices.ownerId} onSelectionChange={choose("ownerId")}
          options={any("Any owner", [{ value: "unassigned", label: "Unassigned" }, ...(options?.users ?? []).map((user) => ({ value: user.id, label: user.name }))])} />
        <Select label="Team" selectedKey={choices.teamId} onSelectionChange={choose("teamId")} options={any("Any team", (options?.teams ?? []).map((team) => ({ value: team.id, label: team.name })))} />
        <Select label="Source" selectedKey={choices.sourceId} onSelectionChange={choose("sourceId")} options={any("Any source", (options?.sources ?? []).map((source) => ({ value: source.id, label: source.name })))} />
        <Select label="Priority" selectedKey={choices.priority} onSelectionChange={choose("priority")} options={any("Any priority", PRIORITY_OPTIONS)} />
        <Select label="Lost reason" selectedKey={choices.lostReasonId} onSelectionChange={choose("lostReasonId")}
          options={any("Any reason", (options?.lostReasons ?? []).map((reason) => ({ value: reason.id, label: reason.name })))} />
        <AccountPicker label="Account" value={text.accountId || null} onChange={(id) => type("accountId")(id ?? "")} />
        <TextField label="Product / service" value={text.product} onChange={type("product")} />
        <TextField label="Value from" inputMode="decimal" value={text.valueMin} onChange={type("valueMin")} />
        <TextField label="Value to" inputMode="decimal" value={text.valueMax} onChange={type("valueMax")} />
        <DateInput label="Expected close from" value={text.expectedCloseFrom} onChange={type("expectedCloseFrom")} />
        <DateInput label="Expected close to" value={text.expectedCloseTo} onChange={type("expectedCloseTo")} />
        <DateInput label="Closed from" value={text.closedFrom} onChange={type("closedFrom")} />
        <DateInput label="Closed to" value={text.closedTo} onChange={type("closedTo")} />
        <DateInput label="Created from" value={text.createdFrom} onChange={type("createdFrom")} />
        <DateInput label="Created to" value={text.createdTo} onChange={type("createdTo")} />
      </div>

      {reportQuery.isLoading ? <LoadingState label="Loading report" rows={4} />
        : reportQuery.isError || !report ? <ErrorState title="Could not load the report" description="You may need the View CRM reports permission." />
        : (
          <div className="overflow-x-auto rounded-[var(--radius-card)] border border-border">
            <table className="w-full text-sm">
              <thead className="bg-surface-muted text-left text-text-secondary">
                <tr>
                  <th className="px-3 py-2 font-medium">{report.groupLabel}</th>
                  {["Opportunities", "Open", "Won", "Lost", "Win rate", "Value", "Weighted value"].map((heading) => <th key={heading} className="px-3 py-2 text-right font-medium">{heading}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {report.rows.length === 0 && <tr><td colSpan={8} className="px-3 py-6 text-center text-text-secondary">No opportunities match these filters.</td></tr>}
                {report.rows.map((row) => (
                  <tr key={row.group}>
                    <td className="px-3 py-2 font-medium">{row.group}</td>
                    {[row.total, row.open, row.won, row.lost].map((value, index) => <td key={index} className="px-3 py-2 text-right tabular-nums">{value}</td>)}
                    <td className="px-3 py-2 text-right tabular-nums">{row.winRate}%</td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(row.value)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(row.weightedValue)}</td>
                  </tr>
                ))}
              </tbody>
              {report.rows.length > 0 && (
                <tfoot className="border-t border-border bg-surface-muted font-semibold">
                  <tr>
                    <td className="px-3 py-2">Total</td>
                    {[report.totals.total, report.totals.open, report.totals.won, report.totals.lost].map((value, index) => <td key={index} className="px-3 py-2 text-right tabular-nums">{value}</td>)}
                    <td className="px-3 py-2 text-right tabular-nums">
                      {report.totals.won + report.totals.lost ? Math.round((report.totals.won / (report.totals.won + report.totals.lost)) * 1000) / 10 : 0}%
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(report.totals.value)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(report.totals.weightedValue)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
    </section>
  );
}
