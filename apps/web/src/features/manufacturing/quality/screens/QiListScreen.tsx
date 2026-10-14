"use client";

// Production inspections: the queue (reported output awaiting inspection, entry by entry, oldest first, with what is held and any inspection
// already open), every inspection with its order, product, decision and state, and the exceptions (reviews waiting, inspections open too long,
// active holds, inspections needing recovery). A queue row starts an inspection; an inspection row opens it.
import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { EmptyState, EnterpriseDataGrid, EnterpriseListPage, ErrorState, LinkButton, NoResultsState, PermissionState, SearchField, StatusBadge } from "@vercentlabs/design-system";

import { formatDateTime } from "@/shared/format/human";
import { useDebouncedValue, usePagedRows } from "@/shared/ui/list";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Panel } from "@/shared/ui/Panel";
import { Cell, LinesTable } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { MO_BASE, errorMessage, errorStatus, qty } from "@/features/manufacturing/orders/api/mo-api";
import { DISPOSITION_LABEL, QI_BASE, QI_TONE, inspectionQueue, listInspections, qualityExceptions, type QiException, type QiListRow } from "../api/qi-api";

const VIEWS = [{ id: "queue", label: "Awaiting inspection" }, { id: "all", label: "All" }, { id: "IN_PROGRESS", label: "In progress" }, { id: "PENDING_REVIEW", label: "Pending review" },
  { id: "FINALIZED", label: "Finalized" }, { id: "REJECTED", label: "With rejections" }, { id: "exceptions", label: "Exceptions" }];
const EXCEPTION_LABEL: Record<QiException["kind"], string> = { REVIEW: "Review waiting", RECOVERY: "Needs recovery", STALE: "Open too long", HOLD: "On hold" };

