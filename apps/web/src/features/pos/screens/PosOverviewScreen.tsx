"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, ErrorState, NumberField, Select, TextField, type SelectOption } from "@vercentlabs/design-system";
import { POS_PERMISSIONS } from "@vercentlabs/permissions";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import {
  closePosShift,
  getPosDashboard,
  listPosCashMovements,
  listPosShifts,
  listPosStores,
  listPosTerminals,
  openPosShift,
  PosApiError,
  recordPosCashMovement,
} from "@/features/pos/shared/pos-api";
import { money } from "@/features/pos/shared/format";

export function PosOverviewScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const queryClient = useQueryClient();
  const canOpenShift = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes(POS_PERMISSIONS.shiftOpen);
  const canCloseShift = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes(POS_PERMISSIONS.shiftClose);

  const canAdjustCash = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes(POS_PERMISSIONS.cashAdjust);

  const [storeId, setStoreId] = useState("");
  const [terminalId, setTerminalId] = useState("");
  const [openingCash, setOpeningCash] = useState(0);
  const [countedCash, setCountedCash] = useState(0);
  const [movementType, setMovementType] = useState<"paid_in" | "paid_out">("paid_out");
  const [movementAmount, setMovementAmount] = useState(0);
  const [movementReason, setMovementReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const dashboardQuery = useQuery({ queryKey: scopedQueryKey(workspace, "pos", "dashboard"), queryFn: getPosDashboard });
  const storesQuery = useQuery({ queryKey: scopedQueryKey(workspace, "pos", "stores"), queryFn: listPosStores });
  const terminalsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "pos", "terminals"), queryFn: listPosTerminals });
  const shiftsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "pos", "shifts"), queryFn: () => listPosShifts() });

  const myOpenShift = useMemo(
    () => shiftsQuery.data?.rows.find((row) => (row as { status: string; cashier_user_id?: string }).status === "open" && (row as { cashier_user_id?: string }).cashier_user_id === workspace.userId),
    [shiftsQuery.data, workspace.userId],
  );

  const cashMovementsQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "pos", "cash-movements", myOpenShift?.id),
    queryFn: () => listPosCashMovements(myOpenShift!.id),
    enabled: Boolean(myOpenShift?.id) && canAdjustCash,
  });

  const storeOptions: SelectOption[] = useMemo(
    () => (storesQuery.data?.rows ?? []).filter((s) => s.active).map((s) => ({ value: s.id, label: `${s.name} (${s.code})` })),
    [storesQuery.data],
  );
  const terminalOptions: SelectOption[] = useMemo(
    () =>
      (terminalsQuery.data?.rows ?? [])
        .filter((t) => (t.storeId ?? t.store_id) === storeId && t.status === "active")
        .map((t) => ({ value: t.id, label: `${t.name} (${t.code})` })),
    [terminalsQuery.data, storeId],
  );

  const openMutation = useMutation({
    mutationFn: () => openPosShift({ storeId, terminalId, openingCash }),
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "pos", "shifts") });
    },
    onError: (err) => setError(err instanceof PosApiError ? err.message : "The shift could not be opened."),
  });

  const closeMutation = useMutation({
    mutationFn: () => closePosShift(myOpenShift!.id, { countedCash }),
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "pos", "shifts") });
    },
    onError: (err) => setError(err instanceof PosApiError ? err.message : "The shift could not be closed."),
  });

  const cashMovementMutation = useMutation({
    mutationFn: () => recordPosCashMovement(myOpenShift!.id, { movementType, amount: movementAmount, reason: movementReason }),
    onSuccess: () => {
      setError(null);
      setMovementAmount(0);
      setMovementReason("");
      queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "pos", "cash-movements", myOpenShift?.id) });
    },
    onError: (err) => setError(err instanceof PosApiError ? err.message : "The cash movement could not be recorded."),
  });

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold text-text">Point of Sale</h1>
        <p className="text-sm text-text-secondary">Open a shift to start ringing up sales, or resume checkout if a shift is already open.</p>
      </div>

      {error && (
        <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        {[
          { label: "Sales today", value: dashboardQuery.data?.sales_today ?? "—" },
          { label: "Revenue today", value: dashboardQuery.data ? money("", dashboardQuery.data.revenue_today) : "—" },
          { label: "Open shifts", value: dashboardQuery.data?.open_shifts ?? "—" },
          { label: "Returns today", value: dashboardQuery.data?.returns_today ?? "—" },
        ].map((stat) => (
          <div key={stat.label} className="rounded-[var(--radius-panel)] border border-border-strong bg-surface p-4">
            <p className="text-xs text-text-muted">{stat.label}</p>
            <p className="mt-1 text-xl font-semibold text-text">{stat.value}</p>
          </div>
        ))}
      </div>

      {dashboardQuery.isError && <ErrorState title="Could not load the POS dashboard" description="Check your connection and try again." />}

      {myOpenShift ? (
        <div className="flex flex-col gap-4 rounded-[var(--radius-panel)] border border-border-strong bg-surface p-5">
          <div>
            <h2 className="text-base font-semibold text-text">Shift open — {(myOpenShift as { shift_number?: string }).shift_number}</h2>
            <p className="text-sm text-text-secondary">Opening cash: {money("", (myOpenShift as { opening_cash?: string }).opening_cash)}</p>
          </div>
          <Button variant="primary" onPress={() => router.push("/pos/checkout")}>
            Go to checkout
          </Button>
          {canAdjustCash && (
            <div className="flex flex-col gap-2 border-t border-border pt-4">
              <p className="text-sm font-medium text-text">Cash paid in / out</p>
              <div className="flex items-end gap-2">
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
              </div>
              <TextField label="Reason" value={movementReason} onChange={setMovementReason} />
              <Button
                variant="secondary"
                onPress={() => cashMovementMutation.mutate()}
                isLoading={cashMovementMutation.isPending}
                isDisabled={movementAmount <= 0 || !movementReason.trim()}
              >
                Record movement
              </Button>
              {(cashMovementsQuery.data?.rows.length ?? 0) > 0 && (
                <ul className="mt-1 flex flex-col divide-y divide-border rounded-[var(--radius-control)] border border-border text-xs">
                  {cashMovementsQuery.data!.rows.map((movement) => (
                    <li key={movement.id} className="flex items-center justify-between px-2 py-1.5">
                      <span className="capitalize text-text-secondary">
                        {movement.movement_type.replace("_", " ")} — {movement.reason}
                      </span>
                      <span className="tabular-nums text-text">{money("", movement.amount)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {canCloseShift && (
            <div className="flex flex-col gap-2 border-t border-border pt-4">
              <p className="text-sm font-medium text-text">Close this shift</p>
              <NumberField label="Counted cash" value={countedCash} onChange={setCountedCash} minValue={0} step={0.01} />
              <Button variant="secondary" onPress={() => closeMutation.mutate()} isLoading={closeMutation.isPending}>
                Close shift
              </Button>
            </div>
          )}
        </div>
      ) : canOpenShift ? (
        <div className="flex flex-col gap-4 rounded-[var(--radius-panel)] border border-border-strong bg-surface p-5">
          <h2 className="text-base font-semibold text-text">Open a shift</h2>
          <Select label="Store" options={storeOptions} value={storeId} onChange={(value) => { setStoreId(String(value ?? "")); setTerminalId(""); }} placeholder="Select a store" />
          <Select label="Terminal" options={terminalOptions} value={terminalId} onChange={(value) => setTerminalId(String(value ?? ""))} placeholder="Select a terminal" isDisabled={!storeId} />
          <NumberField label="Opening cash" value={openingCash} onChange={setOpeningCash} minValue={0} step={0.01} />
          <Button variant="primary" onPress={() => openMutation.mutate()} isDisabled={!storeId || !terminalId} isLoading={openMutation.isPending}>
            Open shift
          </Button>
        </div>
      ) : (
        <p className="text-sm text-text-secondary">No shift is currently open for you, and you are not authorized to open one. Ask a supervisor to open a shift.</p>
      )}
    </div>
  );
}
