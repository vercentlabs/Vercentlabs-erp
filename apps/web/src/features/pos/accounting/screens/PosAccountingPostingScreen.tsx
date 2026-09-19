"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, ErrorState, Select, StatusBadge } from "@vercentlabs/design-system";
import { POS_PERMISSIONS } from "@vercentlabs/permissions";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { PosApiError } from "@/features/pos/shared/http";
import {
  listPosAccountingPostingQueue,
  postPosSaleToAccounting,
  postPosReturnToAccounting,
  getPosAccountingMappingConfig,
  upsertPosAccountingMapping,
  type PosAccountingMappingRow,
} from "@/features/pos/accounting/api/accounting-api";
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
  const canConfigure = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes(POS_PERMISSIONS.settingsManage);
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
    <div className="flex flex-col gap-6">
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
        ) : query.isError ? (
          <ErrorState title="Could not load the posting queue" description="Something went wrong fetching this filter." action={{ label: "Retry", onPress: () => query.refetch() }} />
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

      {canConfigure && <AccountMappingSection />}
    </div>
  );
}

// F305 gap closure — account-mapping configuration. Reuses Accounting's
// own real settings/options/upsert functions (see
// cash-shift-day-end-and-reconciliation/accounting-mapping-config.js);
// this screen lives here because Accounting itself has no frontend
// anywhere in the app yet (confirmed: /accounting still renders the
// generic module-foundation placeholder) -- POS is the actual, immediate
// consumer blocked without this, so the config lives where it's needed,
// calling Accounting's real API rather than a POS-owned table.
function AccountMappingSection() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState<Record<string, string>>({});

  const query = useQuery({ queryKey: scopedQueryKey(workspace, "pos", "accounting-mappings"), queryFn: getPosAccountingMappingConfig });

  const saveMutation = useMutation({
    mutationFn: ({ key, accountId }: { key: string; accountId: string }) => upsertPosAccountingMapping(key, accountId),
    onMutate: ({ key }) => setPendingKey(key),
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "pos", "accounting-mappings") });
    },
    onError: (err) => setError(err instanceof PosApiError ? err.message : "This mapping could not be saved."),
    onSettled: () => setPendingKey(null),
  });

  return (
    <div className="flex flex-col gap-3 rounded-[var(--radius-panel)] border border-border-strong bg-surface p-5">
      <div>
        <h2 className="text-base font-semibold text-text">Accounting account mappings</h2>
        <p className="text-sm text-text-secondary">
          Which general-ledger account each POS financial concept posts to. Six keys come pre-configured for every company (shared with Sales); the rest
          are POS-specific and must be set before F305 posting will succeed for that tender/concept.
        </p>
      </div>
      {error && (
        <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      {!query.data?.ledger ? (
        query.isLoading ? (
          <p className="text-sm text-text-secondary">Loading…</p>
        ) : query.isError ? (
          <ErrorState title="Could not load account mappings" description="Something went wrong fetching the mapping configuration." action={{ label: "Retry", onPress: () => query.refetch() }} />
        ) : (
          <p className="text-sm text-danger">No active Accounting ledger exists for this company yet — configure Accounting before mapping POS accounts.</p>
        )
      ) : (
        <div className="divide-y divide-border">
          {query.data.mappings.map((mapping: PosAccountingMappingRow) => (
            <div key={mapping.key} className="flex items-center justify-between gap-3 py-2.5">
              <div>
                <p className="text-sm font-medium text-text">{mapping.label}</p>
                <p className="text-xs text-text-muted">{mapping.description}</p>
                {mapping.configured && (
                  <p className="text-xs text-success">
                    {mapping.accountCode} — {mapping.accountName}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge tone={mapping.seeded ? "neutral" : mapping.configured ? "success" : "warning"}>
                  {mapping.seeded ? "Pre-seeded" : mapping.configured ? "Configured" : "Not configured"}
                </StatusBadge>
                {!mapping.seeded && (
                  <>
                    <Select
                      aria-label={`Account for ${mapping.label}`}
                      size="compact"
                      value={selectedAccountId[mapping.key] ?? mapping.accountId ?? ""}
                      onChange={(value) => setSelectedAccountId((prev) => ({ ...prev, [mapping.key]: String(value ?? "") }))}
                      options={query.data.accounts.map((account) => ({ value: account.id, label: `${account.code} — ${account.name}` }))}
                      placeholder="Select an account"
                      className="min-w-[220px]"
                    />
                    <Button
                      variant="secondary"
                      size="compact"
                      isDisabled={!selectedAccountId[mapping.key] || pendingKey === mapping.key}
                      isLoading={pendingKey === mapping.key}
                      onPress={() => saveMutation.mutate({ key: mapping.key, accountId: selectedAccountId[mapping.key] })}
                    >
                      Save
                    </Button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
