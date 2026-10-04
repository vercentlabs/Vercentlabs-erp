"use client";

// Overview tab: Identity, Commercial, Tax, CRM, Financial Summary and Sales
// Summary. Financial figures come from Accounting and are shown only when
// the server returns them.
import type { ReactNode } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { countryName, formatDate, formatDateTime, formatMoney } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { getCustomerOverview, type Customer } from "../api/customers-api";

function Card({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-text">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function Facts({ items }: { items: Array<[string, ReactNode]> }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      {items.map(([label, value]) => (
        <div key={label} className="flex flex-col gap-0.5">
          <dt className="text-xs font-medium text-text-muted">{label}</dt>
          <dd className="text-sm break-words text-text">{value === null || value === undefined || value === "" ? <span className="text-text-muted">Not set</span> : value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Figure({ label, value, tone }: { label: string; value: ReactNode; tone?: "danger" }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs font-medium text-text-muted">{label}</span>
      <span className={`text-lg font-semibold tabular-nums ${tone === "danger" ? "text-danger" : "text-text"}`}>{value}</span>
    </div>
  );
}

export function CustomerOverviewPanel({ customer, onOpenTab }: { customer: Customer; onOpenTab: (tab: string) => void }) {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "sales", "customer", customer.id, "overview"), queryFn: () => getCustomerOverview(customer.id) });
  const overview = query.data;
  const tabLink = (tab: string, label: string) => <button type="button" className="text-xs text-brand underline-offset-2 hover:underline" onClick={() => onOpenTab(tab)}>{label}</button>;

  return (
    <div className="grid gap-4 pt-3 lg:grid-cols-2">
      <Card title="Identity">
        <Facts items={[
          ["Customer number", customer.customerNumber],
          ["Customer type", customer.customerKindLabel],
          ["Customer name", customer.displayName],
          ["Legal name", customer.legalName],
          ["Email", customer.email ? <a className="hover:underline" href={`mailto:${customer.email}`}>{customer.email}</a> : null],
          ["Phone", customer.phone ? <a className="hover:underline" href={`tel:${customer.phone}`}>{customer.phone}</a> : null],
          ["Website", customer.website ? <a className="hover:underline" href={customer.website} target="_blank" rel="noreferrer">{customer.website.replace(/^https?:\/\//, "")}</a> : null],
          ["Country", customer.countryCode ? countryName(customer.countryCode) : null],
          ["Primary contact", customer.primaryContactName ? [customer.primaryContactName, customer.primaryContactPhone].filter(Boolean).join(" · ") : null],
          ["Salesperson", customer.ownerName],
          ["Created", [customer.createdByName, formatDateTime(customer.createdAt)].filter(Boolean).join(" · ")],
          ["Last updated", [customer.updatedByName, formatDateTime(customer.updatedAt)].filter(Boolean).join(" · ")],
        ]} />
        {customer.notes && <p className="border-t border-border pt-3 text-sm whitespace-pre-wrap text-text-secondary">{customer.notes}</p>}
      </Card>

      <div className="flex flex-col gap-4">
        <Card title="Commercial">
          <Facts items={[["Currency", customer.currencyCode], ["Price list", customer.priceListName ?? "Standard prices"], ["Payment terms", customer.paymentTermName]]} />
        </Card>
        <Card title="Tax">
          <Facts items={[
            ["GST registration type", customer.gstRegistrationLabel],
            ["GSTIN", customer.gstin],
            ["PAN", customer.pan],
            ["GST state", customer.gstStateName ? `${customer.gstStateName} (${customer.gstStateCode})` : null],
            ["Place of supply", customer.placeOfSupplyName ? `${customer.placeOfSupplyName} (${customer.placeOfSupply})` : null],
          ]} />
        </Card>
      </div>

      {query.isLoading && <div className="lg:col-span-2"><LoadingState label="Loading summary" rows={3} /></div>}

      {overview && (
        <Card title="CRM">
          <Facts items={[
            ["CRM account", overview.access.crm ? <Link className="text-brand underline-offset-2 hover:underline" href={`/crm/accounts/${overview.crm.accountId}`}>{overview.crm.accountName} ({overview.crm.accountNumber})</Link> : `${overview.crm.accountName} (${overview.crm.accountNumber})`],
            ["Account owner", overview.crm.ownerName ?? "Unassigned"],
          ]} />
          {overview.access.crm && (
            <div className="flex flex-col gap-1 border-t border-border pt-3">
              <span className="text-xs font-medium text-text-muted">Open opportunities</span>
              {overview.crm.openOpportunities.length === 0 ? <span className="text-sm text-text-muted">None</span> : (
                <ul className="flex flex-col divide-y divide-border text-sm">
                  {overview.crm.openOpportunities.map((opportunity) => (
                    <li key={opportunity.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                      <Link className="text-brand underline-offset-2 hover:underline" href={opportunity.href}>{opportunity.name}</Link>
                      <span className="text-text-secondary">
                        {[opportunity.stageName, opportunity.amount !== null ? formatMoney(opportunity.currencyCode, opportunity.amount) : null,
                          opportunity.expectedCloseDate ? `closes ${formatDate(opportunity.expectedCloseDate)}` : null].filter(Boolean).join(" · ")}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </Card>
      )}

      {overview?.sales && (
        <Card title="Sales summary">
          <div className="grid grid-cols-3 gap-4">
            <Figure label="Open quotations" value={overview.sales.openQuotations} />
            <Figure label="Open sales orders" value={overview.sales.openSalesOrders} />
            <Figure label="Pending deliveries" value={overview.sales.pendingDeliveries} />
          </div>
          <p className="text-xs text-text-muted">{overview.sales.lastOrderDate ? `Last order on ${formatDate(overview.sales.lastOrderDate)}.` : "No orders yet."}</p>
          <div className="flex flex-wrap gap-3">{tabLink("quotations", "Quotations")}{tabLink("orders", "Sales orders")}{tabLink("deliveries", "Deliveries")}</div>
        </Card>
      )}

      {overview?.finance && (
        <div className="lg:col-span-2">
          <Card title="Financial summary">
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <Figure label="Outstanding receivable" value={formatMoney(overview.finance.currencyCode, overview.finance.outstanding)} />
              <Figure label="Overdue" value={formatMoney(overview.finance.currencyCode, overview.finance.overdue)} tone={overview.finance.overdue > 0 ? "danger" : undefined} />
              <Figure label="Unallocated advance" value={formatMoney(overview.finance.currencyCode, overview.finance.unallocatedAdvance)} />
              <Figure label="Last payment" value={overview.finance.lastPaymentDate ? formatDate(overview.finance.lastPaymentDate) : "None"} />
            </div>
            {overview.finance.lastPaymentAmount !== null && (
              <p className="text-xs text-text-muted">Last payment {overview.finance.lastPaymentNumber}: {formatMoney(overview.finance.currencyCode, overview.finance.lastPaymentAmount)}.</p>
            )}
            <div className="flex flex-col gap-1 border-t border-border pt-3">
              <span className="text-xs font-medium text-text-muted">Receivables aging · {overview.finance.openInvoices} open {overview.finance.openInvoices === 1 ? "invoice" : "invoices"}</span>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                {overview.finance.aging.map((bucket) => (
                  <div key={bucket.key} className="flex flex-col gap-0.5 rounded-[var(--radius-control)] border border-border px-3 py-2">
                    <span className="text-xs text-text-muted">{bucket.label}</span>
                    <span className="text-sm font-medium tabular-nums">{formatMoney(overview.finance!.currencyCode, bucket.amount)}</span>
                  </div>
                ))}
              </div>
            </div>
            <p className="text-xs text-text-muted">These figures come from Accounting. They cannot be edited here.</p>
            <div className="flex flex-wrap gap-3">
              {tabLink("invoices", "Customer statement: invoices")}{tabLink("payments", "Payments")}
              <Link className="text-xs text-brand underline-offset-2 hover:underline" href="/accounting/customer-invoices">Open receivables in Accounting</Link>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
