"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Select, StatusBadge } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { PosApiError } from "@/features/pos/shared/http";
import { listPosAccountingPostingQueue, postPosSaleToAccounting, postPosReturnToAccounting } from "@/features/pos/accounting/api/accounting-api";
import { money } from "@/features/pos/shared/format";

const STATUS_TONE: Record<string, "warning" | "success" | "danger" | "neutral"> = {
  pending: "warning",
  posted: "success",
  failed: "danger",
  not_applicable: "neutral",
};

// F305 -- a real, visible queue of every completed sale/return's GL
// posting status, per the task's own "failed postings remain visible and
// safely recoverable" requirement. Retrying just calls the same idempotent
// postPosSaleToAccounting/postPosReturnToAccounting a human would trigger
// from the Z report screen -- there is no separate "retry" code path.
export function PosAccountingPostingScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState("pending_and_failed");
  const [error, setError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "pos", "accounting-posting-queue", status),
    queryFn: () => listPosAccountingPostingQueue(status === "pending_and_failed" ? {} : { status }),
  });

  const retryMutation = useMutation({
    mutationFn: (row: { id: string; document_type: string }) =>
      row.document_type === "pos_sale" ? postPosSaleToAccounting(row.id) : postPosReturnToAccounting(row.id),
    onSuccess: (result) => {
      if (result.failed) {
        setError(result.message || "Posting failed again — see the error below.");
      } else {
        setError(null);
      }
      queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "pos", "accounting-posting-queue") });
    },
    onError: (err) => setError(err instanceof PosApiError ? err.message : "The posting attempt could not be completed."),
  });

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold text-text">Accounting posting</h1>
        <p className="text-sm text-text-secondary">Every completed POS sale/return&apos;s general-ledger posting status — retry a failed posting here.</p>
      </div>

      <Select
        label="Filter"
        value={status}
        onChange={(value) => setStatus(String(value ?? "pending_and_failed"))}
        options={[
          { value: "pending_and_failed", label: "Pending + failed" },
          { value: "pending", label: "Pending only" },
          { value: "failed", label: "Failed only" },
          { value: "posted", label: "Posted" },
        ]}
        className="max-w-xs"
      />

      {error && (
        <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      <div className="rounded-[var(--radius-panel)] border border-border-strong bg-surface">
        {query.isLoading ? (
          <p className="p-4 text-sm text-text-secondary">Loading…</p>
        ) : !query.data?.rows?.length ? (
          <p className="p-4 text-sm text-text-muted">Nothing in this filter.</p>
        ) : (
          <div className="divide-y divide-border">
            {query.data.rows.map((row) => (
              <div key={row.id} className="flex items-center justify-between px-4 py-3 text-sm">
                <div>
                  <p className="font-medium text-text">
                    {row.document_type === "pos_sale" ? "Sale" : "Return"} {row.document_number}
                  </p>
                  {row.accounting_posting_error && <p className="text-xs text-danger">{row.accounting_posting_error}</p>}
                </div>
                <div className="flex items-center gap-3">
                  <span className="tabular-nums">{money(row.currency_code ?? "", row.grand_total)}</span>
                  <StatusBadge tone={STATUS_TONE[row.accounting_posting_status] ?? "neutral"}>{row.accounting_posting_status}</StatusBadge>
                  {row.accounting_posting_status !== "posted" && (
                    <Button variant="secondary" size="compact" onPress={() => retryMutation.mutate(row)} isLoading={retryMutation.isPending}>
                      {row.accounting_posting_status === "failed" ? "Retry" : "Post"}
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
