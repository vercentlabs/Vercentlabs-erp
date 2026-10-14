"use client";

// Bills of Materials: one per finished product, with its current revision. Views by state; search by number or product; filter to the
// recipes that use a material. A row opens the BOM.
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { ComboBox, EmptyState, EnterpriseDataGrid, EnterpriseListPage, ErrorState, LinkButton, NoResultsState, PermissionState, SearchField, StatusBadge } from "@vercentlabs/design-system";

import { formatDateTime } from "@/shared/format/human";
import { filterBarOf, useDebouncedValue, usePagedRows } from "@/shared/ui/list";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { STATUS_LABEL, STATUS_TONE, bomOptions, errorMessage, errorStatus, listBoms, type BomListRow } from "../api/bom-api";

export const BOM_BASE = "/manufacturing/boms";
const VIEWS = [{ id: "all", label: "All" }, { id: "ACTIVE", label: "Active" }, { id: "DRAFT", label: "Draft" }, { id: "PENDING_APPROVAL", label: "Pending approval" },
  { id: "APPROVED", label: "Approved" }, { id: "REJECTED", label: "Rejected" }, { id: "ARCHIVED", label: "Archived" }];

export function BomListScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const can = (permission: string) => workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes(permission);
  const [view, setView] = useState("all");
  const [search, setSearch] = useState("");
  const submitted = useDebouncedValue(search);
  const [componentItemId, setComponentItemId] = useState<string | null>(null);
  const filters = { status: view === "all" || view === "ARCHIVED" ? undefined : view, includeArchived: view === "ARCHIVED" ? "true" : undefined, search: submitted || undefined,
    componentItemId: componentItemId ?? undefined };
  const list = useQuery({ queryKey: scopedQueryKey(workspace, "manufacturing", "boms", filters), queryFn: () => listBoms(filters), placeholderData: (previous) => previous });
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "manufacturing", "bom-options"), queryFn: bomOptions, staleTime: 60_000 });
  const rows = useMemo(() => (list.data ?? []).filter((row) => view !== "ARCHIVED" || row.state === "ARCHIVED"), [list.data, view]);
  const paged = usePagedRows(rows);
  const columns = useMemo<ColumnDef<BomListRow, unknown>[]>(() => [
    { id: "number", accessorKey: "number", header: "BOM", enableHiding: false, cell: ({ row }) => <span className="font-medium text-text">{row.original.number}</span> },
    { id: "product", header: "Product", cell: ({ row }) => <span className="flex flex-col"><span>{row.original.finishedItem.name}</span><span className="text-xs text-text-muted">{row.original.finishedItem.code}</span></span> },
    { id: "output", accessorKey: "output", header: "Output", cell: ({ row }) => <span className="tabular-nums">{row.original.output}</span> },
    { id: "lines", accessorKey: "lines", header: "Materials", cell: ({ row }) => <span className="tabular-nums">{row.original.lines}</span> },
    { id: "revision", header: "Revision", cell: ({ row }) => row.original.activeRevision ? `Rev ${row.original.activeRevision} active` : row.original.latestRevision ? `Rev ${row.original.latestRevision}` : "—" },
    { id: "latest", header: "In progress", cell: ({ row }) => row.original.activeRevision && row.original.latestStatus && row.original.latestStatus !== "ACTIVE" && row.original.latestRevision !== row.original.activeRevision
      ? `Rev ${row.original.latestRevision} ${STATUS_LABEL[row.original.latestStatus].toLowerCase()}` : "" },
    { id: "state", accessorKey: "state", header: "Status", cell: ({ row }) => <StatusBadge tone={STATUS_TONE[row.original.state] ?? "neutral"}>{STATUS_LABEL[row.original.state]}</StatusBadge> },
    { id: "updatedAt", accessorKey: "updatedAt", header: "Updated", cell: ({ row }) => formatDateTime(row.original.updatedAt) },
  ], []);
  if (list.isError && errorStatus(list.error) === 403) return <PermissionState title="You don't have access to bills of materials" description="Ask an administrator for access." />;
  const filterBar = filterBarOf([{ id: "component", active: Boolean(componentItemId), label: `Uses: ${options.data?.materials.find((item) => item.id === componentItemId)?.code ?? ""}`,
    clear: () => setComponentItemId(null) }], paged.resetPage);
  return (
    <EnterpriseListPage
      header={{
        title: "Bills of Materials",
        description: "The approved recipe each product is made from: its materials, quantities, units and revisions. A BOM never moves stock or buys anything; production orders and Procurement act on it.",
        primaryAction: can("manufacturing.bom.create") ? <LinkButton href={`${BOM_BASE}/new`} variant="primary"><Plus className="size-4" aria-hidden="true" />New BOM</LinkButton> : undefined,
      }}
      savedViews={{ views: VIEWS, activeViewId: view, onSelect: (id) => { setView(id); paged.resetPage(); } }}
      actionBar={{ start: (
        <>
          <SearchField aria-label="Search BOMs" placeholder="BOM number or product" className="w-full sm:w-80" value={search} onChange={setSearch} />
          <ComboBox aria-label="Uses material" size="compact" placeholder="Uses material…" selectedKey={componentItemId} onSelectionChange={(key) => setComponentItemId(key ? String(key) : null)}
            options={(options.data?.materials ?? []).map((item) => ({ value: item.id, label: `${item.code} · ${item.name}` }))} />
        </>
      ) }}
      filterBar={filterBar}
    >
      <EnterpriseDataGrid<BomListRow>
        aria-label="Bills of materials" columns={columns} data={paged.pageRows} getRowId={(row) => row.id}
        state={list.isLoading ? "loading" : list.isError ? "error" : rows.length === 0 ? (submitted || view !== "all" || componentItemId ? "no-results" : "empty") : "ready"}
        loadingContent={<LoadingState label="Loading bills of materials" rows={8} />}
        errorContent={<ErrorState title="Could not load bills of materials" description={errorMessage(list.error)} action={{ label: "Try again", onPress: () => void list.refetch() }} />}
        emptyContent={<EmptyState title="No bills of materials yet" description="Create the recipe for a product: the materials and quantities one unit (or one batch) needs."
          action={can("manufacturing.bom.create") ? { label: "New BOM", onPress: () => router.push(`${BOM_BASE}/new`) } : undefined} />}
        noResultsContent={<NoResultsState title="Nothing matches" description="Try another view, search or material." />}
        {...paged.grid}
        onRowClick={(row) => router.push(`${BOM_BASE}/${row.id}`)}
        renderMobileCard={(row) => (
          <div className="flex flex-col gap-1">
            <span className="flex items-center justify-between gap-2"><span className="font-medium">{row.number}</span><StatusBadge tone={STATUS_TONE[row.state] ?? "neutral"}>{STATUS_LABEL[row.state]}</StatusBadge></span>
            <span className="text-xs text-text-muted">{row.finishedItem.code} · {row.finishedItem.name} · {row.lines} materials</span>
          </div>
        )}
      />
    </EnterpriseListPage>
  );
}
