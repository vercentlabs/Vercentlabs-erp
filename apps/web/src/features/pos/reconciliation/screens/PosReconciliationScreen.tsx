"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, NumberField, Select, StatusBadge, TextArea, TextField } from "@vercentlabs/design-system";
import { POS_PERMISSIONS } from "@vercentlabs/permissions";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { PosApiError } from "@/features/pos/shared/http";
import {
  importPosSettlementBatch,
  listPosReconciliations,
  resolvePosReconciliation,
  type PosReconciliation,
} from "@/features/pos/reconciliation/api/reconciliation-api";
import { money } from "@/features/pos/shared/format";

const STATUS_TONE: Record<string, "warning" | "success" | "neutral"> = {
  draft: "neutral",
  matched: "success",
  variance: "warning",
  resolved: "success",
};

// F304 -- settlement evidence import (the input every reconciliation
// matches against) and the resulting reconciliation list, with resolution
// for anything left in 'variance'. Generating a reconciliation itself
// happens from a specific closed Z report (day-end report detail screen)
// since a reconciliation is always scoped to one report; this screen is
// the cross-report exception queue + evidence import surface.
export function PosReconciliationScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const canManage = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes(POS_PERMISSIONS.reconciliationManage);
  const canApprove = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes(POS_PERMISSIONS.reconciliationApprove);

  const [statusFilter, setStatusFilter] = useState("variance");
  const [error, setError] = useState<string | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [resolutionNotes, setResolutionNotes] = useState("");

  const [paymentMethod, setPaymentMethod] = useState("card");
  const [providerKey, setProviderKey] = useState("sandbox");
  const [batchReference, setBatchReference] = useState("");
  const [settlementDate, setSettlementDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [providerReference, setProviderReference] = useState("");
  const [amount, setAmount] = useState(0);
  const [feeAmount, setFeeAmount] = useState(0);

  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "pos", "reconciliations", statusFilter),
    queryFn: () => listPosReconciliations(statusFilter === "all" ? {} : { status: statusFilter }),
  });

  const importMutation = useMutation({
    mutationFn: () =>
      importPosSettlementBatch({
        paymentMethod,
        providerKey,
        batchReference,
        settlementDate,
        entries: [{ providerReference, amount, feeAmount }],
      }),
    onSuccess: () => {
      setError(null);
      setBatchReference("");
      setProviderReference("");
      setAmount(0);
      setFeeAmount(0);
    },
    onError: (err) => setError(err instanceof PosApiError ? err.message : "The settlement batch could not be imported."),
  });

  const resolveMutation = useMutation({
    mutationFn: (id: string) => resolvePosReconciliation(id, resolutionNotes),
    onSuccess: () => {
      setError(null);
      setResolvingId(null);
      setResolutionNotes("");
      queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "pos", "reconciliations") });
    },
    onError: (err) => setError(err instanceof PosApiError ? err.message : "This reconciliation could not be resolved."),
  });

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold text-text">Payment reconciliation</h1>
        <p className="text-sm text-text-secondary">
          Import provider settlement evidence and resolve reconciliation exceptions against closed Z reports.
        </p>
      </div>

      {error && (
        <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      {canManage && (
        <div className="flex flex-col gap-3 rounded-[var(--radius-panel)] border border-border-strong bg-surface p-5">
          <h2 className="text-base font-semibold text-text">Import settlement evidence</h2>
          <p className="text-xs text-text-secondary">
            Enter one settlement entry from a provider statement/file (or the sandbox adapter&apos;s own test-settlement generator). Each import is
            idempotent by provider + batch reference — re-importing the same batch replays it rather than double-counting.
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Select
              label="Payment method"
              value={paymentMethod}
              onChange={(value) => setPaymentMethod(String(value ?? "card"))}
              options={[
                { value: "card", label: "Card" },
                { value: "upi", label: "UPI" },
                { value: "bank_transfer", label: "Bank transfer" },
                { value: "wallet", label: "Wallet" },
                { value: "store_credit", label: "Store credit" },
              ]}
            />
            <TextField label="Provider key" value={providerKey} onChange={setProviderKey} />
            <TextField label="Batch reference" value={batchReference} onChange={setBatchReference} />
            <TextField label="Settlement date" value={settlementDate} onChange={setSettlementDate} />
            <TextField label="Provider reference (payment)" value={providerReference} onChange={setProviderReference} />
            <NumberField label="Amount" value={amount} onChange={setAmount} minValue={0} step={0.01} />
            <NumberField label="Fee amount" value={feeAmount} onChange={setFeeAmount} minValue={0} step={0.01} />
          </div>
          <Button
            variant="primary"
            onPress={() => importMutation.mutate()}
            isDisabled={!batchReference.trim() || !providerReference.trim() || amount <= 0}
            isLoading={importMutation.isPending}
            className="self-start"
          >
            Import
          </Button>
        </div>
      )}

      <Select
        label="Filter"
        value={statusFilter}
        onChange={(value) => setStatusFilter(String(value ?? "variance"))}
        options={[
          { value: "variance", label: "Exceptions (variance)" },
          { value: "matched", label: "Matched" },
          { value: "resolved", label: "Resolved" },
          { value: "all", label: "All" },
        ]}
        className="max-w-xs"
      />

      <div className="rounded-[var(--radius-panel)] border border-border-strong bg-surface">
        {query.isLoading ? (
          <p className="p-4 text-sm text-text-secondary">Loading…</p>
        ) : !query.data?.rows?.length ? (
          <p className="p-4 text-sm text-text-muted">Nothing in this filter.</p>
        ) : (
          <div className="divide-y divide-border">
            {query.data.rows.map((row: PosReconciliation) => (
              <div key={row.id} className="flex flex-col gap-2 px-4 py-3 text-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium capitalize text-text">
                      {row.payment_method} {row.reconciliation_number ? `— ${row.reconciliation_number}` : ""}
                    </p>
                    <p className="text-xs text-text-muted">
                      Expected {money("", row.expected_amount)} · Settled {money("", row.settled_amount)} · Variance {money("", row.variance_amount)}
                      {row.missing_count > 0 && ` · ${row.missing_count} missing`}
                      {row.duplicate_count > 0 && ` · ${row.duplicate_count} duplicate`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge tone={STATUS_TONE[row.status] ?? "neutral"}>{row.status}</StatusBadge>
                    {row.status === "variance" && canApprove && (
                      <Button variant="secondary" size="compact" onPress={() => setResolvingId(resolvingId === row.id ? null : row.id)}>
                        Resolve
                      </Button>
                    )}
                  </div>
                </div>
                {resolvingId === row.id && (
                  <div className="flex items-end gap-2 border-t border-border pt-2">
                    <TextArea label="Resolution notes" value={resolutionNotes} onChange={setResolutionNotes} className="flex-1" />
                    <Button
                      variant="primary"
                      onPress={() => resolveMutation.mutate(row.id)}
                      isDisabled={!resolutionNotes.trim()}
                      isLoading={resolveMutation.isPending}
                    >
                      Confirm
                    </Button>
                  </div>
                )}
                {row.resolution_notes && <p className="text-xs text-text-muted">Resolved: {row.resolution_notes}</p>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
