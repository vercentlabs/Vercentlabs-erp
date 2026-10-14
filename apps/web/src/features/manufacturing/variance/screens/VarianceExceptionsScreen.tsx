"use client";

// Variance Exceptions: the supervisors' queue — material lines of orders in production that are outside tolerance with nobody investigating
// yet, investigations in progress and awaiting approval — and every exception. A row opens the exception or its order's materials.
import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { EmptyState, EnterpriseDataGrid, EnterpriseListPage, ErrorState, NoResultsState, PermissionState, SearchField, StatusBadge } from "@vercentlabs/design-system";

import { formatDateTime } from "@/shared/format/human";
import { useDebouncedValue, usePagedRows } from "@/shared/ui/list";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Panel } from "@/shared/ui/Panel";
import { Cell, LinesTable } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { MO_BASE, errorMessage, errorStatus, inr, qty } from "@/features/manufacturing/orders/api/mo-api";
import { BAND_TONE, STATUS_TONE, VARIANCE_BASE, listExceptions, reviewQueue, signed, type Band, type ExceptionRow } from "../api/variance-api";

const VIEWS = [{ id: "queue", label: "Needs review" }, { id: "open", label: "In progress" }, { id: "SUBMITTED", label: "Awaiting approval" }, { id: "APPROVED", label: "Approved" },
  { id: "RESOLVED", label: "Resolved" }, { id: "all", label: "All" }];

