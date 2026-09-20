"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Check, X } from "lucide-react";
import { Button, Dialog, EnterpriseDataGrid, EnterpriseListPage, ErrorState, NoResultsState, Select, StatusBadge, TextArea, type SelectOption } from "@vercentlabs/design-system";
import { POS_PERMISSIONS } from "@vercentlabs/permissions";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { PosApiError } from "@/features/pos/shared/http";
import { decidePosDiscountApproval, listPosDiscountApprovals, type PosDiscountApproval } from "@/features/pos/discount-approvals/api/discount-approvals-api";
import { money, statusLabel, statusTone } from "@/features/pos/shared/format";
import { PosAlert, PosFacts } from "@/features/pos/shared/PosUi";

type StatusFilter = "pending" | "approved" | "rejected" | "all";

const STATUS_OPTIONS: SelectOption<StatusFilter>[] = [
  { value: "pending", label: "Awaiting decision" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "all", label: "All" },
];

// F279-APP-001 -- above-threshold discounts are applied to the cart at once
// but cannot complete a sale until a DIFFERENT person holding
// pos.discount.approve decides them. The generic /approvals inbox never
// showed these to their approver (it lists only a request's requester,
// assignee or an approvals.manage holder, and POS sets no assignee), so this
// queue is where a store manager actually finds them. Approving here calls
// the platform's own decide endpoint; the self-approval block, permission
// check and cart-version binding all remain server-side.
export function PosDiscountApprovalsScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const canDecide = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes(POS_PERMISSIONS.discountApprove);

  const [status, setStatus] = useState<StatusFilter>("pending");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<PosDiscountApproval | null>(null);
  const [rejectNote, setRejectNote] = useState("");

  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "pos", "discount-approvals", status),
    queryFn: () => listPosDiscountApprovals(status),
    // A cashier is standing at the counter waiting on this: keep it fresh.
    refetchInterval: status === "pending" ? 10_000 : false,
  });
  const rows = query.data?.rows ?? [];

  const decideMutation = useMutation({
    mutationFn: ({ row, decision, note }: { row: PosDiscountApproval; decision: "approved" | "rejected"; note?: string }) => {
      if (!row.approval_request_id) throw new PosApiError("This request has no approval record to decide.", 409);
      return decidePosDiscountApproval(row.approval_request_id, decision, note);
    },
    onSuccess: (_result, { decision }) => {
      setError(null);
      setNotice(decision === "approved" ? "Discount approved — the cashier can now complete the sale." : "Discount rejected — the cashier must remove it before completing the sale.");
      setRejecting(null);
      setRejectNote("");
      queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "pos", "discount-approvals") });
    },
    onError: (err) => {
      setNotice(null);
      setRejecting(null);
      setError(err instanceof PosApiError ? err.message : "The decision could not be recorded.");
    },
  });

  const columns: ColumnDef<PosDiscountApproval, unknown>[] = useMemo(
    () => [
      {
        id: "request",
        header: "Request",
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="font-medium text-text">{row.original.cart_line_id ? row.original.line_description || "Line discount" : "Whole-cart discount"}</span>
            <span className="max-w-md whitespace-normal text-xs text-text-muted">“{row.original.reason}”</span>
          </div>
        ),
        accessorFn: (row) => row.reason,
      },
      {
        id: "discount",
        header: "Discount",
        accessorFn: (row) => `${money(row.currency_code, row.discount_amount_snapshot)} (${Number(row.discount_percent_snapshot ?? 0).toFixed(1)}%)`,
      },
      { id: "where", header: "Store / terminal", accessorFn: (row) => `${row.store_name} · ${row.terminal_name}` },
      { id: "requested", header: "Requested by", accessorFn: (row) => row.requested_by_name ?? "—" },
      {
        id: "status",
        header: "Status",
        cell: ({ row }) => (
          <div className="flex flex-col items-start gap-0.5">
            <StatusBadge tone={statusTone(row.original.status)}>{statusLabel(row.original.status)}</StatusBadge>
            {row.original.status === "pending" && !row.original.is_current && <span className="text-xs text-text-muted">Cart has since changed</span>}
            {row.original.approved_by_name && <span className="text-xs text-text-muted">by {row.original.approved_by_name}</span>}
          </div>
        ),
        accessorFn: (row) => row.status,
      },
    ],
    [],
  );

  return (
    <div className="flex flex-col gap-4">
      {error && <PosAlert>{error}</PosAlert>}
      {notice && <PosAlert tone="success">{notice}</PosAlert>}

      <EnterpriseListPage
        header={{
          title: "Discount approvals",
          description: canDecide
            ? "Above-threshold discounts waiting for a supervisor's decision. The cashier cannot complete the sale until one is approved."
            : "Your above-threshold discount requests and their status.",
        }}
        actionBar={{
          start: <Select aria-label="Status" size="compact" options={STATUS_OPTIONS} selectedKey={status} onSelectionChange={(key) => setStatus((key as StatusFilter) ?? "pending")} />,
        }}
      >
        <EnterpriseDataGrid<PosDiscountApproval>
          aria-label="Discount approvals"
          columns={columns}
          data={rows}
          getRowId={(row) => row.id}
          state={query.isLoading ? "loading" : query.isError ? "error" : rows.length === 0 ? "empty" : "ready"}
          loadingContent={<p className="px-4 py-8 text-sm text-text-secondary">Loading approvals…</p>}
          emptyContent={
            <NoResultsState
              title={status === "pending" ? "Nothing is waiting for approval" : "No requests in this view"}
              description={status === "pending" ? "New above-threshold discounts appear here as cashiers request them." : "Try a different status filter."}
            />
          }
          errorContent={<ErrorState title="Could not load discount approvals" action={{ label: "Retry", onPress: () => query.refetch() }} />}
          rowActions={(row) =>
            canDecide && row.status === "pending" ? (
              <div className="flex items-center gap-1">
                <Button variant="primary" size="compact" isDisabled={!row.is_current} isLoading={decideMutation.isPending && decideMutation.variables?.row.id === row.id} onPress={() => decideMutation.mutate({ row, decision: "approved" })}>
                  <Check className="size-3.5" aria-hidden="true" />
                  Approve
                </Button>
                <Button variant="secondary" size="compact" isDisabled={decideMutation.isPending} onPress={() => setRejecting(row)}>
                  <X className="size-3.5" aria-hidden="true" />
                  Reject
                </Button>
              </div>
            ) : null
          }
        />
      </EnterpriseListPage>

      {rejecting && (
        <Dialog isOpen onOpenChange={(open) => !open && setRejecting(null)} title="Reject this discount?">
          <div className="flex flex-col gap-4">
            <PosFacts
              columns={2}
              items={[
                { label: "Discount", value: `${money(rejecting.currency_code, rejecting.discount_amount_snapshot)} (${Number(rejecting.discount_percent_snapshot ?? 0).toFixed(1)}%)` },
                { label: "Requested by", value: rejecting.requested_by_name ?? "—" },
              ]}
            />
            <TextArea label="Note to the cashier (optional)" value={rejectNote} onChange={setRejectNote} />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onPress={() => setRejecting(null)}>
                Cancel
              </Button>
              <Button variant="danger" isLoading={decideMutation.isPending} onPress={() => decideMutation.mutate({ row: rejecting, decision: "rejected", note: rejectNote })}>
                Reject discount
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
}
