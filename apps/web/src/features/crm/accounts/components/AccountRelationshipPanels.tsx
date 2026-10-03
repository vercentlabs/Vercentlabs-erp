"use client";

// The account's people, addresses and company structure.
import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Star } from "lucide-react";
import { AlertDialog, Badge, Button, Checkbox, ComboBox, Dialog, EmptyState, Select, TextField } from "@vercentlabs/design-system";

import { CountrySelect } from "@/features/crm/shared/ui/CountrySelect";
import { countryName } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import {
  addAccountAddress, createAccountContact, errorMessage, getAccountHierarchy, linkAccountContact, listAccountAddresses, listAccountContacts,
  removeAccountAddress, searchLinkableContacts, setAccountParent, unlinkAccountContact, updateAccountAddress, updateAccountContact,
  type Account, type AccountAddress, type AccountContact, type AccountOptions,
} from "../api/accounts-api";
import { ADDRESS_TYPE_LABELS, AccountStatusBadge, AccountTypeBadge, ErrorBanner } from "../account-format";
import { AccountPicker } from "./AccountPicker";

function useAccountRefresh(accountId: string) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "account", accountId) });
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "accounts") });
  };
}

function SectionHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-base font-semibold">{title}</h2>
      {action && <div className="flex flex-wrap gap-2">{action}</div>}
    </div>
  );
}

// ------------------------------------------------------------------ contacts

