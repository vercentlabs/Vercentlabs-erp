"use client";

// Input tax credit: the GST paid on supplier invoices and expenses, by document. It is not claimable merely because the invoice exists —
// it waits until someone confirms the conditions are met (it appears in GSTR-2B, the goods or services were received, the supplier filed).
// Confirming moves it to the claimable CGST / SGST / IGST / cess accounts; refusing makes it a cost. A decision made in error is undone.
import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Button, Dialog, EmptyState, EnterpriseDataGrid, EnterpriseListPage, ErrorState, MetricCard, PermissionState, StatusBadge, TextField } from "@vercentlabs/design-system";

import { formatDate, formatDateTime } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice } from "@/shared/ui/Panel";
import { usePagedRows } from "@/shared/ui/list";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { amount, decideItc, errorMessage, errorStatus, listItc, undoItc, type ItcRow, type ItcStatus } from "../api/automatic-api";

const VIEWS = [{ id: "PENDING", label: "Awaiting confirmation" }, { id: "ELIGIBLE", label: "Claimable" }, { id: "INELIGIBLE", label: "Not claimable" }, { id: "all", label: "All" }];
const STATUS: Record<ItcStatus, { label: string; tone: "info" | "success" | "warning" }> = {
  PENDING: { label: "Awaiting confirmation", tone: "info" }, ELIGIBLE: { label: "Claimable", tone: "success" }, INELIGIBLE: { label: "Not claimable", tone: "warning" },
};

export function InputTaxCreditScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const mayDecide = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes("accounting.tax.manage");
  const [view, setView] = useState("PENDING");
  const [selected, setSelected] = useState<ItcRow | null>(null);
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "accounting", "itc", view), queryFn: () => listItc(view === "all" ? undefined : view), placeholderData: (previous) => previous });
  const rows = useMemo(() => query.data?.rows ?? [], [query.data]);
  const paged = usePagedRows(rows);
  const columns = useMemo<ColumnDef<ItcRow, unknown>[]>(() => [
    { id: "number", accessorKey: "number", header: "Document", enableHiding: false, cell: ({ row }) => (
      <span className="flex flex-col"><span className="font-medium text-text">{row.original.href
        ? <Link className="underline" href={row.original.href} onClick={(event) => event.stopPropagation()}>{row.original.number}</Link> : row.original.number}</span>
        <span className="text-xs text-text-muted">{row.original.document}</span></span>) },
    { id: "supplier", accessorKey: "supplier", header: "Supplier", cell: ({ row }) => <span className="flex flex-col"><span>{row.original.supplier ?? "—"}</span>
      <span className="text-xs text-text-muted">{row.original.gstin ?? "No GSTIN"}</span></span> },
    { id: "taxPeriod", accessorKey: "taxPeriod", header: "Tax period" },
    { id: "cgst", accessorKey: "cgst", header: "CGST", cell: ({ row }) => <span className="tabular-nums">{amount(row.original.cgst)}</span> },
    { id: "sgst", accessorKey: "sgst", header: "SGST", cell: ({ row }) => <span className="tabular-nums">{amount(row.original.sgst)}</span> },
    { id: "igst", accessorKey: "igst", header: "IGST", cell: ({ row }) => <span className="tabular-nums">{amount(row.original.igst)}</span> },
    { id: "tax", accessorKey: "tax", header: "Total GST", cell: ({ row }) => <span className="font-medium tabular-nums">{amount(row.original.tax)}</span> },
    { id: "itcStatus", accessorKey: "itcStatus", header: "Credit", cell: ({ row }) => <StatusBadge tone={STATUS[row.original.itcStatus].tone}>{STATUS[row.original.itcStatus].label}</StatusBadge> },
  ], []);
  if (query.isError && errorStatus(query.error) === 403) return <PermissionState title="You don't have access to Accounting" description="Ask an administrator for access." />;
  const totals = query.data?.totals;
  return (
    <EnterpriseListPage
      header={{ title: "Input Tax Credit", description: "GST paid on purchases is claimable only once the credit is confirmed — for example when the invoice appears in GSTR-2B. Until then it waits on its own account." }}
      savedViews={{ views: VIEWS, activeViewId: view, onSelect: (id) => { setView(id); paged.resetPage(); } }}
    >
      {totals && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <MetricCard label="Awaiting confirmation" value={amount(totals.pending)} />
          <MetricCard label="Claimable" value={amount(totals.eligible)} />
          <MetricCard label="Not claimable (cost)" value={amount(totals.ineligible)} />
        </div>
      )}
      <EnterpriseDataGrid<ItcRow>
        aria-label="Input tax credit" columns={columns} data={paged.pageRows} getRowId={(row) => `${row.sourceType}:${row.sourceId}`}
        state={query.isLoading ? "loading" : query.isError ? "error" : rows.length === 0 ? "empty" : "ready"}
        loadingContent={<LoadingState label="Loading input tax credit" rows={6} />}
        errorContent={<ErrorState title="Could not load input tax credit" description={errorMessage(query.error)} />}
        emptyContent={<EmptyState title={view === "PENDING" ? "Nothing awaits confirmation" : "Nothing here"} description="Supplier invoices and expenses with GST appear here once posted." />}
        {...paged.grid}
        onRowClick={(row) => setSelected(row)}
      />
      {selected && <ItcDialog row={selected} mayDecide={mayDecide} onClose={() => setSelected(null)} onChanged={() => queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "accounting") })} />}
    </EnterpriseListPage>
  );
}

