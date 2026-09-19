"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import {
  Button,
  Dialog,
  EnterpriseDataGrid,
  EnterpriseListPage,
  ErrorState,
  NoResultsState,
  NumberField,
  PermissionState,
  Select,
  StatusBadge,
  type ActiveFilter,
  type SelectOption,
} from "@vercentlabs/design-system";
import { POS_PERMISSIONS } from "@vercentlabs/permissions";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { PosApiError } from "@/features/pos/shared/http";
import { listPosEligibleCashiers } from "@/features/pos/cashiers/api/cashiers-api";
import { listPosStores } from "@/features/pos/stores/api/stores-api";
import { listPosTerminals } from "@/features/pos/terminals/api/terminals-api";
import { openPosShift, listPosShiftsPage, type PosShift, type PosShiftFilters } from "@/features/pos/shifts/api/shifts-api";
import { money } from "@/features/pos/shared/format";

const PAGE_SIZE = 25;

const statusTone: Record<string, "success" | "info"> = { open: "info", closed: "success" };

// F301/F302: shift HISTORY across stores/terminals/cashiers -- the
// overview dashboard only ever shows "my current shift." A plain cashier
// (nobody with shift-close/cash-adjust/store-manage authority) has no
// business browsing every other cashier's shift, so their own view is
// pinned to just their own shifts; a manager sees and filters across
// everyone the same way the day-end-reports workspace lets them filter
// across stores.
export function PosShiftsScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const workspace = useWorkspaceContext();
  const isManager =
    workspace.roleSlugs.includes("organization_owner") ||
    workspace.permissions.includes(POS_PERMISSIONS.shiftClose) ||
    workspace.permissions.includes(POS_PERMISSIONS.cashAdjust) ||
    workspace.permissions.includes(POS_PERMISSIONS.storeManage) ||
    workspace.permissions.includes(POS_PERMISSIONS.terminalManage);
  const canOpenShift = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes(POS_PERMISSIONS.shiftOpen);

  const [filters, setFilters] = useState<PosShiftFilters>(() => ({
    limit: PAGE_SIZE,
    offset: 0,
    cashierUserId: isManager ? undefined : workspace.userId,
  }));
  const [openDialog, setOpenDialog] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  const [storeId, setStoreId] = useState("");
  const [terminalId, setTerminalId] = useState("");
  const [openingCash, setOpeningCash] = useState(0);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  const storesQuery = useQuery({ queryKey: scopedQueryKey(workspace, "pos", "stores"), queryFn: listPosStores });
  const terminalsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "pos", "terminals"), queryFn: listPosTerminals });
  const cashiersQuery = useQuery({ queryKey: scopedQueryKey(workspace, "pos", "cashiers"), queryFn: listPosEligibleCashiers, enabled: isManager });

  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "pos", "shifts-page", filters),
    queryFn: () => listPosShiftsPage(filters),
    placeholderData: (previous) => previous,
  });

  function updateFilter<K extends keyof PosShiftFilters>(key: K, value: PosShiftFilters[K]) {
    setFilters((current) => ({ ...current, [key]: value, offset: 0 }));
  }

  const storeOptions: SelectOption[] = useMemo(() => (storesQuery.data?.rows ?? []).map((s) => ({ value: s.id, label: `${s.name} (${s.code})` })), [storesQuery.data]);
  const terminalOptions: SelectOption[] = useMemo(
    () =>
      (terminalsQuery.data?.rows ?? [])
        .filter((t) => !storeId || (t.storeId ?? t.store_id) === storeId)
        .map((t) => ({ value: t.id, label: `${t.name} (${t.code})` })),
    [terminalsQuery.data, storeId],
  );
  const filterTerminalOptions: SelectOption[] = useMemo(
    () =>
      (terminalsQuery.data?.rows ?? [])
        .filter((t) => !filters.storeId || (t.storeId ?? t.store_id) === filters.storeId)
        .map((t) => ({ value: t.id, label: `${t.name} (${t.code})` })),
    [terminalsQuery.data, filters.storeId],
  );
  const cashierOptions: SelectOption[] = useMemo(() => (cashiersQuery.data?.rows ?? []).map((c) => ({ value: c.id, label: c.fullName })), [cashiersQuery.data]);
  const storeNameById = useMemo(() => new Map((storesQuery.data?.rows ?? []).map((s) => [s.id, s.name])), [storesQuery.data]);
  const terminalNameById = useMemo(() => new Map((terminalsQuery.data?.rows ?? []).map((t) => [t.id, t.name])), [terminalsQuery.data]);
  const cashierNameById = useMemo(() => new Map((cashiersQuery.data?.rows ?? []).map((c) => [c.id, c.fullName])), [cashiersQuery.data]);

  const openMutation = useMutation({
    // F301: same reserve-then-complete idempotency contract as the
    // overview dashboard's own quick "open a shift" action -- a client
    // retry safely replays the original response instead of surfacing a
    // raw unique-constraint error.
    mutationFn: () => openPosShift({ storeId, terminalId, openingCash, idempotencyKey }),
    onSuccess: (result) => {
      setOpenError(null);
      setOpenDialog(false);
      setStoreId("");
      setTerminalId("");
      setOpeningCash(0);
      setIdempotencyKey(crypto.randomUUID());
      queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "pos", "shifts-page") });
      queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "pos", "shifts") });
      router.push(`/pos/shifts/${result.shift.id}`);
    },
    onError: (err) => setOpenError(err instanceof PosApiError ? err.message : "The shift could not be opened."),
  });

  const rows = query.data?.rows ?? [];
  const total = query.data?.total ?? 0;
  const pageIndex = Math.floor((filters.offset ?? 0) / PAGE_SIZE);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const activeFilters: ActiveFilter[] = useMemo(() => {
    const active: ActiveFilter[] = [];
    if (filters.storeId) active.push({ id: "storeId", label: `Store: ${storeNameById.get(filters.storeId) ?? filters.storeId}` });
    if (filters.terminalId) active.push({ id: "terminalId", label: `Terminal: ${terminalNameById.get(filters.terminalId) ?? filters.terminalId}` });
    if (filters.status) active.push({ id: "status", label: `Status: ${filters.status}` });
    if (isManager && filters.cashierUserId) active.push({ id: "cashierUserId", label: `Cashier: ${cashierNameById.get(filters.cashierUserId) ?? filters.cashierUserId}` });
    if (filters.dateFrom) active.push({ id: "dateFrom", label: `From: ${filters.dateFrom}` });
    if (filters.dateTo) active.push({ id: "dateTo", label: `To: ${filters.dateTo}` });
    return active;
  }, [filters, isManager, storeNameById, terminalNameById, cashierNameById]);

  const columns: ColumnDef<PosShift, unknown>[] = useMemo(
    () => [
      { id: "shift_number", header: "Shift #", accessorKey: "shift_number", cell: ({ row }) => <span className="font-mono font-medium text-text">{row.original.shift_number}</span> },
      { id: "store", header: "Store", accessorFn: (row) => storeNameById.get(row.store_id) ?? row.store_id },
      { id: "terminal", header: "Terminal", accessorFn: (row) => terminalNameById.get(row.terminal_id) ?? row.terminal_id },
      { id: "cashier", header: "Cashier", accessorFn: (row) => cashierNameById.get(row.cashier_user_id) ?? row.cashier_user_id },
      { id: "status", header: "Status", cell: ({ row }) => <StatusBadge tone={statusTone[row.original.status] ?? "neutral"}>{row.original.status}</StatusBadge> },
      { id: "opening_cash", header: "Opening cash", accessorFn: (row) => money("", row.opening_cash) },
      { id: "counted_cash", header: "Counted cash", accessorFn: (row) => (row.counted_cash != null ? money("", row.counted_cash) : "—") },
      {
        id: "cash_variance",
        header: "Variance",
        cell: ({ row }) =>
          row.original.cash_variance != null ? (
            <span className={Number(row.original.cash_variance) === 0 ? "text-text" : "font-medium text-danger"}>{money("", row.original.cash_variance)}</span>
          ) : (
            "—"
          ),
      },
      { id: "opened_at", header: "Opened", accessorFn: (row) => new Date(row.opened_at).toLocaleString() },
      { id: "closed_at", header: "Closed", accessorFn: (row) => (row.closed_at ? new Date(row.closed_at).toLocaleString() : "—") },
    ],
    [storeNameById, terminalNameById, cashierNameById],
  );

  const gridState = query.isLoading
    ? "loading"
    : query.isError && query.error instanceof PosApiError && query.error.status === 403
      ? "permission-denied"
      : query.isError
        ? "error"
        : rows.length === 0
          ? "empty"
          : "ready";

  return (
    <>
      <EnterpriseListPage
        header={{
          title: "Shifts",
          description: isManager
            ? "Every cashier shift across your accessible stores and terminals -- opening balance, cash movements, and close variance."
            : "Your own shift history -- opening balance, cash movements, and close variance.",
          primaryAction: canOpenShift ? (
            <Button variant="primary" onPress={() => setOpenDialog(true)}>
              <Plus className="size-4" aria-hidden="true" />
              Open shift
            </Button>
          ) : undefined,
        }}
        actionBar={{
          start: (
            <>
              <Select
                aria-label="Store"
                size="compact"
                options={[{ value: "", label: "Any store" }, ...storeOptions]}
                selectedKey={filters.storeId ?? ""}
                onSelectionChange={(key) => updateFilter("storeId", key ? String(key) : undefined)}
              />
              <Select
                aria-label="Terminal"
                size="compact"
                options={[{ value: "", label: "Any terminal" }, ...filterTerminalOptions]}
                selectedKey={filters.terminalId ?? ""}
                onSelectionChange={(key) => updateFilter("terminalId", key ? String(key) : undefined)}
              />
              <Select
                aria-label="Status"
                size="compact"
                options={[
                  { value: "", label: "Any status" },
                  { value: "open", label: "Open" },
                  { value: "closed", label: "Closed" },
                ]}
                selectedKey={filters.status ?? ""}
                onSelectionChange={(key) => updateFilter("status", key ? String(key) : undefined)}
              />
              {isManager && (
                <Select
                  aria-label="Cashier"
                  size="compact"
                  options={[{ value: "", label: "Any cashier" }, ...cashierOptions]}
                  selectedKey={filters.cashierUserId ?? ""}
                  onSelectionChange={(key) => updateFilter("cashierUserId", key ? String(key) : undefined)}
                />
              )}
              <input
                type="date"
                aria-label="From date"
                value={filters.dateFrom ?? ""}
                onChange={(event) => updateFilter("dateFrom", event.target.value || undefined)}
                className="rounded-[var(--radius-control)] border border-border bg-surface px-3 py-1.5 text-sm text-text"
              />
              <input
                type="date"
                aria-label="To date"
                value={filters.dateTo ?? ""}
                onChange={(event) => updateFilter("dateTo", event.target.value || undefined)}
                className="rounded-[var(--radius-control)] border border-border bg-surface px-3 py-1.5 text-sm text-text"
              />
            </>
          ),
        }}
        filterBar={{
          filters: activeFilters,
          onRemove: (id) => updateFilter(id as keyof PosShiftFilters, undefined),
          onClearAll: activeFilters.length > 0 ? () => setFilters({ limit: PAGE_SIZE, offset: 0, cashierUserId: isManager ? undefined : workspace.userId }) : undefined,
        }}
      >
        <EnterpriseDataGrid<PosShift>
          aria-label="Shifts"
          columns={columns}
          data={rows}
          getRowId={(row) => row.id}
          onRowClick={(row) => router.push(`/pos/shifts/${row.id}`)}
          state={gridState}
          loadingContent={<p className="px-4 py-8 text-sm text-text-secondary">Loading shifts…</p>}
          emptyContent={<NoResultsState title="No shifts yet" description={canOpenShift ? "Open a shift to start ringing up sales." : "No shift has been opened yet."} />}
          errorContent={<ErrorState title="Could not load shifts" action={{ label: "Retry", onPress: () => query.refetch() }} />}
          permissionDeniedContent={<PermissionState title="You don't have access to Shifts" />}
          pageIndex={pageIndex}
          pageSize={PAGE_SIZE}
          pageCount={pageCount}
          totalRowCount={total}
          onPageChange={(nextIndex) => setFilters((current) => ({ ...current, offset: nextIndex * PAGE_SIZE }))}
        />
      </EnterpriseListPage>

      {openDialog && (
        <Dialog isOpen onOpenChange={(open) => !open && setOpenDialog(false)} title="Open a shift">
          <div className="flex flex-col gap-4">
            {openError && (
              <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">
                {openError}
              </p>
            )}
            <Select label="Store" options={storeOptions} value={storeId} onChange={(value) => { setStoreId(String(value ?? "")); setTerminalId(""); }} placeholder="Select a store" />
            <Select label="Terminal" options={terminalOptions} value={terminalId} onChange={(value) => setTerminalId(String(value ?? ""))} placeholder="Select a terminal" isDisabled={!storeId} />
            <NumberField label="Opening cash" value={openingCash} onChange={setOpeningCash} minValue={0} step={0.01} />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onPress={() => setOpenDialog(false)}>
                Cancel
              </Button>
              <Button variant="primary" onPress={() => openMutation.mutate()} isDisabled={!storeId || !terminalId} isLoading={openMutation.isPending}>
                Open shift
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </>
  );
}
