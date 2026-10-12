"use client";

// POS returns: history by return, receipt, invoice or credit-note number, with each return's status and — separately — its refund status;
// "New return" starts one against the original sale.
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { Button, EnterpriseDataGrid, EnterpriseListPage, ErrorState, NoResultsState, SearchField, Select, StatusBadge } from "@vercentlabs/design-system";

import { REFUND_LABEL, REFUND_TONE, STATUS_LABEL, STATUS_TONE, listReturns, type PosReturnRow } from "@/features/pos/returns/api/returns-api";
import { NewReturnDialog } from "@/features/pos/returns/components/NewReturnDialog";
import { PosApiError } from "@/features/pos/shared/http";
import { dateTime, money } from "@/features/pos/shared/format";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

const PAGE_SIZE = 25;

export function PosReturnsScreen() {
  const router = useRouter();
  const workspace = useWorkspaceContext();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [refundStatus, setRefundStatus] = useState("");
  const [pageIndex, setPageIndex] = useState(0);
  const [creating, setCreating] = useState(false);
  const filters = { search: search.trim() || undefined, status: status || undefined, refundStatus: refundStatus || undefined, limit: PAGE_SIZE, offset: pageIndex * PAGE_SIZE };
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "pos", "returns", filters), queryFn: () => listReturns(filters), placeholderData: (previous) => previous });
  const rows = query.data?.rows ?? [];
  const total = query.data?.total ?? 0;
  const reset = (set: (value: string) => void) => (value: string) => { setPageIndex(0); set(value); };

  const columns: ColumnDef<PosReturnRow, unknown>[] = useMemo(() => [
    { id: "returnNumber", header: "Return", cell: ({ row }) => <span className="font-medium text-text">{row.original.returnNumber}</span> },
    { id: "sale", header: "Original sale", accessorFn: (row) => row.invoiceNumber ?? row.receiptNumber },
    { id: "createdAt", header: "Started", accessorFn: (row) => dateTime(row.createdAt) },
    { id: "requestedBy", header: "By", accessorFn: (row) => row.requestedBy ?? "—" },
    { id: "status", header: "Status", cell: ({ row }) => <StatusBadge tone={STATUS_TONE[row.original.status] ?? "neutral"}>{STATUS_LABEL[row.original.status] ?? row.original.status}</StatusBadge> },
    { id: "refundStatus", header: "Refund", cell: ({ row }) => row.original.status === "POSTED"
      ? <StatusBadge tone={REFUND_TONE[row.original.refundStatus] ?? "neutral"}>{REFUND_LABEL[row.original.refundStatus] ?? row.original.refundStatus}</StatusBadge> : <span className="text-text-muted">—</span> },
    { id: "flags", header: "", accessorFn: (row) => [row.receiptPresent ? null : "No receipt", row.exceptions.length ? "Exception" : null, row.creditNoteNumber].filter(Boolean).join(" · ") },
    { id: "refundDue", header: "Refund due", accessorFn: (row) => money(row.currency, row.refundDue) },
  ], []);

  return (
    <>
      <EnterpriseListPage
        header={{ title: "Returns", description: "Goods taken back against a completed sale. A return is posted once; its refund keeps its own status until the money is back with the customer.",
          primaryAction: <Button variant="primary" onPress={() => setCreating(true)}><Plus size={16} aria-hidden /> New return</Button> }}
        actionBar={{
          start: (
            <>
              <SearchField aria-label="Return, receipt, invoice or credit-note number" placeholder="Return, receipt or invoice number…" value={search} onChange={reset(setSearch)} className="min-w-[240px]" />
              <Select aria-label="Status" size="compact" selectedKey={status} onSelectionChange={(key) => reset(setStatus)(String(key))}
                options={[{ value: "", label: "Any status" }, ...["draft", "awaiting_approval", "awaiting_inspection", "approved", "posted", "rejected", "cancelled"].map((value) => ({ value, label: STATUS_LABEL[value.toUpperCase()] }))]} />
              <Select aria-label="Refund" size="compact" selectedKey={refundStatus} onSelectionChange={(key) => reset(setRefundStatus)(String(key))}
                options={[{ value: "", label: "Any refund status" }, ...["pending", "processing", "failed", "unknown", "succeeded"].map((value) => ({ value, label: REFUND_LABEL[value.toUpperCase()] }))]} />
            </>
          ),
        }}
      >
        <EnterpriseDataGrid<PosReturnRow>
          aria-label="POS returns"
          columns={columns}
          data={rows}
          getRowId={(row) => row.id}
          onRowClick={(row) => router.push(`/pos/returns/${row.id}`)}
          state={query.isLoading ? "loading" : query.isError ? "error" : rows.length === 0 ? "empty" : "ready"}
          manualSorting
          pageIndex={pageIndex}
          pageSize={PAGE_SIZE}
          pageCount={Math.max(1, Math.ceil(total / PAGE_SIZE))}
          totalRowCount={total}
          onPageChange={setPageIndex}
          loadingContent={<p className="px-4 py-8 text-sm text-text-secondary">Loading returns…</p>}
          emptyContent={<NoResultsState title="No returns" description="Start one with New return." />}
          errorContent={<ErrorState title="Could not load returns" description={query.error instanceof PosApiError ? query.error.message : "Something went wrong."}
            action={{ label: "Retry", onPress: () => query.refetch() }} />}
        />
      </EnterpriseListPage>
      {creating && <NewReturnDialog onClose={() => setCreating(false)} onCreated={(created) => { setCreating(false); router.push(`/pos/returns/${created.id}`); }} />}
    </>
  );
}