export function VarianceExceptionsScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const params = useSearchParams();
  const [view, setView] = useState(VIEWS.some((row) => row.id === params.get("view")) ? params.get("view")! : "queue");
  const [search, setSearch] = useState("");
  const submitted = useDebouncedValue(search);
  const filters = { status: view === "queue" ? undefined : view, search: submitted || undefined };
  const list = useQuery({ queryKey: scopedQueryKey(workspace, "manufacturing", "variance-exceptions", filters), queryFn: () => listExceptions(filters), enabled: view !== "queue", placeholderData: (previous) => previous });
  const queue = useQuery({ queryKey: scopedQueryKey(workspace, "manufacturing", "variance-queue"), queryFn: reviewQueue, enabled: view === "queue" });
  const rows = useMemo(() => list.data ?? [], [list.data]);
  const paged = usePagedRows(rows);
  const columns = useMemo<ColumnDef<ExceptionRow, unknown>[]>(() => [
    { id: "number", accessorKey: "number", header: "Exception", enableHiding: false, cell: ({ row }) => <span className="flex flex-col"><span className="font-medium text-text">{row.original.number}</span>
      <span className="text-xs text-text-muted">{row.original.orderNumber}</span></span> },
    { id: "material", header: "Material", cell: ({ row }) => `${row.original.code} · ${row.original.name}` },
    { id: "variance", header: "Variance", cell: ({ row }) => `${signed(row.original.variance)} ${row.original.uom ?? ""}${row.original.variancePct ? ` (${signed(row.original.variancePct)}%)` : ""}` },
    { id: "cost", header: "Usage cost", cell: ({ row }) => (row.original.usageCost ? inr(row.original.usageCost) : "") },
    { id: "reason", header: "Reason", cell: ({ row }) => row.original.reason ?? "—" },
    { id: "status", header: "Status", cell: ({ row }) => <StatusBadge tone={STATUS_TONE[row.original.status] ?? "neutral"}>{row.original.statusLabel}</StatusBadge> },
    { id: "owner", header: "Owner", cell: ({ row }) => row.original.assignee ?? "—" },
    { id: "when", header: "Opened", cell: ({ row }) => formatDateTime(row.original.createdAt) },
  ], []);
  const failure = list.error ?? queue.error;
  if (failure && errorStatus(failure) === 403) return <PermissionState title="You don't have access to material variance" description="Ask an administrator for access." />;
  return (
    <EnterpriseListPage
      header={{ title: "Variance Exceptions", description: "Material used beyond (or well under) what the BOM expects for the production reported: investigate the cause, submit it for approval, resolve it. A variance never changes stock, the BOM or the books by itself." }}
      savedViews={{ views: VIEWS, activeViewId: view, onSelect: (id) => { setView(id); paged.resetPage(); } }}
      actionBar={view === "queue" ? undefined : { start: <SearchField aria-label="Search exceptions" placeholder="Exception, order or material" className="w-full sm:w-80" value={search} onChange={setSearch} /> }}
    >
      {view === "queue" ? (
        queue.isLoading ? <LoadingState label="Loading the queue" rows={6} /> : queue.isError ? <ErrorState title="Could not load the queue" description={errorMessage(queue.error)} /> : (
          <div className="flex flex-col gap-4">
            <Panel title="Outside tolerance, not yet investigated" description="Lines of orders in production; open the order's Materials tab to investigate one.">
              {(queue.data?.unopened ?? []).length === 0 ? <p className="text-sm text-text-muted">Nothing outside tolerance.</p> : (
                <LinesTable columns={["Order", "Material", { label: "Expected", numeric: true }, { label: "Actual", numeric: true }, { label: "Variance", numeric: true }, "Status"]}>
                  {(queue.data?.unopened ?? []).map((row) => (
                    <tr key={row.materialId}>
                      <Cell><Link className="text-brand underline" href={`${MO_BASE}/${row.orderId}?tab=materials`}>{row.orderNumber}</Link></Cell><Cell>{row.code} · {row.name}</Cell>
                      <Cell numeric>{qty(row.expected)}</Cell><Cell numeric>{qty(row.actual)}</Cell><Cell numeric>{signed(row.variance)}{row.variancePct ? ` (${signed(row.variancePct)}%)` : ""}</Cell>
                      <Cell><StatusBadge tone={BAND_TONE[row.band as Band]}>{row.bandLabel}</StatusBadge></Cell>
                    </tr>
                  ))}
                </LinesTable>
              )}
            </Panel>
            <Panel title="Investigations in progress">
              {(queue.data?.exceptions ?? []).length === 0 ? <p className="text-sm text-text-muted">None.</p> : (
                <LinesTable columns={["Exception", "Order", "Material", { label: "Variance", numeric: true }, "Status", "Owner"]}>
                  {(queue.data?.exceptions ?? []).map((row) => (
                    <tr key={row.id}><Cell><Link className="text-brand underline" href={`${VARIANCE_BASE}/${row.id}`}>{row.number}</Link></Cell><Cell>{row.orderNumber}</Cell><Cell>{row.code}</Cell>
                      <Cell numeric>{signed(row.variance)}</Cell><Cell><StatusBadge tone={STATUS_TONE[row.status] ?? "neutral"}>{row.statusLabel}</StatusBadge></Cell><Cell>{row.assignee ?? "—"}</Cell></tr>
                  ))}
                </LinesTable>
              )}
            </Panel>
          </div>
        )
      ) : (
        <EnterpriseDataGrid<ExceptionRow>
          aria-label="Variance exceptions" columns={columns} data={paged.pageRows} getRowId={(row) => row.id}
          state={list.isLoading ? "loading" : list.isError ? "error" : rows.length === 0 ? (submitted || view !== "all" ? "no-results" : "empty") : "ready"}
          loadingContent={<LoadingState label="Loading exceptions" rows={8} />}
          errorContent={<ErrorState title="Could not load exceptions" description={errorMessage(list.error)} action={{ label: "Try again", onPress: () => void list.refetch() }} />}
          emptyContent={<EmptyState title="No variance exceptions" description="Exceptions are opened from an order's Materials tab when usage is outside tolerance." action={{ label: "Manufacturing orders", onPress: () => router.push(MO_BASE) }} />}
          noResultsContent={<NoResultsState title="Nothing matches" description="Try another view or search." />}
          {...paged.grid}
          onRowClick={(row) => router.push(`${VARIANCE_BASE}/${row.id}`)}
          renderMobileCard={(row) => (
            <div className="flex flex-col gap-1">
              <span className="flex items-center justify-between gap-2"><span className="font-medium">{row.number} · {row.code}</span><StatusBadge tone={STATUS_TONE[row.status] ?? "neutral"}>{row.statusLabel}</StatusBadge></span>
              <span className="text-xs text-text-muted">{row.orderNumber} · {signed(row.variance)} {row.uom ?? ""}</span>
            </div>
          )}
        />
      )}
    </EnterpriseListPage>
  );
}
