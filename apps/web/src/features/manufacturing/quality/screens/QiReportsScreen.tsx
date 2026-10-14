"use client";

// Production quality reports: output awaiting inspection; inspections by order; acceptance and rejection rates by month and product; defects by
// reason and severity; holds; rework; rejected output awaiting scrap; batch history; failed measurements; turnaround from reporting to decision;
// inspector activity; quality corrections; and quality against receipt. Rates are shown per item or per order, never summed across units.
import Link from "next/link";
import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ErrorState, PageHeader, PermissionState, Tab, TabList, Tabs, TextField } from "@vercentlabs/design-system";

import { formatDateTime } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Panel } from "@/shared/ui/Panel";
import { Cell, LinesTable } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { MO_BASE, errorMessage, errorStatus, qty } from "@/features/manufacturing/orders/api/mo-api";
import { QI_BASE, qualityReport, reasonLabel } from "../api/qi-api";

const REPORTS = [{ id: "pending", label: "Awaiting inspection" }, { id: "by-mo", label: "By order" }, { id: "rates", label: "Acceptance rates" }, { id: "by-product", label: "By product" },
  { id: "defects-by-reason", label: "Defects by reason" }, { id: "defects-by-severity", label: "Defects by severity" }, { id: "holds", label: "Holds" }, { id: "rework", label: "Rework" },
  { id: "rejected-awaiting-scrap", label: "Rejected awaiting scrap" }, { id: "batch-history", label: "Batch history" }, { id: "failed-measurements", label: "Failed checks" },
  { id: "turnaround", label: "Turnaround" }, { id: "inspectors", label: "Inspectors" }, { id: "corrections", label: "Corrections" }, { id: "quality-to-receipt", label: "Quality to receipt" }];
type Row = Record<string, unknown>;
const s = (value: unknown) => (value === null || value === undefined ? "" : String(value));
const n = (value: unknown) => qty(value === null || value === undefined ? null : String(value));
const rate = (value: unknown) => (value === null || value === undefined ? "—" : `${s(value)}%`);
const when = (value: unknown) => (value ? formatDateTime(s(value)) : "");