function ItcDialog({ row, mayDecide, onClose, onChanged }: { row: ItcRow; mayDecide: boolean; onClose: () => void; onChanged: () => Promise<unknown> }) {
  const [reason, setReason] = useState("");
  const [reference, setReference] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try { await work(); await onChanged(); onClose(); } catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
  };
  const input = { sourceType: row.sourceType, sourceId: row.sourceId, reason: reason.trim() };
  return (
    <Dialog isOpen isDismissable onOpenChange={(open) => { if (!open) onClose(); }} title={`${row.document} ${row.number ?? ""}`} size="md">
      <div className="flex flex-col gap-3 text-sm">
        <p>{row.supplier ?? "Supplier"} · {row.gstin ?? "no GSTIN"} · {formatDate(row.documentDate)} · GST {amount(row.tax)}</p>
        <StatusBadge tone={STATUS[row.itcStatus].tone}>{STATUS[row.itcStatus].label}</StatusBadge>
        {row.decidedAt && <p className="text-text-secondary">Decided {formatDateTime(row.decidedAt)}{row.decidedBy ? ` by ${row.decidedBy}` : ""}: {row.reason}</p>}
        {mayDecide && (
          <>
            <TextField label={row.itcStatus === "PENDING" ? "How it was confirmed, or why it cannot be claimed" : "Why the decision is undone"} value={reason} onChange={setReason} maxLength={500} />
            {row.itcStatus === "PENDING" && <TextField label="Reference (optional)" description="For example the GSTR-2B period" value={reference} onChange={setReference} maxLength={200} />}
            <div className="flex flex-wrap gap-2">
              {row.itcStatus === "PENDING" ? (
                <>
                  <Button variant="primary" isLoading={busy} isDisabled={reason.trim().length < 3}
                    onPress={() => run(() => decideItc({ ...input, decision: "ELIGIBLE", reference: reference.trim() || undefined }))}>Confirm claimable</Button>
                  <Button variant="secondary" isLoading={busy} isDisabled={reason.trim().length < 3}
                    onPress={() => run(() => decideItc({ ...input, decision: "INELIGIBLE", reference: reference.trim() || undefined }))}>Not claimable</Button>
                </>
              ) : <Button variant="secondary" isLoading={busy} isDisabled={reason.trim().length < 3} onPress={() => run(() => undoItc(input))}>Undo the decision</Button>}
            </div>
          </>
        )}
        {error && <Notice tone="danger">{error}</Notice>}
      </div>
    </Dialog>
  );
}
