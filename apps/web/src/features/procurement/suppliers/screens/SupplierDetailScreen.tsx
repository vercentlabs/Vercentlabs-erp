"use client";

// The supplier's 360°: who it is and whether it may be used, its places and
// people, the defaults new documents start from, its tax identity, and the
// documents it appears on. Purchase figures come from procurement
// documents; what it is owed from Accounts Payable (amounts only for those
// who may see payables). Actions are offered only when they are possible.
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Pencil, ShoppingCart } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Dialog, ErrorState, LinkButton, PermissionState, RecordDetailsPage, Tab, TabList, TabPanel, Tabs } from "@vercentlabs/design-system";

import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { calendarDate, dateTime, money } from "@/features/procurement/shared/format";

import { deleteSupplier, errorCode, errorMessage, getSummary, getSupplier, getSupplierOptions, type SupplierDetail, type SupplierOptions } from "../api/suppliers-api";
import { SupplierStatusBadge, formatAddress } from "../supplier-format";
import { StatusDialog, type StatusAction } from "../components/SupplierDialogs";
import { DocumentsPanel, FilesPanel, HistoryPanel, PaymentDetailsPanel } from "../components/SupplierPanels";
import { AddressesContactsPanel } from "../components/AddressesContactsPanel";
import { useTabParam } from "@/features/procurement/shared/navigation";
import { listDebitNotesAndCredits } from "@/features/procurement/vendor-credits/api/vendor-credits-api";
import { Facts, Notice, Panel } from "@/shared/ui/Panel";

const SUPPLIER_TABS = ["overview", "contacts", "addresses", "tax", "purchase-orders", "goods-receipts", "supplier-bills", "returns-credits", "payment-details", "notes", "history"] as const;

// The supplier's debit notes (claims) and vendor credits, from Debit Notes & Vendor Credits.
function SupplierCreditsPanel({ supplierId }: { supplierId: string }) {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "supplier-credits", supplierId), queryFn: () => listDebitNotesAndCredits({ supplierId }) });
  const rows = query.data?.rows ?? [];
  return (
    <Panel title="Debit claims and vendor credits" description="Claims raised with this supplier and the credits it gave."
      actions={<LinkButton size="compact" variant="secondary" href={`/procurement/debit-notes-credits/new?supplierId=${supplierId}`}>New Credit / Claim</LinkButton>}>
      {query.isLoading ? <p className="text-sm text-text-muted">Loading…</p> : !rows.length ? <p className="text-sm text-text-muted">None.</p> : (
        <ul className="flex flex-col divide-y divide-border text-sm">
          {rows.map((row) => <li key={`${row.kind}-${row.id}`} className="flex flex-wrap justify-between gap-2 py-2"><span><Link className="text-brand hover:underline" href={row.href}>{row.number}</Link>
            {" "}· {row.kind === "claim" ? "Debit claim" : "Vendor credit"} · {row.statusLabel}{row.settlementLabel ? ` · ${row.settlementLabel}` : ""}</span>
            <span className="tabular-nums">{money(row.currencyCode, row.total)}</span></li>)}
        </ul>
      )}
    </Panel>
  );
}

export function SupplierDetailScreen({ supplierId }: { supplierId: string }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const key = scopedQueryKey(workspace, "procurement", "supplier", supplierId);
  const query = useQuery({ queryKey: key, queryFn: () => getSupplier(supplierId) });
  const optionsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "supplier-options"), queryFn: getSupplierOptions, staleTime: 60_000 });
  const [notice, setNotice] = useState<string | null>(null);
  const changed = (message: string) => {
    setNotice(message);
    void queryClient.invalidateQueries({ queryKey: key });
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "procurement", "suppliers") });
  };
  if (query.isLoading || optionsQuery.isLoading) return <LoadingState label="Loading supplier" />;
  if (query.isError || !query.data) {
    if (errorCode(query.error) === "PERMISSION_DENIED") return <PermissionState title="You don't have access to suppliers" />;
    return <ErrorState title={errorCode(query.error) === "SUPPLIER_NOT_FOUND" ? "Supplier not found" : "Could not load this supplier"} description={errorMessage(query.error)}
      action={{ label: "Retry", onPress: () => query.refetch() }} />;
  }
  if (!optionsQuery.data) return <ErrorState title="Could not load this supplier" action={{ label: "Retry", onPress: () => optionsQuery.refetch() }} />;
  return <Supplier360 detail={query.data} options={optionsQuery.data} notice={notice} onChanged={changed} />;
}