export function QiReportsScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const kind = REPORTS.some((row) => row.id === params.get("report")) ? params.get("report")! : "by-mo";
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const filters = { from: from || undefined, to: to || undefined };
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "manufacturing", "quality-report", kind, filters), queryFn: () => qualityReport<Row>(kind, filters) });
  if (query.isError && errorStatus(query.error) === 403) return <PermissionState title="You don't have access to production inspections" description="Ask an administrator for access." />;
  const rows = query.data ?? [];
  const order = (row: Row) => (row.orderId ? <Link className="text-brand underline" href={`${MO_BASE}/${s(row.orderId)}?tab=quality`}>{s(row.orderNumber)}</Link> : "");
  const inspection = (row: Row) => (row.inspectionId ? <Link className="text-brand underline" href={`${QI_BASE}/${s(row.inspectionId)}`}>{s(row.inspectionNumber)}</Link> : "");
  const dated = !["pending", "holds", "corrections", "quality-to-receipt"].includes(kind);
  const table = () => {
    switch (kind) {
      case "pending": return <LinesTable columns={["Order", "Entry", "Product", { label: "Awaiting", numeric: true }, { label: "Held", numeric: true }, "Reported", { label: "Hours waiting", numeric: true }]}>
        {rows.map((row, index) => <tr key={index}><Cell>{order(row)}</Cell><Cell>{s(row.entryNumber)}</Cell><Cell>{s(row.itemCode)}</Cell><Cell numeric>{n(row.pending)} {s(row.uom)}</Cell>
          <Cell numeric>{Number(row.held) ? n(row.held) : ""}</Cell><Cell>{when(row.reportedAt)}</Cell><Cell numeric>{s(row.ageHours)}</Cell></tr>)}</LinesTable>;
      case "by-mo": return <LinesTable columns={["Order", "Product", { label: "Inspections", numeric: true }, { label: "Accepted", numeric: true }, { label: "Rejected", numeric: true }, { label: "Held", numeric: true }, { label: "Rejection rate", numeric: true }, "Last"]}>
        {rows.map((row, index) => <tr key={index}><Cell>{order(row)}</Cell><Cell>{s(row.code)}</Cell><Cell numeric>{s(row.inspections)}</Cell><Cell numeric>{n(row.accepted)}</Cell><Cell numeric>{n(row.rejected)}</Cell>
          <Cell numeric>{n(row.held)}</Cell><Cell numeric>{rate(row.rejectionRatePct)}</Cell><Cell>{when(row.lastAt)}</Cell></tr>)}</LinesTable>;
      case "rates": return <LinesTable columns={["Month", "Product", { label: "Inspections", numeric: true }, { label: "Accepted", numeric: true }, { label: "Rejected", numeric: true }, { label: "Acceptance rate", numeric: true }, { label: "Rejection rate", numeric: true }]}>
        {rows.map((row, index) => <tr key={index}><Cell>{s(row.month)}</Cell><Cell>{s(row.code)}</Cell><Cell numeric>{s(row.inspections)}</Cell><Cell numeric>{n(row.accepted)} {s(row.uom)}</Cell><Cell numeric>{n(row.rejected)}</Cell>
          <Cell numeric>{rate(row.acceptanceRatePct)}</Cell><Cell numeric>{rate(row.rejectionRatePct)}</Cell></tr>)}</LinesTable>;
      case "by-product": return <LinesTable columns={["Product", { label: "Orders", numeric: true }, { label: "Inspections", numeric: true }, { label: "Accepted", numeric: true }, { label: "Rejected", numeric: true }, { label: "Held", numeric: true }, { label: "Rejection rate", numeric: true }]}>
        {rows.map((row, index) => <tr key={index}><Cell>{s(row.code)} · {s(row.name)}</Cell><Cell numeric>{s(row.orders)}</Cell><Cell numeric>{s(row.inspections)}</Cell><Cell numeric>{n(row.accepted)} {s(row.uom)}</Cell>
          <Cell numeric>{n(row.rejected)}</Cell><Cell numeric>{n(row.held)}</Cell><Cell numeric>{rate(row.rejectionRatePct)}</Cell></tr>)}</LinesTable>;
      case "defects-by-reason":
      case "defects-by-severity": return <LinesTable columns={[kind === "defects-by-reason" ? "Reason" : "Severity", { label: "Defects", numeric: true }, { label: "Inspections", numeric: true }, { label: "Units affected", numeric: true }]}>
        {rows.map((row, index) => <tr key={index}><Cell>{reasonLabel(s(row.reason ?? row.severity))}</Cell><Cell numeric>{s(row.defects)}</Cell><Cell numeric>{s(row.inspections)}</Cell><Cell numeric>{n(row.affected)}</Cell></tr>)}</LinesTable>;
      case "holds": return <LinesTable columns={["Order", "Entry", "Inspection", { label: "Held", numeric: true }, "Why", "Status", "Placed", "Released"]}>
        {rows.map((row, index) => <tr key={index}><Cell>{order(row)}</Cell><Cell>{s(row.entryNumber)}</Cell><Cell>{inspection(row)}</Cell><Cell numeric>{n(row.quantity)}</Cell><Cell>{s(row.reason)}</Cell>
          <Cell>{row.status === "ACTIVE" ? "On hold" : "Released"}</Cell><Cell>{when(row.placedAt)}</Cell><Cell>{when(row.releasedAt)}{row.note ? ` — ${s(row.note)}` : ""}</Cell></tr>)}</LinesTable>;
      case "rework": return <LinesTable columns={["Inspection", "Order", "Product", { label: "Rejected for rework", numeric: true }, { label: "Accepted after rework", numeric: true }, "Assigned to", "When"]}>
        {rows.map((row, index) => <tr key={index}><Cell>{inspection(row)}</Cell><Cell>{order(row)}</Cell><Cell>{s(row.code)}</Cell><Cell numeric>{n(row.rejected)} {s(row.uom)}</Cell><Cell numeric>{n(row.reworked)}</Cell>
          <Cell>{s(row.assignedTo)}</Cell><Cell>{when(row.at)}</Cell></tr>)}</LinesTable>;
      case "rejected-awaiting-scrap": return <LinesTable columns={["Inspection", "Order", "Entry", "Product", { label: "Rejected for scrap", numeric: true }, { label: "Scrapped", numeric: true }, "Decided"]}>
        {rows.map((row, index) => <tr key={index}><Cell>{inspection(row)}</Cell><Cell>{order(row)}</Cell><Cell>{s(row.entryNumber)}</Cell><Cell>{s(row.code)}</Cell><Cell numeric>{n(row.rejected)} {s(row.uom)}</Cell>
          <Cell numeric>{n(row.scrapped)}</Cell><Cell>{when(row.at)}</Cell></tr>)}</LinesTable>;
      case "batch-history": return <LinesTable columns={["Production batch", "Inspection", "Order", "Product", { label: "Accepted", numeric: true }, { label: "Rejected", numeric: true }, { label: "Held", numeric: true }, "When"]}>
        {rows.map((row, index) => <tr key={index}><Cell>{s(row.batch)}</Cell><Cell>{inspection(row)}</Cell><Cell>{order(row)}</Cell><Cell>{s(row.code)}</Cell><Cell numeric>{n(row.accepted)} {s(row.uom)}</Cell>
          <Cell numeric>{n(row.rejected)}</Cell><Cell numeric>{n(row.held)}</Cell><Cell>{when(row.at)}</Cell></tr>)}</LinesTable>;
      case "failed-measurements": return <LinesTable columns={["Inspection", "Order", "Product", "Check", "Recorded", "Limits", "When"]}>
        {rows.map((row, index) => <tr key={index}><Cell>{inspection(row)}</Cell><Cell>{order(row)}</Cell><Cell>{s(row.code)}</Cell><Cell>{s(row.check)}{row.critical ? " (critical)" : ""}</Cell>
          <Cell>{s(row.value)} {s(row.unit)}</Cell><Cell>{row.lower || row.upper ? `${s(row.lower) || "—"} to ${s(row.upper) || "—"}` : ""}</Cell><Cell>{when(row.at)}</Cell></tr>)}</LinesTable>;
      case "turnaround": return <LinesTable columns={["Inspection", "Order", "Product", "Reported", "Finalized", { label: "Hours", numeric: true }]}>
        {rows.map((row, index) => <tr key={index}><Cell>{inspection(row)}</Cell><Cell>{order(row)}</Cell><Cell>{s(row.code)}</Cell><Cell>{when(row.reportedAt)}</Cell><Cell>{when(row.finalizedAt)}</Cell><Cell numeric>{s(row.hours)}</Cell></tr>)}</LinesTable>;
      case "inspectors": return <LinesTable columns={["Inspector", { label: "Inspections", numeric: true }, { label: "Accepted", numeric: true }, { label: "Rejected", numeric: true }, { label: "Held", numeric: true }, { label: "Reviewed", numeric: true }, { label: "Rejection rate", numeric: true }]}>
        {rows.map((row, index) => <tr key={index}><Cell>{s(row.inspector)}</Cell><Cell numeric>{s(row.inspections)}</Cell><Cell numeric>{n(row.accepted)}</Cell><Cell numeric>{n(row.rejected)}</Cell><Cell numeric>{n(row.held)}</Cell>
          <Cell numeric>{s(row.reviewed)}</Cell><Cell numeric>{rate(row.rejectionRatePct)}</Cell></tr>)}</LinesTable>;
      case "corrections": return <LinesTable columns={["Correction", "Order", "Entry", "Inspection", "Change", { label: "Quantity", numeric: true }, "Why", "By"]}>
        {rows.map((row, index) => <tr key={index}><Cell>{s(row.number)}</Cell><Cell>{order(row)}</Cell><Cell>{s(row.entryNumber)}</Cell><Cell>{inspection(row)}</Cell>
          <Cell>{row.direction === "ACCEPTED_TO_REJECTED" ? "Accepted → rejected" : `Rejected → accepted${row.kind === "REWORK" ? " after rework" : ""}`}</Cell><Cell numeric>{n(row.quantity)}</Cell><Cell>{s(row.reason)}</Cell>
          <Cell>{s(row.by)}, {when(row.at)}</Cell></tr>)}</LinesTable>;
      case "quality-to-receipt": return <LinesTable columns={["Order", "Status", "Product", { label: "Awaiting inspection", numeric: true }, { label: "Held", numeric: true }, { label: "Accepted", numeric: true }, { label: "Received", numeric: true }, { label: "Accepted, not received", numeric: true }, { label: "Rejected", numeric: true }]}>
        {rows.map((row, index) => <tr key={index}><Cell>{order(row)}</Cell><Cell>{s(row.orderStatusLabel)}</Cell><Cell>{s(row.code)}</Cell><Cell numeric>{n(row.pending)}</Cell><Cell numeric>{Number(row.held) ? n(row.held) : ""}</Cell>
          <Cell numeric>{n(row.accepted)}</Cell><Cell numeric>{n(row.received)}</Cell><Cell numeric>{Number(row.awaitingReceipt) ? n(row.awaitingReceipt) : ""}</Cell><Cell numeric>{n(row.rejected)}</Cell></tr>)}</LinesTable>;
      default: return null;
    }
  };
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Quality Reports" description="How production output fares at inspection: what waits, what passes and fails and why, how long a decision takes, and how quality decisions reach stock." />
      <Tabs selectedKey={kind} onSelectionChange={(value) => router.replace(`${pathname}?report=${String(value)}`)}>
        <TabList aria-label="Reports">{REPORTS.map((row) => <Tab key={row.id} id={row.id}>{row.label}</Tab>)}</TabList>
      </Tabs>
      {dated && (
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
