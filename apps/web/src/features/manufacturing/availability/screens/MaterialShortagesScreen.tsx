"use client";

// Material shortages across open manufacturing orders: for every short material, the order, how much is still needed, what covers it, what is
// short, what is coming and what is already requested from Procurement — oldest first, so the planner works the longest-waiting first.
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
import { LINE_TONE, listShortages } from "../api/availability-api";

const VIEWS = [{ id: "all", label: "All" }, { id: "SHORTAGE", label: "Short" }, { id: "AWAITING_RECEIPT", label: "Awaiting receipt" }, { id: "BLOCKED", label: "Blocked" }];

export function MaterialShortagesScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const view = VIEWS.some((row) => row.id === params.get("view")) ? params.get("view")! : "all";
  const status = view === "all" ? undefined : view;
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "manufacturing", "material-shortages", view), queryFn: () => listShortages({ status }) });
  if (query.isError && errorStatus(query.error) === 403) return <PermissionState title="You don't have access to material availability" description="Ask an administrator for access." />;
  const rows = query.data ?? [];
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Material Shortages" description="What open manufacturing orders still need and cannot cover from usable stock. Incoming supply is shown, never counted as stock." />
      <Tabs selectedKey={view} onSelectionChange={(value) => router.replace(`${pathname}?view=${String(value)}`)}>
        <TabList aria-label="Shortage views">{VIEWS.map((row) => <Tab key={row.id} id={row.id}>{row.label}</Tab>)}</TabList>
      </Tabs>
      {query.isLoading && <LoadingState label="Checking shortages" rows={6} />}
      {query.isError && <ErrorState title="Could not load shortages" description={errorMessage(query.error)} />}
      {query.data && (
        <Panel title={`${rows.length} short material line${rows.length === 1 ? "" : "s"}`}>
          {!rows.length ? <p className="text-sm text-text-muted">No open order is short of material.</p> : (
            <LinesTable columns={["Order", "Material", "From", { label: "Still needed", numeric: true }, { label: "Covered", numeric: true }, { label: "Short", numeric: true },
              { label: "Coming", numeric: true }, "Expected", "Requested", "Status", "Needed by", { label: "Age (days)", numeric: true }]}>
              {rows.map((row) => (
                <tr key={`${row.orderId}-${row.materialId}`}>
                  <Cell><span className="flex flex-col"><Link className="text-brand underline" href={`${MO_BASE}/${row.orderId}?tab=materials`}>{row.orderNumber}</Link>
                    <span className="text-xs text-text-muted">{row.orderStatusLabel}</span></span></Cell>
                  <Cell><span className="flex flex-col"><span>{row.code} · {row.name}</span><span className="text-xs text-text-muted">{row.uom}{row.kind === "SUBASSEMBLY" ? " · subassembly" : ""}</span></span></Cell>
                  <Cell>{row.warehouse}</Cell><Cell numeric>{qty(row.remaining)}</Cell><Cell numeric>{qty(row.covered)}</Cell><Cell numeric>{qty(row.shortage)}</Cell>
                  <Cell numeric>{Number(row.incoming) ? qty(row.incoming) : ""}</Cell><Cell>{row.expectedAt ? formatDate(row.expectedAt) : ""}</Cell>
                  <Cell>{row.requested.length ? row.requested.map((demand) => `${demand.number} (${qty(demand.quantity)})`).join(", ") : <span className="text-text-muted">Not requested</span>}</Cell>
                  <Cell><StatusBadge tone={LINE_TONE[row.status]}>{row.statusLabel}</StatusBadge></Cell>
                  <Cell>{formatDate(row.requiredBy)}</Cell><Cell numeric>{row.ageDays}</Cell>
                </tr>
              ))}
            </LinesTable>
          )}
        </Panel>
      )}
    </div>
  );
}