export function QiListScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const params = useSearchParams();
  const [view, setView] = useState(VIEWS.some((row) => row.id === params.get("view")) ? params.get("view")! : "queue");
  const [search, setSearch] = useState("");
  const submitted = useDebouncedValue(search);
  const listed = !["queue", "exceptions"].includes(view);
  const filters = { status: ["all", "REJECTED"].includes(view) || !listed ? undefined : view, outcome: view === "REJECTED" ? "REJECTED" : undefined, search: submitted || undefined };
  const list = useQuery({ queryKey: scopedQueryKey(workspace, "manufacturing", "quality-inspections", filters), queryFn: () => listInspections(filters), placeholderData: (previous) => previous, enabled: listed });
  const queue = useQuery({ queryKey: scopedQueryKey(workspace, "manufacturing", "quality-queue"), queryFn: () => inspectionQueue(), enabled: view === "queue" });
  const exceptions = useQuery({ queryKey: scopedQueryKey(workspace, "manufacturing", "quality-exceptions"), queryFn: qualityExceptions, enabled: view === "exceptions" });
  const rows = useMemo(() => list.data ?? [], [list.data]);
  const paged = usePagedRows(rows);
  const columns = useMemo<ColumnDef<QiListRow, unknown>[]>(() => [
    { id: "number", accessorKey: "number", header: "Inspection", enableHiding: false, cell: ({ row }) => (
      <span className="flex flex-col"><span className="font-medium text-text">{row.original.number}</span>{row.original.stage === "IN_PROCESS" && <span className="text-xs text-text-muted">In-process check</span>}</span>
    ) },
    { id: "order", header: "Manufacturing order", cell: ({ row }) => <span className="flex flex-col"><span>{row.original.orderNumber}</span><span className="text-xs text-text-muted">{row.original.entryNumber}{row.original.batch ? ` · ${row.original.batch}` : ""}</span></span> },
    { id: "item", header: "Product", cell: ({ row }) => <span className="flex flex-col"><span>{row.original.itemCode}</span><span className="text-xs text-text-muted">{row.original.itemName}</span></span> },
    { id: "covered", header: "Covered", cell: ({ row }) => `${qty(row.original.scope)} ${row.original.uom ?? ""}${row.original.examined !== row.original.scope ? ` (${qty(row.original.examined)} examined)` : ""}` },
    { id: "decision", header: "Decision", cell: ({ row }) => (
      <span className="text-sm">{qty(row.original.accepted)} accepted · {qty(row.original.rejected)} rejected{row.original.disposition ? ` (${DISPOSITION_LABEL[row.original.disposition].toLowerCase()})` : ""}
        {Number(row.original.held) ? ` · ${qty(row.original.held)} held` : ""}</span>
    ) },
    { id: "status", header: "Status", cell: ({ row }) => <StatusBadge tone={QI_TONE[row.original.status]}>{row.original.statusLabel}</StatusBadge> },
    { id: "inspector", header: "Inspector", cell: ({ row }) => <span className="flex flex-col"><span>{row.original.inspector ?? "—"}</span><span className="text-xs text-text-muted">{formatDateTime(row.original.finalizedAt ?? row.original.inspectedAt)}</span></span> },
  ], []);
  const failure = list.error ?? queue.error ?? exceptions.error;
  if (failure && errorStatus(failure) === 403) return <PermissionState title="You don't have access to production inspections" description="Ask an administrator for access." />;
  return (
    <EnterpriseListPage
      header={{ title: "Production Inspections", description: "Final and in-process quality inspection of manufactured output: the queue of output awaiting inspection, every inspection and its decision, and what needs attention. Only accepted output can be received into stock." }}
      savedViews={{ views: VIEWS, activeViewId: view, onSelect: (id) => { setView(id); paged.resetPage(); } }}
      actionBar={listed ? { start: <SearchField aria-label="Search inspections" placeholder="Inspection, order, entry or product" className="w-full sm:w-80" value={search} onChange={setSearch} /> } : undefined}
    >
      {view === "queue" ? (
        queue.isLoading ? <LoadingState label="Loading the queue" rows={6} /> : queue.isError ? <ErrorState title="Could not load the queue" description={errorMessage(queue.error)} /> : (
          <Panel title="Awaiting inspection" description="Reported output nobody has decided yet, oldest first. Held output is shown but cannot be inspected until it is released or reinspected.">
            {(queue.data ?? []).length === 0 ? <p className="text-sm text-text-muted">Nothing awaits inspection.</p> : (
              <LinesTable columns={["Order", "Entry", "Product", { label: "Awaiting", numeric: true }, { label: "Held", numeric: true }, "Reported", ""]}>
                {(queue.data ?? []).map((row) => (
                  <tr key={row.entryId}>
                    <Cell><Link className="text-brand underline" href={`${MO_BASE}/${row.orderId}?tab=quality`}>{row.orderNumber}</Link>{row.orderStatus === "ON_HOLD" ? <span className="text-xs text-text-muted"> · on hold</span> : null}</Cell>
                    <Cell>{row.entryNumber}{row.batch ? ` · ${row.batch}` : ""}</Cell><Cell>{row.itemCode} · {row.itemName}</Cell>
                    <Cell numeric>{qty(row.pending)} {row.uom ?? ""}</Cell><Cell numeric>{Number(row.held) ? qty(row.held) : ""}</Cell>
                    <Cell>{row.reportedAt ? formatDateTime(row.reportedAt) : ""}{row.ageHours !== null && row.ageHours >= 24 ? <span className="text-xs text-warning"> · {Math.floor(row.ageHours / 24)}d waiting</span> : null}</Cell>
                    <Cell>
                      {row.openInspectionId ? <Link className="text-brand underline" href={`${QI_BASE}/${row.openInspectionId}`}>Open inspection</Link>
                        : Number(row.available) > 0 ? <LinkButton size="compact" variant="primary" href={`${QI_BASE}/new?orderId=${row.orderId}&entryId=${row.entryId}`}>Inspect</LinkButton> : <span className="text-xs text-text-muted">All held</span>}
                    </Cell>
                  </tr>
                ))}
              </LinesTable>
            )}
          </Panel>
        )
      ) : view === "exceptions" ? (
        exceptions.isLoading ? <LoadingState label="Loading exceptions" rows={6} /> : exceptions.isError ? <ErrorState title="Could not load the exceptions" description={errorMessage(exceptions.error)} /> : (
          <Panel title="Exceptions" description="What needs someone before output can move on.">
            {(exceptions.data ?? []).length === 0 ? <p className="text-sm text-text-muted">Nothing needs attention.</p> : (
              <LinesTable columns={["Kind", "Inspection", "Order", "What", "Since"]}>
                {(exceptions.data ?? []).map((row, index) => (
                  <tr key={index}>
                    <Cell><StatusBadge tone={row.kind === "RECOVERY" ? "danger" : "warning"}>{EXCEPTION_LABEL[row.kind]}</StatusBadge></Cell>
                    <Cell>{row.inspectionId ? <Link className="text-brand underline" href={`${QI_BASE}/${row.inspectionId}`}>{row.inspectionNumber}</Link> : ""}</Cell>
                    <Cell><Link className="text-brand underline" href={`${MO_BASE}/${row.orderId}?tab=quality`}>{row.orderNumber}</Link></Cell>
                    <Cell>{row.itemCode} · {row.summary}</Cell><Cell>{formatDateTime(row.since)}</Cell>
                  </tr>
                ))}
              </LinesTable>
            )}
          </Panel>
        )
      ) : (
        <EnterpriseDataGrid<QiListRow>
          aria-label="Production inspections" columns={columns} data={paged.pageRows} getRowId={(row) => row.id}
          state={list.isLoading ? "loading" : list.isError ? "error" : rows.length === 0 ? (submitted || view !== "all" ? "no-results" : "empty") : "ready"}
          loadingContent={<LoadingState label="Loading inspections" rows={8} />}
          errorContent={<ErrorState title="Could not load inspections" description={errorMessage(list.error)} action={{ label: "Try again", onPress: () => void list.refetch() }} />}
          emptyContent={<EmptyState title="No inspections yet" description="Inspect reported output from the queue or from a manufacturing order's Quality tab." action={{ label: "Awaiting inspection", onPress: () => setView("queue") }} />}
          noResultsContent={<NoResultsState title="Nothing matches" description="Try another view or search." />}
          {...paged.grid}
          onRowClick={(row) => router.push(`${QI_BASE}/${row.id}`)}
          renderMobileCard={(row) => (
            <div className="flex flex-col gap-1">
              <span className="flex items-center justify-between gap-2"><span className="font-medium">{row.number}</span><StatusBadge tone={QI_TONE[row.status]}>{row.statusLabel}</StatusBadge></span>
              <span className="text-xs text-text-muted">{row.orderNumber} · {row.itemCode} · {qty(row.accepted)} accepted · {qty(row.rejected)} rejected</span>
            </div>
          )}
        />
      )}
    </EnterpriseListPage>
  );
}
