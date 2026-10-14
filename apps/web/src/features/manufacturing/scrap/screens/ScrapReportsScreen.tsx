"use client";

// Scrap reports: by order, component, reason, production batch and date; planned allowance against actual scrap with the material scrap rate;
// cost and the normal/abnormal split; rejected-output disposition with the output rejection rate; recoverable scrap; by location; approvals
// and corrections. The two rates are shown per item or per order, never summed across units. Value only for those who may see cost.
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
import { SCRAP_BASE, scrapReport } from "../api/scrap-api";

const REPORTS = [{ id: "by-mo", label: "By order" }, { id: "by-component", label: "By component" }, { id: "by-reason", label: "By reason" }, { id: "by-batch", label: "By production batch" },
  { id: "by-date", label: "By date" }, { id: "planned-vs-actual", label: "Planned vs actual" }, { id: "cost", label: "Cost" }, { id: "normal-abnormal", label: "Normal vs abnormal" },
  { id: "rejected-disposition", label: "Rejected output" }, { id: "recoverable", label: "Recoverable" }, { id: "by-location", label: "By location" }, { id: "approvals", label: "Approvals & corrections" }];
type Row = Record<string, unknown>;
const s = (value: unknown) => (value === null || value === undefined ? "" : String(value));
const n = (value: unknown) => qty(value === null || value === undefined ? null : String(value));
const money = (value: unknown) => (value === null || value === undefined ? "—" : inr(String(value)));
const rate = (value: unknown) => (value === null || value === undefined ? "—" : `${s(value)}%`);
const label = (value: unknown) => s(value).toLowerCase().replace(/_/g, " ");

