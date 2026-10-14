"use client";

// Scrap: every scrap note with its order, what was scrapped, why, its disposition and state — and the exceptions queue (approvals and corrections
// waiting, postings needing recovery, rejected output nobody has disposed of). Views by state; search by note, order or item. A row opens the
// note. New notes start from a manufacturing order (Materials for issued material, Production for rejected output).
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

import { MO_BASE, errorMessage, errorStatus, inr } from "@/features/manufacturing/orders/api/mo-api";
import { SCRAP_BASE, SCRAP_TONE, TYPE_LABEL, listScraps, scrapExceptions, type ScrapException, type ScrapListRow } from "../api/scrap-api";

const VIEWS = [{ id: "all", label: "All" }, { id: "PENDING_APPROVAL", label: "Pending approval" }, { id: "DRAFT", label: "Draft" }, { id: "POSTED", label: "Posted" },
  { id: "RECOVERABLE", label: "Recoverable" }, { id: "REVERSED", label: "Reversed" }, { id: "exceptions", label: "Exceptions" }];
const EXCEPTION_LABEL: Record<ScrapException["kind"], string> = { APPROVAL_PENDING: "Approval waiting", APPROVED_NOT_POSTED: "Approved, not posted", CORRECTION_PENDING: "Correction waiting",
  POSTING_MISMATCH: "Posting needs recovery", REJECTED_NOT_DISPOSED: "Rejected output not disposed" };

