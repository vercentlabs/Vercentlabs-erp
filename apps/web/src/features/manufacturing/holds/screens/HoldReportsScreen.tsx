"use client";

// Production hold reports: active holds and their aging; holds by reason and severity; production downtime per order (each hold counted once,
// however many reasons overlapped inside it); material-shortage, quality and equipment holds; customer demand at risk; held subassembly orders;
// and the hold-and-resume audit trail.
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

import { MO_BASE, errorMessage, errorStatus, qty } from "@/features/manufacturing/orders/api/mo-api";
import { HOLDS_BASE, SEVERITY_TONE, duration, holdReport, type Severity } from "../api/hold-api";

const REPORTS = [{ id: "active", label: "Active holds" }, { id: "aging", label: "Aging" }, { id: "downtime", label: "Downtime by order" }, { id: "by-reason", label: "By reason" },
  { id: "by-severity", label: "By severity" }, { id: "by-mo", label: "Hold duration" }, { id: "material-shortage", label: "Material shortages" }, { id: "quality", label: "Quality" },
  { id: "equipment", label: "Equipment" }, { id: "sales-risk", label: "Delivery risk" }, { id: "subassembly", label: "Held subassemblies" }, { id: "audit", label: "Audit" }];
type Row = Record<string, unknown>;
const s = (value: unknown) => (value === null || value === undefined ? "" : String(value));
const h = (value: unknown) => duration(Number(value ?? 0));
const when = (value: unknown) => (value ? formatDateTime(s(value)) : "");

