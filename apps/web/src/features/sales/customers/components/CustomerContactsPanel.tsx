"use client";

// Contacts tab: the people at the customer. They are the shared contacts
// CRM, Support and Projects use, linked to the customer, so a person is never
// entered twice. Adding a contact searches the existing ones first. One
// contact is the primary; one receives invoices; one receives deliveries; a
// person can hold several of these and can belong to one of the customer's
// locations.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { AlertDialog, Badge, Button, Checkbox, ComboBox, Dialog, EmptyState, SearchField, Select, Tab, TabList, TabPanel, Tabs, TextArea, TextField } from "@vercentlabs/design-system";

import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import {
  addCustomerContact, errorCode, errorMessage, errorPayload, fieldErrors, findExistingContact, listCustomerAddresses, listCustomerContacts, searchLinkableContacts,
  updateCustomerContact, type ContactInput, type Customer, type CustomerContact, type CustomerOptions, type ExistingContact,
} from "../api/customers-api";
import { ErrorBanner, NONE, orNull, withNone } from "../customer-format";

export function CustomerContactsPanel({ customer, options }: { customer: Customer; options: CustomerOptions }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const can = options.capabilities;
  const [search, setSearch] = useState("");
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "sales", "customer", customer.id, "contacts", search.trim()), queryFn: () => listCustomerContacts(customer.id, search.trim() || undefined) });
  const [dialog, setDialog] = useState<CustomerContact | "new" | null>(null);
  const [leaving, setLeaving] = useState<{ contact: CustomerContact; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "sales", "customer", customer.id) });
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "sales", "customers") });
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "sales", "options") });
  };
  const change = useMutation({
    mutationFn: ({ contact, input }: { contact: CustomerContact; input: ContactInput }) => updateCustomerContact(customer.id, contact.id, input),
    onSuccess: () => { setError(null); setLeaving(null); refresh(); },
    onError: (failure, variables) => {
      // Open documents refer to this person: ask before ending the relationship.
      if (errorPayload(failure).requiresConfirmation) { setLeaving({ contact: variables.contact, message: errorMessage(failure) }); return; }
      setLeaving(null);
      setError(errorMessage(failure));
    },
  });
  const contacts = query.data ?? [];

  return (
    <section className="flex flex-col gap-3 pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SearchField aria-label="Search contacts" placeholder="Search name, email, phone, role or department" className="w-full sm:w-80" value={search} onChange={setSearch} />
        {can.manageContacts && <Button variant="primary" size="compact" onPress={() => setDialog("new")}><Plus className="size-4" aria-hidden="true" />Add Contact</Button>}
      </div>
      <ErrorBanner message={error} />
      {query.isLoading ? <LoadingState label="Loading contacts" rows={3} />
        : query.isError ? <ErrorBanner message={errorCode(query.error) === "PERMISSION_DENIED" ? "You do not have permission to view customer contacts." : errorMessage(query.error, "The contacts could not be loaded.")} />
        : contacts.length === 0 ? <EmptyState title={search.trim() ? "No contacts match" : "No contacts yet"} description={search.trim() ? "Try a different search." : "Add the person quotations and invoices should be addressed to."} />
        : (
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {contacts.map((contact) => (
              <li key={contact.id} className={`flex flex-col gap-2 rounded-[var(--radius-card)] border border-border bg-surface p-4 text-sm ${contact.isActive ? "" : "opacity-70"}`}>
                <div>
                  <p className="text-base font-semibold">{contact.name}</p>
                  <p className="text-text-secondary">{[contact.jobTitle, contact.department].filter(Boolean).join(" · ") || contact.roleLabel || "No job title"}</p>
                </div>
                <div className="flex flex-wrap gap-1">
                  {contact.isPrimary && <Badge tone="info">Primary Contact</Badge>}
                  {contact.isBillingContact && <Badge tone="neutral">Billing Contact</Badge>}
                  {contact.isShippingContact && <Badge tone="neutral">Delivery Contact</Badge>}
                  {contact.isProcurementContact && <Badge tone="neutral">Procurement Contact</Badge>}
                  {contact.roleLabel && (contact.jobTitle || contact.department) && <Badge tone="neutral">{contact.roleLabel}</Badge>}
                  {!contact.isActive && <Badge tone="neutral">Inactive</Badge>}
                </div>
                {contact.addressLabel && <p className="text-text-secondary">{contact.addressLabel}</p>}
                <p className="flex flex-col text-text-secondary">
                  {contact.email && <a className="hover:underline" href={`mailto:${contact.email}`}>{contact.email}</a>}
                  {contact.phone && <a className="hover:underline" href={`tel:${contact.phone}`}>{contact.phone}</a>}
                </p>
                {contact.notes && <p className="text-xs whitespace-pre-wrap text-text-muted">{contact.notes}</p>}
                <div className="mt-auto flex flex-wrap gap-2 pt-1">
                  {contact.isActive && can.manageContacts && <Button variant="ghost" size="compact" onPress={() => setDialog(contact)}>Edit</Button>}
                  {contact.isActive && !contact.isPrimary && can.manageContacts && can.setPrimaryContact && (
                    <Button variant="ghost" size="compact" isDisabled={change.isPending} onPress={() => change.mutate({ contact, input: { isPrimary: true } })}>Make primary</Button>
                  )}
                  {can.manageContacts && can.inactivateContact && (
                    <Button variant="ghost" size="compact" isDisabled={change.isPending} onPress={() => change.mutate({ contact, input: { isActive: !contact.isActive } })}>
                      {contact.isActive ? "Inactivate" : "Reactivate"}
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      <p className="text-xs text-text-muted">Inactivating a contact here ends their role at this customer. The person stays in Contacts and on the documents already issued.</p>
      {dialog && (
        <ContactDialog key={dialog === "new" ? "new" : dialog.id} customer={customer} options={options} contact={dialog === "new" ? null : dialog}
          onClose={() => setDialog(null)} onSaved={() => { setDialog(null); refresh(); }} />
      )}
      <AlertDialog isOpen={Boolean(leaving)} onOpenChange={(open) => !open && setLeaving(null)} title={`Inactivate ${leaving?.contact.name ?? "contact"}?`}
        description={leaving?.message ?? ""} confirmLabel="Inactivate" isConfirming={change.isPending}
        onConfirm={() => leaving && change.mutate({ contact: leaving.contact, input: { isActive: false, confirmOpenDocuments: true } })} />
    </section>
  );
}

function ContactDialog({ customer, options, contact, onClose, onSaved }: {
  customer: Customer; options: CustomerOptions; contact: CustomerContact | null; onClose: () => void; onSaved: () => void;
}) {
  const workspace = useWorkspaceContext();
  const can = options.capabilities;
  // Search existing contacts first; create a new one only if the person is not there.
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [person, setPerson] = useState({ firstName: "", lastName: "", email: "", phone: "" });
  const [link, setLink] = useState({
    jobTitle: contact?.jobTitle ?? "", department: contact?.department ?? "", role: contact?.role ?? NONE, addressId: contact?.addressId ?? NONE, notes: contact?.notes ?? "",
    isPrimary: contact?.isPrimary ?? false, isBillingContact: contact?.isBillingContact ?? false, isShippingContact: contact?.isShippingContact ?? false,
    isProcurementContact: contact?.isProcurementContact ?? false,
  });
  const [search, setSearch] = useState("");
  const [contactId, setContactId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [found, setFound] = useState<ExistingContact[] | null>(null);
  const addresses = useQuery({ queryKey: scopedQueryKey(workspace, "sales", "customer", customer.id, "addresses", ""), queryFn: () => listCustomerAddresses(customer.id), enabled: can.viewAddresses });
  const candidates = useQuery({
    queryKey: scopedQueryKey(workspace, "sales", "customer", customer.id, "linkable-contacts", search),
    queryFn: () => searchLinkableContacts(customer.id, search),
    enabled: !contact && mode === "existing",
  });
  const relationship = (): ContactInput => ({
    jobTitle: link.jobTitle.trim(), department: link.department.trim(), role: orNull(link.role) ?? "", addressId: orNull(link.addressId), notes: link.notes.trim(),
    isBillingContact: link.isBillingContact, isShippingContact: link.isShippingContact, isProcurementContact: link.isProcurementContact, ...(link.isPrimary && !contact?.isPrimary ? { isPrimary: true } : {}),
  });
  const save = useMutation({
    mutationFn: async ({ linkId, allowDuplicate }: { linkId?: string; allowDuplicate?: boolean }) => {
      if (contact) return updateCustomerContact(customer.id, contact.id, relationship());
      if (linkId) return addCustomerContact(customer.id, { contactId: linkId, ...relationship() });
      if (!allowDuplicate) {
        const matches = await findExistingContact(customer.id, person);
        if (matches.length) { setFound(matches); return null; }
      }
      return addCustomerContact(customer.id, { ...person, ...relationship(), allowDuplicate: true });
    },
    onSuccess: (saved) => { if (saved) onSaved(); },
    onError: (failure) => {
      const matches = errorPayload(failure).matches as ExistingContact[] | undefined;
      if (errorPayload(failure).existingContactFound && matches) { setFound(matches); setError(null); return; }
      setErrors(fieldErrors(failure));
      setError(errorMessage(failure));
    },
  });
  const setPersonField = (field: keyof typeof person) => (value: string) => { setPerson({ ...person, [field]: value }); setFound(null); setErrors({}); };
  const addressOptions = withNone((addresses.data ?? []).filter((address) => address.isActive || address.id === contact?.addressId)
    .map((address) => ({ value: address.id, label: address.label || `${address.addressTypeLabel} – ${address.city}` })), "No specific location");

  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={contact ? `Edit ${contact.name}` : "Add contact"}
      description={contact ? "Their role at this customer. Email and phone are kept on the contact itself." : undefined} size="lg">
      <div className="flex flex-col gap-4 overflow-y-auto pr-1">
        <ErrorBanner message={error} />
        {contact ? null : (
          <Tabs selectedKey={mode} onSelectionChange={(value) => { setMode(String(value) as "new" | "existing"); setError(null); setFound(null); }}>
            <TabList aria-label="Contact source">
              <Tab id="existing">Find existing contact</Tab>
              <Tab id="new">Create new contact</Tab>
            </TabList>
            <TabPanel id="existing">
              <div className="flex flex-col gap-1 pt-3">
                <ComboBox label="Contact" isRequired placeholder="Search by name, email or phone" selectedKey={contactId} onSelectionChange={(value) => setContactId(value ? String(value) : null)}
                  onInputChange={setSearch} isLoading={candidates.isFetching} emptyMessage="No matching contacts. Create a new one."
                  options={(candidates.data ?? []).map((entry) => ({ value: entry.id, label: [entry.name, entry.email, entry.accountName].filter(Boolean).join(" · ") }))} />
                <p className="text-xs text-text-muted">The same person is linked, not copied, so their details stay in one place.</p>
              </div>
            </TabPanel>
            <TabPanel id="new">
              <div className="flex flex-col gap-3 pt-3">
                <div className="grid gap-4 sm:grid-cols-2">
                  <TextField label="First name" isRequired value={person.firstName} onChange={setPersonField("firstName")} errorMessage={errors.firstName} />
                  <TextField label="Last name" value={person.lastName} onChange={setPersonField("lastName")} />
                  <TextField label="Email" type="email" value={person.email} onChange={setPersonField("email")} errorMessage={errors.email} />
                  <TextField label="Mobile / phone" value={person.phone} onChange={setPersonField("phone")} errorMessage={errors.mobile} />
                </div>
                {found && found.length > 0 && (
                  <div role="alert" className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-warning-emphasis/40 bg-warning-soft px-3 py-3 text-sm">
                    <p className="font-medium">Existing contact found</p>
                    <ul className="flex flex-col gap-2">
                      {found.map((match) => (
                        <li key={match.id} className="flex flex-wrap items-center justify-between gap-2">
                          <span>
                            <span className="font-medium">{match.name}</span>
                            <span className="text-text-secondary"> {[match.email, match.phone, match.accountName, match.reasons.join(", ")].filter(Boolean).join(" · ")}</span>
                          </span>
                          {match.link === "linked" ? <Badge tone="neutral">Already a contact here</Badge>
                            : <Button variant="secondary" size="compact" isLoading={save.isPending} onPress={() => save.mutate({ linkId: match.id })}>{match.link === "inactive" ? "Restore link" : "Link existing"}</Button>}
                        </li>
                      ))}
                    </ul>
                    <div><Button variant="ghost" size="compact" isDisabled={save.isPending} onPress={() => save.mutate({ allowDuplicate: true })}>This is a different person. Create a new contact</Button></div>
                  </div>
                )}
              </div>
            </TabPanel>
          </Tabs>
        )}
        <section aria-label="Role at this customer" className="flex flex-col gap-4 border-t border-border pt-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Select label="Role" selectedKey={link.role} onSelectionChange={(value) => setLink({ ...link, role: String(value) })}
              options={withNone(options.contactRoles.map((entry) => ({ value: entry.code, label: entry.label })))} errorMessage={errors.role} />
            <TextField label="Job title" value={link.jobTitle} onChange={(value) => setLink({ ...link, jobTitle: value })} />
            <TextField label="Department" value={link.department} onChange={(value) => setLink({ ...link, department: value })} />
            {can.viewAddresses && (
              <Select label="Location" description="The customer address this person works at." selectedKey={link.addressId} onSelectionChange={(value) => setLink({ ...link, addressId: String(value) })}
                options={addressOptions} errorMessage={errors.addressId} />
            )}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Checkbox isSelected={link.isPrimary} isDisabled={Boolean(contact?.isPrimary) || !can.setPrimaryContact} onChange={(value) => setLink({ ...link, isPrimary: value })}>Primary contact</Checkbox>
            <Checkbox isSelected={link.isBillingContact} onChange={(value) => setLink({ ...link, isBillingContact: value })}>Billing contact (invoices, statements)</Checkbox>
            <Checkbox isSelected={link.isShippingContact} onChange={(value) => setLink({ ...link, isShippingContact: value })}>Delivery contact (shipments)</Checkbox>
            <Checkbox isSelected={link.isProcurementContact} onChange={(value) => setLink({ ...link, isProcurementContact: value })}>Procurement contact</Checkbox>
          </div>
          <TextArea label="Notes" rows={2} value={link.notes} onChange={(value) => setLink({ ...link, notes: value })} />
        </section>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isLoading={save.isPending} isDisabled={!contact && (mode === "existing" ? !contactId : !person.firstName.trim())}
            onPress={() => save.mutate(contact ? {} : mode === "existing" ? { linkId: contactId ?? undefined } : {})}>
            {contact ? "Save" : mode === "existing" ? "Link contact" : "Add contact"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
