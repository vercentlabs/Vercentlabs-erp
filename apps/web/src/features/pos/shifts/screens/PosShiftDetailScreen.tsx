"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, ErrorState, NumberField, StatusBadge, TextArea } from "@vercentlabs/design-system";
import { POS_PERMISSIONS } from "@vercentlabs/permissions";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { PosApiError } from "@/features/pos/shared/http";
import { closePosShift, getPosShift } from "@/features/pos/shifts/api/shifts-api";
import { money } from "@/features/pos/shared/format";

const statusTone: Record<string, "success" | "info"> = { open: "info", closed: "success" };

export function PosShiftDetailScreen({ shiftId }: { shiftId: string }) {
  const router = useRouter();
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const canCloseShift = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes(POS_PERMISSIONS.shiftClose);

  const [actionError, setActionError] = useState<string | null>(null);
  const [countedCash, setCountedCash] = useState(0);
  const [closeNotes, setCloseNotes] = useState("");

  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "pos", "shift", shiftId),
    queryFn: () => getPosShift(shiftId),
  });

  const closeMutation = useMutation({
    // F301/F302: same closeShift domain call and request shape the
    // overview dashboard's own quick-close action uses -- no separate
    // idempotency key here because closeShift itself never accepted one
    // (see shift-operations.js); this reuses that exact contract rather
    // than inventing a second one for this screen.
    mutationFn: () => closePosShift(shiftId, { countedCash, closeNotes: closeNotes.trim() || undefined }),
    onSuccess: () => {
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "pos", "shift", shiftId) });
      queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "pos", "shifts-page") });
      queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "pos", "shifts") });
    },
    onError: (err) => setActionError(err instanceof PosApiError ? err.message : "The shift could not be closed."),
  });

  if (query.isLoading) return <p className="p-6 text-sm text-text-secondary">Loading shift…</p>;
  if (query.isError || !query.data) {
    return <ErrorState title="Could not load this shift" action={{ label: "Retry", onPress: () => query.refetch() }} />;
  }

  const shift = query.data.shift;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <button type="button" className="text-sm text-text-secondary hover:underline" onClick={() => router.push("/pos/shifts")}>
            ← All shifts
          </button>
          <h1 className="mt-1 text-2xl font-semibold text-text">Shift {shift.shift_number}</h1>
          <p className="text-sm text-text-secondary">
            Opened {new Date(shift.opened_at).toLocaleString()}
            {shift.closed_at ? ` · Closed ${new Date(shift.closed_at).toLocaleString()}` : ""}
          </p>
        </div>
        <StatusBadge tone={statusTone[shift.status] ?? "neutral"}>{shift.status}</StatusBadge>
      </div>

      {actionError && (
        <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">
          {actionError}
        </p>
      )}

      <section className="rounded-[var(--radius-panel)] border border-border-strong bg-surface p-5">
        <h2 className="mb-3 text-base font-semibold text-text">Cash reconciliation</h2>
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {[
            ["Opening cash", money("", shift.opening_cash)],
            ["Expected cash", money("", shift.expected_cash)],
            ["Counted cash", shift.counted_cash != null ? money("", shift.counted_cash) : "—"],
            ["Variance", shift.cash_variance != null ? money("", shift.cash_variance) : "—"],
            ["Close notes", shift.close_notes || "—"],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs text-text-muted">{label}</dt>
              <dd className="text-lg font-semibold text-text">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="rounded-[var(--radius-panel)] border border-border-strong bg-surface p-5">
        <h2 className="mb-3 text-base font-semibold text-text">Cash movements during this shift</h2>
        {shift.cashMovements.length === 0 ? (
          <p className="text-sm text-text-secondary">No cash movements recorded.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-text-muted">
                <th className="pb-2">Movement #</th>
                <th className="pb-2">Type</th>
                <th className="pb-2">Reason</th>
                <th className="pb-2">Amount</th>
                <th className="pb-2">When</th>
              </tr>
            </thead>
            <tbody>
              {shift.cashMovements.map((movement) => (
                <tr key={movement.id} className="border-t border-border">
                  <td className="py-2 font-mono">{movement.movement_number}</td>
                  <td className="py-2 capitalize">{movement.movement_type.replace("_", " ")}</td>
                  <td className="py-2">{movement.reason}</td>
                  <td className="py-2 tabular-nums">{money("", movement.amount)}</td>
                  <td className="py-2">{new Date(movement.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="rounded-[var(--radius-panel)] border border-border-strong bg-surface p-5">
        <h2 className="mb-3 text-base font-semibold text-text">Payments breakdown</h2>
        {shift.paymentBreakdown.length === 0 ? (
          <p className="text-sm text-text-secondary">No payments recorded.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-text-muted">
                <th className="pb-2">Method</th>
                <th className="pb-2">Status</th>
                <th className="pb-2">Count</th>
                <th className="pb-2">Amount</th>
              </tr>
            </thead>
            <tbody>
              {shift.paymentBreakdown.map((row) => (
                <tr key={`${row.payment_method}-${row.status}`} className="border-t border-border">
                  <td className="py-2 capitalize">{row.payment_method}</td>
                  <td className="py-2 capitalize">{row.status}</td>
                  <td className="py-2">{row.count}</td>
                  <td className="py-2 tabular-nums">{money("", row.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="rounded-[var(--radius-panel)] border border-border-strong bg-surface p-5">
        <h2 className="mb-3 text-base font-semibold text-text">Transactions during this shift</h2>
        {shift.sales.length === 0 ? (
          <p className="text-sm text-text-secondary">No sales recorded.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-text-muted">
                <th className="pb-2">Receipt #</th>
                <th className="pb-2">Customer</th>
                <th className="pb-2">Status</th>
                <th className="pb-2">Total</th>
                <th className="pb-2">When</th>
              </tr>
            </thead>
            <tbody>
              {shift.sales.map((sale) => (
                <tr key={sale.id} className="border-t border-border">
                  <td className="py-2 font-mono">{sale.receipt_number}</td>
                  <td className="py-2">{sale.customer_name || "—"}</td>
                  <td className="py-2 capitalize">{sale.status.replace("_", " ")}</td>
                  <td className="py-2 tabular-nums">{money("", sale.grand_total)}</td>
                  <td className="py-2">{new Date(sale.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {shift.status === "open" && canCloseShift && (
        <section className="flex flex-col gap-3 rounded-[var(--radius-panel)] border border-border-strong bg-surface p-5">
          <h2 className="text-base font-semibold text-text">Close this shift</h2>
          <NumberField label="Counted cash" value={countedCash} onChange={setCountedCash} minValue={0} step={0.01} />
          <TextArea label="Close notes (optional)" value={closeNotes} onChange={setCloseNotes} />
          <div>
            <Button variant="primary" onPress={() => closeMutation.mutate()} isLoading={closeMutation.isPending}>
              Close shift
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
