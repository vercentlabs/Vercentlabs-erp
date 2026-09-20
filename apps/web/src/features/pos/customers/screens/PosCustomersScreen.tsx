"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { ExternalLink, Plus, ShoppingCart } from "lucide-react";
import { Button, Dialog, EnterpriseDataGrid, EnterpriseListPage, ErrorState, NoResultsState, PermissionState, SearchField, StatusBadge } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { PosApiError } from "@/features/pos/shared/http";
import { searchPosCustomers, type PosCustomerMatch } from "@/features/pos/checkout/api/checkout-api";
import { listPosCustomerSales } from "@/features/pos/customers/api/customers-api";
import { getPosCustomerLoyaltyBalance } from "@/features/pos/loyalty/api/loyalty-api";
import { listPosInvoices } from "@/features/pos/invoices/api/invoices-api";
import { calendarDate, money, statusLabel, statusTone } from "@/features/pos/shared/format";
import { PosDataTable, PosFacts, PosPanel } from "@/features/pos/shared/PosUi";

// F276/F287-F290 -- a POS-scoped customer workspace. This is NOT a second
// customer database: search is the exact bounded business_parties lookup
// checkout already uses, and every record shown here (loyalty ledger,
// invoices, sales) is read from its own existing authoritative source,
// never duplicated. CRM (tenant.business_parties directly, for a party_type
// of customer/both/prospect -- see services/api/src/modules/crm/
// prospect-and-relationship-master-data/account-operations.js's
// ACCOUNT_TYPES) stays the record of truth; the "View in CRM" link below is
// exact because a POS customer id IS a CRM account id, the same row.
export function PosCustomersScreen() {
  const workspace = useWorkspaceContext();
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selected, setSelected] = useState<PosCustomerMatch | null>(null);

  // Mirrors PosCheckoutScreen.tsx's own customer-search debounce exactly
  // (250ms) so search-as-you-type behaves identically in both places.
  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(searchInput), 250);
    return () => clearTimeout(handle);
  }, [searchInput]);

  const hasSearch = debouncedSearch.trim().length > 0;
  const searchQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "pos", "customers-workspace", "search", debouncedSearch),
    queryFn: () => searchPosCustomers(debouncedSearch),
    enabled: hasSearch,
  });

  const isPermissionDenied = searchQuery.isError && searchQuery.error instanceof PosApiError && searchQuery.error.status === 403;
  const rows = searchQuery.data?.rows ?? [];

  const columns: ColumnDef<PosCustomerMatch, unknown>[] = useMemo(
    () => [
      { id: "name", header: "Customer", accessorKey: "displayName", cell: ({ row }) => <span className="font-medium text-text">{row.original.displayName}</span> },
      { id: "code", header: "Code", accessorKey: "code" },
      { id: "phone", header: "Phone", accessorFn: (row) => row.phone || "—" },
      { id: "email", header: "Email", accessorFn: (row) => row.email || "—" },
    ],
    [],
  );

  const gridState = isPermissionDenied
    ? "permission-denied"
    : searchQuery.isError
      ? "error"
      : !hasSearch
        ? "empty"
        : searchQuery.isFetching && !searchQuery.data
          ? "loading"
          : rows.length === 0
            ? "no-results"
            : "ready";

  return (
    <EnterpriseListPage
      header={{
        title: "Customers",
        description: "Search POS customers, review their purchase history and loyalty balance, and jump into a new sale or their full CRM record.",
        primaryAction: (
          <Link href="/crm/accounts/new">
            <Button variant="primary">
              <Plus className="size-4" aria-hidden="true" />
              New customer
            </Button>
          </Link>
        ),
      }}
      actionBar={{
        start: <SearchField aria-label="Search customers" placeholder="Name, code, phone or email…" value={searchInput} onChange={setSearchInput} className="min-w-[280px]" />,
      }}
    >
      <EnterpriseDataGrid<PosCustomerMatch>
        aria-label="POS customers"
        columns={columns}
        data={rows}
        getRowId={(row) => row.id}
        state={gridState}
        loadingContent={<p className="px-4 py-8 text-sm text-text-secondary">Searching…</p>}
        emptyContent={<NoResultsState title="Search for a customer" description="Type a name, code, phone number or email to find a customer." />}
        noResultsContent={<NoResultsState title="No matching customers" description="Check the spelling, or create the customer in CRM." />}
        errorContent={<ErrorState title="Customers could not be searched" action={{ label: "Retry", onPress: () => searchQuery.refetch() }} />}
        permissionDeniedContent={<PermissionState title="You don't have access to POS customers" />}
        onRowClick={(row) => setSelected(row)}
      />

      {selected && <PosCustomerDetailDialog customer={selected} onClose={() => setSelected(null)} />}
    </EnterpriseListPage>
  );
}

