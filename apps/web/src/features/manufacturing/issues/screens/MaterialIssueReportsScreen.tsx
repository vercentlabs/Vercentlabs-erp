"use client";

// Material issue reports: issues by order, date, warehouse and material; planned against issued; issued against used and returned; usage
// variance; batch and serial traceability; material still in production; approvals; and posting exceptions (the recovery queue). Value only
// for those who may see cost.
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
import { MI_BASE, issueReport } from "../api/mi-api";

const REPORTS = [{ id: "by-mo", label: "By order" }, { id: "by-date", label: "By date" }, { id: "by-warehouse", label: "By warehouse" }, { id: "by-component", label: "By material" },
  { id: "planned-vs-issued", label: "Planned vs issued" }, { id: "issued-vs-consumed", label: "Issued vs used" }, { id: "issued-vs-returned", label: "Issued vs returned" },
  { id: "usage-variance", label: "Usage variance" }, { id: "traceability", label: "Batch & serial trace" }, { id: "unreconciled-custody", label: "Still in production" },
  { id: "approval-history", label: "Approvals" }, { id: "posting-exceptions", label: "Posting exceptions" }];
type Row = Record<string, unknown>;
const s = (value: unknown) => (value === null || value === undefined ? "" : String(value));
const n = (value: unknown) => qty(value === null || value === undefined ? null : String(value));
const money = (value: unknown) => (value === null || value === undefined ? "—" : inr(String(value)));
const label = (value: unknown) => s(value).toLowerCase().replace(/_/g, " ");