export function ScrapListScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const params = useSearchParams();
  const [view, setView] = useState(VIEWS.some((row) => row.id === params.get("view")) ? params.get("view")! : "all");
  const [search, setSearch] = useState("");
  const submitted = useDebouncedValue(search);
  const filters = { status: ["all", "RECOVERABLE", "REVERSED", "exceptions"].includes(view) ? undefined : view, disposition: view === "RECOVERABLE" ? "RECOVERABLE" : undefined,
    correction: view === "REVERSED" ? "REVERSED" : undefined, search: submitted || undefined };
  const list = useQuery({ queryKey: scopedQueryKey(workspace, "manufacturing", "scrap", filters), queryFn: () => listScraps(filters), placeholderData: (previous) => previous, enabled: view !== "exceptions" });
  const exceptions = useQuery({ queryKey: scopedQueryKey(workspace, "manufacturing", "scrap-exceptions"), queryFn: scrapExceptions, enabled: view === "exceptions" });
  const rows = useMemo(() => list.data ?? [], [list.data]);
  const paged = usePagedRows(rows);
  const columns = useMemo<ColumnDef<ScrapListRow, unknown>[]>(() => [
    { id: "number", accessorKey: "number", header: "Scrap note", enableHiding: false, cell: ({ row }) => <span className="font-medium text-text">{row.original.number}</span> },
    { id: "order", header: "Manufacturing order", cell: ({ row }) => <span className="flex flex-col"><span>{row.original.orderNumber}</span><span className="text-xs text-text-muted">{row.original.finishedItem}</span></span> },
    { id: "what", header: "Scrapped", cell: ({ row }) => <span className="flex flex-col"><span className="text-sm">{row.original.summary ?? "—"}</span><span className="text-xs text-text-muted">{TYPE_LABEL[row.original.scrapType]}</span></span> },
    { id: "why", header: "Reason", cell: ({ row }) => row.original.reasonLabel },
    { id: "disposition", header: "Disposition", cell: ({ row }) => (
      <span className="flex flex-col text-sm"><span>{row.original.disposition === "RECOVERABLE" ? `Recoverable${row.original.location ? ` · ${row.original.location}` : ""}` : "Irrecoverable"}</span>
        <span className="text-xs text-text-muted">{row.original.lossClass === "ABNORMAL" ? "Abnormal loss" : "Normal loss"}</span></span>
    ) },
    { id: "status", header: "Status", cell: ({ row }) => (
      <span className="flex flex-wrap gap-1"><StatusBadge tone={SCRAP_TONE[row.original.status] ?? "neutral"}>{row.original.statusLabel}</StatusBadge>
        {row.original.correctionStatus === "REVERSED" && <StatusBadge tone="neutral">Reversed</StatusBadge>}{row.original.correctionStatus === "REQUESTED" && <StatusBadge tone="warning">Correction requested</StatusBadge>}</span>
    ) },
    { id: "when", header: "Posted", cell: ({ row }) => (row.original.postedAt ? <span className="flex flex-col"><span>{formatDateTime(row.original.postedAt)}</span><span className="text-xs text-text-muted">{row.original.postedBy}</span></span>
      : <span className="text-text-muted">Created {formatDateTime(row.original.createdAt)}</span>) },
    { id: "cost", header: "Value", cell: ({ row }) => (row.original.totalCost === null ? "" : inr(row.original.totalCost)) },
  ], []);
  const failure = list.error ?? exceptions.error;
  if (failure && errorStatus(failure) === 403) return <PermissionState title="You don't have access to scrap" description="Ask an administrator for access." />;
  return (
    <EnterpriseListPage
      header={{ title: "Scrap", description: "Material and output that became unusable in manufacturing: what, how much, why, from which order and batch, and where it went. Record scrap from a manufacturing order — Materials for issued material, Production for rejected output." }}
      savedViews={{ views: VIEWS, activeViewId: view, onSelect: (id) => { setView(id); paged.resetPage(); } }}
      actionBar={view === "exceptions" ? undefined : { start: <SearchField aria-label="Search scrap" placeholder="Note, order or item" className="w-full sm:w-80" value={search} onChange={setSearch} /> }}
    >
      {view === "exceptions" ? (
        exceptions.isLoading ? <LoadingState label="Loading exceptions" rows={6} /> : exceptions.isError ? <ErrorState title="Could not load the exceptions" description={errorMessage(exceptions.error)} /> : (
          <Panel title="Exceptions" description="What needs someone before scrap is settled.">
            {(exceptions.data ?? []).length === 0 ? <p className="text-sm text-text-muted">Nothing needs attention.</p> : (
              <LinesTable columns={["Kind", "Scrap note", "Order", "What", "Since"]}>
                {(exceptions.data ?? []).map((row, index) => (
                  <tr key={index}>
                    <Cell><StatusBadge tone={row.kind === "POSTING_MISMATCH" ? "danger" : "warning"}>{EXCEPTION_LABEL[row.kind]}</StatusBadge></Cell>
                    <Cell>{row.scrapId ? <Link className="text-brand underline" href={`${SCRAP_BASE}/${row.scrapId}`}>{row.scrapNumber}</Link> : ""}</Cell>
                    <Cell><Link className="text-brand underline" href={`${MO_BASE}/${row.orderId}?tab=production`}>{row.orderNumber ?? "Order"}</Link></Cell>
                    <Cell>{row.message}</Cell><Cell>{row.since ? formatDateTime(row.since) : ""}</Cell>
                  </tr>
                ))}
              </LinesTable>
            )}
          </Panel>
        )
      ) : (
        <EnterpriseDataGrid<ScrapListRow>
          aria-label="Scrap notes" columns={columns} data={paged.pageRows} getRowId={(row) => row.id}
          state={list.isLoading ? "loading" : list.isError ? "error" : rows.length === 0 ? (submitted || view !== "all" ? "no-results" : "empty") : "ready"}
          loadingContent={<LoadingState label="Loading scrap" rows={8} />}
          errorContent={<ErrorState title="Could not load scrap" description={errorMessage(list.error)} action={{ label: "Try again", onPress: () => void list.refetch() }} />}
          emptyContent={<EmptyState title="No scrap recorded" description="Open a manufacturing order and record scrap from its Materials or Production tab." action={{ label: "Manufacturing orders", onPress: () => router.push(MO_BASE) }} />}
          noResultsContent={<NoResultsState title="Nothing matches" description="Try another view or search." />}
          {...paged.grid}
          onRowClick={(row) => router.push(`${SCRAP_BASE}/${row.id}`)}
          renderMobileCard={(row) => (
            <div className="flex flex-col gap-1">
              <span className="flex items-center justify-between gap-2"><span className="font-medium">{row.number}</span><StatusBadge tone={SCRAP_TONE[row.status] ?? "neutral"}>{row.statusLabel}</StatusBadge></span>
              <span className="text-xs text-text-muted">{row.orderNumber} · {row.summary} · {row.reasonLabel}</span>
            </div>
          )}
        />
      )}
    </EnterpriseListPage>
  );
}
