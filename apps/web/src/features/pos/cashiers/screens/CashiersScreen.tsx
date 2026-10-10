"use client";

// Cashiers: the POS profiles of workspace users — where each may work, their POS role, and whether they are on a session now. Views: All,
// Active, Inactive, On a session. The current outlet, terminal and session come from the open session, never from the profile.
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { Button, EmptyState, EnterpriseDataGrid, EnterpriseListPage, ErrorState, NoResultsState, PermissionState, SearchField, Select, StatusBadge } from "@vercentlabs/design-system";

import { formatDateTime } from "@/shared/format/human";
import { filterBarOf, optionLabel, useDebouncedValue, usePagedRows } from "@/shared/ui/list";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { CASHIERS_BASE, STATE_LABEL, STATE_TONE, errorCode, errorMessage, getCashierOptions, listCashiers, type Cashier, type CashierFilters } from "../api/cashiers-api";

const ANY = "any";
const VIEWS = [{ id: "all", label: "All" }, { id: "active", label: "Active" }, { id: "inactive", label: "Inactive" }, { id: "on_shift", label: "On a session" }];
const sortValue = (row: Cashier, id: string) => (row as Record<string, unknown>)[id];

export function CashiersScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const [view, setView] = useState("all");
  const [search, setSearch] = useState("");
  const submitted = useDebouncedValue(search);
  const [outletId, setOutletId] = useState(ANY);
  const [role, setRole] = useState(ANY);
  const filters: CashierFilters = Object.fromEntries(Object.entries({ view, search: submitted, outletId, role }).filter(([, value]) => value && value !== ANY));
  const list = useQuery({ queryKey: scopedQueryKey(workspace, "pos-cashiers", "list", filters), queryFn: () => listCashiers(filters), placeholderData: (previous) => previous });
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "pos-cashiers", "options"), queryFn: getCashierOptions, staleTime: 60_000 });
  const rows = useMemo(() => list.data?.cashiers ?? [], [list.data]);
  const paged = usePagedRows(rows, { initialSorting: [{ id: "code", desc: false }], sortValue });
  const can = list.data?.capabilities ?? options.data?.capabilities;

  const columns = useMemo(() => [
    { id: "code", accessorKey: "code", header: "Cashier code", cell: ({ row }) => <span className="font-medium tabular-nums">{row.original.code}</span> },
    { id: "name", accessorKey: "name", header: "Cashier", cell: ({ row }) => (
      <span className="flex flex-col"><span className="font-medium text-text">{row.original.name}</span><span className="text-xs text-text-muted">{row.original.email}</span></span>
    ) },
    { id: "defaultOutlet", accessorKey: "defaultOutlet", header: "Default outlet", cell: ({ row }) => row.original.defaultOutlet ?? "" },
    { id: "outlets", accessorFn: (row) => row.outlets.length, header: "Outlet access", cell: ({ row }) => row.original.outlets.join(", ") || "None" },
    { id: "posRoles", accessorFn: (row) => row.posRoles.join(", "), header: "POS role", cell: ({ row }) => row.original.posRoles.join(", ") || <span className="text-text-muted">No POS role</span> },
    { id: "isActive", accessorKey: "isActive", header: "Status", cell: ({ row }) => <StatusBadge tone={row.original.isActive ? "success" : "neutral"}>{row.original.isActive ? "Active" : "Inactive"}</StatusBadge> },
    { id: "operationalState", accessorKey: "operationalState", header: "Now", cell: ({ row }) => <StatusBadge tone={STATE_TONE[row.original.operationalState]}>{STATE_LABEL[row.original.operationalState]}</StatusBadge> },
    { id: "currentOutlet", accessorKey: "currentOutlet", header: "Current outlet", cell: ({ row }) => row.original.currentOutlet ?? "" },
    { id: "currentTerminal", accessorKey: "currentTerminal", header: "Current terminal", cell: ({ row }) => row.original.currentTerminal ?? "" },
    { id: "currentSession", accessorKey: "currentSession", header: "Current session", cell: ({ row }) => row.original.currentSession ?? "" },
    { id: "lastActivity", accessorKey: "lastActivity", header: "Last activity", cell: ({ row }) => (row.original.lastActivity ? formatDateTime(row.original.lastActivity) : "") },
  ] satisfies ColumnDef<Cashier, unknown>[], []);

  if (list.isError && errorCode(list.error) === "PERMISSION_DENIED") return <PermissionState title="You don't have access to cashiers" description="Ask an administrator for access." />;
  const opts = options.data;
  const filterBar = filterBarOf([
    { id: "outlet", active: outletId !== ANY, label: `Outlet: ${optionLabel(opts?.outlets, outletId)}`, clear: () => setOutletId(ANY) },
    { id: "role", active: role !== ANY, label: `Role: ${role}`, clear: () => setRole(ANY) },
  ], paged.resetPage);
  const filtered = Boolean(submitted) || Boolean(filterBar) || view !== "all";
  const create = () => router.push(`${CASHIERS_BASE}/new`);

  return (
    <EnterpriseListPage
      header={{
        title: "Cashiers",
        description: "The people who operate POS: a profile over their workspace user, with the outlets they may work at. Their POS role decides what they may do.",
        primaryAction: can?.create ? <Button variant="primary" onPress={create}><Plus className="size-4" aria-hidden="true" />New cashier</Button> : undefined,
      }}
      savedViews={{ views: VIEWS, activeViewId: view, onSelect: (id) => { setView(id); paged.resetPage(); } }}
      actionBar={{
        start: (
          <>
            <SearchField aria-label="Search cashiers" placeholder="Search name, code, email or employee number" className="w-full sm:w-80" value={search} onChange={setSearch} />
            <Select aria-label="Outlet" size="compact" selectedKey={outletId} onSelectionChange={(key) => setOutletId(String(key))}
              options={[{ value: ANY, label: "Any outlet" }, ...(opts?.outlets ?? []).map((entry) => ({ value: entry.id, label: entry.label }))]} />
            <Select aria-label="POS role" size="compact" selectedKey={role} onSelectionChange={(key) => setRole(String(key))}
              options={[{ value: ANY, label: "Any POS role" }, ...(opts?.roles ?? []).map((name) => ({ value: name, label: name }))]} />
          </>
        ),
      }}
      filterBar={filterBar}
    >
      <EnterpriseDataGrid<Cashier>
        aria-label="Cashiers"
        columns={columns}
        data={paged.pageRows}
        getRowId={(row) => row.id}
        state={list.isLoading ? "loading" : list.isError ? "error" : rows.length === 0 ? (filtered ? "no-results" : "empty") : "ready"}
        loadingContent={<LoadingState label="Loading cashiers" rows={6} />}
        errorContent={<ErrorState title="Could not load cashiers" description={errorMessage(list.error)} action={{ label: "Try again", onPress: () => void list.refetch() }} />}
        emptyContent={<EmptyState title="No cashiers yet" description="Give the people who sell at your outlets a cashier profile. They sign in with their own workspace account."
          action={can?.create ? { label: "New cashier", onPress: create } : undefined} />}
        noResultsContent={<NoResultsState title="No cashiers match" description="Try another view, search or filter." />}
        {...paged.grid}
        onRowClick={(row) => router.push(`${CASHIERS_BASE}/${row.id}`)}
        renderMobileCard={(row) => (
          <div className="flex flex-col gap-1">
            <span className="flex items-center justify-between gap-2"><span className="font-medium">{row.code} · {row.name}</span>
              <StatusBadge tone={STATE_TONE[row.operationalState]}>{STATE_LABEL[row.operationalState]}</StatusBadge></span>
            <span className="text-xs text-text-muted">{[row.outlets.join(", "), row.currentTerminal].filter(Boolean).join(" · ")}</span>
          </div>
        )}
      />
    </EnterpriseListPage>
  );
}
