"use client";

// Production reports (one page, many views): output by order and date, batch history, planned against accepted, yield, accepted but not
// received, finished-goods receipts and the entries they came from, material use per batch, work in progress, partial production cost,
// sales-linked progress, overproduction and short closes, corrections, and what needs attention. Value only for those who may see cost.
import Link from "next/link";
import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ErrorState, PageHeader, PermissionState, Tab, TabList, Tabs, TextField } from "@vercentlabs/design-system";

import { formatDate, formatDateTime } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Panel } from "@/shared/ui/Panel";
import { Cell, LinesTable } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { MO_BASE, errorMessage, errorStatus, inr, qty } from "@/features/manufacturing/orders/api/mo-api";
import { productionReport } from "../api/pp-api";

const REPORTS = [{ id: "summary", label: "Output by day" }, { id: "batches", label: "Batches" }, { id: "planned-vs-accepted", label: "Planned vs accepted" }, { id: "yield", label: "Yield" },
  { id: "accepted-unreceived", label: "Accepted, not received" }, { id: "receipts", label: "Receipts" }, { id: "material-per-batch", label: "Material per batch" }, { id: "wip", label: "Work in progress" },
  { id: "cost", label: "Production cost" }, { id: "sales-linked", label: "Sales-linked" }, { id: "over-short", label: "Over / short" }, { id: "corrections", label: "Corrections" },
  { id: "exceptions", label: "Needs attention" }];
type Row = Record<string, unknown>;
const s = (value: unknown) => (value === null || value === undefined ? "" : String(value));
const n = (value: unknown) => qty(value === null || value === undefined ? null : String(value));
const money = (value: unknown) => (value === null || value === undefined ? "—" : inr(String(value)));

