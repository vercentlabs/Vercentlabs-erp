"use client";

// Demand reports: Sales-to-MO traceability, production by customer, delivery risk, excess production, cancelled demand still covered by
// manufacturing orders, and planning exceptions.
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ErrorState, PageHeader, PermissionState, Tab, TabList, Tabs } from "@vercentlabs/design-system";

import { formatDate } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Panel } from "@/shared/ui/Panel";
import { Cell, LinesTable } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { MO_BASE, errorMessage, errorStatus, qty } from "@/features/manufacturing/orders/api/mo-api";
import { DEMAND_BASE, demandReport, type Demand } from "../api/demand-api";

const REPORTS = [{ id: "traceability", label: "Sales-to-MO traceability" }, { id: "by-customer", label: "Production by customer" }, { id: "delivery-risk", label: "Delivery risk" },
  { id: "excess-production", label: "Excess production" }, { id: "cancelled-with-orders", label: "Cancelled demand with orders" }, { id: "exceptions", label: "Exceptions" }];
type Row = Record<string, string | number | null>;

export function DemandReportsScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const kind = REPORTS.some((row) => row.id === params.get("report")) ? params.get("report")! : "traceability";
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "manufacturing", "demand-report", kind), queryFn: () => demandReport<Row>(kind) });
  if (query.isError && errorStatus(query.error) === 403) return <PermissionState title="You don't have access to manufacturing demand" description="Ask an administrator for access." />;
  const rows = query.data ?? [];
  const demandRows = ["delivery-risk", "cancelled-with-orders", "exceptions"].includes(kind);
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Demand Reports" description="How customer demand and manufacturing supply line up. Quantities only; no cost." />
      <Tabs selectedKey={kind} onSelectionChange={(value) => router.replace(`${pathname}?report=${String(value)}`)}>
        <TabList aria-label="Reports">{REPORTS.map((row) => <Tab key={row.id} id={row.id}>{row.label}</Tab>)}</TabList>
      </Tabs>
      {query.isLoading && <LoadingState label="Loading the report" rows={6} />}
      {query.isError && <ErrorState title="Could not load the report" description={errorMessage(query.error)} />}
      {query.data && (
        <Panel title={REPORTS.find((row) => row.id === kind)?.label}>
          {!rows.length ? <p className="text-sm text-text-muted">Nothing to report.</p> : kind === "traceability" ? (
            <LinesTable columns={["Sales order", "Customer", "Product", "Manufacturing order", "Status", { label: "Assigned", numeric: true }, { label: "Received", numeric: true }, { label: "Reserved", numeric: true }, { label: "Delivered", numeric: true }]}>
              {rows.map((row, index) => <tr key={index}><Cell><Link className="text-brand underline" href={`${DEMAND_BASE}/${row.demandId}`}>{row.salesOrder}</Link></Cell><Cell>{row.customer}</Cell><Cell>{row.item}</Cell>
                <Cell><Link className="text-brand underline" href={`${MO_BASE}/${row.orderId}`}>{row.orderNumber}</Link></Cell><Cell>{String(row.status).toLowerCase().replace(/_/g, " ")}</Cell>
                <Cell numeric>{qty(String(row.allocated))}</Cell><Cell numeric>{qty(String(row.received))}</Cell><Cell numeric>{qty(String(row.reserved))}</Cell><Cell numeric>{qty(String(row.fulfilled))}</Cell></tr>)}
            </LinesTable>
          ) : kind === "by-customer" ? (
            <LinesTable columns={["Customer", { label: "Lines", numeric: true }, { label: "Outstanding", numeric: true }, { label: "In production", numeric: true }, { label: "Uncovered", numeric: true }]}>
              {rows.map((row, index) => <tr key={index}><Cell>{row.customer}</Cell><Cell numeric>{row.lines}</Cell><Cell numeric>{qty(String(row.outstanding))}</Cell><Cell numeric>{qty(String(row.inProduction))}</Cell>
                <Cell numeric>{qty(String(row.uncovered))}</Cell></tr>)}
            </LinesTable>
          ) : kind === "excess-production" ? (
            <LinesTable columns={["Manufacturing order", "Product", "Status", { label: "Accepted", numeric: true }, { label: "Assigned to customers", numeric: true }, { label: "Unassigned", numeric: true }]}>
              {rows.map((row, index) => <tr key={index}><Cell><Link className="text-brand underline" href={`${MO_BASE}/${row.orderId}`}>{row.orderNumber}</Link></Cell><Cell>{row.item}</Cell>
                <Cell>{String(row.status).toLowerCase().replace(/_/g, " ")}</Cell><Cell numeric>{qty(String(row.accepted))}</Cell><Cell numeric>{qty(String(row.assigned))}</Cell><Cell numeric>{qty(String(row.excess))}</Cell></tr>)}
            </LinesTable>
          ) : demandRows ? (
            <LinesTable columns={["Sales order", "Customer", "Product", "Required", { label: "Uncovered", numeric: true }, "Status", "Why"]}>
              {(rows as unknown as Demand[]).map((row) => <tr key={row.id}><Cell><Link className="text-brand underline" href={`${DEMAND_BASE}/${row.id}`}>{row.salesOrder.number}</Link></Cell>
                <Cell>{row.salesOrder.customer}</Cell><Cell>{row.item.code}</Cell><Cell>{row.requiredDate ? formatDate(row.requiredDate) : "—"}</Cell><Cell numeric>{qty(row.quantities.uncovered)}</Cell>
                <Cell>{row.statusLabel}</Cell><Cell>{row.exception ?? row.warnings.join(" ")}</Cell></tr>)}
            </LinesTable>
          ) : null}
        </Panel>
      )}
    </div>
  );
}
