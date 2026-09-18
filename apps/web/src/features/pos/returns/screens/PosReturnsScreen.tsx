"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { ArrowLeftRight, Check, Plus, RotateCcw } from "lucide-react";
import { Button, Checkbox, Dialog, EnterpriseDataGrid, EnterpriseListPage, NumberField, PermissionState, StatusBadge, TextField } from "@vercentlabs/design-system";
import { POS_PERMISSIONS } from "@vercentlabs/permissions";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { PosApiError } from "@/features/pos/shared/http";
import {
  approvePosReturn,
  completePosReturn,
  createPosReturn,
  findPosSaleForReturn,
  listPosReturns,
  type PosReturn,
  type PosReturnSale,
  type PosReturnSaleLine,
} from "@/features/pos/returns/api/returns-api";
import { money } from "@/features/pos/shared/format";

const STATUS_TONE: Record<PosReturn["status"], "success" | "warning" | "neutral" | "danger"> = {
  pending_approval: "warning",
  approved: "neutral",
  completed: "success",
  rejected: "danger",
};

// F291/F292 -- returns and refunds against the real F291/F292 backend
// (createPointOfSaleReturn/approvePointOfSaleReturn/completePointOfSaleReturn,
// services/api/src/modules/point-of-sale/index.js). A cashier can request
// a return (pos.return.create); a supervisor approves and completes the
// refund (pos.return.approve, on a DIFFERENT person than the requester --
// enforced server-side). "Complete refund" works for every tender the
// original sale used, not just cash: completePointOfSaleReturn allocates
// the refund across the sale's real payment legs and refunds each through
// its own real mechanism (a cash movement, or the same provider-adapter
// refundPosPayment call the standalone payment-refund action uses) --
// there is no separate "non-cash" button because there is no separate
// code path to gate here.
export function PosReturnsScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const queryClient = useQueryClient();
  const canCreate = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes(POS_PERMISSIONS.returnCreate);
  const canApprove = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes(POS_PERMISSIONS.returnApprove);
  const canView = canCreate || canApprove || workspace.permissions.includes(POS_PERMISSIONS.view);

  const [error, setError] = useState<string | null>(null);
  const [newReturnOpen, setNewReturnOpen] = useState(false);

  const query = useQuery({ queryKey: scopedQueryKey(workspace, "pos", "returns"), queryFn: listPosReturns, enabled: canView });
  const rows = query.data?.rows ?? [];

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "pos", "returns") });
  }
  function handleError(err: unknown) {
    setError(err instanceof PosApiError ? err.message : "This action could not be completed.");
  }

  const approveMutation = useMutation({
    mutationFn: (posReturn: PosReturn) => approvePosReturn(posReturn.id, { idempotencyKey: `approve-${posReturn.id}-${Date.now()}` }),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: handleError,
  });
  const completeMutation = useMutation({
    mutationFn: (posReturn: PosReturn) => completePosReturn(posReturn.id, { idempotencyKey: `complete-${posReturn.id}-${Date.now()}` }),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: handleError,
  });

  const columns: ColumnDef<PosReturn, unknown>[] = useMemo(
    () => [
      { id: "number", header: "Return #", accessorKey: "return_number", cell: ({ row }) => <span className="font-mono font-medium text-text">{row.original.return_number}</span> },
      { id: "reason", header: "Reason", accessorKey: "reason" },
      { id: "refund", header: "Refund", accessorFn: (row) => money("", row.refund_total) },
      { id: "status", header: "Status", cell: ({ row }) => <StatusBadge tone={STATUS_TONE[row.original.status] ?? "neutral"}>{row.original.status.replace("_", " ")}</StatusBadge> },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => {
          const r = row.original;
          if (r.status === "pending_approval" && canApprove) {
            return (
              <Button variant="secondary" size="compact" onPress={() => approveMutation.mutate(r)} isLoading={approveMutation.isPending}>
                <Check className="size-4" aria-hidden="true" />
                Approve
              </Button>
            );
          }
          if (r.status === "approved" && canApprove) {
            return (
              <div className="flex items-center gap-1.5">
                <Button variant="primary" size="compact" onPress={() => completeMutation.mutate(r)} isLoading={completeMutation.isPending}>
                  <RotateCcw className="size-4" aria-hidden="true" />
                  Complete refund
                </Button>
                <Button variant="secondary" size="compact" onPress={() => router.push(`/pos/checkout?exchangeReturnId=${r.id}`)}>
                  <ArrowLeftRight className="size-4" aria-hidden="true" />
                  Exchange
                </Button>
              </div>
            );
          }
          return null;
        },
      },
    ],
    [canApprove, approveMutation, completeMutation, router],
  );

  if (!canView) return <PermissionState title="You don't have access to POS Returns" description="Ask an administrator to grant pos.return.create or pos.return.approve." />;

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      <EnterpriseListPage
        header={{
          title: "Returns",
          description: "Returns and refunds against a completed sale, refunded back through whichever tender(s) the original sale used.",
          primaryAction: canCreate ? (
            <Button variant="primary" onPress={() => setNewReturnOpen(true)}>
              <Plus className="size-4" aria-hidden="true" />
              New return
            </Button>
          ) : undefined,
        }}
      >
        <EnterpriseDataGrid<PosReturn> aria-label="Returns" columns={columns} data={rows} getRowId={(row) => row.id} state={query.isLoading ? "loading" : rows.length === 0 ? "empty" : "ready"} />
      </EnterpriseListPage>

      {newReturnOpen && (
        <NewReturnDialog
          onClose={() => setNewReturnOpen(false)}
          onCreated={() => {
            invalidate();
            setNewReturnOpen(false);
          }}
          onError={handleError}
        />
      )}
    </div>
  );
}

