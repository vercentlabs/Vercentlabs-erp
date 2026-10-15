"use client";

// The deal dashboard and the Deals by stage report. Every figure counts only the deals the signed-in user can see, and links to the list
// behind it. One "Deals closed between" range at the top drives Results and Won and lost (marked with a calendar); the pipeline figures
// are now. The breakdowns by owner, stage and source live here (not on the pipeline board).
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays } from "lucide-react";
import { Button, ErrorState, LinkButton, PageHeader, Select, TextField } from "@vercentlabs/design-system";

import { WinLossReportPanel } from "@/features/crm/close-reasons/components/WinLossReportPanel";
import { AccountPicker } from "@/features/crm/accounts/components/AccountPicker";
import { getPipeline, getPipelineSummary } from "@/features/crm/opportunity-pipeline/api/pipeline-api";
import { PipelineBreakdowns } from "@/features/crm/opportunity-pipeline/components/PipelineInsights";
import { DateInput } from "@/features/crm/shared/ui/DateTimeInput";
import { ReportToolbar, downloadCsv } from "@/features/crm/shared/ui/ReportToolbar";
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
  { value: "account", label: "Company" },
  { value: "product", label: "Product / service" },
  { value: "priority", label: "Priority" },
  { value: "closeMonth", label: "Close month" },
  { value: "lostReason", label: "Lost reason" },
];

function monthStart() {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1)).toISOString().slice(0, 10);
}

export function OpportunityDashboardScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const optionsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "opportunity-options"), queryFn: getOpportunityOptions, staleTime: 60_000 });
  const dashboardQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "opportunities", "dashboard", from, to),
    queryFn: () => getOpportunityDashboard({ from, to }),
    ...LIVE_OPPORTUNITY_QUERY,
  });
  // The breakdowns read the open pipeline, the same as the board.
  const summaryQuery = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "opportunities", "pipeline-summary", {}), queryFn: () => getPipelineSummary({}), ...LIVE_OPPORTUNITY_QUERY });
  const pipelineQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "opportunities", "pipeline", { status: "open", cardSort: "expectedCloseDate" }),
    queryFn: () => getPipeline({ status: "open", cardSort: "expectedCloseDate" }),
    ...LIVE_OPPORTUNITY_QUERY,
  });
  const dashboard = dashboardQuery.data;
  const currency = optionsQuery.data?.baseCurrency;
  const money = (amount: number) => formatMoney(currency, amount);
  const closedRange = `closedFrom=${from}&closedTo=${to}`;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Deal dashboard"
        description="The open pipeline, what is closing, what was won and lost, and which deals need attention."
        secondaryActions={<><LinkButton variant="outline" href="/crm/opportunities">Open deals</LinkButton><LinkButton variant="outline" href="/crm/pipeline">Open pipeline</LinkButton></>}
      />

      <section className="flex flex-wrap items-end gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4" aria-label="Date range">
        <p className="flex items-center gap-1.5 pb-2 text-sm font-semibold"><CalendarDays className="size-4 text-brand" aria-hidden="true" />Deals closed between</p>
        <DateInput label="From" value={from} onChange={setFrom} />
        <DateInput label="To" value={to} onChange={setTo} />
        <p className="pb-2 text-xs text-text-muted">Results and why deals were won and lost use this range; the pipeline figures are as of now.</p>
      </section>

      {dashboardQuery.isLoading ? <LoadingState label="Loading dashboard" rows={6} />
        : dashboardQuery.isError || !dashboard ? <ErrorState title="Could not load the dashboard" description="Check your connection and try again." action={{ label: "Try again", onPress: () => void dashboardQuery.refetch() }} />
        : (
          <>
            <section className="flex flex-col gap-3">
              <h2 className="text-base font-semibold">Pipeline <span className="text-sm font-normal text-text-muted">· now</span></h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                <Figure href="/crm/opportunities?view=open" label="Open deals" value={dashboard.totals.open} />
                <Figure href="/crm/opportunities?view=open" label="Open value" value={money(dashboard.totals.openValue)} />
                <Figure href="/crm/opportunities?view=open" label="Weighted value" value={money(dashboard.totals.weightedValue)} />
                <Figure href="/crm/opportunities?view=closing_this_month" label="Closing this month" value={dashboard.totals.closingThisMonth} />
                <Figure href="/crm/opportunities?view=overdue" label="Overdue (past close date)" value={dashboard.totals.overdue} />
                <Figure href="/crm/opportunities?view=stale" label={`Stale (no activity ${dashboard.totals.staleDays}+ days)`} value={dashboard.totals.stale} />
              </div>
            </section>

            <section className="flex flex-col gap-3">
              <h2 className="flex items-center gap-1.5 text-base font-semibold"><CalendarDays className="size-4 text-brand" aria-label="Uses the date range" />Results</h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Figure href={`/crm/opportunities?view=won&${closedRange}`} label="Won" value={`${dashboard.totals.won} · ${money(dashboard.totals.wonValue)}`} />
                <Figure href={`/crm/opportunities?view=lost&${closedRange}`} label="Lost" value={`${dashboard.totals.lost} · ${money(dashboard.totals.lostValue)}`} />
                <Figure label="Win rate" value={dashboard.totals.winRate === null ? "–" : `${dashboard.totals.winRate}%`} />
                <Figure label="Loss rate" value={dashboard.totals.lossRate === null ? "–" : `${dashboard.totals.lossRate}%`} />
                <Figure label="Top lost reason" value={dashboard.totals.topLostReason ?? "–"} />
                <Figure label="Average deal size (won)" value={money(dashboard.totals.averageDealSize)} />
                <Figure label="Average sales cycle" value={dashboard.totals.averageSalesCycleDays === null ? "–" : days(dashboard.totals.averageSalesCycleDays)} />
              </div>
            </section>

            {currency && <WinLossReportPanel currency={currency} period={{ from, to }} hideTotals />}

            {summaryQuery.isError && (
              <p role="alert" className="flex flex-wrap items-center gap-2 text-sm text-danger">Pipeline figures couldn&apos;t be loaded.
              <Button variant="ghost" size="compact" onPress={() => void summaryQuery.refetch()}>Try again</Button></p>
            )}
            {summaryQuery.data && currency && (
              <PipelineBreakdowns summary={summaryQuery.data} pipeline={pipelineQuery.data} currency={currency}
                onSelectOwner={(ownerId) => router.push(`/crm/pipeline?ownerId=${ownerId ?? "unassigned"}`)} />
            )}
          </>
        )}

      <OpportunitiesByStageReport />
    </div>
  );
}