export function HoldReportsScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const kind = REPORTS.some((row) => row.id === params.get("report")) ? params.get("report")! : "active";
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const filters = { from: from || undefined, to: to || undefined };
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "manufacturing", "production-hold-report", kind, filters), queryFn: () => holdReport<Row>(kind, filters) });
  if (query.isError && errorStatus(query.error) === 403) return <PermissionState title="You don't have access to production holds" description="Ask an administrator for access." />;
  const rows = query.data ?? [];
  const order = (row: Row) => (row.orderId ? <Link className="text-brand underline" href={`${MO_BASE}/${s(row.orderId)}`}>{s(row.orderNumber)}</Link> : "");
  const hold = (row: Row) => (row.holdId ?? row.id ? <Link className="text-brand underline" href={`${HOLDS_BASE}/${s(row.holdId ?? row.id)}`}>{s(row.holdNumber ?? row.number)}</Link> : "");
  const severity = (row: Row) => <StatusBadge tone={SEVERITY_TONE[(row.severity as Severity) ?? "NORMAL"] ?? "neutral"}>{s(row.severity).toLowerCase()}</StatusBadge>;
  const holdList = () => <LinesTable columns={["Hold", "Order", "Product", "Why", "Severity", "Status", "Started", { label: "Duration", numeric: true }]}>
    {rows.map((row, index) => <tr key={index}><Cell>{hold(row)}</Cell><Cell>{order(row)}</Cell><Cell>{s(row.item)}</Cell><Cell>{(row.reasons as string[] | undefined)?.join(", ")}</Cell><Cell>{severity(row)}</Cell>
      <Cell>{s(row.statusLabel)}{row.overdue ? " · overdue" : ""}</Cell><Cell>{when(row.startedAt)}</Cell><Cell numeric>{h(row.durationHours)}</Cell></tr>)}</LinesTable>;
  const reasonList = () => <LinesTable columns={["Hold", "Order", "Details", "Severity", "Reason status", "Corrective action", { label: "Duration", numeric: true }]}>
    {rows.map((row, index) => <tr key={index}><Cell>{hold(row)}</Cell><Cell>{order(row)}</Cell><Cell>{s(row.description)}{row.sourceReference ? ` (${s(row.sourceReference)})` : ""}</Cell>
      <Cell><StatusBadge tone={SEVERITY_TONE[(row.reasonSeverity as Severity) ?? "NORMAL"]}>{s(row.reasonSeverity).toLowerCase()}</StatusBadge></Cell><Cell>{row.reasonStatus === "ACTIVE" ? "Blocking" : "Cleared"}</Cell>
      <Cell>{s(row.correctiveAction)}</Cell><Cell numeric>{h(row.durationHours)}</Cell></tr>)}</LinesTable>;
  const table = () => {
    switch (kind) {
      case "active": case "aging": case "by-mo": return holdList();
      case "by-reason": case "by-severity": return <LinesTable columns={[kind === "by-reason" ? "Reason" : "Severity", { label: "Holds", numeric: true }, { label: "Active", numeric: true }, { label: "Downtime", numeric: true }, { label: "Average", numeric: true }]}>
        {rows.map((row, index) => <tr key={index}><Cell>{kind === "by-severity" ? s(row.key).toLowerCase() : s(row.key)}</Cell><Cell numeric>{s(row.holds)}</Cell><Cell numeric>{s(row.active)}</Cell><Cell numeric>{h(row.hours)}</Cell><Cell numeric>{h(row.averageHours)}</Cell></tr>)}</LinesTable>;
      case "downtime": return <LinesTable columns={["Order", "Product", { label: "Holds", numeric: true }, { label: "Downtime", numeric: true }, "Now"]}>
        {rows.map((row, index) => <tr key={index}><Cell>{order(row)}</Cell><Cell>{s(row.item)}</Cell><Cell numeric>{s(row.episodes)}</Cell><Cell numeric>{h(row.hours)}</Cell><Cell>{row.active ? "On hold" : ""}</Cell></tr>)}</LinesTable>;
      case "material-shortage": case "quality": case "equipment": return reasonList();
      case "sales-risk": return <LinesTable columns={["Hold", "Order", "Sales order", "Customer", "Required", { label: "Still to make", numeric: true }, "Risk"]}>
        {rows.map((row, index) => <tr key={index}><Cell>{hold(row)}</Cell><Cell>{order(row)}</Cell><Cell>{s(row.salesOrderNumber)}</Cell><Cell>{s(row.customer)}</Cell><Cell>{row.requiredDate ? formatDate(s(row.requiredDate)) : "—"}</Cell>
          <Cell numeric>{qty(s(row.unfinished))}</Cell><Cell>{s(row.risk).toLowerCase().replace(/_/g, " ")}</Cell></tr>)}</LinesTable>;
      case "subassembly": return <LinesTable columns={["Hold", "Subassembly order", "For order", "Its status", "Since"]}>
        {rows.map((row, index) => <tr key={index}><Cell>{hold(row)}</Cell><Cell>{order(row)}</Cell><Cell><Link className="text-brand underline" href={`${MO_BASE}/${s(row.parentId)}`}>{s(row.parentNumber)}</Link></Cell>
          <Cell>{s(row.parentStatusLabel)}</Cell><Cell>{when(row.startedAt)}</Cell></tr>)}</LinesTable>;
      case "audit": return <LinesTable columns={["When", "Hold", "Order", "What", "Details", "By"]}>
        {rows.map((row, index) => <tr key={index}><Cell>{when(row.at)}</Cell><Cell>{hold(row)}</Cell><Cell>{order(row)}</Cell><Cell>{s(row.action)}</Cell><Cell>{s(row.summary)}</Cell><Cell>{s(row.actor)}</Cell></tr>)}</LinesTable>;
      default: return null;
    }
  };
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Production Hold Reports" description="Why production stops, for how long and with what effect on customers — downtime counted once per hold, however many reasons overlapped." />
      <Tabs selectedKey={kind} onSelectionChange={(value) => router.replace(`${pathname}?report=${String(value)}`)}>
        <TabList aria-label="Reports">{REPORTS.map((row) => <Tab key={row.id} id={row.id}>{row.label}</Tab>)}</TabList>
      </Tabs>
      {!["active", "aging", "sales-risk", "subassembly"].includes(kind) && (
        <div className="flex flex-wrap gap-2">
          <TextField label="Held from" type="date" className="w-44" value={from} onChange={setFrom} />
          <TextField label="To" type="date" className="w-44" value={to} onChange={setTo} />
        </div>
      )}
      {query.isLoading && <LoadingState label="Loading the report" rows={6} />}
      {query.isError && <ErrorState title="Could not load the report" description={errorMessage(query.error)} />}
      {query.data && <Panel title={REPORTS.find((row) => row.id === kind)?.label}>{!rows.length ? <p className="text-sm text-text-muted">Nothing to report.</p> : table()}</Panel>}
    </div>
  );
}
