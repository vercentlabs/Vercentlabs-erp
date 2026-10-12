"use client";

// Refunds: every refund at your outlets with its own status — approved, processing, partly refunded, refunded, failed or being checked — and
// the reconciliation queue of outcomes that need someone to verify them (unknown provider answers, failures, mismatches).
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Button, Checkbox, EnterpriseDataGrid, EnterpriseListPage, ErrorState, NoResultsState, SearchField, Select, StatusBadge, TextField } from "@vercentlabs/design-system";

import {
  REFUND_STATUS_LABEL, REFUND_STATUS_TONE, SOURCE_LABEL, listRefundExceptions, listRefunds, resolveRefundException, type PosRefundException, type PosRefundRow,
} from "@/features/pos/refunds/api/refunds-api";
import { PosApiError } from "@/features/pos/shared/http";
import { dateTime, money } from "@/features/pos/shared/format";
import { PosPanel } from "@/features/pos/shared/PosUi";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

const PAGE_SIZE = 25;

function ExceptionRow({ entry, onResolved }: { entry: PosRefundException; onResolved: () => void }) {
  const [note, setNote] = useState("");
  const [reference, setReference] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const resolve = async (outcome?: "refunded" | "not_refunded") => {
    setBusy(true);
    setError(null);
    try { await resolveRefundException(entry.id, { outcome, note: note.trim(), reference: reference.trim() || undefined }); onResolved(); }
    catch (failure) { setError(failure instanceof PosApiError ? failure.message : "Could not resolve."); } finally { setBusy(false); }
  };
  return (
    <li className="flex flex-col gap-2 border-t border-border py-2 text-sm">
      <p><span className="font-medium">{entry.refundNumber}</span> · {entry.method ?? ""} {entry.amount ?? ""} · {entry.type.replace(/_/g, " ").toLowerCase()} · {dateTime(entry.createdAt)}</p>
      <p className="text-text-muted">{entry.detail}</p>
      <div className="flex flex-wrap items-end gap-2">
        <TextField label="How it was resolved" value={note} onChange={setNote} maxLength={300} className="sm:max-w-sm" />
        {entry.type === "UNKNOWN_OUTCOME" && <TextField label="Provider reference (if refunded)" value={reference} onChange={setReference} maxLength={80} className="sm:max-w-xs" />}
        {entry.type === "UNKNOWN_OUTCOME" ? (
          <>
            <Button size="compact" variant="secondary" isLoading={busy} isDisabled={!note.trim()} onPress={() => resolve("refunded")}>Confirmed refunded</Button>
            <Button size="compact" variant="ghost" isLoading={busy} isDisabled={!note.trim()} onPress={() => resolve("not_refunded")}>Confirmed not refunded</Button>
          </>
        ) : <Button size="compact" variant="secondary" isLoading={busy} isDisabled={!note.trim()} onPress={() => resolve()}>Resolve</Button>}
      </div>
      {error && <p className="text-danger-emphasis">{error}</p>}
    </li>
  );
}

