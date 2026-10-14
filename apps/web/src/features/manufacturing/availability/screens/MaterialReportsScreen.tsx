"use client";

// Material availability reports: order readiness, demand by material, shortages by warehouse, reservation coverage, issued against required,
// incoming supply, subassembly shortages and shortage aging. Quantities only; no cost.
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ErrorState, PageHeader, PermissionState, StatusBadge, Tab, TabList, Tabs } from "@vercentlabs/design-system";

import { formatDate } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Panel } from "@/shared/ui/Panel";
import { Cell, LinesTable } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { MO_BASE, errorMessage, errorStatus, qty } from "@/features/manufacturing/orders/api/mo-api";
import { READINESS_TONE, SOURCE_LABEL, materialReport, type IncomingSource, type Readiness } from "../api/availability-api";

const REPORTS = [{ id: "readiness", label: "Order readiness" }, { id: "demand-by-item", label: "Demand by material" }, { id: "warehouse-shortages", label: "Shortages by warehouse" },
  { id: "reservation-coverage", label: "Reservation coverage" }, { id: "issued-vs-required", label: "Issued vs required" }, { id: "incoming", label: "Incoming supply" },
  { id: "subassembly-shortages", label: "Subassembly shortages" }, { id: "aging", label: "Shortage aging" }];
type Row = Record<string, string | number | null> & { sources?: IncomingSource[] };

const OrderLink = ({ row }: { row: Row }) => <Link className="text-brand underline" href={`${MO_BASE}/${row.orderId}?tab=materials`}>{row.orderNumber}</Link>;

export function MaterialReportsScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const kind = REPORTS.some((row) => row.id === params.get("report")) ? params.get("report")! : "readiness";
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "manufacturing", "material-report", kind), queryFn: () => materialReport<Row>(kind) });
  if (query.isError && errorStatus(query.error) === 403) return <PermissionState title="You don't have access to material availability" description="Ask an administrator for access." />;
  const rows = query.data ?? [];
  const n = (value: unknown) => qty(value === null || value === undefined ? null : String(value));
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Material Availability Reports" description="What open manufacturing orders need, hold, use and are short of. Usable stock only; incoming supply is never counted as stock." />
      <Tabs selectedKey={kind} onSelectionChange={(value) => router.replace(`${pathname}?report=${String(value)}`)}>
        <TabList aria-label="Reports">{REPORTS.map((row) => <Tab key={row.id} id={row.id}>{row.label}</Tab>)}</TabList>
      </Tabs>
      {query.isLoading && <LoadingState label="Loading the report" rows={6} />}
      {query.isError && <ErrorState title="Could not load the report" description={errorMessage(query.error)} />}
      {query.data && (
        <Panel title={REPORTS.find((row) => row.id === kind)?.label}>
          {!rows.length ? <p className="text-sm text-text-muted">Nothing to report.</p> : kind === "readiness" ? (
            <LinesTable columns={["Order", "Status", "From", { label: "Remaining", numeric: true }, { label: "Materials cover", numeric: true }, { label: "Allocated cover", numeric: true },
              { label: "Short lines", numeric: true }, "Limited by", "Readiness"]}>
              {rows.map((row) => <tr key={String(row.orderId)}><Cell><OrderLink row={row} /></Cell><Cell>{row.status}</Cell><Cell>{row.warehouse}</Cell><Cell numeric>{n(row.remaining)}</Cell>
                <Cell numeric>{n(row.feasible)}</Cell><Cell numeric>{n(row.allocatedFeasible)}</Cell><Cell numeric>{row.shortages}</Cell><Cell>{row.limiting}</Cell>
                <Cell><StatusBadge tone={READINESS_TONE[row.readiness as Readiness] ?? "neutral"}>{String(row.readinessLabel)}</StatusBadge></Cell></tr>)}
            </LinesTable>
          ) : kind === "demand-by-item" ? (
            <LinesTable columns={["Material", "Unit", { label: "Orders", numeric: true }, { label: "Still needed", numeric: true }, { label: "In production", numeric: true }, { label: "Reserved", numeric: true },
              { label: "Short", numeric: true }, { label: "Coming", numeric: true }]}>
              {rows.map((row, index) => <tr key={index}><Cell>{row.code} · {row.name}</Cell><Cell>{row.uom}</Cell><Cell numeric>{row.orders}</Cell><Cell numeric>{n(row.remaining)}</Cell>
                <Cell numeric>{n(row.inProduction)}</Cell><Cell numeric>{n(row.reserved)}</Cell><Cell numeric>{n(row.shortage)}</Cell><Cell numeric>{n(row.incoming)}</Cell></tr>)}
            </LinesTable>
          ) : kind === "warehouse-shortages" ? (
            <LinesTable columns={["Warehouse", "Material", "Unit", { label: "Short", numeric: true }, { label: "Orders", numeric: true }]}>
              {rows.map((row, index) => <tr key={index}><Cell>{row.warehouse}</Cell><Cell>{row.code}</Cell><Cell>{row.uom}</Cell><Cell numeric>{n(row.shortage)}</Cell><Cell numeric>{row.orders}</Cell></tr>)}
            </LinesTable>
          ) : kind === "issued-vs-required" ? (
            <LinesTable columns={["Order", "Material", "Unit", { label: "Required", numeric: true }, { label: "Used", numeric: true }, { label: "In production", numeric: true }, { label: "Still needed", numeric: true }]}>
              {rows.map((row, index) => <tr key={index}><Cell><OrderLink row={row} /></Cell><Cell>{row.code}</Cell><Cell>{row.uom}</Cell><Cell numeric>{n(row.required)}</Cell><Cell numeric>{n(row.consumed)}</Cell>
                <Cell numeric>{n(row.inProduction)}</Cell><Cell numeric>{n(row.remaining)}</Cell></tr>)}
            </LinesTable>
          ) : kind === "incoming" ? (
            <LinesTable columns={["Order", "Material", { label: "Short", numeric: true }, { label: "Coming", numeric: true }, "From", "Expected"]}>
              {rows.map((row, index) => <tr key={index}><Cell><OrderLink row={row} /></Cell><Cell>{row.code}</Cell><Cell numeric>{n(row.shortage)}</Cell><Cell numeric>{n(row.incoming)}</Cell>
                <Cell>{(row.sources ?? []).map((source) => `${source.reference} (${SOURCE_LABEL[source.source]}, ${qty(source.quantity)})`).join(", ")}</Cell>
                <Cell>{row.expectedAt ? formatDate(String(row.expectedAt)) : ""}</Cell></tr>)}
            </LinesTable>
          ) : (
            <LinesTable columns={["Order", "Material", "Unit", { label: "Still needed", numeric: true }, { label: "In production", numeric: true }, { label: "Reserved", numeric: true },
              { label: "Short", numeric: true }, { label: "Coming", numeric: true }, ...(kind === "aging" ? [{ label: "Age (days)", numeric: true }] : [])]}>
              {rows.map((row, index) => <tr key={index}><Cell><OrderLink row={row} /></Cell><Cell>{row.code}</Cell><Cell>{row.uom}</Cell><Cell numeric>{n(row.remaining)}</Cell>
                <Cell numeric>{n(row.inProduction)}</Cell><Cell numeric>{n(row.reserved)}</Cell><Cell numeric>{Number(row.shortage) ? n(row.shortage) : ""}</Cell><Cell numeric>{Number(row.incoming) ? n(row.incoming) : ""}</Cell>
                {kind === "aging" && <Cell numeric>{row.ageDays}</Cell>}</tr>)}
            </LinesTable>
          )}
        </Panel>
      )}
    </div>
  );
}
