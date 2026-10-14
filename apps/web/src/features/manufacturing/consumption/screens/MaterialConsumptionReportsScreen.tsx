"use client";

// Material consumption reports: by order, material, date and production batch; planned against actual and the usage variances; issued against
// used; scrap and return reconciliation; actual material cost; material still in production (work in progress); batch and serial
// traceability; approvals; and notes that disagree with custody. Value only for those who may see cost.
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
import { BAND_TONE, MC_BASE, consumptionReport, type Band } from "../api/mc-api";

const REPORTS = [{ id: "by-mo", label: "By order" }, { id: "by-component", label: "By material" }, { id: "by-date", label: "By date" }, { id: "by-batch", label: "By production batch" },
  { id: "planned-vs-actual", label: "Planned vs actual" }, { id: "variance", label: "Usage variance" }, { id: "issued-vs-consumed", label: "Issued vs used" }, { id: "scrap-return", label: "Scrap & returns" },
  { id: "actual-cost", label: "Actual material cost" }, { id: "wip", label: "Still in production" }, { id: "traceability", label: "Batch & serial trace" }, { id: "approval-history", label: "Approvals" },
  { id: "unreconciled", label: "Unreconciled" }];
type Row = Record<string, unknown>;
const s = (value: unknown) => (value === null || value === undefined ? "" : String(value));
const n = (value: unknown) => qty(value === null || value === undefined ? null : String(value));
const money = (value: unknown) => (value === null || value === undefined ? "—" : inr(String(value)));
const label = (value: unknown) => s(value).toLowerCase().replace(/_/g, " ");

export function MaterialConsumptionReportsScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const kind = REPORTS.some((row) => row.id === params.get("report")) ? params.get("report")! : "by-date";
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const filters = { from: from || undefined, to: to || undefined };
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "manufacturing", "material-consumption-report", kind, filters), queryFn: () => consumptionReport<Row>(kind, filters) });
  if (query.isError && errorStatus(query.error) === 403) return <PermissionState title="You don't have access to material consumption" description="Ask an administrator for access." />;
  const rows = query.data ?? [];
  const order = (row: Row) => <Link className="text-brand underline" href={`${MO_BASE}/${s(row.orderId)}?tab=materials`}>{s(row.orderNumber)}</Link>;
  const note = (row: Row) => <Link className="text-brand underline" href={`${MC_BASE}/${s(row.consumptionId)}`}>{s(row.consumptionNumber)}</Link>;
  const band = (row: Row) => (row.band ? <StatusBadge tone={BAND_TONE[row.band as Band] ?? "neutral"}>{s(row.bandLabel)}</StatusBadge> : null);
  const dated = !["issued-vs-consumed", "scrap-return", "wip", "approval-history", "unreconciled"].includes(kind);
  const table = () => {
    switch (kind) {
      case "by-mo": return <LinesTable columns={["Order", { label: "Notes", numeric: true }, { label: "Lines", numeric: true }, "Last recorded", { label: "Value", numeric: true }]}>
        {rows.map((row, index) => <tr key={index}><Cell>{order(row)}</Cell><Cell numeric>{s(row.notes)}</Cell><Cell numeric>{s(row.lines)}</Cell><Cell>{formatDateTime(s(row.lastAt))}</Cell><Cell numeric>{money(row.cost)}</Cell></tr>)}</LinesTable>;
      case "by-component": return <LinesTable columns={["Material", "Unit", { label: "Used", numeric: true }, { label: "Corrected", numeric: true }, { label: "Orders", numeric: true }, { label: "Value", numeric: true }]}>
        {rows.map((row, index) => <tr key={index}><Cell>{s(row.code)} · {s(row.name)}</Cell><Cell>{s(row.uom)}</Cell><Cell numeric>{n(row.consumed)}</Cell><Cell numeric>{Number(row.corrected) ? n(row.corrected) : ""}</Cell>
          <Cell numeric>{s(row.orders)}</Cell><Cell numeric>{money(row.cost)}</Cell></tr>)}</LinesTable>;
      case "by-date": return <LinesTable columns={["Day", { label: "Notes", numeric: true }, { label: "Lines", numeric: true }, { label: "Orders", numeric: true }, { label: "Value", numeric: true }]}>
        {rows.map((row, index) => <tr key={index}><Cell>{formatDate(s(row.day))}</Cell><Cell numeric>{s(row.notes)}</Cell><Cell numeric>{s(row.lines)}</Cell><Cell numeric>{s(row.orders)}</Cell><Cell numeric>{money(row.cost)}</Cell></tr>)}</LinesTable>;
      case "by-batch": return <LinesTable columns={["Order", "Production batch", { label: "Output basis", numeric: true }, { label: "Notes", numeric: true }, { label: "Lines", numeric: true }, "Variance", { label: "Value", numeric: true }]}>
        {rows.map((row, index) => <tr key={index}><Cell>{order(row)}</Cell><Cell>{s(row.batch)}</Cell><Cell numeric>{row.outputBasis ? n(row.outputBasis) : "—"}</Cell><Cell numeric>{s(row.notes)}</Cell><Cell numeric>{s(row.lines)}</Cell>
          <Cell>{row.hasVariance ? <StatusBadge tone="warning">Above the BOM</StatusBadge> : ""}</Cell><Cell numeric>{money(row.cost)}</Cell></tr>)}</LinesTable>;
      case "planned-vs-actual":
      case "variance": return <LinesTable columns={["Note", "Order", "Batch", "Material", { label: "For output", numeric: true }, { label: "Expected", numeric: true }, { label: "Used", numeric: true }, { label: "Variance", numeric: true }, "", "Approval"]}>
        {rows.map((row, index) => <tr key={index}><Cell>{note(row)}</Cell><Cell>{order(row)}</Cell><Cell>{s(row.batch)}</Cell><Cell>{s(row.code)}</Cell><Cell numeric>{row.outputBasis ? n(row.outputBasis) : "—"}</Cell>
          <Cell numeric>{row.expected === null ? "—" : n(row.expected)}</Cell><Cell numeric>{n(row.consumed)}</Cell>
          <Cell numeric>{row.variance === null ? "" : `${Number(row.variance) > 0 ? "+" : ""}${n(row.variance)}${row.variancePct === null ? "" : ` (${s(row.variancePct)}%)`}`}</Cell><Cell>{band(row)}</Cell><Cell>{label(row.approvalStatus)}</Cell></tr>)}</LinesTable>;
      case "issued-vs-consumed":
      case "scrap-return":
      case "wip": return <LinesTable columns={["Order", "Material", "Unit", { label: "Issued", numeric: true }, { label: "Used", numeric: true }, { label: "Scrapped", numeric: true }, { label: "Returned", numeric: true },
        { label: "In production", numeric: true }, ...(kind === "wip" ? [{ label: "Value in production", numeric: true }] : kind === "scrap-return" ? [{ label: "Scrap value", numeric: true }] : []), "Reconciled"]}>
        {rows.map((row, index) => <tr key={index}><Cell>{order(row)}</Cell><Cell>{s(row.code)}</Cell><Cell>{s(row.uom)}</Cell><Cell numeric>{n(row.issued)}</Cell><Cell numeric>{n(row.consumed)}</Cell><Cell numeric>{n(row.scrapped)}</Cell>
          <Cell numeric>{n(row.returned)}</Cell><Cell numeric>{n(row.inCustody)}</Cell>{kind === "wip" && <Cell numeric>{money(row.custodyValue)}</Cell>}{kind === "scrap-return" && <Cell numeric>{money(row.scrapValue)}</Cell>}
          <Cell>{row.reconciled ? <StatusBadge tone="success">Yes</StatusBadge> : <StatusBadge tone="warning">Open</StatusBadge>}</Cell></tr>)}</LinesTable>;
      case "actual-cost": return <LinesTable columns={["Order", "Material", { label: "Used", numeric: true }, { label: "Unit cost", numeric: true }, { label: "Value", numeric: true }, ""]}>
        {rows.map((row, index) => <tr key={index}><Cell>{order(row)}</Cell><Cell>{s(row.code)}</Cell><Cell numeric>{n(row.consumed)} {s(row.uom)}</Cell><Cell numeric>{row.unitCost === null ? "—" : money(row.unitCost)}</Cell>
          <Cell numeric>{money(row.cost)}</Cell><Cell>{row.costMissing ? <StatusBadge tone="danger">Cost missing</StatusBadge> : ""}</Cell></tr>)}</LinesTable>;
      case "traceability": return <LinesTable columns={["Note", "Order", "Material", { label: "Quantity", numeric: true }, "Batch", "Serial", "From issue", "Production batch", "Posted by", "When"]}>
        {rows.map((row, index) => <tr key={index}><Cell>{note(row)}</Cell><Cell>{order(row)}</Cell><Cell>{s(row.code)}</Cell><Cell numeric>{n(row.quantity)} {s(row.uom)}</Cell><Cell>{s(row.batch)}</Cell><Cell>{s(row.serial)}</Cell>
          <Cell>{s(row.issueNumber)}</Cell><Cell>{s(row.productionBatch)}</Cell><Cell>{s(row.postedBy)}</Cell><Cell>{formatDateTime(s(row.at))}</Cell></tr>)}</LinesTable>;
      case "approval-history": return <LinesTable columns={["Note", "Order", "Approval", "Why", "Asked by", "Decided by", "Note"]}>
        {rows.map((row, index) => <tr key={index}><Cell>{note(row)}</Cell><Cell>{order(row)}</Cell><Cell>{label(row.approvalStatus)}</Cell><Cell>{s(row.reason)}</Cell>
          <Cell>{s(row.requestedBy)}{row.requestedAt ? `, ${formatDateTime(s(row.requestedAt))}` : ""}</Cell><Cell>{s(row.decidedBy)}{row.decidedAt ? `, ${formatDateTime(s(row.decidedAt))}` : ""}</Cell><Cell>{s(row.note)}</Cell></tr>)}</LinesTable>;
      case "unreconciled": return <LinesTable columns={["Note", "Status", "What disagrees"]}>
        {rows.map((row, index) => <tr key={index}><Cell>{note(row)}</Cell><Cell>{label(row.status)}</Cell><Cell>{(row.problems as string[] ?? []).join(" ")}</Cell></tr>)}</LinesTable>;
      default: return null;
    }
  };
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Material Consumption Reports" description="What production used of the material issued to it, against the BOM — and what is scrapped, returned or still in production." />
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
