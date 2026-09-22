"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Archive, ArrowLeft, Pencil, Plus } from "lucide-react";
import { Button, Dialog, EnterpriseDataGrid, ErrorState, PermissionState, RecordDetailsPage, Select, StatusBadge, Switch, Tab, TabList, TabPanel, Tabs, TextField } from "@vercentlabs/design-system";
import { BUSINESS_DATA_PERMISSIONS } from "@vercentlabs/permissions";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { SalesApiError } from "@/features/sales/shared/http";
import { money, statusLabel, statusTone } from "@/features/sales/shared/format";
import { SalesAlert, SalesFacts, SalesPanel } from "@/features/sales/shared/SalesUi";
import { getSalesOptions, listSalesQuotations, type SalesOptions, type SalesQuotationRow } from "@/features/sales/quotations/api/quotations-api";
import { listSalesOrders, type SalesOrderRow } from "@/features/sales/orders/api/orders-api";
import { archiveRecord, createRecord, getCustomer, getCustomerCredit, updateRecord, type AddressInput, type ContactInput, type CustomerRecord } from "@/features/sales/master/api/master-api";
import { CustomerDialog } from "@/features/sales/master/screens/SalesCustomersScreen";

type Contact = SalesOptions["contacts"][number] & { designation?: string | null; phone?: string | null; mobile?: string | null };
type Address = SalesOptions["addresses"][number] & { line2?: string | null; district?: string | null; state?: string | null; state_code?: string | null; postal_code?: string | null; country_code?: string | null; gstin?: string | null };

const ADDRESS_TYPES = ["registered", "billing", "shipping", "office", "plant", "other"].map((value) => ({ value, label: statusLabel(value) }));