export function ProductionProgressReportsScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const kind = REPORTS.some((row) => row.id === params.get("report")) ? params.get("report")! : "summary";
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const filters = { from: from || undefined, to: to || undefined };
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "manufacturing", "production-report", kind, filters), queryFn: () => productionReport<Row>(kind, filters) });
  if (query.isError && errorStatus(query.error) === 403) return <PermissionState title="You don't have access to production" description="Ask an administrator for access." />;
  const rows = query.data ?? [];
  const order = (row: Row) => <Link className="text-brand underline" href={`${MO_BASE}/${s(row.orderId)}?tab=production`}>{s(row.orderNumber)}</Link>;
  const progressColumns = ["Order", "Product", "Status", { label: "Planned", numeric: true }, { label: "Reported", numeric: true }, { label: "Accepted", numeric: true }, { label: "Rejected", numeric: true },
    { label: "Awaiting", numeric: true }, { label: "Received", numeric: true }, { label: "Accepted, not received", numeric: true }];
  const progressCells = (row: Row) => <><Cell>{order(row)}</Cell><Cell>{s(row.product)}</Cell><Cell>{s(row.status)}</Cell><Cell numeric>{n(row.planned)}</Cell><Cell numeric>{n(row.reported)}</Cell>
    <Cell numeric>{n(row.accepted)}</Cell><Cell numeric>{n(row.rejected)}</Cell><Cell numeric>{n(row.pending)}</Cell><Cell numeric>{n(row.received)}</Cell><Cell numeric>{n(row.acceptedNotReceived)}</Cell></>;
  const table = () => {
    switch (kind) {
      case "summary": return <LinesTable columns={["Day", "Order", { label: "Entries", numeric: true }, { label: "Reported", numeric: true }]}>
        {rows.map((row, index) => <tr key={index}><Cell>{formatDate(s(row.day))}</Cell><Cell>{order(row)}</Cell><Cell numeric>{s(row.entries)}</Cell><Cell numeric>{n(row.reported)}</Cell></tr>)}</LinesTable>;
      case "batches": return <LinesTable columns={["Order", "Batch", "Status", { label: "Planned", numeric: true }, { label: "Entries", numeric: true }, { label: "Reported", numeric: true }, { label: "Accepted", numeric: true },
        { label: "Rejected", numeric: true }, { label: "Received", numeric: true }, "Started"]}>
        {rows.map((row, index) => <tr key={index}><Cell>{order(row)}</Cell><Cell>{s(row.reference)}</Cell><Cell>{s(row.status).toLowerCase()}</Cell><Cell numeric>{row.planned ? n(row.planned) : "—"}</Cell>
          <Cell numeric>{s(row.entries)}</Cell><Cell numeric>{n(row.reported)}</Cell><Cell numeric>{n(row.accepted)}</Cell><Cell numeric>{n(row.rejected)}</Cell><Cell numeric>{n(row.received)}</Cell>
          <Cell>{formatDateTime(s(row.startedAt))}</Cell></tr>)}</LinesTable>;
      case "planned-vs-accepted":
      case "accepted-unreceived": return <LinesTable columns={[...progressColumns, { label: "Progress", numeric: true }]}>
        {rows.map((row, index) => <tr key={index}>{progressCells(row)}<Cell numeric>{row.progressPct ? `${s(row.progressPct)}%` : "—"}</Cell></tr>)}</LinesTable>;
      case "yield": return <LinesTable columns={["Order", "Product", { label: "Reported", numeric: true }, { label: "Accepted", numeric: true }, { label: "Rejected", numeric: true }, { label: "Yield", numeric: true }]}>
        {rows.map((row, index) => <tr key={index}><Cell>{order(row)}</Cell><Cell>{s(row.product)}</Cell><Cell numeric>{n(row.reported)}</Cell><Cell numeric>{n(row.accepted)}</Cell><Cell numeric>{n(row.rejected)}</Cell>
          <Cell numeric>{row.yieldPct ? `${s(row.yieldPct)}%` : "—"}</Cell></tr>)}</LinesTable>;
      case "receipts": return <LinesTable columns={["Receipt", "Order", { label: "Quantity", numeric: true }, "From entries", "Warehouse", "Batch", { label: "Unit cost", numeric: true }, { label: "Value", numeric: true }, "When"]}>
        {rows.map((row, index) => <tr key={index}><Cell>{s(row.receiptNumber)}</Cell><Cell>{order(row)}</Cell><Cell numeric>{n(row.quantity)}</Cell><Cell>{s(row.sources)}</Cell><Cell>{s(row.warehouse)}</Cell><Cell>{s(row.batch)}</Cell>
          <Cell numeric>{money(row.unitCost)}</Cell><Cell numeric>{money(row.totalCost)}</Cell><Cell>{formatDateTime(s(row.at))}</Cell></tr>)}</LinesTable>;
      case "material-per-batch": return <LinesTable columns={["Order", "Batch", { label: "Reported", numeric: true }, "Material", { label: "BOM expects", numeric: true }, { label: "Used", numeric: true }, { label: "Variance", numeric: true }]}>
        {rows.map((row, index) => <tr key={index}><Cell>{order(row)}</Cell><Cell>{s(row.batch)}</Cell><Cell numeric>{n(row.reported)}</Cell><Cell>{s(row.code)}</Cell><Cell numeric>{n(row.expected)}</Cell><Cell numeric>{n(row.consumed)}</Cell>
          <Cell numeric>{Number(row.variance) > 0 ? "+" : ""}{n(row.variance)}</Cell></tr>)}</LinesTable>;
      case "wip":
      case "cost": return <LinesTable columns={["Order", "Status", { label: "Accepted", numeric: true }, { label: "Received", numeric: true }, { label: "Material in WIP", numeric: true }, { label: "Capitalised", numeric: true },
        { label: "Variance closed", numeric: true }, { label: "Remaining WIP", numeric: true }, { label: "Received unit cost", numeric: true }]}>
        {rows.map((row, index) => <tr key={index}><Cell>{order(row)}</Cell><Cell>{s(row.status)}</Cell><Cell numeric>{n(row.accepted)}</Cell><Cell numeric>{n(row.received)}</Cell><Cell numeric>{money(row.materialInWip)}</Cell>
          <Cell numeric>{money(row.capitalised)}</Cell><Cell numeric>{money(row.varianceClosed)}</Cell><Cell numeric>{money(row.remainingWip)}</Cell><Cell numeric>{money(row.receivedUnitCost)}</Cell></tr>)}</LinesTable>;
      case "sales-linked": return <LinesTable columns={["Order", "Sales order", "Customer", "Required", { label: "Assigned", numeric: true }, { label: "Received", numeric: true }, { label: "Reserved", numeric: true }, "Status"]}>
        {rows.map((row, index) => <tr key={index}><Cell>{order(row)}</Cell><Cell>{s(row.salesOrder)}</Cell><Cell>{s(row.customer)}</Cell><Cell>{row.requiredDate ? formatDate(s(row.requiredDate)) : ""}</Cell>
          <Cell numeric>{n(row.assigned)}</Cell><Cell numeric>{n(row.received)}</Cell><Cell numeric>{n(row.reserved)}</Cell><Cell>{s(row.status).toLowerCase().replace(/_/g, " ")}</Cell></tr>)}</LinesTable>;
      case "over-short": return <LinesTable columns={["Order", "Product", { label: "Planned", numeric: true }, { label: "Accepted", numeric: true }, { label: "Allowance", numeric: true }, "Outcome", "Short-close reason"]}>
        {rows.map((row, index) => <tr key={index}><Cell>{order(row)}</Cell><Cell>{s(row.product)}</Cell><Cell numeric>{n(row.planned)}</Cell><Cell numeric>{n(row.accepted)}</Cell><Cell numeric>{Number(row.allowance) ? `+${n(row.allowance)}` : ""}</Cell>
          <Cell>{s(row.outcome)}</Cell><Cell>{s(row.shortClose)}</Cell></tr>)}</LinesTable>;
      case "corrections": return <LinesTable columns={["Correction", "Order", "Entry", "Withdrawn", { label: "Quantity", numeric: true }, "Why", "By", "When"]}>
        {rows.map((row, index) => <tr key={index}><Cell>{s(row.number)}</Cell><Cell>{order(row)}</Cell><Cell>{s(row.entryNumber)}</Cell><Cell>{s(row.kind) === "PENDING" ? "awaiting inspection" : "accepted"}</Cell>
          <Cell numeric>{n(row.quantity)}</Cell><Cell>{s(row.reason)}</Cell><Cell>{s(row.by)}</Cell><Cell>{formatDateTime(s(row.at))}</Cell></tr>)}</LinesTable>;
      case "exceptions": return <LinesTable columns={["Order", "What needs attention"]}>
        {rows.map((row, index) => <tr key={index}><Cell>{order(row)}</Cell><Cell>{s(row.problem)}</Cell></tr>)}</LinesTable>;
      default: return null;
    }
  };
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Production Progress" description="Output made in parts — reported, inspected, accepted, received — and what it cost. Figures come from the posted entries, decisions and receipts." />
      <Tabs selectedKey={kind} onSelectionChange={(value) => router.replace(`${pathname}?report=${String(value)}`)}>
        <TabList aria-label="Reports">{REPORTS.map((row) => <Tab key={row.id} id={row.id}>{row.label}</Tab>)}</TabList>
      </Tabs>
      {["summary", "receipts", "corrections"].includes(kind) && (
        <div className="flex flex-wrap gap-2">
          <TextField label="From" type="date" className="w-44" value={from} onChange={setFrom} />
          <TextField label="To" type="date" className="w-44" value={to} onChange={setTo} />
        </div>
      )}
      {query.isLoading && <LoadingState label="Loading the report" rows={6} />}
      {query.isError && <ErrorState title="Could not load the report" description={errorMessage(query.error)} />}
      {query.data && <Panel title={REPORTS.find((row) => row.id === kind)?.label}>{!rows.length ? <p className="text-sm text-text-muted">Nothing to report.</p> : table()}</Panel>}
    </div>
  );
}
