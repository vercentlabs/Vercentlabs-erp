"use client";

// Finished-goods receipt reports: receipts by order, date, product and warehouse; accepted output not yet received; the partial-receipt summary
// per order; corrections and reversals; lot and serial traceability (back to the order, the production entry and the raw-material lots issued);
// and the exceptions queue (approvals and corrections waiting, failed sales allocations, postings needing recovery). Value only for those who
// may see cost. Reversed receipts count nothing.
import Link from "next/link";
import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ErrorState, PageHeader, PermissionState, StatusBadge, Tab, TabList, Tabs, TextField } from "@vercentlabs/design-system";

import { formatDate, formatDateTime } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Panel } from "@/shared/ui/Panel";
import { Cell, LinesTable } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { MO_BASE, errorMessage, errorStatus, inr, qty } from "@/features/manufacturing/orders/api/mo-api";
import { FGR_BASE, receiptExceptions, receiptReport, type ReceiptException } from "../api/fgr-api";

const REPORTS = [{ id: "exceptions", label: "Exceptions" }, { id: "accepted-unreceived", label: "Accepted, not received" }, { id: "by-mo", label: "By order" }, { id: "by-date", label: "By date" },
  { id: "by-item", label: "By product" }, { id: "by-warehouse", label: "By warehouse" }, { id: "partial-summary", label: "Partial receipts" }, { id: "reversals", label: "Corrections" },
  { id: "traceability", label: "Lot & serial trace" }];
const EXCEPTION_LABEL: Record<ReceiptException["kind"], string> = { APPROVAL_PENDING: "Approval waiting", CORRECTION_PENDING: "Correction waiting", SALES_ALLOCATION_FAILED: "Sales allocation failed",
  POSTING_MISMATCH: "Posting needs recovery", ACCEPTED_NOT_RECEIVED: "Accepted, not received" };
type Row = Record<string, unknown>;
const s = (value: unknown) => (value === null || value === undefined ? "" : String(value));
const n = (value: unknown) => qty(value === null || value === undefined ? null : String(value));
const money = (value: unknown) => (value === null || value === undefined ? "—" : inr(String(value)));

export function FinishedGoodsReceiptReportsScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const kind = REPORTS.some((row) => row.id === params.get("report")) ? params.get("report")! : "exceptions";
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [lot, setLot] = useState("");
  const [serial, setSerial] = useState("");
  const filters = { from: from || undefined, to: to || undefined, lot: kind === "traceability" ? lot.trim() || undefined : undefined, serial: kind === "traceability" ? serial.trim() || undefined : undefined };
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "manufacturing", "finished-goods-receipt-report", kind, filters),
    queryFn: () => (kind === "exceptions" ? receiptExceptions().then((rows) => rows as unknown as Row[]) : receiptReport<Row>(kind, filters)) });
  if (query.isError && errorStatus(query.error) === 403) return <PermissionState title="You don't have access to finished-goods receipts" description="Ask an administrator for access." />;
  const rows = query.data ?? [];
  const order = (row: Row) => (row.orderId ? <Link className="text-brand underline" href={`${MO_BASE}/${s(row.orderId)}?tab=production`}>{s(row.orderNumber) || "Order"}</Link> : "");
  const receipt = (row: Row) => (row.receiptId ? <Link className="text-brand underline" href={`${FGR_BASE}/${s(row.receiptId)}`}>{s(row.receiptNumber)}</Link> : "");
  const dated = ["by-mo", "by-date", "by-item", "by-warehouse", "traceability"].includes(kind);
  const table = () => {
    switch (kind) {
      case "exceptions": return <LinesTable columns={["Kind", "Receipt", "Order", "What", "Since"]}>
        {rows.map((row, index) => <tr key={index}><Cell><StatusBadge tone={row.kind === "POSTING_MISMATCH" || row.kind === "SALES_ALLOCATION_FAILED" ? "danger" : "warning"}>{EXCEPTION_LABEL[row.kind as ReceiptException["kind"]] ?? s(row.kind)}</StatusBadge></Cell>
          <Cell>{receipt(row)}</Cell><Cell>{order(row)}</Cell><Cell>{s(row.message)}</Cell><Cell>{row.since ? formatDateTime(s(row.since)) : ""}</Cell></tr>)}</LinesTable>;
      case "accepted-unreceived": return <LinesTable columns={["Order", "Status", "Product", { label: "Accepted", numeric: true }, { label: "Received", numeric: true }, { label: "Receivable", numeric: true }, "Into"]}>
        {rows.map((row, index) => <tr key={index}><Cell>{order(row)}</Cell><Cell>{s(row.orderStatusLabel)}</Cell><Cell>{s(row.code)}</Cell><Cell numeric>{n(row.accepted)}</Cell><Cell numeric>{n(row.received)}</Cell>
          <Cell numeric>{n(row.receivable)} {s(row.uom)}</Cell><Cell>{s(row.warehouse)}</Cell></tr>)}</LinesTable>;
      case "by-mo": return <LinesTable columns={["Order", "Product", { label: "Receipts", numeric: true }, { label: "Received", numeric: true }, { label: "Accepted", numeric: true }, { label: "Receivable", numeric: true }, "Last received", { label: "Value", numeric: true }]}>
        {rows.map((row, index) => <tr key={index}><Cell>{order(row)}</Cell><Cell>{s(row.code)}</Cell><Cell numeric>{s(row.receipts)}</Cell><Cell numeric>{n(row.received)} {s(row.uom)}</Cell><Cell numeric>{n(row.accepted)}</Cell>
          <Cell numeric>{n(row.receivable)}</Cell><Cell>{formatDateTime(s(row.lastReceivedAt))}</Cell><Cell numeric>{money(row.cost)}</Cell></tr>)}</LinesTable>;
      case "by-date": return <LinesTable columns={["Day", { label: "Receipts", numeric: true }, { label: "Orders", numeric: true }, { label: "Products", numeric: true }, { label: "Quantity", numeric: true }, { label: "Value", numeric: true }]}>
        {rows.map((row, index) => <tr key={index}><Cell>{formatDate(s(row.day))}</Cell><Cell numeric>{s(row.receipts)}</Cell><Cell numeric>{s(row.orders)}</Cell><Cell numeric>{s(row.items)}</Cell><Cell numeric>{n(row.quantity)}</Cell><Cell numeric>{money(row.cost)}</Cell></tr>)}</LinesTable>;
      case "by-item": return <LinesTable columns={["Product", "Unit", { label: "Received", numeric: true }, { label: "Receipts", numeric: true }, { label: "Orders", numeric: true }, { label: "Value", numeric: true }]}>
        {rows.map((row, index) => <tr key={index}><Cell>{s(row.code)} · {s(row.name)}</Cell><Cell>{s(row.uom)}</Cell><Cell numeric>{n(row.quantity)}</Cell><Cell numeric>{s(row.receipts)}</Cell><Cell numeric>{s(row.orders)}</Cell><Cell numeric>{money(row.cost)}</Cell></tr>)}</LinesTable>;
      case "by-warehouse": return <LinesTable columns={["Warehouse", { label: "Receipts", numeric: true }, { label: "Products", numeric: true }, { label: "Quantity", numeric: true }, { label: "Value", numeric: true }]}>
        {rows.map((row, index) => <tr key={index}><Cell>{s(row.warehouse)}</Cell><Cell numeric>{s(row.receipts)}</Cell><Cell numeric>{s(row.items)}</Cell><Cell numeric>{n(row.quantity)}</Cell><Cell numeric>{money(row.cost)}</Cell></tr>)}</LinesTable>;
      case "partial-summary": return <LinesTable columns={["Order", "Status", "Product", { label: "Planned", numeric: true }, { label: "Reported", numeric: true }, { label: "Accepted", numeric: true }, { label: "Rejected", numeric: true },
        { label: "Awaiting inspection", numeric: true }, { label: "Received", numeric: true }, { label: "Receivable", numeric: true }, { label: "Receipts", numeric: true }]}>
        {rows.map((row, index) => <tr key={index}><Cell>{order(row)}</Cell><Cell>{s(row.orderStatusLabel)}</Cell><Cell>{s(row.code)}</Cell><Cell numeric>{n(row.planned)}</Cell><Cell numeric>{n(row.reported)}</Cell>
          <Cell numeric>{n(row.accepted)}</Cell><Cell numeric>{n(row.rejected)}</Cell><Cell numeric>{n(row.pending)}</Cell><Cell numeric>{n(row.received)}</Cell><Cell numeric>{n(row.receivable)}</Cell><Cell numeric>{s(row.receipts)}</Cell></tr>)}</LinesTable>;
      case "reversals": return <LinesTable columns={["Correction", "Receipt", "Order", "Product", { label: "Quantity", numeric: true }, "Status", "Why", "Asked by", "Decided by", { label: "Value", numeric: true }]}>
        {rows.map((row, index) => <tr key={index}><Cell>{s(row.number)}</Cell><Cell>{receipt(row)}</Cell><Cell>{order(row)}</Cell><Cell>{s(row.code)}</Cell><Cell numeric>{n(row.quantity)}</Cell><Cell>{s(row.status).toLowerCase()}</Cell>
          <Cell>{s(row.reason)}{row.note ? ` — ${s(row.note)}` : ""}</Cell><Cell>{s(row.requestedBy)}{row.requestedAt ? `, ${formatDateTime(s(row.requestedAt))}` : ""}</Cell>
          <Cell>{s(row.decidedBy)}{row.decidedAt ? `, ${formatDateTime(s(row.decidedAt))}` : ""}</Cell><Cell numeric>{money(row.cost)}</Cell></tr>)}</LinesTable>;
      case "traceability": return <LinesTable columns={["Receipt", "Order", "Product", "Production entry", "Lot / serials", { label: "Quantity", numeric: true }, "Into", "Raw materials issued to the order", "When"]}>
        {rows.map((row, index) => <tr key={index}><Cell>{receipt(row)}{row.reversed ? " (reversed)" : ""}</Cell><Cell>{order(row)}</Cell><Cell>{s(row.code)}</Cell>
          <Cell>{s(row.entryNumber)}{row.productionBatch ? ` · ${s(row.productionBatch)}` : ""}</Cell><Cell>{s(row.lot)}{(row.serials as string[] ?? []).length ? (row.serials as string[]).join(", ") : ""}</Cell>
          <Cell numeric>{n(row.quantity)} {s(row.uom)}</Cell><Cell>{s(row.warehouse)}</Cell>
          <Cell><span className="text-xs">{(row.materials as Row[] ?? []).map((part) => `${s(part.code)} ${s(part.lot ?? part.serial)} ${n(part.quantity)}`).join("; ") || "—"}</span></Cell>
          <Cell>{formatDateTime(s(row.at))}</Cell></tr>)}</LinesTable>;
      default: return null;
    }
  };
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Finished-Goods Receipt Reports" description="Accepted production received into stock: what, when, where, at what value — and what still waits to be received or decided." />
      <Tabs selectedKey={kind} onSelectionChange={(value) => router.replace(`${pathname}?report=${String(value)}`)}>
        <TabList aria-label="Reports">{REPORTS.map((row) => <Tab key={row.id} id={row.id}>{row.label}</Tab>)}</TabList>
      </Tabs>
      {(dated || kind === "traceability") && (
        <div className="flex flex-wrap gap-2">
          {dated && <TextField label="From" type="date" className="w-44" value={from} onChange={setFrom} />}
          {dated && <TextField label="To" type="date" className="w-44" value={to} onChange={setTo} />}
          {kind === "traceability" && <TextField label="Lot" className="w-44" value={lot} onChange={setLot} />}
          {kind === "traceability" && <TextField label="Serial number" className="w-44" value={serial} onChange={setSerial} />}
        </div>
      )}
      {query.isLoading && <LoadingState label="Loading the report" rows={6} />}
      {query.isError && <ErrorState title="Could not load the report" description={errorMessage(query.error)} />}
      {query.data && <Panel title={REPORTS.find((row) => row.id === kind)?.label}>{!rows.length ? <p className="text-sm text-text-muted">{kind === "exceptions" ? "Nothing needs attention." : "Nothing to report."}</p> : table()}</Panel>}
    </div>
  );
}