export function PosRefundsScreen() {
  const router = useRouter();
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [method, setMethod] = useState("");
  const [outstanding, setOutstanding] = useState(false);
  const [pageIndex, setPageIndex] = useState(0);
  const filters = { search: search.trim() || undefined, status: status || undefined, method: method || undefined, outstanding, limit: PAGE_SIZE, offset: pageIndex * PAGE_SIZE };
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "pos", "refunds", filters), queryFn: () => listRefunds(filters), placeholderData: (previous) => previous });
  const exceptions = useQuery({ queryKey: scopedQueryKey(workspace, "pos", "refund-exceptions"), queryFn: () => listRefundExceptions("open"), retry: false });
  const rows = query.data?.rows ?? [];
  const total = query.data?.total ?? 0;
  const reset = <T,>(set: (value: T) => void) => (value: T) => { setPageIndex(0); set(value); };
  const columns: ColumnDef<PosRefundRow, unknown>[] = useMemo(() => [
    { id: "refundNumber", header: "Refund", cell: ({ row }) => <span className="font-medium text-text">{row.original.refundNumber}</span> },
    { id: "source", header: "For", accessorFn: (row) => `${SOURCE_LABEL[row.sourceType] ?? row.sourceType}${row.invoiceNumber || row.receiptNumber ? ` · ${row.invoiceNumber ?? row.receiptNumber}` : ""}` },
    { id: "createdAt", header: "Started", accessorFn: (row) => dateTime(row.createdAt) },
    { id: "methods", header: "Methods", accessorFn: (row) => row.methods ?? "—" },
    { id: "status", header: "Status", cell: ({ row }) => <StatusBadge tone={REFUND_STATUS_TONE[row.original.status] ?? "neutral"}>{REFUND_STATUS_LABEL[row.original.status] ?? row.original.status}</StatusBadge> },
    { id: "authorized", header: "Authorized", accessorFn: (row) => money(row.currency, row.authorizedAmount) },
    { id: "paid", header: "Refunded", accessorFn: (row) => money(row.currency, row.paid) },
  ], []);

  return (
    <EnterpriseListPage
      header={{ title: "Refunds", description: "Money returned to customers for an authorized source. A refund is complete only when every payment method's refund is confirmed." }}
      actionBar={{
        start: (
          <>
            <SearchField aria-label="Refund, return, receipt or invoice number" placeholder="Refund, return or invoice number…" value={search} onChange={reset(setSearch)} className="min-w-[240px]" />
            <Select aria-label="Status" size="compact" selectedKey={status} onSelectionChange={(key) => reset(setStatus)(String(key))}
              options={[{ value: "", label: "Any status" }, ...Object.entries(REFUND_STATUS_LABEL).map(([value, label]) => ({ value: value.toLowerCase(), label }))]} />
            <Select aria-label="Method" size="compact" selectedKey={method} onSelectionChange={(key) => reset(setMethod)(String(key))}
              options={[{ value: "", label: "Any method" }, { value: "cash", label: "Cash" }, { value: "card", label: "Card" }, { value: "upi", label: "UPI" }]} />
            <Checkbox isSelected={outstanding} onChange={reset(setOutstanding)}>Still owed only</Checkbox>
          </>
        ),
      }}
    >
      {(exceptions.data ?? []).length > 0 && (
        <PosPanel title="Needs verification" description="Refund outcomes someone must verify before anything else happens. Resolving needs reconciliation rights.">
          <ul>{exceptions.data!.map((entry) => <ExceptionRow key={entry.id} entry={entry} onResolved={() => { void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "pos", "refund-exceptions") }); void query.refetch(); }} />)}</ul>
        </PosPanel>
      )}
      <EnterpriseDataGrid<PosRefundRow>
        aria-label="Refunds"
        columns={columns}
        data={rows}
        getRowId={(row) => row.id}
        onRowClick={(row) => router.push(`/pos/refunds/${row.id}`)}
        state={query.isLoading ? "loading" : query.isError ? "error" : rows.length === 0 ? "empty" : "ready"}
        manualSorting
        pageIndex={pageIndex}
        pageSize={PAGE_SIZE}
        pageCount={Math.max(1, Math.ceil(total / PAGE_SIZE))}
        totalRowCount={total}
        onPageChange={setPageIndex}
        loadingContent={<p className="px-4 py-8 text-sm text-text-secondary">Loading refunds…</p>}
        emptyContent={<NoResultsState title="No refunds" description="Refunds are started from a posted return." />}
        errorContent={<ErrorState title="Could not load refunds" description={query.error instanceof PosApiError ? query.error.message : "Something went wrong."}
          action={{ label: "Retry", onPress: () => query.refetch() }} />}
      />
    </EnterpriseListPage>
  );
}