function Supplier360({ detail, options, notice, onChanged }: { detail: SupplierDetail; options: SupplierOptions; notice: string | null; onChanged: (message: string) => void }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const { supplier, actions } = detail;
  const [tab, setTab] = useTabParam(SUPPLIER_TABS, "overview");
  const [statusAction, setStatusAction] = useState<StatusAction | null>(null);
  const [deleting, setDeleting] = useState(false);
  const summary = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "supplier", supplier.id, "summary"), queryFn: () => getSummary(supplier.id) });
  const remove = useMutation({ mutationFn: () => deleteSupplier(supplier.id), onSuccess: () => router.replace("/procurement/suppliers") });
  const purchases = summary.data?.purchases;
  const payables = summary.data?.payables;
  const base = options.baseCurrency;

  return (
    <div className="flex flex-col gap-4">
      {notice && <Notice tone="success">{notice}</Notice>}
      {supplier.status === "blocked" && (
        <Notice>
          Blocked{supplier.blockedAt ? ` on ${dateTime(supplier.blockedAt)}` : ""}{supplier.blockedByName ? ` by ${supplier.blockedByName}` : ""}: {supplier.blockedReason}.
          {" "}No new purchase orders, and draft orders cannot go forward. Bills already owed can still be paid by Finance.
        </Notice>
      )}
      {supplier.status === "inactive" && (
        <Notice tone="warning">Inactive{supplier.statusReason ? `: ${supplier.statusReason}` : ""}. Not offered for new business; its documents stay as they are.</Notice>
      )}
      <RecordDetailsPage
        header={{
          title: supplier.supplierName,
          status: <span className="flex items-center gap-2"><span className="tabular-nums text-text-muted">{supplier.supplierNumber}</span><SupplierStatusBadge status={supplier.status} /></span>,
          fields: [
            { label: "Category", value: supplier.categoryLabel },
            { label: "Currency", value: supplier.defaultCurrency },
            { label: "Payment terms", value: supplier.paymentTermName ?? "—" },
            { label: "Buyer", value: supplier.assignedBuyerName ?? "Unassigned" },
            { label: "GSTIN", value: supplier.gstin ?? "—" },
            ...(supplier.isCustomer ? [{ label: "Also customer", value: supplier.customerNumber ?? "Yes" }] : []),
          ],
          primaryAction: actions.createPurchaseOrder ? (
            <LinkButton variant="primary" href={`/procurement/purchase-orders/new?supplierId=${supplier.id}`}><ShoppingCart className="size-4" aria-hidden="true" />Create Purchase Order</LinkButton>
          ) : undefined,
          secondaryActions: (
            <div className="flex flex-wrap items-center gap-2">
              {actions.createBill && <LinkButton variant="secondary" href={`/procurement/supplier-bills/new?source=direct&supplierId=${supplier.id}`}>Create Supplier Bill</LinkButton>}
              {actions.edit && <LinkButton variant="secondary" href={`/procurement/suppliers/${supplier.id}/edit`}><Pencil className="size-4" aria-hidden="true" />Edit</LinkButton>}
              {actions.activate && <Button variant="secondary" onPress={() => setStatusAction("activate")}>Activate</Button>}
              {actions.unblock && <Button variant="secondary" onPress={() => setStatusAction("unblock")}>Unblock</Button>}
              {actions.deactivate && <Button variant="ghost" onPress={() => setStatusAction("deactivate")}>Deactivate</Button>}
              {actions.block && <Button variant="ghost" onPress={() => setStatusAction("block")}>Block</Button>}
              {detail.capabilities.status && <Button variant="ghost" onPress={() => setDeleting(true)}>Delete</Button>}
            </div>
          ),
        }}
      >
        <Tabs selectedKey={tab} onSelectionChange={(key) => setTab(String(key))}>
          <TabList aria-label="Supplier sections">
            <Tab id="overview">Overview</Tab>
            {actions.viewContacts && <Tab id="contacts">Contacts</Tab>}
            {actions.viewAddresses && <Tab id="addresses">Addresses</Tab>}
            <Tab id="tax">Tax &amp; Registrations</Tab>
            <Tab id="purchase-orders">Purchase Orders</Tab>
            <Tab id="goods-receipts">Goods Receipts</Tab>
            <Tab id="supplier-bills">Supplier Bills</Tab>
            <Tab id="returns-credits">Returns &amp; Credits</Tab>
            {actions.viewPaymentDetails && <Tab id="payment-details">Payment Details</Tab>}
            <Tab id="notes">Notes &amp; Attachments</Tab>
            <Tab id="history">History</Tab>
          </TabList>
          <TabPanel id="overview">
            <div className="flex flex-col gap-4 pt-4">
              <Panel title="Supplier">
                <Facts columns={3} items={[
                  { label: "Supplier name", value: supplier.supplierName },
                  { label: "Legal name", value: supplier.legalName ?? "—" },
                  { label: "Type", value: supplier.supplierTypeLabel },
                  { label: "Email", value: supplier.primaryEmail ?? "—" },
                  { label: "Phone", value: supplier.primaryPhone ?? "—" },
                  { label: "Website", value: supplier.website ? <a className="text-brand hover:underline" href={supplier.website} target="_blank" rel="noreferrer">{supplier.website}</a> : "—" },
                  { label: "Primary contact", value: supplier.primaryContact ? [supplier.primaryContact.name, supplier.primaryContact.email, supplier.primaryContact.phone].filter(Boolean).join(" · ") : "—" },
                  { label: "Primary location", value: supplier.primaryAddress ? `${supplier.primaryAddress.label ?? "Registered"}: ${formatAddress(supplier.primaryAddress)}` : "—" },
                  { label: "Country", value: supplier.countryCode ?? "—" },
                ]} />
              </Panel>
              <Panel title="Purchasing" description="From the procurement documents themselves.">
                {summary.isLoading ? <p className="text-sm text-text-muted">Loading…</p> : purchases ? (
                  <Facts columns={4} items={[
                    { label: "Purchase orders", value: purchases.purchaseOrders },
                    { label: "Open purchase orders", value: purchases.openPurchaseOrders },
                    { label: "Last purchase", value: purchases.lastPurchaseAt ? calendarDate(purchases.lastPurchaseAt) : "None yet" },
                    { label: "Open goods receipts", value: purchases.openGoodsReceipts },
                  ]} />
                ) : <Notice>{errorMessage(summary.error)}</Notice>}
              </Panel>
              <Panel title="Payables" description="From Accounts Payable. Procurement keeps no balance of its own.">
                {payables ? (
                  <Facts columns={4} items={[
                    { label: "Open bills", value: payables.openBills },
                    { label: "Overdue bills", value: payables.overdueBills },
                    ...(payables.amountsVisible ? [
                      { label: "Open payables", value: money(base, payables.openPayables ?? 0) },
                      { label: "Overdue payables", value: money(base, payables.overduePayables ?? 0) },
                      { label: "Unapplied supplier credits", value: money(base, payables.unappliedCredits ?? 0) },
                      { label: "Last payment", value: payables.lastPayment ? `${payables.lastPayment.number} · ${money(payables.lastPayment.currency, payables.lastPayment.amount)} · ${calendarDate(payables.lastPayment.date)}` : "None yet" },
                    ] : []),
                  ]} />
                ) : <p className="text-sm text-text-muted">Loading…</p>}
                {payables && !payables.amountsVisible && <p className="text-xs text-text-muted">Amounts are shown to people who may see supplier payables.</p>}
              </Panel>
              <Panel title="Commercial defaults" description="New RFQs and purchase orders start from these. A document keeps what it was given: changing them here never changes an existing order or bill.">
                <Facts columns={3} items={[
                  { label: "Default currency", value: supplier.defaultCurrency },
                  { label: "Default payment terms", value: supplier.paymentTermName ?? "—" },
                  { label: "MSME classification", value: supplier.msme?.classification ? `${{ micro: "Micro", small: "Small", medium: "Medium", not_msme: "Not an MSME" }[supplier.msme.classification] ?? supplier.msme.classification}${supplier.msme.registrationNumber ? ` · ${supplier.msme.registrationNumber}` : ""}${supplier.msme.effectiveFrom ? ` (from ${supplier.msme.effectiveFrom})` : ""}` : "Not recorded" },
                  { label: "Payment agreement", value: supplier.msme?.writtenPaymentAgreement ? `Written: ${supplier.msme.agreedPaymentDays ?? "—"} days${supplier.msme.paymentAgreementReference ? ` · ${supplier.msme.paymentAgreementReference}` : ""}` : "No written agreement" },
                  { label: "Buyer", value: supplier.assignedBuyerName ?? "Unassigned" },
                  { label: "Category", value: supplier.categoryLabel },
                  ...(["ordering", "rfq", "accounts", "dispatch"] as const).map((purpose) => ({
                    label: { ordering: "Ordering contact", rfq: "RFQ contact", accounts: "Accounts contact", dispatch: "Dispatch contact" }[purpose],
                    value: detail.contacts.find((contact) => contact.id === detail.defaults.contacts[purpose])?.name ?? supplier.primaryContact?.name ?? "—",
                  })),
                  ...(["ordering", "billing", "ship_from", "return_to"] as const).map((purpose) => ({
                    label: { ordering: "Ordering address", billing: "Billing address", ship_from: "Ship-from location", return_to: "Return-to location" }[purpose],
                    value: detail.addresses.find((address) => address.id === detail.defaults.addresses[purpose])?.label ?? "—",
                  })),
                ]} />
              </Panel>
            </div>
          </TabPanel>
          {actions.viewContacts && <TabPanel id="contacts"><div className="pt-4"><AddressesContactsPanel detail={detail} options={options} onChanged={onChanged} onShowHistory={() => setTab("history")} show="contacts" /></div></TabPanel>}
          {actions.viewAddresses && <TabPanel id="addresses"><div className="pt-4"><AddressesContactsPanel detail={detail} options={options} onChanged={onChanged} onShowHistory={() => setTab("history")} show="addresses" /></div></TabPanel>}
          <TabPanel id="tax">
            <div className="flex flex-col gap-4 pt-4">
              <Panel title="Tax identity" description="Master data: each document keeps a snapshot, so a change here never rewrites a posted bill.">
                <Facts columns={3} items={[
                  { label: "GST registration type", value: supplier.gstRegistrationLabel ?? "—" },
                  { label: "GSTIN", value: supplier.gstin ?? "—" },
                  { label: "PAN / Tax ID", value: supplier.pan ?? "—" },
                  { label: "Registered state", value: supplier.registeredStateName ? `${supplier.registeredStateName} (${supplier.registeredStateCode})` : "—" },
                  { label: "Country", value: supplier.countryCode ?? "—" },
                  { label: "Supplier type", value: supplier.supplierTypeLabel },
                ]} />
              </Panel>
              <Panel title="GST registrations" description="Every registration of this supplier and the locations it covers. Managed under Addresses & Contacts.">
                {detail.taxRegistrations.length ? (
                  <ul className="flex flex-col divide-y divide-border text-sm">
                    {detail.taxRegistrations.map((registration) => {
                      const covered = detail.addresses.filter((address) => address.taxRegistration?.id === registration.id && address.status === "active");
                      return (
                        <li key={registration.id} className={`py-2 ${registration.status !== "active" ? "opacity-60" : ""}`}>
                          <span className="font-medium tabular-nums">{registration.gstin}</span>
                          {" "}· {registration.registrationLabel} · {registration.stateName ?? registration.stateCode}{registration.isPrincipal ? " · principal" : ""}
                          {registration.status !== "active" ? " · inactive" : ""}
                          <span className="block text-xs text-text-muted">{covered.length ? covered.map((address) => `${address.label}, ${address.city}`).join(" · ") : "No location linked"}</span>
                        </li>
                      );
                    })}
                  </ul>
                ) : <p className="text-sm text-text-muted">No GST registrations.</p>}
              </Panel>
            </div>
          </TabPanel>
          <TabPanel id="purchase-orders"><div className="pt-4"><DocumentsPanel supplierId={supplier.id} kind="orders" /></div></TabPanel>
          <TabPanel id="goods-receipts"><div className="pt-4"><DocumentsPanel supplierId={supplier.id} kind="receipts" /></div></TabPanel>
          <TabPanel id="supplier-bills">
            <div className="flex flex-col gap-4 pt-4">
              <DocumentsPanel supplierId={supplier.id} kind="bills" />
              {actions.viewPayables && <DocumentsPanel supplierId={supplier.id} kind="payments" />}
            </div>
          </TabPanel>
          <TabPanel id="returns-credits"><div className="flex flex-col gap-4 pt-4"><DocumentsPanel supplierId={supplier.id} kind="returns" /><SupplierCreditsPanel supplierId={supplier.id} /></div></TabPanel>
          {actions.viewPaymentDetails && <TabPanel id="payment-details"><div className="pt-4"><PaymentDetailsPanel detail={detail} options={options} onChanged={onChanged} /></div></TabPanel>}
          <TabPanel id="notes">
            <div className="flex flex-col gap-4 pt-4">
              <Panel title="Internal notes" description="Never printed on a purchase order.">
                <p className="whitespace-pre-line text-sm">{supplier.notes ?? <span className="text-text-muted">None</span>}</p>
              </Panel>
              <FilesPanel detail={detail} />
            </div>
          </TabPanel>
          <TabPanel id="history"><div className="pt-4"><HistoryPanel supplierId={supplier.id} /></div></TabPanel>
        </Tabs>
      </RecordDetailsPage>

      {statusAction && <StatusDialog supplier={supplier} action={statusAction} onClose={() => setStatusAction(null)} onDone={(message) => { setStatusAction(null); onChanged(message); }} />}
      {deleting && (
        <Dialog isOpen onOpenChange={(open) => !open && setDeleting(false)} title={`Delete ${supplier.supplierNumber}?`}
          description="Only a supplier created by mistake and never used can be deleted. One that has been used is deactivated or blocked instead.">
          <div className="flex flex-col gap-3">
            {remove.error && <Notice>{errorMessage(remove.error)}</Notice>}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onPress={() => setDeleting(false)}>Cancel</Button>
              <Button variant="danger" isLoading={remove.isPending || remove.isSuccess} onPress={() => remove.mutate()}>Delete supplier</Button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
}
