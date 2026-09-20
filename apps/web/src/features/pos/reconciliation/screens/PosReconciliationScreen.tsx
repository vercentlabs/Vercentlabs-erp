"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus, Trash2, Upload } from "lucide-react";
import {
  Button,
  Dialog,
  EnterpriseDataGrid,
  EnterpriseListPage,
  ErrorState,
  IconButton,
  NoResultsState,
  NumberField,
  Select,
  StatusBadge,
  TextArea,
  TextField,
  type SelectOption,
} from "@vercentlabs/design-system";
import { POS_PERMISSIONS } from "@vercentlabs/permissions";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { PosApiError } from "@/features/pos/shared/http";
import {
  getPosReconciliation,
  importPosSettlementBatch,
  listPosReconciliations,
  recordPosReconciliationCorrection,
  resolvePosReconciliation,
  type PosReconciliation,
} from "@/features/pos/reconciliation/api/reconciliation-api";
import { listPosStores } from "@/features/pos/stores/api/stores-api";
import { dateTime, money, statusLabel, statusTone } from "@/features/pos/shared/format";
import { PosAlert, PosFacts } from "@/features/pos/shared/PosUi";

const PAYMENT_METHOD_OPTIONS: SelectOption[] = [
  { value: "card", label: "Card" },
  { value: "upi", label: "UPI" },
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "wallet", label: "Wallet" },
  { value: "store_credit", label: "Store credit" },
];

const STATUS_FILTER_OPTIONS: SelectOption[] = [
  { value: "variance", label: "Exceptions (variance)" },
  { value: "matched", label: "Matched" },
  { value: "resolved", label: "Resolved" },
  { value: "all", label: "All" },
];

type EntryDraft = { key: number; providerReference: string; amount: number; feeAmount: number };

let entryKey = 0;
const blankEntry = (): EntryDraft => ({ key: ++entryKey, providerReference: "", amount: 0, feeAmount: 0 });

// Parses a pasted provider statement: one entry per line, comma- or
// tab-separated "providerReference, amount[, fee]". A header row (any line
// whose amount column isn't numeric) is skipped rather than rejected, since
// statements exported from a provider dashboard usually start with one.
function parseStatement(text: string): EntryDraft[] {
  const entries: EntryDraft[] = [];
  for (const line of text.split(/\r?\n/)) {
    const cells = line.split(/[\t,]/).map((cell) => cell.trim());
    if (cells.length < 2 || !cells[0]) continue;
    const amount = Number(cells[1]);
    if (!Number.isFinite(amount)) continue;
    const fee = cells[2] ? Number(cells[2]) : 0;
    entries.push({ key: ++entryKey, providerReference: cells[0], amount, feeAmount: Number.isFinite(fee) ? fee : 0 });
  }
  return entries;
}

