"use client";

// Debit Notes & Vendor Credits: one list of the buyer's claims to suppliers (debit notes) and the suppliers' financial credits (vendor credits)
// — separate records with separate statuses — and the chooser between raising a claim and recording a credit.
import { useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { FileMinus, Plus, ReceiptText } from "lucide-react";
import {
  EmptyState, EnterpriseDataGrid, EnterpriseListPage, ErrorState, LinkButton, NoResultsState, PageHeader, SearchField, Select, StatusBadge,
} from "@vercentlabs/design-system";

import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { calendarDate, money } from "@/features/procurement/shared/format";
import { useListState } from "@/features/procurement/shared/navigation";

import { errorMessage, getCreditOptions, listDebitNotesAndCredits, type ListRow } from "../api/vendor-credits-api";

type Tone = "neutral" | "info" | "success" | "warning" | "danger";
export const CLAIM_TONE: Record<string, Tone> = { draft: "neutral", issued: "info", accepted: "success", partially_accepted: "warning", rejected: "danger", resolved: "success", closed: "neutral" };
export const CREDIT_TONE: Record<string, Tone> = { draft: "neutral", awaiting_approval: "warning", posted: "success", cancelled: "neutral", reversed: "danger" };
export const SETTLEMENT_TONE: Record<string, Tone> = { unapplied: "warning", partially_applied: "info", fully_settled: "success" };

export function DebitNotesCreditsScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  // The view is in the URL; the search and supplier filter are remembered for this browser tab.
  const list = useListState("debit-notes-credits", { view: "all", filters: { supplierId: "any" } });
  const { view, setView, search, setSearch } = list;
  const supplierId = list.filters.supplierId;
  const setSupplierId = (value: string) => list.setFilter("supplierId", value);
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "credit-options"), queryFn: () => getCreditOptions(), staleTime: 60_000 });
  const filters = useMemo(() => ({ view, search: search.trim() || undefined, supplierId: supplierId === "any" ? undefined : supplierId }), [view, search, supplierId]);
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "debit-notes-credits", filters), queryFn: () => listDebitNotesAndCredits(filters) });
  const rows = query.data?.rows ?? [];
  const canCreate = Boolean(options.data?.permissions.claimsManage || options.data?.permissions.creditsManage);
  const columns = useMemo<ColumnDef<ListRow, unknown>[]>(() => [
    { id: "number", header: "Number", cell: ({ row }) => <span className="font-medium tabular-nums">{row.original.number}</span> },
    { id: "type", header: "Type", cell: ({ row }) => (row.original.kind === "claim" ? "Debit claim to supplier" : "Vendor credit") },
    { id: "supplier", header: "Supplier", cell: ({ row }) => row.original.supplierName ?? "—" },
    { id: "origin", header: "Origin / supplier ref", cell: ({ row }) => <span>{row.original.kind === "credit" ? row.original.originLabel : "Claim"}
      {row.original.supplierCreditNoteNumber && <span className="block text-xs text-text-muted">{row.original.supplierCreditNoteNumber}</span>}</span> },
    { id: "date", header: "Date", cell: ({ row }) => calendarDate(row.original.date) },
    { id: "amount", header: "Amount", cell: ({ row }) => <span className="tabular-nums">{money(row.original.currencyCode, row.original.total)}</span> },
    { id: "status", header: "Status", cell: ({ row }) => <StatusBadge tone={(row.original.kind === "claim" ? CLAIM_TONE : CREDIT_TONE)[row.original.status] ?? "neutral"}>{row.original.statusLabel}</StatusBadge> },
    { id: "settlement", header: "Settlement / accepted", cell: ({ row }) => (row.original.kind === "credit"
      ? (row.original.settlementStatus && row.original.settlementStatus !== "not_applicable" ? <StatusBadge tone={SETTLEMENT_TONE[row.original.settlementStatus] ?? "neutral"}>{row.original.settlementLabel ?? ""}</StatusBadge> : "—")
      : Number(row.original.accepted ?? 0) > 0 ? <span className="tabular-nums">{money(row.original.currencyCode, row.original.accepted)} accepted</span> : "—") },
    { id: "available", header: "Unapplied / to credit", cell: ({ row }) => <span className="tabular-nums">{Number(row.original.available ?? 0) > 0 ? money(row.original.currencyCode, row.original.available) : "—"}</span> },
  ], []);
  const filtered = search || view !== "all" || supplierId !== "any";
  return (
    <EnterpriseListPage header={{ title: "Supplier Credits / Debit Notes",
      description: "Claims raised with suppliers and the credits suppliers give. A debit claim is a claim — it changes nothing in Accounts Payable; a vendor credit is posted through Finance and then applied to bills or refunded.",
      primaryAction: canCreate ? <LinkButton variant="primary" href="/procurement/debit-notes-credits/new"><Plus className="size-4" aria-hidden="true" />New</LinkButton> : undefined }}
      savedViews={{ views: (query.data?.views ?? options.data?.views ?? [{ key: "all", label: "All" }]).map((entry) => ({ id: entry.key,
        label: entry.key === "claims" || entry.key === "credits" || entry.key === "all" ? entry.label : `${(entry as { group?: string }).group === "claims" ? "Claims" : "Credits"} · ${entry.label}` })), activeViewId: view, onSelect: setView }}
      actionBar={{ start: (
        <>
          <SearchField aria-label="Search debit claims and credits" placeholder="Number, supplier, supplier credit note" className="w-full sm:w-80" value={search} onChange={setSearch} />
          <Select aria-label="Supplier" size="compact" selectedKey={supplierId} onSelectionChange={(value) => setSupplierId(String(value))}
            options={[{ value: "any", label: "Any supplier" }, ...(options.data?.suppliers ?? []).map((supplier) => ({ value: supplier.id, label: supplier.name }))]} />
        </>
      ) }}>
      <EnterpriseDataGrid<ListRow> aria-label="Debit claims and vendor credits" columns={columns} data={rows} getRowId={(row) => `${row.kind}-${row.id}`}
        state={query.isLoading ? "loading" : query.isError ? "error" : rows.length === 0 ? (filtered ? "no-results" : "empty") : "ready"}
        loadingContent={<LoadingState label="Loading debit claims and credits" rows={6} />}
        errorContent={<ErrorState title="Could not load debit claims and credits" description={errorMessage(query.error)} action={{ label: "Try again", onPress: () => void query.refetch() }} />}
        emptyContent={<EmptyState title="No debit claims or vendor credits yet" description="Raise a debit claim to a supplier, or record the credit a supplier gave." />}
        noResultsContent={<NoResultsState title="Nothing in this view" description="Try another view, supplier or search." />}
        onRowClick={(row) => router.push(row.href)}
        renderMobileCard={(row) => <div className="flex flex-col gap-1"><span className="font-medium tabular-nums">{row.number} · {row.supplierName}</span>
          <span className="text-xs text-text-muted">{row.kind === "claim" ? "Debit claim" : "Vendor credit"} · {row.statusLabel} · {money(row.currencyCode, row.total)}</span></div>} />
    </EnterpriseListPage>
  );
}

