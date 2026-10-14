"use client";

// Material usage variance reports: by order, component, product, production batch and period; favorable against unfavorable; cost (usage,
// price and total — overlapping, never added together); scrap against consumption; by reason; approval history; open exceptions; and BOM
// review candidates (a component over tolerance on several orders of the same product), with the open BOM review requests. Quantities are
// never summed across units.
import Link from "next/link";
import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, ErrorState, PageHeader, PermissionState, Tab, TabList, Tabs, TextField } from "@vercentlabs/design-system";

import { formatDateTime } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Panel } from "@/shared/ui/Panel";
import { Cell, LinesTable } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { MO_BASE, errorMessage, errorStatus, inr, qty } from "@/features/manufacturing/orders/api/mo-api";
import { AskDialog, type Ask } from "@/features/manufacturing/orders/components/MoDialogs";
import { VARIANCE_BASE, closeBomReview, listBomReviews, signed, varianceReport } from "../api/variance-api";

const REPORTS = [{ id: "by-mo", label: "By order" }, { id: "by-component", label: "By component" }, { id: "by-product", label: "By product" }, { id: "by-batch", label: "By batch" },
  { id: "by-period", label: "By month" }, { id: "favorable-unfavorable", label: "Favorable vs unfavorable" }, { id: "cost", label: "Cost" }, { id: "scrap-vs-consumption", label: "Scrap vs consumption" },
  { id: "by-reason", label: "By reason" }, { id: "approvals", label: "Approvals" }, { id: "open-exceptions", label: "Open exceptions" }, { id: "bom-review-candidates", label: "BOM review" }];
type Row = Record<string, unknown>;
const s = (value: unknown) => (value === null || value === undefined ? "" : String(value));
const money = (value: unknown) => (value === null || value === undefined ? "—" : inr(String(value)));
type Quantity = { unit: string; expected: string; actual: string; variance: string };
const quantities = (value: unknown) => ((value as Quantity[] | undefined) ?? []).map((row) => `${signed(row.variance)} ${row.unit}`).join(" · ");