export function AccountContactsPanel({ account, canEdit }: { account: Account; canEdit: boolean }) {
  const workspace = useWorkspaceContext();
  const refresh = useAccountRefresh(account.id);
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "account", account.id, "contacts"), queryFn: () => listAccountContacts(account.id) });
  const [dialog, setDialog] = useState<"new" | "link" | null>(null);
  const [unlinking, setUnlinking] = useState<AccountContact | null>(null);
  const [error, setError] = useState<string | null>(null);
  const action = useMutation({
    mutationFn: (run: () => Promise<unknown>) => run(),
    onSuccess: () => { setError(null); setUnlinking(null); refresh(); },
    onError: (failure) => setError(errorMessage(failure)),
  });
  const contacts = query.data ?? [];

  return (
    <section className="flex flex-col gap-3">
      <SectionHeader title="Contacts" action={canEdit && (
        <>
          <Button variant="secondary" size="compact" onPress={() => setDialog("link")}>Link existing contact</Button>
          <Button variant="primary" size="compact" onPress={() => setDialog("new")}>Add contact</Button>
        </>
      )} />
      <ErrorBanner message={error} />
      {query.isLoading ? <LoadingState label="Loading contacts" rows={3} /> : query.isError ? <ErrorBanner message="Could not load the contacts." /> : contacts.length === 0 ? (
        <EmptyState title="No contacts yet" description="Add the people you deal with at this company. Mark one as the primary contact." />
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-[var(--radius-card)] border border-border bg-surface">
          {contacts.map((contact) => (
            <li key={contact.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
              <div className="flex min-w-0 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/crm/contacts/${contact.id}`} className="font-medium hover:underline">{contact.name}</Link>
                  {contact.isPrimary && <Badge tone="brand"><Star className="size-3" aria-hidden="true" />Primary</Badge>}
                  {contact.isDecisionMaker && <Badge tone="success">Decision maker</Badge>}
                  {contact.status !== "active" && <Badge tone="neutral">Inactive</Badge>}
                </div>
                <span className="text-text-secondary">{[contact.jobTitle, contact.department].filter(Boolean).join(" · ") || "No job title"}</span>
                {(contact.email || contact.phone) && <span className="text-xs text-text-muted">{[contact.email, contact.phone].filter(Boolean).join(" · ")}</span>}
              </div>
              {canEdit && (
                <div className="flex flex-wrap gap-2">
                  {!contact.isPrimary && contact.status === "active" && (
                    <Button variant="outline" size="compact" onPress={() => action.mutate(() => updateAccountContact(account.id, contact.id, { isPrimary: true }))}>Make primary</Button>
                  )}
                  <Button variant="outline" size="compact" onPress={() => action.mutate(() => updateAccountContact(account.id, contact.id, { isDecisionMaker: !contact.isDecisionMaker }))}>
                    {contact.isDecisionMaker ? "Not decision maker" : "Decision maker"}
                  </Button>
                  <Button variant="ghost" size="compact" onPress={() => setUnlinking(contact)}>Unlink</Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <NewContactDialog isOpen={dialog === "new"} onOpenChange={(open) => !open && setDialog(null)} accountId={account.id} onDone={refresh} />
      <LinkContactDialog isOpen={dialog === "link"} onOpenChange={(open) => !open && setDialog(null)} accountId={account.id} onDone={refresh} />
      <AlertDialog
        isOpen={Boolean(unlinking)}
        onOpenChange={(open) => !open && setUnlinking(null)}
        title={`Unlink ${unlinking?.name ?? "contact"}?`}
        description="The contact stays in CRM with its history, but no longer belongs to this company."
        confirmLabel="Unlink"
        isConfirming={action.isPending}
        onConfirm={() => unlinking && action.mutate(() => unlinkAccountContact(account.id, unlinking.id))}
      />
    </section>
  );
}

function NewContactDialog({ isOpen, onOpenChange, accountId, onDone }: { isOpen: boolean; onOpenChange: (open: boolean) => void; accountId: string; onDone: () => void }) {
  const empty = { firstName: "", lastName: "", designation: "", department: "", email: "", mobile: "", isDecisionMaker: false, makePrimary: false };
  const [values, setValues] = useState(empty);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof typeof empty>(key: K) => (value: (typeof empty)[K]) => setValues((current) => ({ ...current, [key]: value }));
  const mutation = useMutation({
    mutationFn: () => createAccountContact(accountId, values),
    onSuccess: () => { onDone(); setValues(empty); setError(null); onOpenChange(false); },
    onError: (failure) => setError(errorMessage(failure)),
  });
  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} title="Add contact" description="A person at this company. An email or mobile number is needed to reach them." size="lg">
      <div className="flex flex-col gap-4">
        <ErrorBanner message={error} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="First name" isRequired value={values.firstName} onChange={set("firstName")} />
          <TextField label="Last name" value={values.lastName} onChange={set("lastName")} />
          <TextField label="Job title" value={values.designation} onChange={set("designation")} />
          <TextField label="Department" value={values.department} onChange={set("department")} />
          <TextField label="Email" type="email" value={values.email} onChange={set("email")} />
          <TextField label="Mobile" type="tel" value={values.mobile} onChange={set("mobile")} />
        </div>
        <Checkbox isSelected={values.isDecisionMaker} onChange={set("isDecisionMaker")}>Decision maker</Checkbox>
        <Checkbox isSelected={values.makePrimary} onChange={set("makePrimary")}>Primary contact for this account</Checkbox>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" onPress={() => mutation.mutate()} isLoading={mutation.isPending}
            isDisabled={!values.firstName.trim() || !(values.email.trim() || values.mobile.trim())}>Add contact</Button>
        </div>
      </div>
    </Dialog>
  );
}

function LinkContactDialog({ isOpen, onOpenChange, accountId, onDone }: { isOpen: boolean; onOpenChange: (open: boolean) => void; accountId: string; onDone: () => void }) {
  const workspace = useWorkspaceContext();
  const [text, setText] = useState("");
  const [contactId, setContactId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "account", accountId, "linkable-contacts", text),
    queryFn: () => searchLinkableContacts(accountId, text),
    enabled: isOpen,
    staleTime: 10_000,
  });
  const mutation = useMutation({
    mutationFn: () => linkAccountContact(accountId, contactId as string),
    onSuccess: () => { onDone(); setContactId(null); setError(null); onOpenChange(false); },
    onError: (failure) => setError(errorMessage(failure)),
  });
  const rows = query.data ?? [];
  const chosen = rows.find((row) => row.id === contactId);
  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} title="Link existing contact" description="Choose a contact with no company, or one to move from another account.">
      <div className="flex flex-col gap-4">
        <ErrorBanner message={error} />
        <ComboBox label="Contact" placeholder="Search by name or email" options={rows.map((row) => ({ value: row.id, label: `${row.name}${row.accountName ? ` — ${row.accountName}` : ""}` }))}
          selectedKey={contactId} onSelectionChange={(key) => setContactId(key ? String(key) : null)} onInputChange={setText} isLoading={query.isFetching}
          emptyMessage="No matching contacts" allowsEmptyCollection />
        {chosen?.accountName && <p className="text-sm text-warning">This contact will move from {chosen.accountName} to this account.</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" onPress={() => mutation.mutate()} isLoading={mutation.isPending} isDisabled={!contactId}>Link contact</Button>
        </div>
      </div>
    </Dialog>
  );
}

// ------------------------------------------------------------------ addresses

export function AccountAddressesPanel({ account, options, canEdit }: { account: Account; options: AccountOptions; canEdit: boolean }) {
  const workspace = useWorkspaceContext();
  const refresh = useAccountRefresh(account.id);
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "account", account.id, "addresses"), queryFn: () => listAccountAddresses(account.id) });
  const [editing, setEditing] = useState<AccountAddress | "new" | null>(null);
  const [removing, setRemoving] = useState<AccountAddress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const remove = useMutation({
    mutationFn: (address: AccountAddress) => removeAccountAddress(account.id, address.id),
    onSuccess: () => { setError(null); setRemoving(null); refresh(); },
    onError: (failure) => setError(errorMessage(failure)),
  });
  const addresses = query.data ?? [];

  return (
    <section className="flex flex-col gap-3">
      <SectionHeader title="Addresses" action={canEdit && <Button variant="primary" size="compact" onPress={() => setEditing("new")}>Add address</Button>} />
      <ErrorBanner message={error} />
      {query.isLoading ? <LoadingState label="Loading addresses" rows={2} /> : query.isError ? <ErrorBanner message="Could not load the addresses." /> : addresses.length === 0 ? (
        <EmptyState title="No addresses" description="Add the registered, billing, shipping and branch addresses. A billing address is needed before the account can become a customer." />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {addresses.map((address) => (
            <li key={address.id} className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-border bg-surface p-4 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="neutral">{ADDRESS_TYPE_LABELS[address.addressType] ?? address.addressType}</Badge>
                {address.isDefaultBilling && <Badge tone="brand">Default billing</Badge>}
                {address.isDefaultShipping && <Badge tone="info">Default shipping</Badge>}
              </div>
              <address className="not-italic text-text-secondary">
                {address.line1}{address.line2 ? <><br />{address.line2}</> : null}<br />
                {address.city}, {address.state} {address.postalCode}<br />
                {address.countryCode ? countryName(address.countryCode) : ""}
              </address>
              {canEdit && (
                <div className="flex gap-2">
                  <Button variant="outline" size="compact" onPress={() => setEditing(address)}>Edit</Button>
                  <Button variant="ghost" size="compact" onPress={() => setRemoving(address)}>Remove</Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {editing && <AddressDialog accountId={account.id} address={editing === "new" ? null : editing} options={options} onClose={() => setEditing(null)} onDone={refresh} />}
      <AlertDialog
        isOpen={Boolean(removing)}
        onOpenChange={(open) => !open && setRemoving(null)}
        title="Remove this address?"
        description="Documents that already printed it keep it; it is no longer offered for new ones."
        tone="danger"
        confirmLabel="Remove"
        isConfirming={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing)}
      />
    </section>
  );
}

function AddressDialog({ accountId, address, options, onClose, onDone }: {
  accountId: string; address: AccountAddress | null; options: AccountOptions; onClose: () => void; onDone: () => void;
}) {
  const [values, setValues] = useState({
    addressType: address?.addressType ?? "billing",
    line1: address?.line1 ?? "", line2: address?.line2 ?? "", city: address?.city ?? "", state: address?.state ?? "", stateCode: address?.stateCode ?? "",
    postalCode: address?.postalCode ?? "", countryCode: address?.countryCode ?? "IN",
    isDefaultBilling: address?.isDefaultBilling ?? false, isDefaultShipping: address?.isDefaultShipping ?? false,
  });
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const set = <K extends keyof typeof values>(key: K) => (value: (typeof values)[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => ({ ...current, [key]: "" }));
  };
  const mutation = useMutation({
    mutationFn: () => (address ? updateAccountAddress(accountId, address.id, values) : addAccountAddress(accountId, values)),
    onSuccess: () => { onDone(); onClose(); },
    onError: (failure) => {
      const issues = (failure as { details?: { issues?: Array<{ field: string; message: string }> } }).details?.issues ?? [];
      setFieldErrors(Object.fromEntries(issues.map((issue) => [issue.field, issue.message])));
      setError(errorMessage(failure));
    },
  });
  const complete = values.line1.trim() && values.city.trim() && values.state.trim() && values.postalCode.trim() && values.countryCode;
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={address ? "Edit address" : "Add address"} size="lg">
      <div className="flex flex-col gap-4">
        <ErrorBanner message={error} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Address type" isRequired selectedKey={values.addressType} onSelectionChange={(key) => set("addressType")(String(key))}
            options={options.addressTypes.map((entry) => ({ value: entry.code, label: entry.label }))} />
          <span className="hidden sm:block" />
          <TextField label="Address line 1" isRequired className="sm:col-span-2" value={values.line1} onChange={set("line1")} errorMessage={fieldErrors.line1} />
          <TextField label="Address line 2" className="sm:col-span-2" value={values.line2} onChange={set("line2")} />
          <TextField label="City" isRequired value={values.city} onChange={set("city")} errorMessage={fieldErrors.city} />
          <TextField label="State" isRequired value={values.state} onChange={set("state")} errorMessage={fieldErrors.state} />
          <TextField label="State code" description="GST state code, for example 27." value={values.stateCode} onChange={set("stateCode")} errorMessage={fieldErrors.stateCode} />
          <TextField label="Postal code" isRequired value={values.postalCode} onChange={set("postalCode")} errorMessage={fieldErrors.postalCode} />
          <CountrySelect value={values.countryCode} onChange={set("countryCode")} errorMessage={fieldErrors.countryCode} />
        </div>
        <Checkbox isSelected={values.isDefaultBilling} onChange={set("isDefaultBilling")}>Default billing address</Checkbox>
        <Checkbox isSelected={values.isDefaultShipping} onChange={set("isDefaultShipping")}>Default shipping address</Checkbox>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button variant="primary" onPress={() => mutation.mutate()} isLoading={mutation.isPending} isDisabled={!complete}>{address ? "Save address" : "Add address"}</Button>
        </div>
      </div>
    </Dialog>
  );
}

// ------------------------------------------------------------------ hierarchy

export function AccountHierarchyPanel({ account, canEdit }: { account: Account; canEdit: boolean }) {
  const workspace = useWorkspaceContext();
  const refresh = useAccountRefresh(account.id);
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "account", account.id, "hierarchy"), queryFn: () => getAccountHierarchy(account.id) });
  const [isChoosing, setChoosing] = useState(false);
  const [parentId, setParentId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: (next: string | null) => setAccountParent(account.id, next),
    onSuccess: () => { setError(null); setChoosing(false); setParentId(null); refresh(); },
    onError: (failure) => setError(errorMessage(failure)),
  });
  const hierarchy = query.data;

  return (
    <section className="flex flex-col gap-3">
      <SectionHeader title="Company structure" action={canEdit && (
        <>
          {account.parentPartyId && <Button variant="ghost" size="compact" onPress={() => mutation.mutate(null)} isLoading={mutation.isPending && !isChoosing}>Remove parent</Button>}
          <Button variant="secondary" size="compact" onPress={() => setChoosing(true)}>{account.parentPartyId ? "Change parent" : "Set parent account"}</Button>
        </>
      )} />
      <ErrorBanner message={error} />
      {query.isLoading ? <LoadingState label="Loading structure" rows={2} /> : !hierarchy ? null : (
        <div className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-border bg-surface p-4 text-sm">
          {hierarchy.parents.length ? (
            <p className="flex flex-wrap items-center gap-1 text-text-secondary">
              Part of
              {[...hierarchy.parents].reverse().map((parent, index) => (
                <span key={parent.id} className="flex items-center gap-1">
                  {index > 0 && <span aria-hidden="true">›</span>}
                  <Link href={`/crm/accounts/${parent.id}`} className="font-medium text-text hover:underline">{parent.name}</Link>
                </span>
              ))}
            </p>
          ) : <p className="text-text-muted">No parent account.</p>}
          {hierarchy.children.length > 0 && (
            <div className="flex flex-col gap-1">
              <p className="font-medium">Branches and subsidiaries</p>
              <ul className="flex flex-col gap-1">
                {hierarchy.children.map((child) => (
                  <li key={child.id} className="flex flex-wrap items-center gap-2">
                    <Link href={`/crm/accounts/${child.id}`} className="hover:underline">{child.name}</Link>
                    <span className="text-xs text-text-muted">{child.code}</span>
                    <AccountTypeBadge type={child.accountType} />
                    {child.status !== "active" && <AccountStatusBadge status={child.status} />}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      <Dialog isOpen={isChoosing} onOpenChange={setChoosing} title="Parent account" description="The company this account is a branch or subsidiary of.">
        <div className="flex flex-col gap-4">
          <AccountPicker label="Parent account" value={parentId} onChange={(id) => setParentId(id)} excludeId={account.id} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onPress={() => setChoosing(false)}>Cancel</Button>
            <Button variant="primary" onPress={() => mutation.mutate(parentId)} isLoading={mutation.isPending} isDisabled={!parentId}>Save</Button>
          </div>
        </div>
      </Dialog>
    </section>
  );
}