function PosCustomerDetailDialog({ customer, onClose }: { customer: PosCustomerMatch; onClose: () => void }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();

  const balanceQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "pos", "customers-workspace", "loyalty-balance", customer.id),
    queryFn: () => getPosCustomerLoyaltyBalance(customer.id),
  });
  const salesQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "pos", "customers-workspace", "sales", customer.id),
    queryFn: () => listPosCustomerSales(customer.id, 20),
  });
  const invoicesQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "pos", "customers-workspace", "invoices", customer.id),
    queryFn: () => listPosInvoices({ customerId: customer.id, limit: 10 }),
  });

  function startSale() {
    router.push(`/pos/checkout?customerId=${encodeURIComponent(customer.id)}&customerName=${encodeURIComponent(customer.displayName)}`);
  }

  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={customer.displayName} size="lg">
      <div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto pr-1">
        <PosFacts
          columns={3}
          items={[
            { label: "Code", value: customer.code },
            { label: "Phone", value: customer.phone || "—" },
            { label: "Email", value: customer.email || "—" },
          ]}
        />

        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onPress={startSale}>
            <ShoppingCart className="size-4" aria-hidden="true" />
            Start sale for this customer
          </Button>
          <Link href={`/crm/accounts/${customer.id}`} target="_blank" rel="noopener noreferrer">
            <Button variant="secondary">
              <ExternalLink className="size-4" aria-hidden="true" />
              View in CRM
            </Button>
          </Link>
        </div>

        <PosPanel
          title="Loyalty balance"
          actions={
            <Link href="/pos/loyalty" className="text-xs font-medium text-brand hover:underline">
              Full ledger in Loyalty
            </Link>
          }
        >
          {balanceQuery.isLoading ? (
            <p className="text-sm text-text-secondary">Loading…</p>
          ) : balanceQuery.isError ? (
            <p className="text-sm text-text-muted">No loyalty balance on record.</p>
          ) : (
            <p className="text-sm text-text">
              <span className="text-lg font-semibold tabular-nums">{balanceQuery.data?.balance.balance ?? "0"}</span> points
            </p>
          )}
        </PosPanel>

        <PosPanel title="Purchase history at this POS">
          {salesQuery.isLoading ? (
            <p className="text-sm text-text-secondary">Loading…</p>
          ) : salesQuery.isError ? (
            <p className="text-sm text-text-muted">Purchase history could not be loaded.</p>
          ) : (
            <PosDataTable
              rows={salesQuery.data?.rows ?? []}
              empty="No POS sales for this customer yet."
              columns={[
                {
                  key: "receipt_number",
                  header: "Receipt",
                  render: (sale) => (
                    <Link href={`/pos/receipts/${sale.id}`} className="font-medium text-brand hover:underline">
                      {sale.receipt_number}
                    </Link>
                  ),
                },
                { key: "sale_date", header: "Date", render: (sale) => calendarDate(sale.sale_date) },
                { key: "status", header: "Status", render: (sale) => <StatusBadge tone={statusTone(sale.status)}>{statusLabel(sale.status)}</StatusBadge> },
                { key: "grand_total", header: "Total", numeric: true, render: (sale) => money(sale.currency_code, sale.grand_total) },
              ]}
            />
          )}
        </PosPanel>

        <PosPanel
          title="Invoices"
          actions={
            <Link href="/pos/invoices" className="text-xs font-medium text-brand hover:underline">
              All invoices
            </Link>
          }
        >
          {invoicesQuery.isLoading ? (
            <p className="text-sm text-text-secondary">Loading…</p>
          ) : invoicesQuery.isError ? (
            <p className="text-sm text-text-muted">Invoices could not be loaded.</p>
          ) : (
            <PosDataTable
              rows={invoicesQuery.data?.rows ?? []}
              empty="No tax invoices generated for this customer yet."
              columns={[
                {
                  key: "invoice_number",
                  header: "Invoice",
                  render: (invoice) => (
                    <Link href={`/pos/receipts/${invoice.sale_id}`} className="font-medium text-brand hover:underline">
                      {invoice.invoice_number}
                    </Link>
                  ),
                },
                { key: "grand_total", header: "Total", numeric: true, render: (invoice) => money(invoice.currency_code, invoice.grand_total) },
              ]}
            />
          )}
        </PosPanel>

        <PosPanel title="Returns" description="Review this customer's returns from the Returns screen.">
          <div>
            <Link href="/pos/returns" className="text-sm font-medium text-brand hover:underline">
              Go to Returns
            </Link>
          </div>
        </PosPanel>
      </div>
    </Dialog>
  );
}
