"use client";

// Inspection checklists: one per product (or company-wide) and stage, each kept as revisions — an inspection freezes the revision it started
// with. A row opens the checklist with its revisions; those who manage checklists start a new one.
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { EmptyState, EnterpriseDataGrid, EnterpriseListPage, ErrorState, LinkButton, NoResultsState, PermissionState, StatusBadge } from "@vercentlabs/design-system";

import { formatDateTime } from "@/shared/format/human";
import { usePagedRows } from "@/shared/ui/list";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { errorMessage, errorStatus } from "@/features/manufacturing/orders/api/mo-api";
import { QI_TEMPLATES_BASE, listTemplates, type QiTemplateRow } from "../api/qi-api";

const VIEWS = [{ id: "ACTIVE", label: "Active" }, { id: "INACTIVE", label: "Inactive" }, { id: "all", label: "All" }];

export function QiTemplatesScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const [view, setView] = useState("ACTIVE");
  const filters = { status: view === "all" ? undefined : view };
  const list = useQuery({ queryKey: scopedQueryKey(workspace, "manufacturing", "quality-templates", filters), queryFn: () => listTemplates(filters), placeholderData: (previous) => previous });
  const rows = useMemo(() => list.data ?? [], [list.data]);
  const paged = usePagedRows(rows);
  const columns = useMemo<ColumnDef<QiTemplateRow, unknown>[]>(() => [
    { id: "name", accessorKey: "name", header: "Checklist", enableHiding: false, cell: ({ row }) => <span className="flex flex-col"><span className="font-medium text-text">{row.original.name}</span><span className="text-xs text-text-muted">{row.original.number}</span></span> },
    { id: "product", header: "Product", cell: ({ row }) => (row.original.itemCode ? `${row.original.itemCode} · ${row.original.itemName}` : <span className="text-text-muted">Every product</span>) },
    { id: "stage", header: "Stage", cell: ({ row }) => (row.original.stage === "FINAL" ? "Final inspection" : "In-process check") },
    { id: "checks", header: "Checks", cell: ({ row }) => `${row.original.checks}${row.original.critical ? ` (${row.original.critical} critical)` : ""}` },
    { id: "revision", header: "Revision", cell: ({ row }) => (row.original.revision ? `Rev ${row.original.revision}` : "—") },
    { id: "used", header: "Inspections", cell: ({ row }) => row.original.used },
    { id: "status", header: "Status", cell: ({ row }) => <StatusBadge tone={row.original.status === "ACTIVE" ? "success" : "neutral"}>{row.original.status === "ACTIVE" ? "Active" : "Inactive"}</StatusBadge> },
    { id: "updated", header: "Updated", cell: ({ row }) => formatDateTime(row.original.updatedAt) },
  ], []);
  if (list.error && errorStatus(list.error) === 403) return <PermissionState title="You don't have access to inspection checklists" description="Ask an administrator for access." />;
  return (
    <EnterpriseListPage
      header={{ title: "Inspection Checklists", description: "What is checked on each product: pass/fail checks, measurements with tolerances, observations and choices, marked required or critical. A new tolerance is a new revision; past inspections keep theirs.",
        primaryAction: <LinkButton variant="primary" href={`${QI_TEMPLATES_BASE}/new`}>New checklist</LinkButton> }}
      savedViews={{ views: VIEWS, activeViewId: view, onSelect: (id) => { setView(id); paged.resetPage(); } }}
    >
      <EnterpriseDataGrid<QiTemplateRow>
        aria-label="Inspection checklists" columns={columns} data={paged.pageRows} getRowId={(row) => row.id}
        state={list.isLoading ? "loading" : list.isError ? "error" : rows.length === 0 ? (view !== "ACTIVE" ? "no-results" : "empty") : "ready"}
        loadingContent={<LoadingState label="Loading checklists" rows={6} />}
        errorContent={<ErrorState title="Could not load checklists" description={errorMessage(list.error)} action={{ label: "Try again", onPress: () => void list.refetch() }} />}
        emptyContent={<EmptyState title="No checklists yet" description="Without a checklist, output gets a basic inspection: a decision with its reasons and defects." action={{ label: "New checklist", onPress: () => router.push(`${QI_TEMPLATES_BASE}/new`) }} />}
        noResultsContent={<NoResultsState title="Nothing here" description="Try another view." />}
        {...paged.grid}
        onRowClick={(row) => router.push(`${QI_TEMPLATES_BASE}/${row.id}`)}
        renderMobileCard={(row) => (
          <div className="flex flex-col gap-1">
            <span className="flex items-center justify-between gap-2"><span className="font-medium">{row.name}</span><StatusBadge tone={row.status === "ACTIVE" ? "success" : "neutral"}>{row.status === "ACTIVE" ? "Active" : "Inactive"}</StatusBadge></span>
            <span className="text-xs text-text-muted">{row.itemCode ?? "Every product"} · {row.checks} checks · rev {row.revision ?? "—"}</span>
          </div>
        )}
      />
    </EnterpriseListPage>
  );
}