export function MaterialIssueReportsScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const kind = REPORTS.some((row) => row.id === params.get("report")) ? params.get("report")! : "by-date";
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const filters = { from: from || undefined, to: to || undefined };
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "manufacturing", "material-issue-report", kind, filters), queryFn: () => issueReport<Row>(kind, filters) });
  if (query.isError && errorStatus(query.error) === 403) return <PermissionState title="You don't have access to material issues" description="Ask an administrator for access." />;
  const rows = query.data ?? [];
  const order = (row: Row) => <Link className="text-brand underline" href={`${MO_BASE}/${s(row.orderId)}?tab=materials`}>{s(row.orderNumber)}</Link>;
  const note = (row: Row) => (row.issueId ? <Link className="text-brand underline" href={`${MI_BASE}/${s(row.issueId)}`}>{s(row.issueNumber)}</Link> : s(row.issueNumber));
  const dated = ["by-mo", "by-date", "by-warehouse", "by-component", "traceability"].includes(kind);
  const table = () => {
    switch (kind) {
      case "by-mo": return <LinesTable columns={["Order", { label: "Notes", numeric: true }, { label: "Lines", numeric: true }, "Last issued", { label: "Value", numeric: true }]}>
        {rows.map((row, index) => <tr key={index}><Cell>{order(row)}</Cell><Cell numeric>{s(row.issues)}</Cell><Cell numeric>{s(row.lines)}</Cell><Cell>{formatDateTime(s(row.lastIssuedAt))}</Cell><Cell numeric>{money(row.cost)}</Cell></tr>)}</LinesTable>;
      case "by-date": return <LinesTable columns={["Day", { label: "Notes", numeric: true }, { label: "Lines", numeric: true }, { label: "Orders", numeric: true }, { label: "Value", numeric: true }]}>
        {rows.map((row, index) => <tr key={index}><Cell>{formatDate(s(row.day))}</Cell><Cell numeric>{s(row.issues)}</Cell><Cell numeric>{s(row.lines)}</Cell><Cell numeric>{s(row.orders)}</Cell><Cell numeric>{money(row.cost)}</Cell></tr>)}</LinesTable>;
      case "by-warehouse": return <LinesTable columns={["Warehouse", { label: "Notes", numeric: true }, { label: "Lines", numeric: true }, { label: "Materials", numeric: true }, { label: "Value", numeric: true }]}>
        {rows.map((row, index) => <tr key={index}><Cell>{s(row.warehouse)}</Cell><Cell numeric>{s(row.issues)}</Cell><Cell numeric>{s(row.lines)}</Cell><Cell numeric>{s(row.items)}</Cell><Cell numeric>{money(row.cost)}</Cell></tr>)}</LinesTable>;
      case "by-component": return <LinesTable columns={["Material", "Unit", { label: "Issued", numeric: true }, { label: "Reversed", numeric: true }, { label: "Notes", numeric: true }, { label: "Orders", numeric: true }, { label: "Value", numeric: true }]}>
        {rows.map((row, index) => <tr key={index}><Cell>{s(row.code)} · {s(row.name)}</Cell><Cell>{s(row.uom)}</Cell><Cell numeric>{n(row.issued)}</Cell><Cell numeric>{Number(row.reversed) ? n(row.reversed) : ""}</Cell>
          <Cell numeric>{s(row.issues)}</Cell><Cell numeric>{s(row.orders)}</Cell><Cell numeric>{money(row.cost)}</Cell></tr>)}</LinesTable>;
      case "planned-vs-issued": return <LinesTable columns={["Order", "Material", "Unit", { label: "Planned", numeric: true }, { label: "Extra", numeric: true }, { label: "Net issued", numeric: true }, { label: "Remaining", numeric: true }]}>
        {rows.map((row, index) => <tr key={index}><Cell>{order(row)}</Cell><Cell>{s(row.code)}</Cell><Cell>{s(row.uom)}</Cell><Cell numeric>{n(row.planned)}</Cell><Cell numeric>{Number(row.extra) ? n(row.extra) : ""}</Cell>
          <Cell numeric>{n(row.netIssued)}</Cell><Cell numeric>{n(row.remainingToIssue)}</Cell></tr>)}</LinesTable>;
      case "issued-vs-consumed":
      case "unreconciled-custody": return <LinesTable columns={["Order", "Material", "Unit", { label: "Net issued", numeric: true }, { label: "Used", numeric: true }, { label: "Scrapped", numeric: true }, { label: "In production", numeric: true }, ...(kind === "unreconciled-custody" ? [{ label: "Days since issue", numeric: true }] : [])]}>
        {rows.map((row, index) => <tr key={index}><Cell>{order(row)}</Cell><Cell>{s(row.code)}</Cell><Cell>{s(row.uom)}</Cell><Cell numeric>{n(row.netIssued)}</Cell><Cell numeric>{n(row.consumed)}</Cell><Cell numeric>{n(row.scrapped)}</Cell>
          <Cell numeric>{n(row.inCustody)}</Cell>{kind === "unreconciled-custody" && <Cell numeric>{s(row.ageDays)}</Cell>}</tr>)}</LinesTable>;
      case "issued-vs-returned": return <LinesTable columns={["Order", "Material", "Unit", { label: "Issued", numeric: true }, { label: "Returned", numeric: true }, { label: "Of which reversed", numeric: true }, { label: "Net issued", numeric: true }]}>
        {rows.map((row, index) => <tr key={index}><Cell>{order(row)}</Cell><Cell>{s(row.code)}</Cell><Cell>{s(row.uom)}</Cell><Cell numeric>{n(row.issued)}</Cell><Cell numeric>{n(row.returned)}</Cell><Cell numeric>{n(row.reversed)}</Cell><Cell numeric>{n(row.netIssued)}</Cell></tr>)}</LinesTable>;
      case "usage-variance": return <LinesTable columns={["Order", "Material", { label: "Extra", numeric: true }, "Kind", "Why", "Status", "Asked by", "Decided by", "From note"]}>
        {rows.map((row, index) => <tr key={index}><Cell>{order(row)}</Cell><Cell>{s(row.code)}</Cell><Cell numeric>{n(row.quantity)}</Cell><Cell>{label(row.type)}</Cell><Cell>{s(row.reason)}</Cell><Cell>{label(row.status)}</Cell>
          <Cell>{s(row.requestedBy)}</Cell><Cell>{s(row.decidedBy)}</Cell><Cell>{s(row.issueNumber)}</Cell></tr>)}</LinesTable>;
      case "traceability": return <LinesTable columns={["Note", "Order", "Material", { label: "Quantity", numeric: true }, "Batch", "Expiry", "Serial", "Location", "Stock", "Issued by", "When"]}>
        {rows.map((row, index) => <tr key={index}><Cell>{note(row)}</Cell><Cell>{order(row)}</Cell><Cell>{s(row.code)}</Cell><Cell numeric>{n(row.quantity)} {s(row.uom)}</Cell><Cell>{s(row.batch)}</Cell>
          <Cell>{row.expiresOn ? formatDate(s(row.expiresOn)) : ""}</Cell><Cell>{s(row.serial)}</Cell><Cell>{s(row.location)}</Cell><Cell>{row.fromReservation ? "Reserved" : "Free"}{row.reversed ? " · reversed" : ""}</Cell>
          <Cell>{s(row.issuedBy)}</Cell><Cell>{formatDateTime(s(row.at))}</Cell></tr>)}</LinesTable>;
      case "approval-history": return <LinesTable columns={["Note", "Order", "Approval", "Kind", "Why", "Asked by", "Decided by", "Note"]}>
        {rows.map((row, index) => <tr key={index}><Cell>{note(row)}</Cell><Cell>{order(row)}</Cell><Cell>{label(row.approvalStatus)}</Cell><Cell>{label(row.type)}</Cell><Cell>{s(row.reason)}</Cell>
          <Cell>{s(row.requestedBy)}{row.requestedAt ? `, ${formatDateTime(s(row.requestedAt))}` : ""}</Cell><Cell>{s(row.decidedBy)}{row.decidedAt ? `, ${formatDateTime(s(row.decidedAt))}` : ""}</Cell><Cell>{s(row.note)}</Cell></tr>)}</LinesTable>;
      case "posting-exceptions": return <LinesTable columns={["Note", "Status", "Inventory", "Finance", "What disagrees"]}>
        {rows.map((row, index) => <tr key={index}><Cell>{note(row)}</Cell><Cell>{label(row.status)}</Cell><Cell>{label((row.inventory as Row)?.status)}</Cell><Cell>{label((row.finance as Row)?.status)}</Cell>
          <Cell>{(row.problems as string[] ?? []).join(" ")}</Cell></tr>)}</LinesTable>;
      default: return null;
    }
  };
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Material Issue Reports" description="What left the warehouse for production, and what became of it — used, scrapped, returned, or still in production." />
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
