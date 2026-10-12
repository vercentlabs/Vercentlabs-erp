"use client";

import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ErrorState,
  MetricStrip,
  PermissionState,
  RecordDetailsPage,
  StatusBadge,
} from "@vercentlabs/design-system";
import { POS_PERMISSIONS } from "@vercentlabs/permissions";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { PosApiError } from "@/features/pos/shared/http";
import { ShiftReviewPanel } from "@/features/pos/shift-opening/components/ShiftReviewPanel";
import { CashSessionPanel } from "@/features/pos/cash-sessions/components/CashSessionPanel";
import { ShiftClosingPanel } from "@/features/pos/shift-closing/components/ShiftClosingPanel";
import { getPosShift } from "@/features/pos/shifts/api/shifts-api";
import {
  dateTime,
  money,
  statusLabel,
  statusTone,
} from "@/features/pos/shared/format";
import {
  PosBackLink,
  PosDataTable,
  PosLoading,
  PosPanel,
} from "@/features/pos/shared/PosUi";

export function PosShiftDetailScreen({ shiftId }: { shiftId: string }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const canCloseShift =
    workspace.roleSlugs.includes("organization_owner") ||
    workspace.permissions.includes(POS_PERMISSIONS.shiftClose);


  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "pos", "shift", shiftId),
    queryFn: () => getPosShift(shiftId),
    retry: (failureCount, error) =>
      !(
        error instanceof PosApiError &&
        (error.status === 403 || error.status === 404)
      ) && failureCount < 2,
  });

  if (query.isLoading) return <PosLoading label="Loading shift…" />;
  if (query.isError || !query.data) {
    if (query.error instanceof PosApiError && query.error.status === 403) {
      return (
        <PermissionState
          title="You don't have access to this shift"
          description="This shift belongs to a store you are not assigned to."
        />
      );
    }
    return (
      <ErrorState
        title="Could not load this shift"
        action={{ label: "Retry", onPress: () => query.refetch() }}
      />
    );
  }

  const shift = query.data.shift;
  const varianceNumber =
    shift.cash_variance != null ? Number(shift.cash_variance) : null;

  return (
    <div className="flex flex-col gap-4">
      <PosBackLink href="/pos/shifts">All shifts</PosBackLink>
      {/* Shift Opening (0103): a supervisor pauses, stops for review or clears a review of another cashier's shift. */}
      <ShiftReviewPanel shiftId={shiftId} />
      {/* Opening Cash Float (0104): the confirmed opening count, corrections and expected drawer cash. */}
      {shift.cash_session_id && <CashSessionPanel cashSessionId={shift.cash_session_id} cashierUserId={shift.cashier_user_id} />}
      <RecordDetailsPage
        header={{
          title: `Shift ${shift.shift_number}`,
          status: (
            <StatusBadge tone={statusTone(shift.status)}>
              {statusLabel(shift.status)}
            </StatusBadge>
          ),
          fields: [
            { label: "Opened", value: dateTime(shift.opened_at) },
            {
              label: "Closed",
              value: shift.closed_at ? dateTime(shift.closed_at) : "—",
            },
            { label: "Transactions", value: shift.sales.length },
          ],
        }}
      >

        <MetricStrip
          metrics={[
            { label: "Opening cash", value: money("", shift.opening_cash) },
            { label: "Expected cash", value: money("", shift.expected_cash) },
            {
              label: "Counted cash",
              value:
                shift.counted_cash != null
                  ? money("", shift.counted_cash)
                  : "—",
            },
            {
              label: "Variance",
              value:
                shift.cash_variance != null
                  ? money("", shift.cash_variance)
                  : "—",
              ...(varianceNumber != null && varianceNumber !== 0
                ? {
                    change: {
                      direction:
                        varianceNumber > 0
                          ? ("up" as const)
                          : ("down" as const),
                      label: varianceNumber > 0 ? "Over" : "Short",
                      isPositive: false,
                    },
                  }
                : {}),
            },
          ]}
        />

        {shift.close_notes && (
          <PosPanel title="Close notes">
            <p className="whitespace-pre-wrap text-sm text-text">
              {shift.close_notes}
            </p>
          </PosPanel>
        )}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <PosPanel title="Cash movements">
            <PosDataTable
              rows={shift.cashMovements}
              empty="No cash movements recorded."
              columns={[
                { key: "movement_number", header: "Movement #" },
                {
                  key: "movement_type",
                  header: "Type",
                  render: (row) => statusLabel(row.movement_type),
                },
                { key: "reason", header: "Reason" },
                {
                  key: "amount",
                  header: "Amount",
                  numeric: true,
                  render: (row) => money("", row.amount),
                },
                {
                  key: "created_at",
                  header: "When",
                  render: (row) => dateTime(row.created_at),
                },
              ]}
            />
          </PosPanel>

          <PosPanel title="Payments breakdown">
            <PosDataTable
              rows={shift.paymentBreakdown}
              empty="No payments recorded."
              columns={[
                {
                  key: "payment_method",
                  header: "Method",
                  render: (row) => statusLabel(row.payment_method),
                },
                {
                  key: "status",
                  header: "Status",
                  render: (row) => (
                    <StatusBadge tone={statusTone(row.status)}>
                      {statusLabel(row.status)}
                    </StatusBadge>
                  ),
                },
                { key: "count", header: "Count", numeric: true },
                {
                  key: "amount",
                  header: "Amount",
                  numeric: true,
                  render: (row) => money("", row.amount),
                },
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
                  <Link
                    href={`/pos/transactions/${row.id}`}
                    className="font-medium text-brand hover:underline"
                  >
                    {row.receipt_number}
                  </Link>
                ),
              },
              {
                key: "customer_name",
                header: "Customer",
                render: (row) => row.customer_name || "—",
              },
              {
                key: "status",
                header: "Status",
                render: (row) => (
                  <StatusBadge tone={statusTone(row.status)}>
                    {statusLabel(row.status)}
                  </StatusBadge>
                ),
              },
              {
                key: "grand_total",
                header: "Total",
                numeric: true,
                render: (row) => money("", row.grand_total),
              },
              {
                key: "created_at",
                header: "When",
                render: (row) => dateTime(row.created_at),
              },
            ]}
          />
        </PosPanel>

        {/* Shift Closing (0105): the four-step close of this shift (its cashier, or a supervisor with a reason), or its closing report once closed. */}
        {canCloseShift && (["open", "closing"].includes(shift.status) || shift.closing_id) && (
          <ShiftClosingPanel shiftId={shiftId} onClosed={() => { void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "pos", "shift", shiftId) }); }} />
        )}
      </RecordDetailsPage>
    </div>
  );
}
