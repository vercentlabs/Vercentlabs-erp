"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, ErrorState, MetricStrip, NumberField, PermissionState, RecordDetailsPage, StatusBadge, TextArea } from "@vercentlabs/design-system";
import { POS_PERMISSIONS } from "@vercentlabs/permissions";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { PosApiError } from "@/features/pos/shared/http";
import { closePosShift, getPosShift } from "@/features/pos/shifts/api/shifts-api";
import { dateTime, money, statusLabel, statusTone } from "@/features/pos/shared/format";
import { PosAlert, PosBackLink, PosDataTable, PosLoading, PosPanel } from "@/features/pos/shared/PosUi";

export function PosShiftDetailScreen({ shiftId }: { shiftId: string }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const canCloseShift = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes(POS_PERMISSIONS.shiftClose);

  const [actionError, setActionError] = useState<string | null>(null);
  const [countedCash, setCountedCash] = useState(0);
  const [closeNotes, setCloseNotes] = useState("");

  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "pos", "shift", shiftId),
    queryFn: () => getPosShift(shiftId),
    retry: (failureCount, error) => !(error instanceof PosApiError && (error.status === 403 || error.status === 404)) && failureCount < 2,
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

  if (query.isLoading) return <PosLoading label="Loading shift…" />;
  if (query.isError || !query.data) {
    if (query.error instanceof PosApiError && query.error.status === 403) {
      return <PermissionState title="You don't have access to this shift" description="This shift belongs to a store you are not assigned to." />;
    }
    return <ErrorState title="Could not load this shift" action={{ label: "Retry", onPress: () => query.refetch() }} />;
  }

  const shift = query.data.shift;
  const varianceNumber = shift.cash_variance != null ? Number(shift.cash_variance) : null;

  return (
    <div className="flex flex-col gap-4">
      <PosBackLink href="/pos/shifts">All shifts</PosBackLink>
      <RecordDetailsPage
        header={{
          title: `Shift ${shift.shift_number}`,
          status: <StatusBadge tone={statusTone(shift.status)}>{statusLabel(shift.status)}</StatusBadge>,
          fields: [
            { label: "Opened", value: dateTime(shift.opened_at) },
            { label: "Closed", value: shift.closed_at ? dateTime(shift.closed_at) : "—" },
            { label: "Transactions", value: shift.sales.length },
          ],
        }}
      >
        {actionError && <PosAlert>{actionError}</PosAlert>}

        <MetricStrip
          metrics={[
            { label: "Opening cash", value: money("", shift.opening_cash) },
            { label: "Expected cash", value: money("", shift.expected_cash) },
            { label: "Counted cash", value: shift.counted_cash != null ? money("", shift.counted_cash) : "—" },
            {
              label: "Variance",
              value: shift.cash_variance != null ? money("", shift.cash_variance) : "—",
              ...(varianceNumber != null && varianceNumber !== 0
                ? { change: { direction: varianceNumber > 0 ? ("up" as const) : ("down" as const), label: varianceNumber > 0 ? "Over" : "Short", isPositive: false } }
                : {}),
            },
          ]}
        />

        {shift.close_notes && (
          <PosPanel title="Close notes">
            <p className="whitespace-pre-wrap text-sm text-text">{shift.close_notes}</p>
          </PosPanel>
        )}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <PosPanel title="Cash movements">
            <PosDataTable
              rows={shift.cashMovements}
              empty="No cash movements recorded."
              columns={[
                { key: "movement_number", header: "Movement #" },
                { key: "movement_type", header: "Type", render: (row) => statusLabel(row.movement_type) },
                { key: "reason", header: "Reason" },
                { key: "amount", header: "Amount", numeric: true, render: (row) => money("", row.amount) },
                { key: "created_at", header: "When", render: (row) => dateTime(row.created_at) },
              ]}
            />
          </PosPanel>

          <PosPanel title="Payments breakdown">
            <PosDataTable
              rows={shift.paymentBreakdown}
              empty="No payments recorded."
              columns={[
                { key: "payment_method", header: "Method", render: (row) => statusLabel(row.payment_method) },
                { key: "status", header: "Status", render: (row) => <StatusBadge tone={statusTone(row.status)}>{statusLabel(row.status)}</StatusBadge> },
                { key: "count", header: "Count", numeric: true },
                { key: "amount", header: "Amount", numeric: true, render: (row) => money("", row.amount) },
              ]}
            />
          </PosPanel>
        </div>

        <PosPanel title="Transactions during this shift">
          <PosDataTable
            rows={shift.sales}
            empty="No sales recorded."
            columns={[
              {
                key: "receipt_number",
                header: "Receipt #",
                render: (row) => (
                  <Link href={`/pos/transactions/${row.id}`} className="font-medium text-brand hover:underline">
                    {row.receipt_number}
                  </Link>
                ),
              },
              { key: "customer_name", header: "Customer", render: (row) => row.customer_name || "—" },
              { key: "status", header: "Status", render: (row) => <StatusBadge tone={statusTone(row.status)}>{statusLabel(row.status)}</StatusBadge> },
              { key: "grand_total", header: "Total", numeric: true, render: (row) => money("", row.grand_total) },
              { key: "created_at", header: "When", render: (row) => dateTime(row.created_at) },
            ]}
          />
        </PosPanel>

        {shift.status === "open" && canCloseShift && (
          <PosPanel title="Close this shift" description="Count the cash in the drawer. Any difference from the expected cash is recorded as the shift variance.">
            <div className="flex max-w-md flex-col gap-3">
              <NumberField label="Counted cash" value={countedCash} onChange={setCountedCash} minValue={0} step={0.01} />
              <TextArea label="Close notes (optional)" value={closeNotes} onChange={setCloseNotes} />
              <div>
                <Button variant="primary" onPress={() => closeMutation.mutate()} isLoading={closeMutation.isPending}>
                  Close shift
                </Button>
              </div>
            </div>
          </PosPanel>
        )}
      </RecordDetailsPage>
    </div>
  );
}