function NewReturnDialog({ onClose, onCreated, onError }: { onClose: () => void; onCreated: () => void; onError: (error: unknown) => void }) {
  const [receiptNumber, setReceiptNumber] = useState("");
  const [found, setFound] = useState<{ sale: PosReturnSale; lines: PosReturnSaleLine[] } | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [restock, setRestock] = useState<Record<string, boolean>>({});
  const [reason, setReason] = useState("");

  async function search() {
    if (!receiptNumber.trim()) return;
    setSearching(true);
    setSearchError(null);
    try {
      const result = await findPosSaleForReturn(receiptNumber.trim());
      setFound(result);
      setQuantities({});
      setRestock({});
    } catch (err) {
      setFound(null);
      setSearchError(err instanceof PosApiError ? err.message : "That receipt could not be found.");
    } finally {
      setSearching(false);
    }
  }

  const returnLines = found
    ? found.lines
        .filter((line) => (quantities[line.id] ?? 0) > 0)
        .map((line) => ({ saleLineId: line.id, quantity: quantities[line.id], restock: Boolean(restock[line.id]) }))
    : [];

  const mutation = useMutation({
    mutationFn: () =>
      createPosReturn({
        saleId: found!.sale.id,
        lines: returnLines,
        reason,
        idempotencyKey: `return-${found!.sale.id}-${Date.now()}`,
      }),
    onSuccess: onCreated,
    onError,
  });

  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title="New return">
      <div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto pr-1">
        {!found ? (
          <>
            <div className="flex items-end gap-2">
              <TextField label="Receipt number" value={receiptNumber} onChange={setReceiptNumber} onKeyDown={(event) => event.key === "Enter" && search()} className="flex-1" />
              <Button variant="secondary" onPress={search} isLoading={searching} isDisabled={!receiptNumber.trim()}>
                Find sale
              </Button>
            </div>
            {searchError && <p className="text-sm text-danger">{searchError}</p>}
          </>
        ) : (
          <>
            <div className="rounded-[var(--radius-control)] border border-border-strong p-3 text-sm">
              <p className="font-medium text-text">Receipt {found.sale.receipt_number}</p>
              <p className="text-text-secondary">Total: {money(found.sale.currency_code, found.sale.grand_total)}</p>
            </div>
            <ul className="flex flex-col gap-3">
              {found.lines.map((line) => {
                const remaining = Number(line.remaining_quantity);
                return (
                  <li key={line.id} className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-border p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-text">{line.description}</span>
                      <span className="text-xs text-text-muted">{remaining} returnable of {line.quantity}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <NumberField
                        aria-label={`Quantity to return for ${line.description}`}
                        size="compact"
                        value={quantities[line.id] ?? 0}
                        onChange={(value) => setQuantities((prev) => ({ ...prev, [line.id]: Math.min(Math.max(0, value), remaining) }))}
                        minValue={0}
                        maxValue={remaining}
                        isDisabled={remaining <= 0}
                      />
                      <Checkbox isSelected={Boolean(restock[line.id])} onChange={(checked) => setRestock((prev) => ({ ...prev, [line.id]: checked }))} isDisabled={remaining <= 0}>
                        Restock
                      </Checkbox>
                    </div>
                  </li>
                );
              })}
            </ul>
            <TextField label="Reason" isRequired value={reason} onChange={setReason} />
          </>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onPress={onClose}>
            Cancel
          </Button>
          {found && (
            <Button variant="primary" onPress={() => mutation.mutate()} isLoading={mutation.isPending} isDisabled={!returnLines.length || !reason.trim()}>
              Request return
            </Button>
          )}
        </div>
      </div>
    </Dialog>
  );
}