// F304 -- settlement evidence import (the input every reconciliation
// matches against) and the resulting reconciliation list, with resolution
// for anything left in 'variance' and an append-only linked correction once
// resolved. Generating a reconciliation itself happens from a specific
// closed Z report (day-end report detail screen) since a reconciliation is
// always scoped to one report; this screen is the cross-report exception
// queue + evidence import surface.
export function PosReconciliationScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const canManage = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes(POS_PERMISSIONS.reconciliationManage);
  const canApprove = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes(POS_PERMISSIONS.reconciliationApprove);

  const [statusFilter, setStatusFilter] = useState("variance");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [resolveTarget, setResolveTarget] = useState<PosReconciliation | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "pos", "reconciliations", statusFilter),
    queryFn: () => listPosReconciliations(statusFilter === "all" ? {} : { status: statusFilter }),
  });
  const rows = query.data?.rows ?? [];

  const columns: ColumnDef<PosReconciliation, unknown>[] = useMemo(
    () => [
      { id: "number", header: "Reconciliation", accessorFn: (row) => row.reconciliation_number ?? "—", cell: ({ row }) => <span className="font-medium text-text">{row.original.reconciliation_number ?? "—"}</span> },
      { id: "method", header: "Method", accessorFn: (row) => statusLabel(row.payment_method) },
      { id: "expected", header: "Expected", accessorFn: (row) => money("", row.expected_amount) },
      { id: "settled", header: "Settled", accessorFn: (row) => money("", row.settled_amount) },
      { id: "variance", header: "Variance", accessorFn: (row) => money("", row.variance_amount) },
      { id: "fees", header: "Fees", accessorFn: (row) => money("", row.fee_total) },
      {
        id: "exceptions",
        header: "Exceptions",
        accessorFn: (row) => [row.missing_count > 0 ? `${row.missing_count} missing` : null, row.duplicate_count > 0 ? `${row.duplicate_count} duplicate` : null].filter(Boolean).join(" · ") || "—",
      },
      { id: "status", header: "Status", cell: ({ row }) => <StatusBadge tone={statusTone(row.original.status)}>{statusLabel(row.original.status)}</StatusBadge> },
    ],
    [],
  );

  return (
    <div className="flex flex-col gap-4">
      {error && <PosAlert>{error}</PosAlert>}
      {notice && <PosAlert tone="success">{notice}</PosAlert>}

      <EnterpriseListPage
        header={{
          title: "Payment reconciliation",
          description: "Import provider settlement evidence and resolve reconciliation exceptions against closed Z reports.",
          primaryAction: canManage ? (
            <Button variant="primary" onPress={() => setImportOpen(true)}>
              <Upload className="size-4" aria-hidden="true" />
              Import settlement
            </Button>
          ) : undefined,
        }}
        actionBar={{
          start: (
            <Select
              aria-label="Status"
              size="compact"
              options={STATUS_FILTER_OPTIONS}
              selectedKey={statusFilter}
              onSelectionChange={(key) => setStatusFilter(String(key ?? "variance"))}
            />
          ),
        }}
      >
        <EnterpriseDataGrid<PosReconciliation>
          aria-label="Reconciliations"
          columns={columns}
          data={rows}
          getRowId={(row) => row.id}
          state={query.isLoading ? "loading" : query.isError ? "error" : rows.length === 0 ? "empty" : "ready"}
          loadingContent={<p className="px-4 py-8 text-sm text-text-secondary">Loading reconciliations…</p>}
          emptyContent={
            <NoResultsState
              title={statusFilter === "variance" ? "No open exceptions" : "Nothing in this filter"}
              description={statusFilter === "variance" ? "Every reconciliation is matched or resolved." : "Try a different status filter."}
            />
          }
          errorContent={<ErrorState title="Could not load reconciliations" description="Something went wrong fetching this filter." action={{ label: "Retry", onPress: () => query.refetch() }} />}
          onRowClick={(row) => setDetailId(row.id)}
          rowActions={(row) =>
            row.status === "variance" && canApprove ? (
              <span onClick={(event) => event.stopPropagation()}>
                <Button variant="secondary" size="compact" onPress={() => setResolveTarget(row)}>
                  Resolve
                </Button>
              </span>
            ) : null
          }
        />
      </EnterpriseListPage>

      {importOpen && (
        <Dialog isOpen onOpenChange={(open) => !open && setImportOpen(false)} title="Import settlement evidence" size="xl">
          <ImportForm
            onImported={(message) => {
              setImportOpen(false);
              setError(null);
              setNotice(message);
              queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "pos", "reconciliations") });
            }}
          />
        </Dialog>
      )}

      {resolveTarget && (
        <ResolveDialog
          reconciliation={resolveTarget}
          onClose={() => setResolveTarget(null)}
          onResolved={() => {
            setResolveTarget(null);
            setError(null);
            setNotice("Reconciliation resolved.");
            queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "pos", "reconciliations") });
          }}
          onError={(message) => setError(message)}
        />
      )}
      {detailId && <DetailDialog id={detailId} canCorrect={canApprove} onClose={() => setDetailId(null)} />}
    </div>
  );
}

