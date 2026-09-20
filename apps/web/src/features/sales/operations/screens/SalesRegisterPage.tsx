"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { Button, EnterpriseDataGrid, EnterpriseListPage, ErrorState, NoResultsState, PermissionState, SearchField } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { SalesApiError } from "@/features/sales/shared/http";
import { listRegister, type RegisterKind } from "@/features/sales/operations/api/operations-api";

export type RegisterConfig<T> = {
  kind: RegisterKind;
  title: string;
  description: string;
  searchLabel: string;
  createLabel?: string;
  createPermission?: string;
  columns: ColumnDef<T, unknown>[];
  searchText: (row: T) => string;
  emptyTitle: string;
  emptyDescription: string;
  onRowClick?: (row: T) => void;
  // Per-row action (e.g. "Complete delivery"); receives a callback that reloads the register.
  rowActions?: (row: T, refresh: () => void) => ReactNode;
  // Renders the create dialog; the page owns open/close state.
  renderCreate?: (props: { onClose: () => void; onDone: () => void }) => ReactNode;
};

// One list page for every operational register (deliveries, invoices, advances,
// adjustments, returns, drop-ships, commissions). The server scopes rows to the
// caller's company; search is applied over the fetched page (registers are
// capped at 100 rows server-side, which the footer says out loud).
export function SalesRegisterPage<T extends { id: string }>({ config }: { config: RegisterConfig<T> }) {
  const workspace = useWorkspaceContext();
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const can = (permission?: string) => !permission || workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes(permission);

  const key = scopedQueryKey(workspace, "sales", "register", config.kind);
  const query = useQuery({ queryKey: key, queryFn: () => listRegister<T>(config.kind).then((r) => r.rows) });
  const rows = useMemo(() => {
    const all = query.data ?? [];
    const term = search.trim().toLowerCase();
    return term ? all.filter((row) => config.searchText(row).toLowerCase().includes(term)) : all;
  }, [query.data, search, config]);

  if (query.isError && query.error instanceof SalesApiError && query.error.status === 403) return <PermissionState title="You don't have access to Sales" description="Ask an administrator to grant sales.view." />;

  const canCreate = Boolean(config.renderCreate) && can(config.createPermission);
  return (
    <>
      <EnterpriseListPage
        header={{
          title: config.title,
          description: config.description,
          primaryAction: canCreate ? (
            <Button variant="primary" onPress={() => setCreating(true)}>
              <Plus className="size-4" aria-hidden="true" />
              {config.createLabel}
            </Button>
          ) : undefined,
        }}
        actionBar={{ start: <SearchField aria-label={config.searchLabel} placeholder="Search…" value={search} onChange={setSearch} className="min-w-[280px]" /> }}
        filterBar={{ filters: search.trim() ? [{ id: "search", label: `Search: ${search.trim()}` }] : [], onRemove: () => setSearch(""), onClearAll: search.trim() ? () => setSearch("") : undefined }}
      >
        <EnterpriseDataGrid<T>
          aria-label={config.title}
          columns={config.columns}
          data={rows}
          getRowId={(row) => row.id}
          state={query.isLoading ? "loading" : query.isError ? "error" : rows.length === 0 && search.trim() ? "no-results" : rows.length === 0 ? "empty" : "ready"}
          loadingContent={<p className="px-4 py-8 text-sm text-text-secondary">Loading…</p>}
          emptyContent={<NoResultsState title={config.emptyTitle} description={config.emptyDescription} action={canCreate ? { label: config.createLabel ?? "Create", onPress: () => setCreating(true) } : undefined} />}
          noResultsContent={<NoResultsState title="Nothing matches this search" description="Try a different term." action={{ label: "Clear search", onPress: () => setSearch("") }} />}
          errorContent={<ErrorState title={`Could not load ${config.title.toLowerCase()}`} action={{ label: "Retry", onPress: () => query.refetch() }} />}
          onRowClick={config.onRowClick}
          rowActions={config.rowActions ? (row) => config.rowActions?.(row, () => void query.refetch()) : undefined}
        />
        {(query.data?.length ?? 0) >= 100 && <p className="px-1 pt-2 text-xs text-text-muted">Showing the 100 most recent records.</p>}
      </EnterpriseListPage>
      {creating && config.renderCreate?.({ onClose: () => setCreating(false), onDone: () => { setCreating(false); query.refetch(); } })}
    </>
  );
}
