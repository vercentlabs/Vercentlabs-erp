"use client";

// Companies report: companies grouped by owner, type, status, industry,
// source, team or created month, with open deals and the companies nobody
// has worked with recently. Counts only the companies the viewer can see. It
// is the Companies tab of Insights → Reports.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ErrorState, Select } from "@vercentlabs/design-system";

import { DateInput } from "@/features/crm/shared/ui/DateTimeInput";
import { ReportToolbar, downloadCsv } from "@/features/crm/shared/ui/ReportToolbar";
import { formatMoney } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { getAccountOptions, getAccountReport } from "../api/accounts-api";
import { LIVE_ACCOUNT_QUERY } from "../live-query";

const ANY = "any";
const GROUP_OPTIONS = [
  { value: "owner", label: "Owner" },
  { value: "type", label: "Company type" },
  { value: "status", label: "Status" },
  { value: "industry", label: "Industry" },
  { value: "source", label: "Source" },
  { value: "team", label: "Team" },
  { value: "month", label: "Created month" },
];

export function AccountReportScreen() {
  const workspace = useWorkspaceContext();
  const [groupBy, setGroupBy] = useState("owner");
  const [ownerId, setOwnerId] = useState(ANY);
  const [accountType, setAccountType] = useState(ANY);
  const [status, setStatus] = useState(ANY);
  const [sourceId, setSourceId] = useState(ANY);
  const [createdFrom, setCreatedFrom] = useState("");
  const [createdTo, setCreatedTo] = useState("");
  const optionsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "account-options"), queryFn: getAccountOptions, staleTime: 60_000 });
  const options = optionsQuery.data;

  const filters: Record<string, string> = { groupBy };
  for (const [key, value] of Object.entries({ ownerId, accountType, status, sourceId })) if (value !== ANY) filters[key] = value;
  if (createdFrom) filters.createdFrom = createdFrom;
  if (createdTo) filters.createdTo = createdTo;

  const reportQuery = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "accounts", "report", filters), queryFn: () => getAccountReport(filters), ...LIVE_ACCOUNT_QUERY });
  const report = reportQuery.data;
  const any = (label: string, list: Array<{ value: string; label: string }>) => [{ value: ANY, label }, ...list];
  const money = (value: number) => formatMoney(options?.baseCurrency, value);
  const columns = report ? [
    { label: "Companies", read: (row: typeof report.totals) => row.total },
    { label: "Prospects", read: (row: typeof report.totals) => row.prospects },
    { label: "Customers", read: (row: typeof report.totals) => row.customers },
    { label: "New (30 days)", read: (row: typeof report.totals) => row.newLast30Days },
    { label: "With open deals", read: (row: typeof report.totals) => row.withOpenOpportunities },
    { label: "Open pipeline", read: (row: typeof report.totals) => money(row.openPipelineValue) },
    { label: `No activity in ${report.staleDays} days`, read: (row: typeof report.totals) => row.withoutRecentActivity },
  ] : [];

  return (
    <div className="flex flex-col gap-6">
      <ReportToolbar
        moreActive={[sourceId !== ANY, Boolean(createdFrom), Boolean(createdTo)].filter(Boolean).length}
        onExport={report ? () => downloadCsv("companies-report.csv", [report.groupLabel, ...columns.map((column) => column.label)],
          [...report.rows.map((row) => [row.group, ...columns.map((column) => column.read(row))]), ["Total", ...columns.map((column) => column.read(report.totals))]]) : undefined}
        primary={<>
        <Select label="Group by" selectedKey={groupBy} onSelectionChange={(key) => setGroupBy(String(key))} options={GROUP_OPTIONS} />
        <Select label="Owner" selectedKey={ownerId} onSelectionChange={(key) => setOwnerId(String(key))}
          options={any("Any owner", [{ value: "unassigned", label: "Unassigned" }, ...(options?.users ?? []).map((user) => ({ value: user.id, label: user.name }))])} />
        <Select label="Company type" selectedKey={accountType} onSelectionChange={(key) => setAccountType(String(key))}
          options={any("Any type", (options?.types ?? []).map((entry) => ({ value: entry.code, label: entry.label })))} />
        <Select label="Status" selectedKey={status} onSelectionChange={(key) => setStatus(String(key))}
          options={any("Active and inactive", (options?.statuses ?? []).map((entry) => ({ value: entry.code, label: entry.label })))} />
        </>}
        more={<>
        <Select label="Source" selectedKey={sourceId} onSelectionChange={(key) => setSourceId(String(key))}
          options={any("Any source", (options?.sources ?? []).map((source) => ({ value: source.id, label: source.name })))} />
        <DateInput label="Created from" value={createdFrom} onChange={setCreatedFrom} />
        <DateInput label="Created to" value={createdTo} onChange={setCreatedTo} />
        </>}
      />

      {reportQuery.isLoading ? <LoadingState label="Loading report" rows={4} />
        : reportQuery.isError || !report ? <ErrorState title="Could not load the report" description="Refresh the page to try again." />
        : (
          <div className="overflow-x-auto rounded-[var(--radius-card)] border border-border">
            <table className="w-full text-sm">
              <thead className="bg-surface-muted text-left text-text-secondary">
                <tr>
                  <th className="px-3 py-2 font-medium">{report.groupLabel}</th>
                  {columns.map((column) => <th key={column.label} className="px-3 py-2 text-right font-medium">{column.label}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {report.rows.length === 0 && <tr><td colSpan={columns.length + 1} className="px-3 py-6 text-center text-text-secondary">No companies match these filters.</td></tr>}
                {report.rows.map((row) => (
                  <tr key={row.group}>
                    <td className="px-3 py-2 font-medium">{row.group}</td>
                    {columns.map((column) => <td key={column.label} className="px-3 py-2 text-right tabular-nums">{column.read(row)}</td>)}
                  </tr>
                ))}
              </tbody>
              {report.rows.length > 0 && (
                <tfoot className="border-t border-border bg-surface-muted font-semibold">
                  <tr>
                    <td className="px-3 py-2">Total</td>
                    {columns.map((column) => <td key={column.label} className="px-3 py-2 text-right tabular-nums">{column.read(report.totals)}</td>)}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
    </div>
  );
}
