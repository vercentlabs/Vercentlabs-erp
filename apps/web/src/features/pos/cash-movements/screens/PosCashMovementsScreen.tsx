"use client";

import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import {
  Button,
  EnterpriseDataGrid,
  EnterpriseListPage,
  ErrorState,
  NoResultsState,
  NumberField,
  PermissionState,
  Select,
  TextField,
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
import { listPosShifts } from "@/features/pos/shifts/api/shifts-api";
import {
  listPosCashMovementHistory,
  recordPosCashMovement,
  type PosCashMovement,
  type PosCashMovementHistoryFilters,
} from "@/features/pos/cash-movements/api/cash-movements-api";
import { money } from "@/features/pos/shared/format";

const PAGE_SIZE = 25;
const MOVEMENT_TONE: Record<string, string> = { paid_in: "text-success", paid_out: "text-danger", opening: "text-text-secondary" };

// F300: paid-in/paid-out cash-movement audit trail across shifts, plus the
// current open shift's own running totals -- the overview dashboard's
// quick form only ever shows ITS shift's own movements; this workspace is
// the full history + create surface managers actually audit from.
export function PosCashMovementsScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const canAdjustCash = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes(POS_PERMISSIONS.cashAdjust);
  const isManager =
    workspace.roleSlugs.includes("organization_owner") ||
    workspace.permissions.includes(POS_PERMISSIONS.shiftClose) ||
    workspace.permissions.includes(POS_PERMISSIONS.storeManage) ||
    workspace.permissions.includes(POS_PERMISSIONS.terminalManage);

  const [filters, setFilters] = useState<PosCashMovementHistoryFilters>(() => ({
    limit: PAGE_SIZE,
    offset: 0,
    cashierUserId: isManager ? undefined : workspace.userId,
  }));
  const [movementType, setMovementType] = useState<"paid_in" | "paid_out">("paid_out");
  const [movementAmount, setMovementAmount] = useState(0);
  const [movementReason, setMovementReason] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [formError, setFormError] = useState<string | null>(null);

  const storesQuery = useQuery({ queryKey: scopedQueryKey(workspace, "pos", "stores"), queryFn: listPosStores });
  const terminalsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "pos", "terminals"), queryFn: listPosTerminals });
  const cashiersQuery = useQuery({ queryKey: scopedQueryKey(workspace, "pos", "cashiers"), queryFn: listPosEligibleCashiers, enabled: isManager });
  // Same "limit/offset only, filter client-side" convention the day-end-
  // reports screen already uses for its own shift lookup -- just enough
  // to label each movement row with its shift/store/terminal.
  const shiftsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "pos", "shifts-lookup"), queryFn: () => listPosShifts({ limit: 200 }) });

  const myOpenShift = useMemo(
    () => shiftsQuery.data?.rows.find((row) => row.status === "open" && row.cashier_user_id === workspace.userId),
    [shiftsQuery.data, workspace.userId],
  );

  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "pos", "cash-movement-history", filters),
    queryFn: () => listPosCashMovementHistory(filters),
    placeholderData: (previous) => previous,
  });

  const currentShiftMovementsQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "pos", "cash-movements", myOpenShift?.id),
    queryFn: () => listPosCashMovementHistory({ shiftId: myOpenShift!.id, limit: 200 }),
    enabled: Boolean(myOpenShift?.id) && canAdjustCash,
  });

  function updateFilter<K extends keyof PosCashMovementHistoryFilters>(key: K, value: PosCashMovementHistoryFilters[K]) {
    setFilters((current) => ({ ...current, [key]: value, offset: 0 }));
  }

  const storeOptions: SelectOption[] = useMemo(() => (storesQuery.data?.rows ?? []).map((s) => ({ value: s.id, label: `${s.name} (${s.code})` })), [storesQuery.data]);
  const terminalOptions: SelectOption[] = useMemo(
    () => (terminalsQuery.data?.rows ?? []).filter((t) => !filters.storeId || (t.storeId ?? t.store_id) === filters.storeId).map((t) => ({ value: t.id, label: `${t.name} (${t.code})` })),
    [terminalsQuery.data, filters.storeId],
  );
  const cashierOptions: SelectOption[] = useMemo(() => (cashiersQuery.data?.rows ?? []).map((c) => ({ value: c.id, label: c.fullName })), [cashiersQuery.data]);
  const storeNameById = useMemo(() => new Map((storesQuery.data?.rows ?? []).map((s) => [s.id, s.name])), [storesQuery.data]);
  const terminalNameById = useMemo(() => new Map((terminalsQuery.data?.rows ?? []).map((t) => [t.id, t.name])), [terminalsQuery.data]);
  const cashierNameById = useMemo(() => new Map((cashiersQuery.data?.rows ?? []).map((c) => [c.id, c.fullName])), [cashiersQuery.data]);
  const shiftById = useMemo(() => new Map((shiftsQuery.data?.rows ?? []).map((s) => [s.id, s])), [shiftsQuery.data]);

  const shiftLabel = useCallback((shiftId: string) => {
    const shift = shiftById.get(shiftId);
    if (!shift) return shiftId;
    const store = storeNameById.get(shift.store_id) ?? shift.store_id;
    const terminal = terminalNameById.get(shift.terminal_id) ?? shift.terminal_id;
    return `${shift.shift_number} · ${store} / ${terminal}`;
  }, [shiftById, storeNameById, terminalNameById]);

  const cashMovementMutation = useMutation({
    // F300: same reserve-then-complete idempotency contract as the
    // overview dashboard's own paid-in/paid-out form -- a client retry
    // (network blip, double-tap) safely replays the original movement
    // instead of double-posting it.
    mutationFn: () => recordPosCashMovement(myOpenShift!.id, { movementType, amount: movementAmount, reason: movementReason, idempotencyKey }),
    onSuccess: () => {
      setFormError(null);
      setMovementAmount(0);
      setMovementReason("");
      setIdempotencyKey(crypto.randomUUID());
      queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "pos", "cash-movements", myOpenShift?.id) });
      queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "pos", "cash-movement-history") });
    },
    onError: (err) => setFormError(err instanceof PosApiError ? err.message : "The cash movement could not be recorded."),
  });

  const rows = query.data?.rows ?? [];
  const total = query.data?.total ?? 0;
  const pageIndex = Math.floor((filters.offset ?? 0) / PAGE_SIZE);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const currentShiftMovements = currentShiftMovementsQuery.data?.rows ?? [];
  const paidInTotal = currentShiftMovements.filter((m) => m.movement_type === "paid_in").reduce((sum, m) => sum + Number(m.amount), 0);
  const paidOutTotal = currentShiftMovements.filter((m) => m.movement_type === "paid_out").reduce((sum, m) => sum + Math.abs(Number(m.amount)), 0);

  const activeFilters: ActiveFilter[] = useMemo(() => {
    const active: ActiveFilter[] = [];
    if (filters.storeId) active.push({ id: "storeId", label: `Store: ${storeNameById.get(filters.storeId) ?? filters.storeId}` });
    if (filters.terminalId) active.push({ id: "terminalId", label: `Terminal: ${terminalNameById.get(filters.terminalId) ?? filters.terminalId}` });
    if (filters.movementType) active.push({ id: "movementType", label: `Type: ${filters.movementType.replace("_", " ")}` });
    if (isManager && filters.cashierUserId) active.push({ id: "cashierUserId", label: `Cashier: ${cashierNameById.get(filters.cashierUserId) ?? filters.cashierUserId}` });
    if (filters.dateFrom) active.push({ id: "dateFrom", label: `From: ${filters.dateFrom}` });
    if (filters.dateTo) active.push({ id: "dateTo", label: `To: ${filters.dateTo}` });
    return active;
  }, [filters, isManager, storeNameById, terminalNameById, cashierNameById]);

  const columns: ColumnDef<PosCashMovement, unknown>[] = useMemo(
    () => [
      { id: "movement_number", header: "Movement #", accessorKey: "movement_number", cell: ({ row }) => <span className="font-mono font-medium text-text">{row.original.movement_number}</span> },
      { id: "movement_type", header: "Type", cell: ({ row }) => <span className={`capitalize ${MOVEMENT_TONE[row.original.movement_type] ?? "text-text"}`}>{row.original.movement_type.replace("_", " ")}</span> },
      { id: "reason", header: "Reason", accessorKey: "reason" },
      { id: "shift", header: "Shift", accessorFn: (row) => shiftLabel(row.shift_id) },
      { id: "cashier", header: "Recorded by", accessorFn: (row) => cashierNameById.get(row.created_by) ?? row.created_by },
      { id: "amount", header: "Amount", accessorFn: (row) => money("", row.amount) },
      { id: "created_at", header: "When", accessorFn: (row) => new Date(row.created_at).toLocaleString() },
    ],
    [cashierNameById, shiftLabel],
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
    <div className="flex flex-col gap-6">
      {canAdjustCash && myOpenShift && (
        <div className="flex flex-col gap-4 rounded-[var(--radius-panel)] border border-border-strong bg-surface p-5">
          <div>
            <h2 className="text-base font-semibold text-text">Current shift — {myOpenShift.shift_number}</h2>
            <p className="text-sm text-text-secondary">
              Paid in this shift: {money("", paidInTotal)} · Paid out this shift: {money("", paidOutTotal)}
            </p>
          </div>
          {formError && (
            <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">
              {formError}
            </p>
          )}
          <div className="flex flex-wrap items-end gap-2">
            <Select
              label="Type"
              size="compact"
              options={[
                { value: "paid_in", label: "Paid in" },
                { value: "paid_out", label: "Paid out" },
              ]}
              selectedKey={movementType}
              onSelectionChange={(key) => setMovementType(key === "paid_in" ? "paid_in" : "paid_out")}
            />
            <NumberField label="Amount" size="compact" value={movementAmount} onChange={setMovementAmount} minValue={0} step={0.01} />
            <TextField label="Reason" value={movementReason} onChange={setMovementReason} className="min-w-[220px] flex-1" />
            <Button
              variant="primary"
              onPress={() => cashMovementMutation.mutate()}
              isLoading={cashMovementMutation.isPending}
              isDisabled={movementAmount <= 0 || !movementReason.trim()}
            >
              Record movement
            </Button>
          </div>
        </div>
      )}

      <EnterpriseListPage
        header={{
          title: "Cash movement",
          description: isManager
            ? "Every paid-in / paid-out cash movement across your accessible stores and terminals, with shift and cashier attribution."
            : "Your own paid-in / paid-out cash movement history.",
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
                options={[{ value: "", label: "Any terminal" }, ...terminalOptions]}
                selectedKey={filters.terminalId ?? ""}
                onSelectionChange={(key) => updateFilter("terminalId", key ? String(key) : undefined)}
              />
              <Select
                aria-label="Movement type"
                size="compact"
                options={[
                  { value: "", label: "Any type" },
                  { value: "paid_in", label: "Paid in" },
                  { value: "paid_out", label: "Paid out" },
                  { value: "opening", label: "Opening float" },
                ]}
                selectedKey={filters.movementType ?? ""}
                onSelectionChange={(key) => updateFilter("movementType", key ? String(key) : undefined)}
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
          onRemove: (id) => updateFilter(id as keyof PosCashMovementHistoryFilters, undefined),
          onClearAll: activeFilters.length > 0 ? () => setFilters({ limit: PAGE_SIZE, offset: 0, cashierUserId: isManager ? undefined : workspace.userId }) : undefined,
        }}
      >
        <EnterpriseDataGrid<PosCashMovement>
          aria-label="Cash movements"
          columns={columns}
          data={rows}
          getRowId={(row) => row.id}
          state={gridState}
          loadingContent={<p className="px-4 py-8 text-sm text-text-secondary">Loading cash movements…</p>}
          emptyContent={<NoResultsState title="No cash movements yet" description="Paid-in / paid-out entries recorded during a shift will appear here." />}
          errorContent={<ErrorState title="Could not load cash movements" action={{ label: "Retry", onPress: () => query.refetch() }} />}
          permissionDeniedContent={<PermissionState title="You don't have access to Cash Movement" />}
          pageIndex={pageIndex}
          pageSize={PAGE_SIZE}
          pageCount={pageCount}
          totalRowCount={total}
          onPageChange={(nextIndex) => setFilters((current) => ({ ...current, offset: nextIndex * PAGE_SIZE }))}
        />
      </EnterpriseListPage>
    </div>
  );
}
