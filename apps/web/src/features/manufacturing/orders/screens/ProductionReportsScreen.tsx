"use client";

// Manufacturing reports: the production summary (planned, accepted, rejected, received, yield) and the cost variance (estimated against
// actual material, capitalised, variance closed), by order for a period of planned starts.
import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ErrorState, PageHeader, PermissionState, Select, StatusBadge, TextField } from "@vercentlabs/design-system";

import { formatDate } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { Cell, FactList, LinesTable } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { MO_BASE, STATUS_TONE, errorMessage, errorStatus, inr, productionSummary, qty } from "../api/mo-api";

const monthAgo = () => new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);

export function ProductionReportsScreen() {
  const workspace = useWorkspaceContext();
  const params = useSearchParams();
  const report = params.get("report") === "variance" ? "variance" : "summary";
  const [from, setFrom] = useState(monthAgo());
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [status, setStatus] = useState("all");
  const filters = { from, to, status };
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "manufacturing", "production-summary", filters), queryFn: () => productionSummary(filters) });
  if (query.isError && errorStatus(query.error) === 403) return <PermissionState title="You don't have access to manufacturing reports" description="Ask an administrator for access." />;
  const data = query.data;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={report === "variance" ? "Cost Variance" : "Production Summary"}
        description={report === "variance" ? "Estimated against actual material cost by order: what was capitalised to finished goods and the variance closed at completion."
          : "Planned against accepted, rejected and received output by order, with yield."} />
      <div className="flex flex-wrap items-end gap-2">
        <TextField label="Planned start from" type="date" value={from} onChange={setFrom} />
        <TextField label="To" type="date" value={to} onChange={setTo} />
        <Select label="Status" selectedKey={status} onSelectionChange={(key) => setStatus(String(key))}
          options={[{ value: "all", label: "All (not cancelled)" }, { value: "IN_PROGRESS", label: "In progress" }, { value: "COMPLETED", label: "Completed" }, { value: "RELEASED", label: "Released" }]} />
      </div>
      {query.isLoading && <LoadingState label="Loading the report" rows={6} />}
      {query.isError && <ErrorState title="Could not load the report" description={errorMessage(query.error)} />}
      {data && report === "variance" && !data.costVisible && <Notice tone="warning">You may not see manufacturing cost.</Notice>}
      {data && (
        <>
          <FactList items={report === "variance" && data.costVisible
            ? [["Orders", String(data.totals.orders)], ["Estimated material", inr(String(data.totals.estimatedCost))], ["Actual material", inr(String(data.totals.actualCost))], ["Variance closed", inr(String(data.totals.varianceClosed))]]
            : [["Orders", String(data.totals.orders)], ["Planned", qty(String(data.totals.planned))], ["Accepted", qty(String(data.totals.accepted))], ["Rejected", qty(String(data.totals.rejected))],
              ["Received", qty(String(data.totals.received))], ["Yield", data.totals.yieldPct ? `${data.totals.yieldPct}%` : "—"]]} />
          <Panel title="By order">
            {data.rows.length ? (
              report === "variance" && data.costVisible ? (
                <LinesTable columns={["Order", "Product", "Status", { label: "Estimated", numeric: true }, { label: "Actual", numeric: true }, { label: "Variance", numeric: true }, { label: "Capitalised", numeric: true }, { label: "Closed to variance", numeric: true }]}>
                  {data.rows.map((row) => <tr key={row.id}><Cell><Link className="text-brand underline" href={`${MO_BASE}/${row.id}?tab=costs`}>{row.number}</Link></Cell><Cell>{row.item}</Cell>
                    <Cell><StatusBadge tone={STATUS_TONE[row.status] ?? "neutral"}>{row.statusLabel}</StatusBadge></Cell><Cell numeric>{inr(row.estimatedCost)}</Cell><Cell numeric>{inr(row.actualCost)}</Cell>
                    <Cell numeric>{inr(row.costVariance)}</Cell><Cell numeric>{inr(row.capitalised)}</Cell><Cell numeric>{inr(row.varianceClosed)}</Cell></tr>)}
                </LinesTable>
              ) : (
                <LinesTable columns={["Order", "Product", "Status", "Planned start", { label: "Planned", numeric: true }, { label: "Accepted", numeric: true }, { label: "Rejected", numeric: true }, { label: "Received", numeric: true }, { label: "Yield", numeric: true }, "Closed"]}>
                  {data.rows.map((row) => <tr key={row.id}><Cell><Link className="text-brand underline" href={`${MO_BASE}/${row.id}`}>{row.number}</Link></Cell><Cell>{row.item}</Cell>
                    <Cell><StatusBadge tone={STATUS_TONE[row.status] ?? "neutral"}>{row.statusLabel}</StatusBadge></Cell><Cell>{formatDate(row.plannedStartAt)}</Cell><Cell numeric>{qty(row.planned)}</Cell>
                    <Cell numeric>{qty(row.accepted)}</Cell><Cell numeric>{qty(row.rejected)}</Cell><Cell numeric>{qty(row.received)}</Cell><Cell numeric>{row.yieldPct ? `${row.yieldPct}%` : "—"}</Cell>
                    <Cell>{row.shortClosed ? "Short" : row.completedAt ? "In full" : ""}</Cell></tr>)}
                </LinesTable>
              )
            ) : <p className="text-sm text-text-muted">No orders in this period.</p>}
          </Panel>
        </>
      )}
    </div>
  );
}
