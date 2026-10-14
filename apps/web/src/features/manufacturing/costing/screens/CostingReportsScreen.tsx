"use client";

// Production costing reports: cost by order, planned against actual, the cost per accepted unit by product (never averaged across products),
// material breakdown, labor and overhead applied, batches, work in progress and its aging, scrap and rejection, receipts, short-closed orders,
// sales-linked production, the costing exceptions and work in progress against Finance; and overhead — by order, category, product and batch,
// per unit, in progress against finished goods, the month's pool against what was applied, and the rate history.
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ErrorState, PageHeader, PermissionState, StatusBadge, Tab, TabList, Tabs } from "@vercentlabs/design-system";

import { formatDateTime } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Panel } from "@/shared/ui/Panel";
import { Cell, LinesTable } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { MO_BASE, errorMessage, errorStatus, inr, qty } from "@/features/manufacturing/orders/api/mo-api";
import { costingReport } from "../api/costing-api";

const REPORTS = [{ id: "exceptions", label: "Exceptions" }, { id: "by-mo", label: "By order" }, { id: "planned-vs-actual", label: "Planned vs actual" }, { id: "unit-cost", label: "Unit cost" },
  { id: "material-breakdown", label: "Material" }, { id: "applied", label: "Labor & overhead" }, { id: "batches", label: "Batches" }, { id: "wip", label: "Work in progress" },
  { id: "wip-aging", label: "WIP aging" }, { id: "scrap-rejection", label: "Scrap & rejection" }, { id: "receipts", label: "Receipts" }, { id: "short-closed", label: "Short-closed" },
  { id: "sales-linked", label: "Sales-linked" }, { id: "inventory-to-gl", label: "To Finance" }, { id: "overhead-by-mo", label: "Overhead by order" }, { id: "overhead-by-category", label: "Overhead by category" },
  { id: "overhead-by-product", label: "Overhead by product" }, { id: "overhead-batches", label: "Batch overhead" }, { id: "overhead-per-unit", label: "Overhead per unit" },
  { id: "overhead-wip-fg", label: "Overhead in WIP / FG" }, { id: "overhead-actual-vs-applied", label: "Actual vs applied" }, { id: "overhead-rate-history", label: "Rate history" }];
type Row = Record<string, unknown>;
const s = (value: unknown) => (value === null || value === undefined ? "" : String(value));
const money = (value: unknown) => (value === null || value === undefined || value === "" ? "—" : inr(String(value)));