export function VarianceReportsScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const kind = REPORTS.some((row) => row.id === params.get("report")) ? params.get("report")! : "by-mo";
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [ask, setAsk] = useState<Ask | null>(null);
  const filters = { from: from || undefined, to: to || undefined };
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "manufacturing", "variance-report", kind, filters), queryFn: () => varianceReport<Row>(kind, filters) });
  const reviews = useQuery({ queryKey: scopedQueryKey(workspace, "manufacturing", "bom-reviews"), queryFn: () => listBomReviews(), enabled: kind === "bom-review-candidates" });
  if (query.isError && errorStatus(query.error) === 403) return <PermissionState title="You don't have access to material variance" description="Ask an administrator for access." />;
  const rows = query.data ?? [];
  const order = (row: Row) => (row.orderId ? <Link className="text-brand underline" href={`${MO_BASE}/${s(row.orderId)}?tab=materials`}>{s(row.orderNumber ?? row.label)}</Link> : s(row.orderNumber));
  const exception = (row: Row) => <Link className="text-brand underline" href={`${VARIANCE_BASE}/${s(row.id)}`}>{s(row.number)}</Link>;
  const grouped = () => <LinesTable columns={["", { label: "Lines", numeric: true }, { label: "Unfavorable", numeric: true }, { label: "Favorable", numeric: true }, { label: "Need review", numeric: true }, "Quantity variance", { label: "Usage cost", numeric: true }]}>
    {rows.map((row, index) => <tr key={index}><Cell>{kind === "by-mo" ? order(row) : s(row.label)}</Cell><Cell numeric>{s(row.lines)}</Cell><Cell numeric>{s(row.unfavorable)}</Cell><Cell numeric>{s(row.favorable)}</Cell>
      <Cell numeric>{s(row.review)}</Cell><Cell>{quantities(row.quantities)}</Cell><Cell numeric>{money(row.usageCost)}</Cell></tr>)}</LinesTable>;
  const exceptions = () => <LinesTable columns={["Exception", "Order", "Material", { label: "Variance", numeric: true }, "Reason", "Status", { label: "Usage cost", numeric: true }, "Opened"]}>
    {rows.map((row, index) => <tr key={index}><Cell>{exception(row)}</Cell><Cell>{order(row)}</Cell><Cell>{s(row.code)}</Cell><Cell numeric>{signed(row.variance as string | null)} {s(row.uom)}</Cell>
      <Cell>{s(row.reason)}</Cell><Cell>{s(row.statusLabel)}{row.resolutionType ? ` · ${s(row.resolutionType).toLowerCase().replace(/_/g, " ")}` : ""}</Cell><Cell numeric>{money(row.usageCost)}</Cell><Cell>{formatDateTime(s(row.createdAt))}</Cell></tr>)}</LinesTable>;
  const table = () => {
    switch (kind) {
      case "by-mo": case "by-component": case "by-product": case "by-period": case "favorable-unfavorable": return grouped();
      case "by-batch": return <LinesTable columns={["Order", "Batch", "Material", { label: "Expected", numeric: true }, { label: "Consumed", numeric: true }, { label: "Variance", numeric: true }]}>
        {rows.map((row, index) => <tr key={index}><Cell>{order(row)}</Cell><Cell>{s(row.batch)}</Cell><Cell>{s(row.code)}</Cell><Cell numeric>{row.expected === null ? "—" : qty(s(row.expected))}</Cell>
          <Cell numeric>{qty(s(row.consumed))} {s(row.uom)}</Cell><Cell numeric>{signed(row.variance as string | null)}{row.variancePct ? ` (${signed(s(row.variancePct))}%)` : ""}</Cell></tr>)}</LinesTable>;
      case "cost": return <LinesTable columns={["Order", "Material", { label: "Expected cost", numeric: true }, { label: "Actual cost", numeric: true }, { label: "Usage variance", numeric: true }, { label: "Price variance", numeric: true }, { label: "Total variance", numeric: true }]}>
        {rows.map((row, index) => <tr key={index}><Cell>{order(row)}</Cell><Cell>{s(row.code)}</Cell><Cell numeric>{money(row.expectedCost)}</Cell><Cell numeric>{money(row.actualCost)}</Cell><Cell numeric>{money(row.usageCost)}</Cell>
          <Cell numeric>{money(row.priceVariance)}</Cell><Cell numeric>{money(row.totalCostVariance)}</Cell></tr>)}</LinesTable>;
      case "scrap-vs-consumption": return <LinesTable columns={["Order", "Material", { label: "Expected", numeric: true }, { label: "Allowance", numeric: true }, { label: "Consumed", numeric: true }, { label: "Scrapped", numeric: true }, { label: "Variance", numeric: true }, "Status"]}>
        {rows.map((row, index) => <tr key={index}><Cell>{order(row)}</Cell><Cell>{s(row.code)}</Cell><Cell numeric>{qty(s(row.expected))}</Cell><Cell numeric>{qty(s(row.allowance))}</Cell><Cell numeric>{qty(s(row.consumed))}</Cell>
          <Cell numeric>{qty(s(row.scrapped))}</Cell><Cell numeric>{signed(s(row.variance))} {s(row.uom)}</Cell><Cell>{s(row.bandLabel)}</Cell></tr>)}</LinesTable>;
      case "by-reason": return <LinesTable columns={["Reason", { label: "Exceptions", numeric: true }, { label: "Approved", numeric: true }, { label: "Rejected", numeric: true }, { label: "Usage cost", numeric: true }]}>
        {rows.map((row, index) => <tr key={index}><Cell>{s(row.reason)}</Cell><Cell numeric>{s(row.exceptions)}</Cell><Cell numeric>{s(row.approved)}</Cell><Cell numeric>{s(row.rejected)}</Cell><Cell numeric>{money(row.usageCost)}</Cell></tr>)}</LinesTable>;
      case "approvals": case "open-exceptions": return exceptions();
      case "bom-review-candidates": return <LinesTable columns={["Product", "Component", "Orders", { label: "Total excess", numeric: true }, { label: "Average", numeric: true }]}>
        {rows.map((row, index) => <tr key={index}><Cell>{s(row.product)}</Cell><Cell>{s(row.component)}</Cell><Cell>{((row.orders as string[]) ?? []).join(", ")}</Cell><Cell numeric>{qty(s(row.totalExcess))} {s(row.uom)}</Cell>
          <Cell numeric>{row.averagePct ? `+${s(row.averagePct)}%` : "—"}</Cell></tr>)}</LinesTable>;
      default: return null;
    }
  };
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Material Usage Variance" description="Expected against actual material use, evaluated from posted consumption, scrap and production — by order, material, product and period, with cost and causes." />
      <Tabs selectedKey={kind} onSelectionChange={(value) => router.replace(`${pathname}?report=${String(value)}`)}>
        <TabList aria-label="Reports">{REPORTS.map((row) => <Tab key={row.id} id={row.id}>{row.label}</Tab>)}</TabList>
      </Tabs>
      {["by-mo", "by-component", "by-product", "by-period", "favorable-unfavorable", "cost", "scrap-vs-consumption", "bom-review-candidates"].includes(kind) && (
        <div className="flex flex-wrap gap-2">
          <TextField label="Started from" type="date" className="w-44" value={from} onChange={setFrom} />
          <TextField label="To" type="date" className="w-44" value={to} onChange={setTo} />
        </div>
      )}
      {query.isLoading && <LoadingState label="Calculating" rows={6} />}
      {query.isError && <ErrorState title="Could not load the report" description={errorMessage(query.error)} />}
      {query.data && <Panel title={REPORTS.find((row) => row.id === kind)?.label}>{!rows.length ? <p className="text-sm text-text-muted">Nothing to report.</p> : table()}</Panel>}
      {kind === "bom-review-candidates" && (
        <Panel title="BOM review requests" description="Raised from variance exceptions. Closing one records what engineering decided; a new BOM revision follows its own workflow.">
          {(reviews.data ?? []).length === 0 ? <p className="text-sm text-text-muted">No open requests.</p> : (
            <LinesTable columns={["Product", "Component", "From", "Why", "Asked", ""]}>
              {(reviews.data ?? []).map((row) => (
                <tr key={row.id}><Cell>{row.finished}</Cell><Cell>{row.component}</Cell><Cell>{row.exceptionId ? <Link className="text-brand underline" href={`${VARIANCE_BASE}/${row.exceptionId}`}>{row.exceptionNumber}</Link> : row.orderNumber}</Cell>
                  <Cell>{row.reason}</Cell><Cell>{row.requester}, {formatDateTime(row.requestedAt)}</Cell>
                  <Cell><Button size="compact" variant="ghost" onPress={() => setAsk({ title: "Close the BOM review", confirm: "Close", fields: [{ name: "note", label: "What was decided", kind: "textarea", required: true }],
                    run: async (values) => { await closeBomReview(row.id, String(values.note)); await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "manufacturing") }); } })}>Close</Button></Cell></tr>
              ))}
            </LinesTable>
          )}
        </Panel>
      )}
      {ask && <AskDialog ask={ask} onClose={() => setAsk(null)} />}
    </div>
  );
}
