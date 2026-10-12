"use client";

// GST invoice history: POS tax invoices, bills of supply and credit notes at the outlets you work at — by number (exact first), buyer GSTIN,
// type, B2B / B2C and dates. Opening one shows its sale.
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { EnterpriseDataGrid, EnterpriseListPage, ErrorState, NoResultsState, SearchField, Select, StatusBadge, TextField } from "@vercentlabs/design-system";
import type { PosInvoice } from "@vercentlabs/api";

import { DOCUMENT_LABEL, listInvoices } from "@/features/pos/invoices/api/invoices-api";
import { PosApiError } from "@/features/pos/shared/http";
import { dateTime, money } from "@/features/pos/shared/format";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

const PAGE_SIZE = 25;

export function PosInvoicesScreen() {
  const router = useRouter();
  const workspace = useWorkspaceContext();
  const [search, setSearch] = useState("");
  const [documentType, setDocumentType] = useState("");
  const [supplyType, setSupplyType] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [pageIndex, setPageIndex] = useState(0);
  const filters = { search: search.trim() || undefined, documentType: documentType || undefined, supplyType: supplyType || undefined, dateFrom: dateFrom || undefined, dateTo: dateTo || undefined,
    limit: PAGE_SIZE, offset: pageIndex * PAGE_SIZE };
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "pos", "invoices", filters), queryFn: () => listInvoices(filters), placeholderData: (previous) => previous });
  const rows = query.data?.rows ?? [];
  const total = query.data?.total ?? 0;
  const reset = <T,>(set: (value: T) => void) => (value: T) => { setPageIndex(0); set(value); };

  const columns: ColumnDef<PosInvoice, unknown>[] = useMemo(() => [
    { id: "invoiceNumber", header: "Number", cell: ({ row }) => <span className="font-medium text-text">{row.original.invoiceNumber}</span> },
    { id: "issuedAt", header: "Issued", accessorFn: (row) => dateTime(row.issuedAt) },
    { id: "documentType", header: "Document", accessorFn: (row) => DOCUMENT_LABEL[row.documentType] ?? row.documentType },
    { id: "supplyType", header: "Supply", cell: ({ row }) => <StatusBadge tone={row.original.supplyType === "b2b" ? "info" : "neutral"}>{row.original.supplyType.toUpperCase()}</StatusBadge> },
    { id: "buyer", header: "Buyer", accessorFn: (row) => row.buyerGstin ?? row.buyer?.name ?? "Walk-in" },
    { id: "against", header: "Against", accessorFn: (row) => row.originalInvoiceNumber ?? "" },
    { id: "taxable", header: "Taxable", accessorFn: (row) => money(row.currency, row.taxableTotal) },
    { id: "tax", header: "Tax", accessorFn: (row) => money(row.currency, row.taxTotal) },
    { id: "total", header: "Total", accessorFn: (row) => money(row.currency, row.grandTotal) },
  ], []);

  return (
    <EnterpriseListPage
      header={{ title: "GST Invoices", description: "Tax invoices, bills of supply and credit notes issued at POS. An issued invoice is never edited — returns issue credit notes." }}
      actionBar={{
        start: (
          <>
            <SearchField aria-label="Invoice number or buyer GSTIN" placeholder="Invoice number or GSTIN…" value={search} onChange={reset(setSearch)} className="min-w-[220px]" />
            <Select aria-label="Document" size="compact" selectedKey={documentType} onSelectionChange={(key) => reset(setDocumentType)(String(key))}
              options={[{ value: "", label: "All documents" }, { value: "tax_invoice", label: "Tax invoices" }, { value: "invoice_cum_bill_of_supply", label: "Invoice cum bill of supply" },
                { value: "bill_of_supply", label: "Bills of supply" }, { value: "credit_note", label: "Credit notes" }]} />
            <Select aria-label="Supply" size="compact" selectedKey={supplyType} onSelectionChange={(key) => reset(setSupplyType)(String(key))}
              options={[{ value: "", label: "B2B and B2C" }, { value: "b2b", label: "B2B" }, { value: "b2c", label: "B2C" }]} />
            <TextField aria-label="From date" type="date" size="compact" value={dateFrom} onChange={reset(setDateFrom)} />
            <TextField aria-label="To date" type="date" size="compact" value={dateTo} onChange={reset(setDateTo)} />
          </>
        ),
      }}
    >
      <EnterpriseDataGrid<PosInvoice>
        aria-label="GST invoices"
        columns={columns}
        data={rows}
        getRowId={(row) => row.id}
        onRowClick={(row) => { if (row.saleId) router.push(`/pos/transactions/${row.saleId}`); }}
        state={query.isLoading ? "loading" : query.isError ? "error" : rows.length === 0 ? "empty" : "ready"}
        manualSorting
        pageIndex={pageIndex}
        pageSize={PAGE_SIZE}
        pageCount={Math.max(1, Math.ceil(total / PAGE_SIZE))}
        totalRowCount={total}
        onPageChange={setPageIndex}
        loadingContent={<p className="px-4 py-8 text-sm text-text-secondary">Loading invoices…</p>}
        emptyContent={<NoResultsState title="No invoices found" description="Invoices appear here as GST sales complete." />}
        errorContent={<ErrorState title="Could not load invoices" description={query.error instanceof PosApiError ? query.error.message : "Something went wrong."}
          action={{ label: "Retry", onPress: () => query.refetch() }} />}
      />
    </EnterpriseListPage>
  );
}