export function CostingReportsScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const kind = REPORTS.some((row) => row.id === params.get("report")) ? params.get("report")! : "exceptions";
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "manufacturing", "costing-report", kind), queryFn: () => costingReport<Row>(kind) });
  if (query.isError && errorStatus(query.error) === 403) return <PermissionState title="You don't have access to production costing" description="Ask an administrator for access." />;
  const rows = query.data ?? [];
  const order = (row: Row) => (row.orderId ? <Link className="text-brand underline" href={`${MO_BASE}/${s(row.orderId)}?tab=costs`}>{s(row.orderNumber)}</Link> : "");
  const table = () => {
    switch (kind) {
      case "exceptions": return <LinesTable columns={["Order", "Status", "What", { label: "Work in progress", numeric: true }, "Details"]}>
        {rows.map((row, index) => <tr key={index}><Cell>{order(row)}</Cell><Cell>{s(row.orderStatusLabel)}</Cell><Cell><StatusBadge tone={["WIP_IMBALANCE", "RECOVERY", "VALUATION_MISSING", "RATE_MISSING", "RATE_INVALID", "OVERHEAD_UNRECONCILED"].includes(s(row.kind)) ? "danger" : "warning"}>{s(row.kind).toLowerCase().replace(/_/g, " ")}</StatusBadge></Cell>
          <Cell numeric>{money(row.wip)}</Cell><Cell>{s(row.message)}</Cell></tr>)}</LinesTable>;
      case "by-mo": case "planned-vs-actual": case "short-closed": return <LinesTable columns={["Order", "Product", { label: "Planned", numeric: true }, { label: "Incurred", numeric: true }, { label: "Variance", numeric: true },
        { label: "Labor", numeric: true }, { label: "Overhead", numeric: true }, { label: "In finished goods", numeric: true }, { label: "WIP", numeric: true }, { label: "Per unit (plan / actual)", numeric: true }, ...(kind === "short-closed" ? ["Why short"] : [])]}>
        {rows.map((row, index) => <tr key={index}><Cell>{order(row)}{row.finalized ? <span className="text-xs text-text-muted"> · final</span> : null}</Cell><Cell>{s(row.product)}</Cell><Cell numeric>{money(row.planned)}</Cell><Cell numeric>{money(row.incurred)}</Cell>
          <Cell numeric>{money(row.variance)}</Cell><Cell numeric>{money(row.labor)}</Cell><Cell numeric>{money(row.overhead)}</Cell><Cell numeric>{money(row.capitalised)}</Cell><Cell numeric>{money(row.wip)}</Cell>
          <Cell numeric>{money(row.plannedUnit)} / {money(row.actualUnit)}</Cell>{kind === "short-closed" && <Cell>{s(row.shortCloseReason)}</Cell>}</tr>)}</LinesTable>;
      case "unit-cost": return <LinesTable columns={["Product", { label: "Orders", numeric: true }, { label: "Accepted", numeric: true }, { label: "Incurred", numeric: true }, { label: "Average per unit", numeric: true }]}>
        {rows.map((row, index) => <tr key={index}><Cell>{s(row.product)}</Cell><Cell numeric>{s(row.orders)}</Cell><Cell numeric>{qty(s(row.accepted))} {s(row.uom)}</Cell><Cell numeric>{money(row.incurred)}</Cell><Cell numeric>{money(row.averageUnit)}</Cell></tr>)}</LinesTable>;
      case "material-breakdown": return <LinesTable columns={["Order", "Material", { label: "Used", numeric: true }, { label: "Used cost", numeric: true }, { label: "Estimated", numeric: true }, { label: "Issued cost", numeric: true }]}>
        {rows.map((row, index) => <tr key={index}><Cell>{order(row)}</Cell><Cell>{s(row.code)} · {s(row.name)}</Cell><Cell numeric>{qty(s(row.consumed))} {s(row.materialUom)}</Cell><Cell numeric>{money(row.usedCost)}</Cell>
          <Cell numeric>{money(row.estimatedCost)}</Cell><Cell numeric>{money(row.issuedCost)}</Cell></tr>)}</LinesTable>;
      case "applied": return <LinesTable columns={["Order", "Component", "Basis", "Batch", { label: "Quantity", numeric: true }, { label: "Rate", numeric: true }, { label: "Amount", numeric: true }, "When"]}>
        {rows.map((row, index) => <tr key={index}><Cell>{order(row)}</Cell><Cell>{s(row.category) || s(row.component)}{row.direction === "REVERSE" ? <span className="text-xs text-text-muted"> · reversal: {s(row.reason)}</span> : null}</Cell><Cell>{s(row.basis)}</Cell><Cell>{s(row.batch)}</Cell><Cell numeric>{qty(s(row.quantity))}</Cell>
          <Cell numeric>{s(row.rate)} (v{s(row.rateVersion)})</Cell><Cell numeric>{money(row.amount)}</Cell><Cell>{formatDateTime(s(row.at))}</Cell></tr>)}</LinesTable>;
      case "batches": return <LinesTable columns={["Order", "Batch", { label: "Reported", numeric: true }, { label: "Material traced", numeric: true }, { label: "Batch costs", numeric: true }]}>
        {rows.map((row, index) => <tr key={index}><Cell>{order(row)}</Cell><Cell>{s(row.batch)}</Cell><Cell numeric>{qty(s(row.reported))}</Cell><Cell numeric>{money(row.materialTraced)}</Cell><Cell numeric>{money(row.batchCosts)}</Cell></tr>)}</LinesTable>;
      case "wip": case "wip-aging": return <LinesTable columns={["Order", "Status", "Product", { label: "Work in progress", numeric: true }, "Last activity", { label: "Days", numeric: true }]}>
        {rows.map((row, index) => <tr key={index}><Cell>{order(row)}</Cell><Cell>{s(row.statusLabel)}</Cell><Cell>{s(row.product)}</Cell><Cell numeric>{money(row.wip)}</Cell><Cell>{row.lastActivity ? formatDateTime(s(row.lastActivity)) : ""}</Cell><Cell numeric>{s(row.days)}</Cell></tr>)}</LinesTable>;
      case "scrap-rejection": return <LinesTable columns={["Order", "What", "Loss", "Disposition", { label: "Rejected units", numeric: true }, { label: "Cost", numeric: true }]}>
        {rows.map((row, index) => <tr key={index}><Cell>{order(row)}</Cell><Cell>{s(row.type).toLowerCase().replace(/_/g, " ")}</Cell><Cell>{s(row.lossClass).toLowerCase()}</Cell><Cell>{s(row.disposition).toLowerCase()}</Cell>
          <Cell numeric>{s(row.rejected)}</Cell><Cell numeric>{money(row.cost)}</Cell></tr>)}</LinesTable>;
      case "receipts": return <LinesTable columns={["Order", "Receipt", { label: "Quantity", numeric: true }, { label: "Material", numeric: true }, { label: "Labor & overhead", numeric: true }, { label: "Total", numeric: true }, { label: "Per unit", numeric: true }, "When"]}>
        {rows.map((row, index) => <tr key={index}><Cell>{order(row)}</Cell><Cell>{s(row.number)}</Cell><Cell numeric>{qty(s(row.quantity))}</Cell><Cell numeric>{money(row.material)}</Cell><Cell numeric>{money(row.conversion)}</Cell>
          <Cell numeric>{money(row.total)}</Cell><Cell numeric>{money(row.unitCost)}</Cell><Cell>{formatDateTime(s(row.at))}</Cell></tr>)}</LinesTable>;
      case "sales-linked": return <LinesTable columns={["Order", "Sales order", "Customer", { label: "Allocated", numeric: true }, { label: "Received", numeric: true }, { label: "Cost per unit", numeric: true }]}>
        {rows.map((row, index) => <tr key={index}><Cell>{order(row)}</Cell><Cell>{s(row.salesOrder)}</Cell><Cell>{s(row.customer)}</Cell><Cell numeric>{qty(s(row.allocated))}</Cell><Cell numeric>{qty(s(row.received))}</Cell><Cell numeric>{money(row.unitCost)}</Cell></tr>)}</LinesTable>;
      case "inventory-to-gl": return <LinesTable columns={["Order", "Status", { label: "On the order", numeric: true }, { label: "In Finance", numeric: true }, { label: "Difference", numeric: true }, "Result"]}>
        {rows.map((row, index) => <tr key={index}><Cell>{order(row)}</Cell><Cell>{s(row.statusLabel)}</Cell><Cell numeric>{money(row.book)}</Cell><Cell numeric>{money(row.finance)}</Cell><Cell numeric>{money(row.difference)}</Cell>
          <Cell><StatusBadge tone={row.status === "BALANCED" ? "success" : "danger"}>{s(row.status).toLowerCase().replace(/_/g, " ")}</StatusBadge></Cell></tr>)}</LinesTable>;
      case "overhead-by-mo": case "overhead-per-unit": case "overhead-wip-fg": return <LinesTable columns={["Order", "Product", { label: "Overhead", numeric: true }, { label: "Accepted", numeric: true },
        { label: "Per unit", numeric: true }, { label: "In finished goods", numeric: true }, { label: "In progress", numeric: true }]}>
        {rows.map((row, index) => <tr key={index}><Cell>{order(row)}</Cell><Cell>{s(row.product)}</Cell><Cell numeric>{money(row.overhead)}</Cell><Cell numeric>{qty(s(row.accepted))}</Cell><Cell numeric>{money(row.perUnit)}</Cell>
          <Cell numeric>{money(row.inFinishedGoods)}</Cell><Cell numeric>{money(row.inProgress)}</Cell></tr>)}</LinesTable>;
      case "overhead-by-category": case "overhead-by-product": return <LinesTable columns={[kind === "overhead-by-category" ? "Category" : "Product", { label: "Orders", numeric: true }, { label: "Applied", numeric: true },
        { label: "Reversed", numeric: true }, { label: "Net", numeric: true }]}>
        {rows.map((row, index) => <tr key={index}><Cell>{s(row.category ?? row.product)}</Cell><Cell numeric>{s(row.orders)}</Cell><Cell numeric>{money(row.applied)}</Cell><Cell numeric>{money(row.reversed)}</Cell><Cell numeric>{money(row.net)}</Cell></tr>)}</LinesTable>;
      case "overhead-batches": return <LinesTable columns={["Order", "Batch", "Category", { label: "Rate", numeric: true }, { label: "Amount", numeric: true }, "When"]}>
        {rows.map((row, index) => <tr key={index}><Cell>{order(row)}</Cell><Cell>{s(row.batch)}</Cell><Cell>{s(row.category)}</Cell><Cell numeric>{money(row.rate)}</Cell><Cell numeric>{money(row.amount)}</Cell><Cell>{formatDateTime(s(row.at))}</Cell></tr>)}</LinesTable>;
      case "overhead-actual-vs-applied": return <LinesTable columns={["Month", "Category", { label: "Actual pool", numeric: true }, { label: "Applied", numeric: true }, { label: "Difference", numeric: true }, "Status"]}>
        {rows.map((row, index) => <tr key={index}><Cell>{s(row.period)}</Cell><Cell>{s(row.category)}</Cell><Cell numeric>{money(row.actual)}</Cell><Cell numeric>{money(row.applied)}</Cell><Cell numeric>{money(row.difference)}</Cell>
          <Cell>{s(row.status).toLowerCase().replace(/_/g, " ")}</Cell></tr>)}</LinesTable>;
      case "overhead-rate-history": return <LinesTable columns={["Rate", "Category", "Product", "Basis", { label: "Rate", numeric: true }, "In force", "Status", "Set / approved"]}>
        {rows.map((row, index) => <tr key={index}><Cell>{s(row.code)}{row.version ? ` v${s(row.version)}` : ""}</Cell><Cell>{s(row.category) || s(row.component)}</Cell><Cell>{s(row.product)}</Cell><Cell>{s(row.basis)}</Cell>
          <Cell numeric>{s(row.rate)}{row.zeroReason ? <span className="block text-xs text-text-muted">{s(row.zeroReason)}</span> : null}</Cell><Cell>{s(row.from).slice(0, 10)}{row.until ? ` – ${s(row.until).slice(0, 10)}` : " onwards"}</Cell>
          <Cell>{s(row.status).toLowerCase().replace(/_/g, " ")}</Cell><Cell>{[s(row.setBy), s(row.approvedBy)].filter(Boolean).join(" / ")}</Cell></tr>)}</LinesTable>;
      default: return null;
    }
  };
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Production Costing Reports" description="What manufacturing costs, where the money is, what each good unit cost and whether Finance agrees — from posted records only." />
      <Tabs selectedKey={kind} onSelectionChange={(value) => router.replace(`${pathname}?report=${String(value)}`)}>
        <TabList aria-label="Reports">{REPORTS.map((row) => <Tab key={row.id} id={row.id}>{row.label}</Tab>)}</TabList>
      </Tabs>
      {query.isLoading && <LoadingState label="Calculating" rows={6} />}
      {query.isError && <ErrorState title="Could not load the report" description={errorMessage(query.error)} />}
      {query.data && <Panel title={REPORTS.find((row) => row.id === kind)?.label}>{!rows.length ? <p className="text-sm text-text-muted">{kind === "exceptions" ? "Nothing needs attention." : "Nothing to report."}</p> : table()}</Panel>}
    </div>
  );
}
