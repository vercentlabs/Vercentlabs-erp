"use client";

// POS Terminals: every checkout register across the outlets, with who is working on it now. Views: All, Active, Inactive, Session open,
// Available. The current session and cashier come from the open session, never from the terminal record.
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

import {
  STATE_LABEL, STATE_TONE, TERMINALS_BASE, errorCode, errorMessage, getTerminalOptions, listTerminals, type Terminal, type TerminalFilters,
} from "../api/terminals-api";

const ANY = "any";
const VIEWS = [
  { id: "all", label: "All" }, { id: "active", label: "Active" }, { id: "inactive", label: "Inactive" }, { id: "session_open", label: "Session open" },
  { id: "available", label: "Available" },
];
const sortValue = (row: Terminal, id: string) => (row as Record<string, unknown>)[id];

export function TerminalsScreen({ initialOutletId }: { initialOutletId?: string | null }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const [view, setView] = useState("all");
  const [search, setSearch] = useState("");
  const submitted = useDebouncedValue(search);
  const [outletId, setOutletId] = useState(initialOutletId ?? ANY);
  const [cash, setCash] = useState(ANY);
  const filters: TerminalFilters = Object.fromEntries(Object.entries({ view, search: submitted, outletId, cash }).filter(([, value]) => value && value !== ANY));
  const list = useQuery({ queryKey: scopedQueryKey(workspace, "pos-terminals", "list", filters), queryFn: () => listTerminals(filters), placeholderData: (previous) => previous });
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "pos-terminals", "options"), queryFn: getTerminalOptions, staleTime: 60_000 });
  const rows = useMemo(() => list.data?.terminals ?? [], [list.data]);
  const paged = usePagedRows(rows, { initialSorting: [{ id: "outlet", desc: false }], sortValue });
  const can = list.data?.capabilities ?? options.data?.capabilities;

  const columns = useMemo(() => [
    { id: "code", accessorKey: "code", header: "Code", cell: ({ row }) => <span className="font-medium tabular-nums">{row.original.code}</span> },
    { id: "name", accessorKey: "name", header: "Terminal", cell: ({ row }) => <span className="font-medium text-text">{row.original.name}</span> },
    { id: "outlet", accessorKey: "outlet", header: "Outlet", cell: ({ row }) => row.original.outlet ?? "" },
    { id: "isActive", accessorKey: "isActive", header: "Status", cell: ({ row }) => <StatusBadge tone={row.original.isActive ? "success" : "neutral"}>{row.original.isActive ? "Active" : "Inactive"}</StatusBadge> },
    { id: "operationalState", accessorKey: "operationalState", header: "Operational state", cell: ({ row }) => (
      <StatusBadge tone={STATE_TONE[row.original.operationalState]}>{STATE_LABEL[row.original.operationalState]}</StatusBadge>
    ) },
    { id: "currentCashier", accessorKey: "currentCashier", header: "Current cashier", cell: ({ row }) => row.original.currentCashier ?? "" },
    { id: "currentSession", accessorKey: "currentSession", header: "Current session", cell: ({ row }) => row.original.currentSession ?? "" },
    { id: "cashManagementEnabled", accessorKey: "cashManagementEnabled", header: "Cash", cell: ({ row }) => (row.original.cashManagementEnabled ? "Yes" : "No") },
    { id: "lastActivity", accessorKey: "lastActivity", header: "Last activity", cell: ({ row }) => (row.original.lastActivity ? formatDateTime(row.original.lastActivity) : "") },
  ] satisfies ColumnDef<Terminal, unknown>[], []);

  if (list.isError && errorCode(list.error) === "PERMISSION_DENIED") return <PermissionState title="You don't have access to POS terminals" description="Ask an administrator for access." />;
  const opts = options.data;
  const filterBar = filterBarOf([
    { id: "outlet", active: outletId !== ANY, label: `Outlet: ${optionLabel(opts?.outlets, outletId)}`, clear: () => setOutletId(ANY) },
    { id: "cash", active: cash !== ANY, label: cash === "yes" ? "Handles cash" : "No cash", clear: () => setCash(ANY) },
  ], paged.resetPage);
  const filtered = Boolean(submitted) || Boolean(filterBar) || view !== "all";
  const create = () => router.push(`${TERMINALS_BASE}/new${outletId !== ANY ? `?outletId=${outletId}` : ""}`);

  return (
    <EnterpriseListPage
      header={{
        title: "POS Terminals",
        description: "The checkout registers at each outlet. A terminal sells from its outlet's warehouse; one session at a time.",
        primaryAction: can?.create ? <Button variant="primary" onPress={create}><Plus className="size-4" aria-hidden="true" />New terminal</Button> : undefined,
      }}
      savedViews={{ views: VIEWS, activeViewId: view, onSelect: (id) => { setView(id); paged.resetPage(); } }}
      actionBar={{
        start: (
          <>
            <SearchField aria-label="Search terminals" placeholder="Search code, name or outlet" className="w-full sm:w-72" value={search} onChange={setSearch} />
            <Select aria-label="Outlet" size="compact" selectedKey={outletId} onSelectionChange={(key) => setOutletId(String(key))}
              options={[{ value: ANY, label: "Any outlet" }, ...(opts?.outlets ?? []).map((entry) => ({ value: entry.id, label: entry.label }))]} />
            <Select aria-label="Cash" size="compact" selectedKey={cash} onSelectionChange={(key) => setCash(String(key))}
              options={[{ value: ANY, label: "Cash or not" }, { value: "yes", label: "Handles cash" }, { value: "no", label: "No cash" }]} />
          </>
        ),
      }}
      filterBar={filterBar}
    >
      <EnterpriseDataGrid<Terminal>
        aria-label="POS terminals"
        columns={columns}
        data={paged.pageRows}
        getRowId={(row) => row.id}
        state={list.isLoading ? "loading" : list.isError ? "error" : rows.length === 0 ? (filtered ? "no-results" : "empty") : "ready"}
        loadingContent={<LoadingState label="Loading terminals" rows={6} />}
        errorContent={<ErrorState title="Could not load terminals" description={errorMessage(list.error)} action={{ label: "Try again", onPress: () => void list.refetch() }} />}
        emptyContent={<EmptyState title="No terminals yet" description="Add the counters each outlet sells from, such as T01 — Counter 1."
          action={can?.create ? { label: "New terminal", onPress: create } : undefined} />}
        noResultsContent={<NoResultsState title="No terminals match" description="Try another view, search or filter." />}
        {...paged.grid}
        onRowClick={(row) => router.push(`${TERMINALS_BASE}/${row.id}`)}
        renderMobileCard={(row) => (
          <div className="flex flex-col gap-1">
            <span className="flex items-center justify-between gap-2"><span className="font-medium">{row.code} · {row.name}</span>
              <StatusBadge tone={STATE_TONE[row.operationalState]}>{STATE_LABEL[row.operationalState]}</StatusBadge></span>
            <span className="text-xs text-text-muted">{[row.outlet, row.currentCashier].filter(Boolean).join(" · ")}</span>
          </div>
        )}
      />
    </EnterpriseListPage>
  );
}