function ImportForm({ onImported }: { onImported: (message: string) => void }) {
  const workspace = useWorkspaceContext();
  const storesQuery = useQuery({ queryKey: scopedQueryKey(workspace, "pos", "stores"), queryFn: () => listPosStores() });

  const [storeId, setStoreId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("card");
  const [providerKey, setProviderKey] = useState("sandbox");
  const [batchReference, setBatchReference] = useState("");
  const [settlementDate, setSettlementDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [entries, setEntries] = useState<EntryDraft[]>(() => [blankEntry()]);
  const [pasted, setPasted] = useState("");
  const [error, setError] = useState<string | null>(null);

  const validEntries = entries.filter((entry) => entry.providerReference.trim() && entry.amount > 0);
  const storeOptions: SelectOption[] = [{ value: "", label: "All stores" }, ...(storesQuery.data?.rows ?? []).map((store) => ({ value: store.id, label: store.name }))];

  function updateEntry(key: number, patch: Partial<EntryDraft>) {
    setEntries((current) => current.map((entry) => (entry.key === key ? { ...entry, ...patch } : entry)));
  }

  function applyPasted() {
    const parsed = parseStatement(pasted);
    if (!parsed.length) return setError("No entries could be read. Use one line per payment: provider reference, amount, optional fee.");
    setEntries(parsed);
    setPasted("");
  }

  const importMutation = useMutation({
    mutationFn: () =>
      importPosSettlementBatch({
        storeId: storeId || null,
        paymentMethod,
        providerKey,
        batchReference,
        settlementDate,
        entries: validEntries.map(({ providerReference, amount, feeAmount }) => ({ providerReference: providerReference.trim(), amount, feeAmount })),
      }),
    onSuccess: (result) => {
      onImported(
        result.replayed
          ? `Batch ${batchReference} was already imported — nothing was double-counted.`
          : `Imported ${validEntries.length} settlement ${validEntries.length === 1 ? "entry" : "entries"} for batch ${batchReference}.`,
      );
      setBatchReference("");
      setEntries([blankEntry()]);
    },
    onError: (err) => setError(err instanceof PosApiError ? err.message : "The settlement batch could not be imported."),
  });

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-text-secondary">
        Enter or paste the payments from a provider statement. Each import is idempotent by provider + batch reference — re-importing the same batch replays it rather than double-counting.
      </p>
      {error && <PosAlert>{error}</PosAlert>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Select label="Payment method" options={PAYMENT_METHOD_OPTIONS} selectedKey={paymentMethod} onSelectionChange={(key) => setPaymentMethod(String(key ?? "card"))} />
        <TextField label="Provider key" value={providerKey} onChange={setProviderKey} />
        <TextField label="Batch reference" isRequired value={batchReference} onChange={setBatchReference} />
        <TextField label="Settlement date" type="date" value={settlementDate} onChange={setSettlementDate} />
        <Select label="Store" options={storeOptions} selectedKey={storeId} onSelectionChange={(key) => setStoreId(String(key ?? ""))} />
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium text-text">Settlement entries</p>
        <div className="flex flex-col gap-2">
          {entries.map((entry, index) => (
            <div key={entry.key} className="grid grid-cols-[1fr_auto] items-end gap-2 sm:grid-cols-[2fr_1fr_1fr_auto]">
              <TextField
                aria-label={`Provider reference ${index + 1}`}
                label={index === 0 ? "Provider reference (payment)" : undefined}
                size="compact"
                value={entry.providerReference}
                onChange={(value) => updateEntry(entry.key, { providerReference: value })}
                className="col-span-2 sm:col-span-1"
              />
              <NumberField aria-label={`Amount ${index + 1}`} label={index === 0 ? "Amount" : undefined} size="compact" value={entry.amount} onChange={(value) => updateEntry(entry.key, { amount: value })} minValue={0} step={0.01} />
              <NumberField aria-label={`Fee ${index + 1}`} label={index === 0 ? "Fee" : undefined} size="compact" value={entry.feeAmount} onChange={(value) => updateEntry(entry.key, { feeAmount: value })} minValue={0} step={0.01} />
              <IconButton
                aria-label={`Remove entry ${index + 1}`}
                size="compact"
                variant="ghost"
                isDisabled={entries.length === 1}
                onPress={() => setEntries((current) => current.filter((candidate) => candidate.key !== entry.key))}
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </IconButton>
            </div>
          ))}
        </div>
        <div>
          <Button variant="ghost" size="compact" onPress={() => setEntries((current) => [...current, blankEntry()])}>
            <Plus className="size-3.5" aria-hidden="true" />
            Add entry
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-dashed border-border bg-surface-muted p-3">
        <TextArea
          label="Paste from statement"
          description="One payment per line: provider reference, amount, optional fee (comma or tab separated). Replaces the entries above."
          value={pasted}
          onChange={setPasted}
        />
        <div>
          <Button variant="secondary" size="compact" onPress={applyPasted} isDisabled={!pasted.trim()}>
            Use pasted entries
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Button variant="primary" onPress={() => importMutation.mutate()} isDisabled={!batchReference.trim() || validEntries.length === 0} isLoading={importMutation.isPending}>
          Import {validEntries.length > 0 ? `${validEntries.length} ${validEntries.length === 1 ? "entry" : "entries"}` : ""}
        </Button>
        <span className="text-xs text-text-muted">Rows without a reference or with a zero amount are ignored.</span>
      </div>
    </div>
  );
}

function ResolveDialog({
  reconciliation,
  onClose,
  onResolved,
  onError,
}: {
  reconciliation: PosReconciliation;
  onClose: () => void;
  onResolved: () => void;
  onError: (message: string) => void;
}) {
  const [notes, setNotes] = useState("");
  const mutation = useMutation({
    mutationFn: () => resolvePosReconciliation(reconciliation.id, notes),
    onSuccess: onResolved,
    onError: (err) => {
      onError(err instanceof PosApiError ? err.message : "This reconciliation could not be resolved.");
      onClose();
    },
  });
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={`Resolve ${reconciliation.reconciliation_number ?? "reconciliation"}`}>
      <div className="flex flex-col gap-4">
        <PosFacts
          columns={2}
          items={[
            { label: "Method", value: statusLabel(reconciliation.payment_method) },
            { label: "Variance", value: money("", reconciliation.variance_amount) },
          ]}
        />
        <TextArea label="Resolution notes" isRequired description="Explain how the variance was investigated and why it is being accepted." value={notes} onChange={setNotes} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onPress={() => mutation.mutate()} isDisabled={!notes.trim()} isLoading={mutation.isPending}>
            Confirm resolution
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function DetailDialog({ id, canCorrect, onClose }: { id: string; canCorrect: boolean; onClose: () => void }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const query = useQuery({ queryKey: scopedQueryKey(workspace, "pos", "reconciliation", id), queryFn: () => getPosReconciliation(id) });
  const correctionMutation = useMutation({
    mutationFn: () => recordPosReconciliationCorrection(id, reason.trim()),
    onSuccess: () => {
      setReason("");
      setError(null);
      queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "pos", "reconciliation", id) });
    },
    onError: (err) => setError(err instanceof PosApiError ? err.message : "The correction could not be recorded."),
  });

  const detail = query.data;
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={detail?.reconciliation_number ?? "Reconciliation"}>
      {query.isLoading ? (
        <p className="text-sm text-text-secondary">Loading…</p>
      ) : query.isError || !detail ? (
        <ErrorState title="Could not load this reconciliation" action={{ label: "Retry", onPress: () => query.refetch() }} />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <StatusBadge tone={statusTone(detail.status)}>{statusLabel(detail.status)}</StatusBadge>
            <span className="text-sm text-text-secondary">{statusLabel(detail.payment_method)}</span>
          </div>
          <PosFacts
            columns={2}
            items={[
              { label: "Expected", value: money("", detail.expected_amount) },
              { label: "Settled", value: money("", detail.settled_amount) },
              { label: "Variance", value: money("", detail.variance_amount) },
              { label: "Fees", value: money("", detail.fee_total) },
              { label: "Missing payments", value: detail.missing_count },
              { label: "Duplicate settlements", value: detail.duplicate_count },
              { label: "Matched", value: detail.matched_at ? dateTime(detail.matched_at) : "—" },
              { label: "Resolved", value: detail.resolved_at ? dateTime(detail.resolved_at) : "—" },
            ]}
          />
          {detail.resolution_notes && (
            <div className="flex flex-col gap-0.5">
              <p className="text-xs font-medium text-text-muted">Resolution notes</p>
              <p className="whitespace-pre-wrap text-sm text-text">{detail.resolution_notes}</p>
            </div>
          )}

          <div className="flex flex-col gap-2 border-t border-border pt-3">
            <p className="text-sm font-semibold text-text">Corrections</p>
            {detail.corrections.length === 0 ? (
              <p className="text-sm text-text-muted">No corrections recorded. A resolved reconciliation is immutable — changes are added as linked corrections.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-border rounded-[var(--radius-control)] border border-border text-sm">
                {detail.corrections.map((correction) => (
                  <li key={correction.id} className="flex flex-col gap-0.5 px-3 py-2">
                    <span className="font-medium text-text">{correction.correction_number}</span>
                    <span className="text-text-secondary">{correction.reason}</span>
                    <span className="text-xs text-text-muted">{dateTime(correction.created_at)}</span>
                  </li>
                ))}
              </ul>
            )}
            {detail.status === "resolved" && canCorrect && (
              <div className="flex flex-col gap-2">
                {error && <PosAlert>{error}</PosAlert>}
                <TextArea label="Record a correction" description="Adds a linked correction; the resolved record itself is never edited." value={reason} onChange={setReason} />
                <div>
                  <Button variant="secondary" onPress={() => correctionMutation.mutate()} isDisabled={!reason.trim()} isLoading={correctionMutation.isPending}>
                    Record correction
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </Dialog>
  );
}