// F031/F032 -- one customer: profile, contacts, addresses and their orders.
export function SalesCustomerDetailScreen({ customerId }: { customerId: string }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const queryClient = useQueryClient();
  const can = (permission: string) => workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes(permission);
  const canManage = can(BUSINESS_DATA_PERMISSIONS.partiesManage);
  const [editing, setEditing] = useState(false);
  const [contactDialog, setContactDialog] = useState<Contact | "new" | null>(null);
  const [addressDialog, setAddressDialog] = useState<Address | "new" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmingArchive, setConfirmingArchive] = useState(false);

  const customerQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "sales", "customer", customerId),
    queryFn: () => getCustomer(customerId).then((r) => r.record),
    retry: (count, error) => !(error instanceof SalesApiError && [403, 404].includes(error.status)) && count < 2,
  });
  const optionsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "sales", "options", customerId), queryFn: () => getSalesOptions(customerId).then((r) => r.options) });
  const ordersQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "sales", "orders", "customer", customerId),
    enabled: Boolean(customerQuery.data),
    queryFn: () => listSalesOrders({ partyId: customerId, limit: 100 }).then((r) => r.rows),
  });
  const quotationsQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "sales", "quotations", "customer", customerId),
    enabled: Boolean(customerQuery.data),
    queryFn: () => listSalesQuotations({ partyId: customerId, limit: 100 }).then((r) => r.rows),
  });
  const creditQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "sales", "credit", customerId),
    enabled: Boolean(customerQuery.data),
    queryFn: () => getCustomerCredit(customerId).then((r) => r.credit),
  });

  function refresh() {
    queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "sales") });
  }
  const archive = useMutation({
    mutationFn: () => archiveRecord("parties", customerId, customerQuery.data?.updatedAt),
    onSuccess: () => {
      setActionError(null);
      setConfirmingArchive(false);
      refresh();
    },
    onError: (err) => setActionError(err instanceof SalesApiError ? err.message : "Could not archive this customer."),
  });
  const restore = useMutation({
    mutationFn: () => updateRecord("parties", customerId, { status: "active" }),
    onSuccess: () => {
      setActionError(null);
      refresh();
    },
    onError: (err) => setActionError(err instanceof SalesApiError ? err.message : "Could not restore this customer."),
  });
  const archiveChild = useMutation({
    mutationFn: ({ resource, id }: { resource: "contacts" | "addresses"; id: string }) => archiveRecord(resource, id),
    onSuccess: refresh,
    onError: (err) => setActionError(err instanceof SalesApiError ? err.message : "Could not remove this record."),
  });

  if (customerQuery.isLoading) return <p className="px-4 py-8 text-sm text-text-secondary">Loading customer…</p>;
  if (customerQuery.isError || !customerQuery.data) {
    if (customerQuery.error instanceof SalesApiError && customerQuery.error.status === 403) return <PermissionState title="You don't have access to this customer" />;
    if (customerQuery.error instanceof SalesApiError && customerQuery.error.status === 404) return <ErrorState title="Customer not found" action={{ label: "Back to customers", onPress: () => router.push("/sales/customers") }} />;
    return <ErrorState title="Could not load this customer" action={{ label: "Retry", onPress: () => customerQuery.refetch() }} />;
  }

  const customer: CustomerRecord = customerQuery.data;
  const term = optionsQuery.data?.paymentTerms.find((t) => t.id === customer.paymentTermId);
  const contacts = (optionsQuery.data?.contacts ?? []) as Contact[];
  const addresses = (optionsQuery.data?.addresses ?? []) as Address[];

  const contactColumns: ColumnDef<Contact, unknown>[] = [
    { id: "name", header: "Name", accessorFn: (c) => `${c.first_name} ${c.last_name ?? ""}`.trim() },
    { id: "role", header: "Designation", accessorFn: (c) => c.designation ?? "—" },
    { id: "email", header: "Email", accessorFn: (c) => c.email ?? "—" },
    { id: "phone", header: "Phone", accessorFn: (c) => c.mobile ?? c.phone ?? "—" },
    { id: "primary", header: "Primary", accessorFn: (c) => (c.is_primary ? "Yes" : "") },
  ];
  const addressColumns: ColumnDef<Address, unknown>[] = [
    { id: "type", header: "Type", accessorFn: (a) => statusLabel(a.address_type) },
    { id: "line", header: "Address", accessorFn: (a) => [a.line1, a.line2, a.city, a.state, a.postal_code].filter(Boolean).join(", ") },
    { id: "gstin", header: "GSTIN", accessorFn: (a) => a.gstin ?? "—" },
    { id: "primary", header: "Primary", accessorFn: (a) => (a.is_primary ? "Yes" : "") },
  ];
  const orderColumns: ColumnDef<SalesOrderRow, unknown>[] = [
    { id: "number", header: "Order", cell: ({ row }) => <Link href={`/sales/orders/${row.original.id}`} className="font-medium text-brand hover:underline">{row.original.sales_order_number}</Link> },
    { id: "status", header: "Status", cell: ({ row }) => <StatusBadge tone={statusTone(row.original.lifecycle_status)}>{statusLabel(row.original.lifecycle_status)}</StatusBadge> },
    { id: "total", header: "Total", accessorFn: (row) => money(row.currency_code, row.grand_total) },
  ];
  const quotationColumns: ColumnDef<SalesQuotationRow, unknown>[] = [
    { id: "number", header: "Quotation", cell: ({ row }) => <Link href={`/sales/quotations/${row.original.id}`} className="font-medium text-brand hover:underline">{row.original.quotation_number}</Link> },
    { id: "status", header: "Status", cell: ({ row }) => <StatusBadge tone={statusTone(row.original.lifecycle_status)}>{statusLabel(row.original.lifecycle_status)}</StatusBadge> },
    { id: "total", header: "Total", accessorFn: (row) => money(row.currency_code, row.grand_total) },
  ];
  const rowActionsFor = (resource: "contacts" | "addresses", open: (record: never) => void) => function RowActions(record: { id: string }) {
    return canManage ? (
      <div className="flex gap-1">
        <Button variant="ghost" size="compact" onPress={() => open(record as never)}>
          <Pencil className="size-3.5" aria-hidden="true" />
          Edit
        </Button>
        <Button variant="ghost" size="compact" onPress={() => archiveChild.mutate({ resource, id: record.id })}>
          Remove
        </Button>
      </div>
    ) : null;
  };

  return (
    <div className="flex flex-col gap-4">
      <Link href="/sales/customers" className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-text">
        <ArrowLeft className="size-3.5" aria-hidden="true" />
        All customers
      </Link>
      <RecordDetailsPage
        header={{
          title: customer.displayName,
          status: <StatusBadge tone={statusTone(customer.status === "active" ? "confirmed" : "cancelled")}>{customer.status === "active" ? "Active" : "Archived"}</StatusBadge>,
          fields: [
            { label: "Code", value: customer.code },
            { label: "Type", value: statusLabel(customer.partyType) },
            { label: "Currency", value: customer.currencyCode ?? "—" },
          ],
          primaryAction: canManage && customer.status === "active" ? (
            <Button variant="primary" onPress={() => router.push(`/sales/quotations/new?customer=${customer.id}`)}>
              New quotation
            </Button>
          ) : undefined,
          secondaryActions: canManage ? (
            <div className="flex gap-2">
              <Button variant="secondary" onPress={() => setEditing(true)}>
                <Pencil className="size-4" aria-hidden="true" />
                Edit
              </Button>
              {customer.status === "active" ? (
                <Button variant="secondary" onPress={() => setConfirmingArchive(true)} isLoading={archive.isPending}>
                  <Archive className="size-4" aria-hidden="true" />
                  Archive
                </Button>
              ) : (
                <Button variant="secondary" onPress={() => restore.mutate()} isLoading={restore.isPending}>
                  Restore
                </Button>
              )}
            </div>
          ) : undefined,
        }}
      >
        {actionError && <SalesAlert>{actionError}</SalesAlert>}
        {customer.status !== "active" && <SalesAlert tone="warning">This customer is archived: it no longer appears when creating quotations or orders. Existing documents are unaffected.</SalesAlert>}
        <Tabs>
          <TabList aria-label="Customer sections">
            <Tab id="profile">Profile</Tab>
            <Tab id="contacts">Contacts ({contacts.length})</Tab>
            <Tab id="addresses">Addresses ({addresses.length})</Tab>
            <Tab id="orders">Orders</Tab>
            <Tab id="quotations">Quotations</Tab>
            <Tab id="credit">Credit &amp; Finance</Tab>
          </TabList>
          <TabPanel id="profile">
            <SalesPanel title="Commercial profile">
              <SalesFacts
                columns={3}
                items={[
                  { label: "Legal name", value: customer.legalName ?? "—" },
                  { label: "GSTIN", value: customer.gstin ?? "—" },
                  { label: "PAN", value: customer.pan ?? "—" },
                  { label: "Payment terms", value: term ? `${term.name} (${term.default_due_days} days)` : "—" },
                  { label: "Credit limit", value: Number(customer.creditLimit) > 0 ? money(customer.currencyCode, customer.creditLimit) : "No limit" },
                ]}
              />
            </SalesPanel>
          </TabPanel>
          <TabPanel id="contacts">
            <SalesSection title="Contacts" addLabel="Add contact" canAdd={canManage} onAdd={() => setContactDialog("new")}>
              <EnterpriseDataGrid<Contact> aria-label="Contacts" columns={contactColumns} data={contacts} getRowId={(c) => c.id} density="compact" state={contacts.length ? "ready" : "empty"} emptyContent={<p className="px-4 py-6 text-sm text-text-muted">No contacts yet.</p>} rowActions={rowActionsFor("contacts", (record) => setContactDialog(record))} />
            </SalesSection>
          </TabPanel>
          <TabPanel id="addresses">
            <SalesSection title="Addresses" addLabel="Add address" canAdd={canManage} onAdd={() => setAddressDialog("new")}>
              <EnterpriseDataGrid<Address> aria-label="Addresses" columns={addressColumns} data={addresses} getRowId={(a) => a.id} density="compact" state={addresses.length ? "ready" : "empty"} emptyContent={<p className="px-4 py-6 text-sm text-text-muted">No addresses yet.</p>} rowActions={rowActionsFor("addresses", (record) => setAddressDialog(record))} />
            </SalesSection>
          </TabPanel>
          <TabPanel id="orders">
            <SalesPanel title="Orders" description="Sales orders raised for this customer.">
              <EnterpriseDataGrid<SalesOrderRow> aria-label="Customer orders" columns={orderColumns} data={ordersQuery.data ?? []} getRowId={(row) => row.id} density="compact" state={ordersQuery.isLoading ? "loading" : (ordersQuery.data?.length ?? 0) ? "ready" : "empty"} loadingContent={<p className="px-4 py-6 text-sm text-text-secondary">Loading…</p>} emptyContent={<p className="px-4 py-6 text-sm text-text-muted">No orders yet.</p>} />
            </SalesPanel>
          </TabPanel>
          <TabPanel id="quotations">
            <SalesPanel title="Quotations" description="Quotations raised for this customer.">
              <EnterpriseDataGrid<SalesQuotationRow> aria-label="Customer quotations" columns={quotationColumns} data={quotationsQuery.data ?? []} getRowId={(row) => row.id} density="compact" state={quotationsQuery.isLoading ? "loading" : (quotationsQuery.data?.length ?? 0) ? "ready" : "empty"} loadingContent={<p className="px-4 py-6 text-sm text-text-secondary">Loading…</p>} emptyContent={<p className="px-4 py-6 text-sm text-text-muted">No quotations yet.</p>} />
            </SalesPanel>
          </TabPanel>
          <TabPanel id="credit">
            <SalesPanel title="Credit & Finance" description="Outstanding receivables and credit exposure for this customer.">
              {creditQuery.isLoading ? (
                <p className="px-4 py-6 text-sm text-text-secondary">Loading…</p>
              ) : creditQuery.data ? (
                <div className="flex flex-col gap-3">
                  {creditQuery.data.overLimit && <SalesAlert tone="warning">This customer is over their credit limit.</SalesAlert>}
                  <SalesFacts
                    columns={3}
                    items={[
                      { label: "Credit limit", value: creditQuery.data.creditLimit > 0 ? money(creditQuery.data.currencyCode, creditQuery.data.creditLimit) : "No limit" },
                      { label: "AR outstanding", value: money(creditQuery.data.currencyCode, creditQuery.data.arOutstanding) },
                      { label: "Unapplied advances", value: money(creditQuery.data.currencyCode, creditQuery.data.unappliedAdvances) },
                      { label: "Available credit", value: creditQuery.data.availableCredit === null ? "No limit" : money(creditQuery.data.currencyCode, creditQuery.data.availableCredit) },
                    ]}
                  />
                </div>
              ) : (
                <p className="px-4 py-6 text-sm text-text-muted">Credit summary unavailable.</p>
              )}
            </SalesPanel>
          </TabPanel>
        </Tabs>
      </RecordDetailsPage>

      {editing && <CustomerDialog customer={customer} onClose={() => setEditing(false)} onSaved={() => setEditing(false)} />}
      {contactDialog && <ContactDialog partyId={customerId} contact={contactDialog === "new" ? undefined : contactDialog} onClose={() => setContactDialog(null)} onSaved={() => { setContactDialog(null); refresh(); }} />}
      {addressDialog && <AddressDialog partyId={customerId} address={addressDialog === "new" ? undefined : addressDialog} onClose={() => setAddressDialog(null)} onSaved={() => { setAddressDialog(null); refresh(); }} />}
      {confirmingArchive && (
        <Dialog isOpen onOpenChange={(open) => !open && setConfirmingArchive(false)} title="Archive this customer?">
          <div className="flex flex-col gap-4">
            {actionError && <SalesAlert>{actionError}</SalesAlert>}
            <p className="text-sm text-text-secondary">This will remove the customer from new quotations and orders. Existing documents are unaffected.</p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onPress={() => setConfirmingArchive(false)}>
                Cancel
              </Button>
              <Button variant="primary" onPress={() => archive.mutate()} isLoading={archive.isPending}>
                Archive customer
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
}

function SalesSection({ title, addLabel, canAdd, onAdd, children }: { title: string; addLabel: string; canAdd: boolean; onAdd: () => void; children: ReactNode }) {
  return (
    <SalesPanel
      title={title}
      actions={
        canAdd ? (
          <Button variant="secondary" size="compact" onPress={onAdd}>
            <Plus className="size-3.5" aria-hidden="true" />
            {addLabel}
          </Button>
        ) : undefined
      }
    >
      {children}
    </SalesPanel>
  );
}

function FormDialog({ title, saveLabel, disabled, mutation, onClose, children }: { title: string; saveLabel: string; disabled: boolean; mutation: { isPending: boolean; error: unknown; mutate: () => void }; onClose: () => void; children: ReactNode }) {
  const message = mutation.error ? (mutation.error instanceof SalesApiError ? mutation.error.message : "This could not be saved.") : null;
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={title}>
      <div className="flex flex-col gap-4">
        {message && <SalesAlert>{message}</SalesAlert>}
        {children}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>
            Close
          </Button>
          <Button variant="primary" onPress={() => mutation.mutate()} isLoading={mutation.isPending} isDisabled={disabled}>
            {saveLabel}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function ContactDialog({ partyId, contact, onClose, onSaved }: { partyId: string; contact?: Contact; onClose: () => void; onSaved: () => void }) {
  const [firstName, setFirstName] = useState(contact?.first_name ?? "");
  const [lastName, setLastName] = useState(contact?.last_name ?? "");
  const [designation, setDesignation] = useState(contact?.designation ?? "");
  const [email, setEmail] = useState(contact?.email ?? "");
  const [phone, setPhone] = useState(contact?.phone ?? "");
  const [mobile, setMobile] = useState(contact?.mobile ?? "");
  const [isPrimary, setIsPrimary] = useState(contact?.is_primary ?? false);
  const mutation = useMutation({
    mutationFn: () => {
      const input: ContactInput = { firstName, lastName: lastName || undefined, designation: designation || undefined, email: email || undefined, phone: phone || undefined, mobile: mobile || undefined, isPrimary };
      return contact ? updateRecord("contacts", contact.id, input) : createRecord("contacts", { ...input, partyId });
    },
    onSuccess: onSaved,
  });
  return (
    <FormDialog title={contact ? "Edit contact" : "Add contact"} saveLabel={contact ? "Save changes" : "Add contact"} disabled={!firstName.trim()} mutation={mutation} onClose={onClose}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <TextField label="First name" isRequired value={firstName} onChange={setFirstName} />
        <TextField label="Last name" value={lastName} onChange={setLastName} />
        <TextField label="Designation" value={designation} onChange={setDesignation} />
        <TextField label="Email" type="email" value={email} onChange={setEmail} />
        <TextField label="Phone" value={phone} onChange={setPhone} />
        <TextField label="Mobile" value={mobile} onChange={setMobile} />
      </div>
      <Switch isSelected={isPrimary} onChange={setIsPrimary}>
        Primary contact
      </Switch>
    </FormDialog>
  );
}

function AddressDialog({ partyId, address, onClose, onSaved }: { partyId: string; address?: Address; onClose: () => void; onSaved: () => void }) {
  const [addressType, setAddressType] = useState(address?.address_type ?? "billing");
  const [line1, setLine1] = useState(address?.line1 ?? "");
  const [line2, setLine2] = useState(address?.line2 ?? "");
  const [city, setCity] = useState(address?.city ?? "");
  const [state, setState] = useState(address?.state ?? "");
  const [stateCode, setStateCode] = useState(address?.state_code ?? "");
  const [postalCode, setPostalCode] = useState(address?.postal_code ?? "");
  const [gstin, setGstin] = useState(address?.gstin ?? "");
  const [isPrimary, setIsPrimary] = useState(address?.is_primary ?? false);
  const mutation = useMutation({
    mutationFn: () => {
      const input: AddressInput = { addressType, line1, line2: line2 || undefined, city: city || undefined, state: state || undefined, stateCode: stateCode || undefined, postalCode: postalCode || undefined, countryCode: address?.country_code ?? "IN", gstin: gstin || undefined, isPrimary };
      return address ? updateRecord("addresses", address.id, input) : createRecord("addresses", { ...input, partyId });
    },
    onSuccess: onSaved,
  });
  return (
    <FormDialog title={address ? "Edit address" : "Add address"} saveLabel={address ? "Save changes" : "Add address"} disabled={!line1.trim() || !city.trim() || !state.trim() || !postalCode.trim()} mutation={mutation} onClose={onClose}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Select label="Type" options={ADDRESS_TYPES} selectedKey={addressType} onSelectionChange={(key) => setAddressType(String(key ?? "billing"))} />
        <TextField label="Address line 1" isRequired value={line1} onChange={setLine1} />
        <TextField label="Address line 2" value={line2} onChange={setLine2} />
        <TextField label="City" isRequired value={city} onChange={setCity} />
        <TextField label="State" isRequired value={state} onChange={setState} />
        <TextField label="State code (GST)" value={stateCode} onChange={setStateCode} />
        <TextField label="Postal code" isRequired value={postalCode} onChange={setPostalCode} />
        <TextField label="GSTIN (this address)" value={gstin} onChange={setGstin} />
      </div>
      <Switch isSelected={isPrimary} onChange={setIsPrimary}>
        Primary address
      </Switch>
    </FormDialog>
  );
}