// The chooser: a claim to the supplier, or the supplier's credit.
export function NewDebitNoteOrCreditScreen({ billId, returnId, supplierId }: { billId?: string; returnId?: string; supplierId?: string }) {
  const workspace = useWorkspaceContext();
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "credit-options"), queryFn: () => getCreditOptions(), staleTime: 60_000 });
  if (options.isLoading) return <LoadingState label="Loading" />;
  if (!options.data) return <ErrorState title="Could not load" description={errorMessage(options.error)} />;
  const query = new URLSearchParams(Object.entries({ supplierBillId: billId, purchaseReturnId: returnId, supplierId }).filter((entry): entry is [string, string] => Boolean(entry[1]))).toString();
  const suffix = query ? `?${query}` : "";
  const card = "flex flex-col gap-2 rounded-lg border border-border bg-surface p-5 text-left transition hover:border-brand";
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="What are you recording?" description="A claim you raise with the supplier is not a credit: the payable changes only when the supplier's credit is recorded and posted." />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {options.data.permissions.claimsManage && (
          <Link className={card} href={`/procurement/debit-notes-credits/claims/new${suffix}`}>
            <FileMinus className="size-6 text-brand" aria-hidden="true" />
            <span className="text-base font-semibold">Issue Debit Claim to Supplier</span>
            <span className="text-sm text-text-muted">Claim from the supplier for returned goods, overbilling, a price difference or a deficient service. The supplier accepts, partly accepts or rejects it; no accounting until their credit is recorded.</span>
          </Link>
        )}
        {options.data.permissions.creditsManage && (
          <Link className={card} href={`/procurement/debit-notes-credits/vendor-credits/new${suffix}`}>
            <ReceiptText className="size-6 text-brand" aria-hidden="true" />
            <span className="text-base font-semibold">Record Vendor Credit</span>
            <span className="text-sm text-text-muted">The supplier issued a credit note, or accepted your debit claim. Posted through Finance, it reduces what you owe — applied to bills or refunded by the supplier.</span>
          </Link>
        )}
      </div>
    </div>
  );
}