function Figure({ href, label, value }: { href?: string; label: string; value: number | string }) {
  const card = (
    <div className="flex h-full flex-col gap-1 rounded-[var(--radius-card)] border border-border bg-surface p-4">
      <p className="text-xs font-medium text-text-muted">{label}</p>
      <p className="text-2xl font-semibold tabular-nums text-text">{value}</p>
    </div>
  );
  return href ? <Link href={href} className="rounded-[var(--radius-card)] outline-none transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-brand">{card}</Link> : card;
}

// Group by, Stage, Owner and Status in a row; the other filters under More filters.
export function OpportunitiesByStageReport() {
  const workspace = useWorkspaceContext();
  const [groupBy, setGroupBy] = useState("stage");
  const [choices, setChoices] = useState({ status: ANY, stageId: ANY, ownerId: ANY, teamId: ANY, sourceId: ANY, priority: ANY, lostReasonId: ANY });
  const [text, setText] = useState({ accountId: "", product: "", expectedCloseFrom: "", expectedCloseTo: "", closedFrom: "", closedTo: "", valueMin: "", valueMax: "", createdFrom: "", createdTo: "" });
  const optionsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "opportunity-options"), queryFn: getOpportunityOptions, staleTime: 60_000 });
  const options = optionsQuery.data;

  const filters: Record<string, string> = { groupBy };
  for (const [key, value] of Object.entries(choices)) if (value !== ANY) filters[key] = value;
  for (const [key, value] of Object.entries(text)) if (value.trim()) filters[key] = value.trim();
  const moreActive = Object.keys(filters).filter((key) => !["groupBy", "stageId", "ownerId", "status"].includes(key)).length;

  const reportQuery = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "opportunities", "report", filters), queryFn: () => getOpportunityReport(filters), ...LIVE_OPPORTUNITY_QUERY });
  const report = reportQuery.data;
  const money = (amount: number) => formatMoney(options?.baseCurrency, amount);
  const any = (label: string, list: Array<{ value: string; label: string }>) => [{ value: ANY, label }, ...list];
  const choose = (key: keyof typeof choices) => (selected: unknown) => setChoices((current) => ({ ...current, [key]: String(selected) }));
  const type = (key: keyof typeof text) => (value: string) => setText((current) => ({ ...current, [key]: value }));
  const exportCsv = report && report.rows.length > 0 ? () => downloadCsv("deals-by-stage.csv",
    [report.groupLabel, "Deals", "Open", "Won", "Lost", "Win rate %", "Value", "Weighted value"],
    report.rows.map((row) => [row.group, row.total, row.open, row.won, row.lost, row.winRate ?? "", row.value, row.weightedValue])) : undefined;

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold">Deals by stage</h2>
        <p className="text-sm text-text-secondary">Deal counts, value and weighted value, grouped and filtered the way you need.</p>
      </div>
      <ReportToolbar
        moreActive={moreActive}
        onExport={exportCsv}
        primary={<>
          <Select label="Group by" selectedKey={groupBy} onSelectionChange={(key) => setGroupBy(String(key))} options={GROUP_OPTIONS} />
          <Select label="Stage" selectedKey={choices.stageId} onSelectionChange={choose("stageId")} options={any("Any stage", (options?.stages ?? []).map((entry) => ({ value: entry.id, label: entry.name })))} />
          <Select label="Owner" selectedKey={choices.ownerId} onSelectionChange={choose("ownerId")}
            options={any("Any owner", [{ value: "unassigned", label: "Unassigned" }, ...(options?.users ?? []).map((user) => ({ value: user.id, label: user.name }))])} />
          <Select label="Status" selectedKey={choices.status} onSelectionChange={choose("status")} options={any("Any status", (options?.statuses ?? []).map((entry) => ({ value: entry.code, label: entry.label })))} />
        </>}
        more={<>
          <Select label="Team" selectedKey={choices.teamId} onSelectionChange={choose("teamId")} options={any("Any team", (options?.teams ?? []).map((team) => ({ value: team.id, label: team.name })))} />
          <Select label="Source" selectedKey={choices.sourceId} onSelectionChange={choose("sourceId")} options={any("Any source", (options?.sources ?? []).map((source) => ({ value: source.id, label: source.name })))} />
          <Select label="Priority" selectedKey={choices.priority} onSelectionChange={choose("priority")} options={any("Any priority", PRIORITY_OPTIONS)} />
          <Select label="Lost reason" selectedKey={choices.lostReasonId} onSelectionChange={choose("lostReasonId")}
            options={any("Any reason", (options?.lostReasons ?? []).map((reason) => ({ value: reason.id, label: reason.name })))} />
          <AccountPicker label="Company" value={text.accountId || null} onChange={(id) => type("accountId")(id ?? "")} />
          <TextField label="Product / service" value={text.product} onChange={type("product")} />
          <TextField label="Value from" inputMode="decimal" value={text.valueMin} onChange={type("valueMin")} />
          <TextField label="Value to" inputMode="decimal" value={text.valueMax} onChange={type("valueMax")} />
          <DateInput label="Close date from" value={text.expectedCloseFrom} onChange={type("expectedCloseFrom")} />
          <DateInput label="Close date to" value={text.expectedCloseTo} onChange={type("expectedCloseTo")} />
          <DateInput label="Closed from" value={text.closedFrom} onChange={type("closedFrom")} />
          <DateInput label="Closed to" value={text.closedTo} onChange={type("closedTo")} />
          <DateInput label="Created from" value={text.createdFrom} onChange={type("createdFrom")} />
          <DateInput label="Created to" value={text.createdTo} onChange={type("createdTo")} />
        </>}
      />

      {reportQuery.isLoading ? <LoadingState label="Loading report" rows={4} />
        : reportQuery.isError || !report ? <ErrorState title="Could not load the report" description="You may need the View CRM reports permission." />
        : (
          <div className="overflow-x-auto rounded-[var(--radius-card)] border border-border">
            <table className="w-full text-sm">
              <thead className="bg-surface-muted text-left text-text-secondary">
                <tr>
                  <th className="px-3 py-2 font-medium">{report.groupLabel}</th>
                  {["Deals", "Open", "Won", "Lost", "Win rate", "Value", "Weighted value"].map((heading) => <th key={heading} className="px-3 py-2 text-right font-medium">{heading}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {report.rows.length === 0 && <tr><td colSpan={8} className="px-3 py-6 text-center text-text-secondary">No deals match these filters.</td></tr>}
                {report.rows.map((row) => (
                  <tr key={row.group}>
                    <td className="px-3 py-2 font-medium">{row.group}</td>
                    {[row.total, row.open, row.won, row.lost].map((value, index) => <td key={index} className="px-3 py-2 text-right tabular-nums">{value}</td>)}
                    <td className="px-3 py-2 text-right tabular-nums">{row.winRate === null ? "–" : `${row.winRate}%`}</td>
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
