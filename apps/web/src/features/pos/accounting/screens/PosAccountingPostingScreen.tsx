"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Button, EnterpriseDataGrid, EnterpriseListPage, ErrorState, NoResultsState, Select, StatusBadge } from "@vercentlabs/design-system";
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
  type PosAccountingPostingRow,
} from "@/features/pos/accounting/api/accounting-api";
import { listPosStores } from "@/features/pos/stores/api/stores-api";
import { dateTime, money, statusLabel } from "@/features/pos/shared/format";
import { PosAlert, PosLoading, PosPanel } from "@/features/pos/shared/PosUi";

const STATUS_FILTERS = [
  { value: "pending_and_failed", label: "Pending + failed" },
  { value: "pending", label: "Pending only" },
  { value: "failed", label: "Failed only" },
  { value: "posted", label: "Posted" },
];

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

  const rows = query.data?.rows ?? [];
  // A return row carries no currency_code of its own (a sale row does), which
  // rendered "265.50" beside "INR 265.50". Both are in the store's currency.
  const storesQuery = useQuery({ queryKey: scopedQueryKey(workspace, "pos", "stores"), queryFn: () => listPosStores() });
  const currencyByStore = useMemo(
    () => new Map((storesQuery.data?.rows ?? []).map((store) => [store.id, store.currencyCode ?? store.currency_code ?? ""])),
    [storesQuery.data],
  );

  const columns: ColumnDef<PosAccountingPostingRow, unknown>[] = useMemo(
    () => [
      {
        id: "document",
        header: "Document",
        accessorFn: (row) => `${row.document_type === "pos_sale" ? "Sale" : "Return"} ${row.document_number}`,
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="font-medium text-text">
              {row.original.document_type === "pos_sale" ? "Sale" : "Return"} {row.original.document_number}
            </span>
            {row.original.accounting_posting_error && <span className="max-w-xl whitespace-normal text-xs text-danger">{row.original.accounting_posting_error}</span>}
          </div>
        ),
      },
      { id: "completed", header: "Completed", accessorFn: (row) => dateTime(row.completed_at) },
      { id: "posted", header: "Posted", accessorFn: (row) => (row.accounting_posted_at ? dateTime(row.accounting_posted_at) : "—") },
      { id: "total", header: "Total", accessorFn: (row) => money(row.currency_code ?? currencyByStore.get(row.store_id) ?? "", row.grand_total) },
      {
        id: "status",
        header: "Status",
        cell: ({ row }) => <StatusBadge tone={STATUS_TONE[row.original.accounting_posting_status] ?? "neutral"}>{statusLabel(row.original.accounting_posting_status)}</StatusBadge>,
      },
    ],
    [currencyByStore],
  );

  return (
    <div className="flex flex-col gap-6">
      {error && <PosAlert>{error}</PosAlert>}

      <EnterpriseListPage
        header={{ title: "Accounting posting", description: "Every completed POS sale/return's general-ledger posting status — retry a failed posting here." }}
        actionBar={{
          start: (
            <Select aria-label="Posting status" size="compact" options={STATUS_FILTERS} selectedKey={status} onSelectionChange={(key) => setStatus(String(key ?? "pending_and_failed"))} />
          ),
        }}
      >
        <EnterpriseDataGrid<PosAccountingPostingRow>
          aria-label="Accounting posting queue"
          columns={columns}
          data={rows}
          getRowId={(row) => row.id}
          state={query.isLoading ? "loading" : query.isError ? "error" : rows.length === 0 ? "empty" : "ready"}
          loadingContent={<p className="px-4 py-8 text-sm text-text-secondary">Loading posting queue…</p>}
          emptyContent={<NoResultsState title="Nothing in this filter" description="Every completed sale and return in this view is already posted." />}
          errorContent={<ErrorState title="Could not load the posting queue" description="Something went wrong fetching this filter." action={{ label: "Retry", onPress: () => query.refetch() }} />}
          rowActions={(row) =>
            row.accounting_posting_status !== "posted" && row.accounting_posting_status !== "not_applicable" ? (
              <Button variant="secondary" size="compact" onPress={() => retryMutation.mutate(row)} isLoading={retryMutation.isPending && retryMutation.variables?.id === row.id}>
                {row.accounting_posting_status === "failed" ? "Retry" : "Post"}
              </Button>
            ) : null
          }
        />
      </EnterpriseListPage>

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
    <PosPanel
      title="Accounting account mappings"
      description="Which general-ledger account each POS financial concept posts to. Six keys come pre-configured for every company (shared with Sales); the rest are POS-specific and must be set before F305 posting will succeed for that tender/concept."
    >
      {error && <PosAlert>{error}</PosAlert>}
      {!query.data?.ledger ? (
        query.isLoading ? (
          <PosLoading />
        ) : query.isError ? (
          <ErrorState title="Could not load account mappings" description="Something went wrong fetching the mapping configuration." action={{ label: "Retry", onPress: () => query.refetch() }} />
        ) : (
          <PosAlert tone="warning">No active Accounting ledger exists for this company yet — configure Accounting before mapping POS accounts.</PosAlert>
        )
      ) : (
        <div className="flex flex-col divide-y divide-border">
          {query.data.mappings.map((mapping: PosAccountingMappingRow) => (
            <div key={mapping.key} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="flex min-w-0 flex-col gap-0.5">
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
                      selectedKey={selectedAccountId[mapping.key] ?? mapping.accountId ?? null}
                      onSelectionChange={(key) => setSelectedAccountId((prev) => ({ ...prev, [mapping.key]: String(key ?? "") }))}
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
    </PosPanel>
  );
}
