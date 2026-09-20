"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShoppingCart } from "lucide-react";
import { Button, ErrorState, MetricStrip, NumberField, PageHeader, PermissionState, Select, StatusBadge, TextField, type SelectOption } from "@vercentlabs/design-system";
import { POS_PERMISSIONS } from "@vercentlabs/permissions";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { PosApiError } from "@/features/pos/shared/http";
import { listPosStores } from "@/features/pos/stores/api/stores-api";
import { listPosTerminals } from "@/features/pos/terminals/api/terminals-api";
import {
  closePosShift,
  getPosDashboard,
  listPosCashMovements,
  listPosShifts,
  openPosShift,
  recordPosCashMovement,
} from "@/features/pos/overview/api/overview-api";
import { money } from "@/features/pos/shared/format";
import { PosAlert, PosFacts, PosLoading, PosPanel } from "@/features/pos/shared/PosUi";

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
  const [movementIdempotencyKey, setMovementIdempotencyKey] = useState(() => crypto.randomUUID());
  const [openShiftIdempotencyKey, setOpenShiftIdempotencyKey] = useState(() => crypto.randomUUID());
  const [error, setError] = useState<string | null>(null);

  const dashboardQuery = useQuery({ queryKey: scopedQueryKey(workspace, "pos", "dashboard"), queryFn: getPosDashboard });
  const storesQuery = useQuery({ queryKey: scopedQueryKey(workspace, "pos", "stores"), queryFn: listPosStores });
  const terminalsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "pos", "terminals"), queryFn: listPosTerminals });
  const shiftsQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "pos", "shifts", "my-open"),
    queryFn: () => listPosShifts({ status: "open", cashierUserId: workspace.userId }),
  });

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
    // F301: a client retry (network blip, double-tap) now safely replays
    // the original shift-open response instead of hitting a raw
    // unique-constraint error — same reserve-then-complete idempotency
    // contract as recordPosCashMovement below. The key rotates only after
    // a genuinely new attempt succeeds or the store/terminal selection
    // changes, never on every render.
    mutationFn: () => openPosShift({ storeId, terminalId, openingCash, idempotencyKey: openShiftIdempotencyKey }),
    onSuccess: () => {
      setError(null);
      setOpenShiftIdempotencyKey(crypto.randomUUID());
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
    mutationFn: () => recordPosCashMovement(myOpenShift!.id, { movementType, amount: movementAmount, reason: movementReason, idempotencyKey: movementIdempotencyKey }),
    onSuccess: () => {
      setError(null);
      setMovementAmount(0);
      setMovementReason("");
      setMovementIdempotencyKey(crypto.randomUUID());
      queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "pos", "cash-movements", myOpenShift?.id) });
    },
    onError: (err) => setError(err instanceof PosApiError ? err.message : "The cash movement could not be recorded."),
  });

  const shiftNumber = (myOpenShift as { shift_number?: string } | undefined)?.shift_number;
  const openingCashValue = (myOpenShift as { opening_cash?: string } | undefined)?.opening_cash;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Point of Sale"
        description="Open a shift to start ringing up sales, or resume checkout if a shift is already open."
        primaryAction={
          myOpenShift ? (
            <Button variant="primary" onPress={() => router.push("/pos/checkout")}>
              <ShoppingCart className="size-4" aria-hidden="true" />
              Go to checkout
            </Button>
          ) : undefined
        }
      />

      {error && <PosAlert>{error}</PosAlert>}

      <MetricStrip
        metrics={[
          { label: "Sales today", value: dashboardQuery.data?.sales_today ?? "—" },
          { label: "Revenue today", value: dashboardQuery.data ? money("", dashboardQuery.data.revenue_today) : "—" },
          { label: "Open shifts", value: dashboardQuery.data?.open_shifts ?? "—" },
          { label: "Returns today", value: dashboardQuery.data?.returns_today ?? "—" },
        ]}
      />

      {dashboardQuery.isError && <ErrorState title="Could not load the POS dashboard" description="Check your connection and try again." action={{ label: "Retry", onPress: () => dashboardQuery.refetch() }} />}

      {shiftsQuery.isLoading ? (
        <PosLoading label="Checking your shift…" />
      ) : myOpenShift ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <PosPanel
            title="Current shift"
            description="Your open shift on this terminal."
            actions={<StatusBadge tone="info">Open</StatusBadge>}
          >
            <PosFacts
              columns={2}
              items={[
                { label: "Shift number", value: shiftNumber ?? "—" },
                { label: "Opening cash", value: money("", openingCashValue) },
              ]}
            />
            {canCloseShift && (
              <div className="flex flex-col gap-3 border-t border-border pt-4">
                <p className="text-sm font-medium text-text">Close this shift</p>
                <NumberField label="Counted cash" value={countedCash} onChange={setCountedCash} minValue={0} step={0.01} />
                <div>
                  <Button variant="secondary" onPress={() => closeMutation.mutate()} isLoading={closeMutation.isPending}>
                    Close shift
                  </Button>
                </div>
              </div>
            )}
          </PosPanel>

          {canAdjustCash && (
            <PosPanel title="Cash paid in / out" description="Record cash added to or taken from the drawer during this shift.">
              <div className="flex flex-wrap items-end gap-3">
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
              <div>
                <Button
                  variant="secondary"
                  onPress={() => cashMovementMutation.mutate()}
                  isLoading={cashMovementMutation.isPending}
                  isDisabled={movementAmount <= 0 || !movementReason.trim()}
                >
                  Record movement
                </Button>
              </div>
              {(cashMovementsQuery.data?.rows.length ?? 0) > 0 && (
                <ul className="flex flex-col divide-y divide-border rounded-[var(--radius-control)] border border-border text-sm">
                  {cashMovementsQuery.data!.rows.map((movement) => (
                    <li key={movement.id} className="flex items-center justify-between gap-3 px-3 py-2">
                      <span className="capitalize text-text-secondary">
                        {movement.movement_type.replace("_", " ")} — {movement.reason}
                      </span>
                      <span className="tabular-nums text-text">{money("", movement.amount)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </PosPanel>
          )}
        </div>
      ) : canOpenShift ? (
        <PosPanel title="Open a shift" description="Choose the store and terminal you are selling from, and count the opening cash in the drawer." className="max-w-2xl">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Select
              label="Store"
              options={storeOptions}
              selectedKey={storeId || null}
              onSelectionChange={(key) => {
                setStoreId(String(key ?? ""));
                setTerminalId("");
              }}
              placeholder="Select a store"
            />
            <Select
              label="Terminal"
              options={terminalOptions}
              selectedKey={terminalId || null}
              onSelectionChange={(key) => setTerminalId(String(key ?? ""))}
              placeholder="Select a terminal"
              isDisabled={!storeId}
            />
          </div>
          <NumberField label="Opening cash" value={openingCash} onChange={setOpeningCash} minValue={0} step={0.01} className="sm:max-w-xs" />
          <div>
            <Button variant="primary" onPress={() => openMutation.mutate()} isDisabled={!storeId || !terminalId} isLoading={openMutation.isPending}>
              Open shift
            </Button>
          </div>
        </PosPanel>
      ) : (
        <PermissionState title="No shift is open for you" description="You are not authorized to open one. Ask a supervisor to open a shift." />
      )}
    </div>
  );
}