export function ScrapReportsScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const kind = REPORTS.some((row) => row.id === params.get("report")) ? params.get("report")! : "by-mo";
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const filters = { from: from || undefined, to: to || undefined };
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "manufacturing", "scrap-report", kind, filters), queryFn: () => scrapReport<Row>(kind, filters) });
  if (query.isError && errorStatus(query.error) === 403) return <PermissionState title="You don't have access to scrap" description="Ask an administrator for access." />;
  const rows = query.data ?? [];
  const order = (row: Row) => (row.orderId ? <Link className="text-brand underline" href={`${MO_BASE}/${s(row.orderId)}?tab=materials`}>{s(row.orderNumber)}</Link> : "");
  const note = (row: Row) => (row.scrapId ? <Link className="text-brand underline" href={`${SCRAP_BASE}/${s(row.scrapId)}`}>{s(row.scrapNumber)}</Link> : "");
  const dated = ["by-mo", "by-component", "by-reason", "by-batch", "by-date", "cost", "normal-abnormal", "recoverable", "by-location"].includes(kind);
  const table = () => {
    switch (kind) {
      case "by-mo": return <LinesTable columns={["Order", { label: "Notes", numeric: true }, { label: "Material lines", numeric: true }, { label: "Output lines", numeric: true }, "Last", { label: "Value", numeric: true }]}>
        {rows.map((row, index) => <tr key={index}><Cell>{order(row)}</Cell><Cell numeric>{s(row.notes)}</Cell><Cell numeric>{s(row.materialLines)}</Cell><Cell numeric>{s(row.outputLines)}</Cell><Cell>{formatDateTime(s(row.lastAt))}</Cell><Cell numeric>{money(row.cost)}</Cell></tr>)}</LinesTable>;
      case "by-component": return <LinesTable columns={["Component", "Unit", { label: "Scrapped", numeric: true }, { label: "Orders", numeric: true }, { label: "Value", numeric: true }]}>
        {rows.map((row, index) => <tr key={index}><Cell>{s(row.code)} · {s(row.name)}</Cell><Cell>{s(row.uom)}</Cell><Cell numeric>{n(row.quantity)}</Cell><Cell numeric>{s(row.orders)}</Cell><Cell numeric>{money(row.cost)}</Cell></tr>)}</LinesTable>;
      case "by-reason": return <LinesTable columns={["Reason", { label: "Notes", numeric: true }, { label: "Value", numeric: true }]}>
        {rows.map((row, index) => <tr key={index}><Cell>{s(row.reason)}</Cell><Cell numeric>{s(row.notes)}</Cell><Cell numeric>{money(row.cost)}</Cell></tr>)}</LinesTable>;
      case "by-batch": return <LinesTable columns={["Order", "Production batch", "Entry", { label: "Output scrapped", numeric: true }, { label: "Value", numeric: true }]}>
        {rows.map((row, index) => <tr key={index}><Cell>{order(row)}</Cell><Cell>{s(row.batch)}</Cell><Cell>{s(row.entryNumber)}</Cell><Cell numeric>{n(row.quantity)} {s(row.uom)}</Cell><Cell numeric>{money(row.cost)}</Cell></tr>)}</LinesTable>;
      case "by-date": return <LinesTable columns={["Day", { label: "Notes", numeric: true }, { label: "Orders", numeric: true }, { label: "Value", numeric: true }]}>
        {rows.map((row, index) => <tr key={index}><Cell>{formatDate(s(row.day))}</Cell><Cell numeric>{s(row.notes)}</Cell><Cell numeric>{s(row.orders)}</Cell><Cell numeric>{money(row.cost)}</Cell></tr>)}</LinesTable>;
      case "planned-vs-actual": return <LinesTable columns={["Order", "Material", "Unit", { label: "Planned", numeric: true }, { label: "Allowance %", numeric: true }, { label: "Planned scrap", numeric: true },
        { label: "Actual scrap", numeric: true }, { label: "Over allowance", numeric: true }, { label: "Net issued", numeric: true }, { label: "Material scrap rate", numeric: true }]}>
        {rows.map((row, index) => <tr key={index}><Cell>{order(row)}</Cell><Cell>{s(row.code)}</Cell><Cell>{s(row.uom)}</Cell><Cell numeric>{n(row.planned)}</Cell><Cell numeric>{row.allowancePct === null ? "—" : `${s(row.allowancePct)}%`}</Cell>
          <Cell numeric>{n(row.plannedScrap)}</Cell><Cell numeric>{n(row.actualScrap)}</Cell><Cell numeric>{Number(row.overAllowance) ? n(row.overAllowance) : ""}</Cell><Cell numeric>{n(row.netIssued)}</Cell><Cell numeric>{rate(row.scrapRatePct)}</Cell></tr>)}</LinesTable>;
      case "cost":
      case "normal-abnormal": return <LinesTable columns={["What", "Disposition", "Loss", "Treatment", { label: "Notes", numeric: true }, { label: "Value", numeric: true }]}>
        {rows.map((row, index) => <tr key={index}><Cell>{label(row.type)}</Cell><Cell>{label(row.disposition)}</Cell><Cell>{label(row.lossClass)}</Cell><Cell>{s(row.treatment)}</Cell><Cell numeric>{s(row.notes)}</Cell><Cell numeric>{money(row.cost)}</Cell></tr>)}</LinesTable>;
      case "rejected-disposition": return <LinesTable columns={["Order", "Status", "Product", { label: "Reported", numeric: true }, { label: "Rejected", numeric: true }, { label: "Output rejection rate", numeric: true },
        { label: "Scrapped", numeric: true }, { label: "Undisposed", numeric: true }]}>
        {rows.map((row, index) => <tr key={index}><Cell>{order(row)}</Cell><Cell>{s(row.orderStatusLabel)}</Cell><Cell>{s(row.code)}</Cell><Cell numeric>{n(row.reported)}</Cell><Cell numeric>{n(row.rejected)}</Cell>
          <Cell numeric>{rate(row.rejectionRatePct)}</Cell><Cell numeric>{n(row.scrapped)}</Cell><Cell numeric>{Number(row.undisposed) ? n(row.undisposed) : ""}</Cell></tr>)}</LinesTable>;
      case "recoverable": return <LinesTable columns={["Note", "Order", "Item", { label: "Quantity", numeric: true }, "Where", { label: "Source value", numeric: true }, { label: "Recovery value", numeric: true }, "When"]}>
        {rows.map((row, index) => <tr key={index}><Cell>{note(row)}</Cell><Cell>{order(row)}</Cell><Cell>{s(row.code)}</Cell><Cell numeric>{n(row.quantity)} {s(row.uom)}</Cell><Cell>{s(row.location)}</Cell>
          <Cell numeric>{money(row.sourceCost)}</Cell><Cell numeric>{money(row.recoveryValue)}</Cell><Cell>{formatDateTime(s(row.at))}</Cell></tr>)}</LinesTable>;
      case "by-location": return <LinesTable columns={["Where", { label: "Notes", numeric: true }, { label: "Value", numeric: true }]}>
        {rows.map((row, index) => <tr key={index}><Cell>{s(row.place)}</Cell><Cell numeric>{s(row.notes)}</Cell><Cell numeric>{money(row.cost)}</Cell></tr>)}</LinesTable>;
      case "approvals": return <LinesTable columns={["Note", "Order", "Status", "Approval", "Why", "Submitted by", "Decided by", "Correction"]}>
        {rows.map((row, index) => <tr key={index}><Cell>{note(row)}</Cell><Cell>{order(row)}</Cell><Cell>{label(row.status)}</Cell><Cell>{label(row.approvalStatus)}</Cell><Cell>{s(row.reasons)}</Cell>
          <Cell>{s(row.requestedBy)}</Cell><Cell>{s(row.decidedBy)}{row.note ? ` — ${s(row.note)}` : ""}</Cell><Cell>{s(row.correction)}</Cell></tr>)}</LinesTable>;
      default: return null;
    }
  };
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Scrap Reports" description="Manufacturing losses: where they happen, why, what they cost, against the BOM's allowance — material scrap and output rejection measured separately." />
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
