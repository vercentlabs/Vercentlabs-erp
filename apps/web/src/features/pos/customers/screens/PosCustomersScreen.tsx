"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ExternalLink, ShoppingCart } from "lucide-react";
import { Button, Dialog, ErrorState, PermissionState, SearchField, StatusBadge } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { PosApiError } from "@/features/pos/shared/http";
import { searchPosCustomers, type PosCustomerMatch } from "@/features/pos/checkout/api/checkout-api";
import { listPosCustomerSales } from "@/features/pos/customers/api/customers-api";
import { getPosCustomerLoyaltyBalance } from "@/features/pos/loyalty/api/loyalty-api";
import { listPosInvoices } from "@/features/pos/invoices/api/invoices-api";
import { money, calendarDate } from "@/features/pos/shared/format";

// F276/F287-F290 -- a POS-scoped customer workspace, deliberately following
// PosLoyaltyScreen.tsx/PosInvoicesScreen.tsx's plain-panel convention rather
// than EnterpriseListPage (neither sibling customer-adjacent POS screen uses
// it either). This is NOT a second customer database: search is the exact
// bounded business_parties lookup checkout already uses, and every record
// shown here (loyalty ledger, invoices, sales) is read from its own existing
// authoritative source, never duplicated. CRM (tenant.business_parties
// directly, for a party_type of customer/both/prospect -- see
// services/api/src/modules/crm/prospect-and-relationship-master-data/
// account-operations.js's ACCOUNT_TYPES) stays the record of truth; the
// "View in CRM" link below is exact because a POS customer id IS a CRM
// account id, the same row.
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

  const searchQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "pos", "customers-workspace", "search", debouncedSearch),
    queryFn: () => searchPosCustomers(debouncedSearch),
    enabled: debouncedSearch.trim().length > 0,
  });

  const isPermissionDenied = searchQuery.isError && searchQuery.error instanceof PosApiError && searchQuery.error.status === 403;
  const rows = searchQuery.data?.rows ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-text">Customers</h1>
        <p className="text-sm text-text-secondary">
          Search POS customers, review their purchase history and loyalty balance at this store, and jump into a new sale or their full CRM record.
        </p>
      </div>

      <div className="flex flex-col gap-3 rounded-[var(--radius-panel)] border border-border-strong bg-surface p-5">
        <div className="flex items-end gap-2">
          <SearchField
            label="Search customers"
            placeholder="Name, code, phone or email…"
            value={searchInput}
            onChange={setSearchInput}
            className="flex-1"
          />
          <Link href="/crm/accounts/new">
            <Button variant="secondary">New customer</Button>
          </Link>
        </div>

        {isPermissionDenied ? (
          <PermissionState title="You don't have access to POS customers" />
        ) : searchQuery.isError ? (
          <ErrorState title="Customers could not be searched" action={{ label: "Retry", onPress: () => searchQuery.refetch() }} />
        ) : !debouncedSearch.trim() ? (
          <p className="p-3 text-sm text-text-muted">Type at least one character to search.</p>
        ) : searchQuery.isFetching ? (
          <p className="p-3 text-sm text-text-secondary">Searching…</p>
        ) : rows.length === 0 ? (
          <p className="p-3 text-sm text-text-muted">No matching customers.</p>
        ) : (
          <div className="divide-y divide-border rounded-[var(--radius-control)] border border-border-strong">
            {rows.map((customer) => (
              <button
                key={customer.id}
                type="button"
                onClick={() => setSelected(customer)}
                className="flex w-full items-center justify-between px-4 py-3 text-left text-sm hover:bg-surface-muted"
              >
                <div>
                  <p className="font-medium text-text">{customer.displayName}</p>
                  <p className="text-xs text-text-muted">
                    {customer.code}
                    {(customer.phone || customer.email) && <> · {customer.phone || customer.email}</>}
                  </p>
                </div>
                <ArrowRight className="size-4 text-text-muted" aria-hidden="true" />
              </button>
            ))}
          </div>
        )}
      </div>

      {selected && <PosCustomerDetailDialog customer={selected} onClose={() => setSelected(null)} />}
    </div>
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
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={customer.displayName}>
      <div className="flex max-h-[75vh] flex-col gap-5 overflow-y-auto pr-1">
        <div className="flex flex-wrap items-center gap-2 text-sm text-text-secondary">
          <span>{customer.code}</span>
          {customer.phone && <span>· {customer.phone}</span>}
          {customer.email && <span>· {customer.email}</span>}
        </div>

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

        <section className="rounded-[var(--radius-control)] border border-border-strong p-3">
          <h3 className="mb-2 text-sm font-semibold text-text">Loyalty balance</h3>
          {balanceQuery.isLoading ? (
            <p className="text-sm text-text-secondary">Loading…</p>
          ) : balanceQuery.isError ? (
            <p className="text-sm text-text-muted">No loyalty balance on record.</p>
          ) : (
            <p className="text-sm text-text">
              <span className="tabular-nums font-medium">{balanceQuery.data?.balance.balance ?? "0"}</span> points
            </p>
          )}
          <Link href="/pos/loyalty" className="mt-2 inline-block text-xs text-brand hover:underline">
            Full ledger in Loyalty →
          </Link>
        </section>

        <section className="rounded-[var(--radius-control)] border border-border-strong p-3">
          <h3 className="mb-2 text-sm font-semibold text-text">Purchase history at this POS</h3>
          {salesQuery.isLoading ? (
            <p className="text-sm text-text-secondary">Loading…</p>
          ) : salesQuery.isError ? (
            <p className="text-sm text-text-muted">Purchase history could not be loaded.</p>
          ) : !salesQuery.data?.rows.length ? (
            <p className="text-sm text-text-muted">No POS sales for this customer yet.</p>
          ) : (
            <div className="flex flex-col divide-y divide-border">
              {salesQuery.data.rows.map((sale) => (
                <Link
                  key={sale.id}
                  href={`/pos/receipts/${sale.id}`}
                  className="flex items-center justify-between py-2 text-sm hover:text-brand"
                >
                  <span>
                    {sale.receipt_number} · {calendarDate(sale.sale_date)}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="tabular-nums">{money(sale.currency_code, sale.grand_total)}</span>
                    <StatusBadge tone={sale.status === "completed" ? "success" : "neutral"}>{sale.status}</StatusBadge>
                  </span>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-[var(--radius-control)] border border-border-strong p-3">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-text">Invoices</h3>
            <Link href="/pos/invoices" className="text-xs text-brand hover:underline">
              All invoices →
            </Link>
          </div>
          {invoicesQuery.isLoading ? (
            <p className="text-sm text-text-secondary">Loading…</p>
          ) : invoicesQuery.isError ? (
            <p className="text-sm text-text-muted">Invoices could not be loaded.</p>
          ) : !invoicesQuery.data?.rows.length ? (
            <p className="text-sm text-text-muted">No tax invoices generated for this customer yet.</p>
          ) : (
            <div className="flex flex-col divide-y divide-border">
              {invoicesQuery.data.rows.map((invoice) => (
                <Link
                  key={invoice.invoice_id}
                  href={`/pos/receipts/${invoice.sale_id}`}
                  className="flex items-center justify-between py-2 text-sm hover:text-brand"
                >
                  <span>{invoice.invoice_number}</span>
                  <span className="tabular-nums">{money(invoice.currency_code, invoice.grand_total)}</span>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-[var(--radius-control)] border border-border-strong p-3">
          <h3 className="mb-1 text-sm font-semibold text-text">Returns</h3>
          <p className="mb-2 text-sm text-text-muted">Review this customer&apos;s returns from the Returns screen.</p>
          <Link href="/pos/returns" className="text-xs text-brand hover:underline">
            Go to Returns →
          </Link>
        </section>
      </div>
    </Dialog>
  );
}
