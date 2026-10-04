"use client";

// Addresses tab: every location of the customer, grouped as Default Billing,
// Default Shipping and Other Locations, each under the label people know it
// by. Documents copy the address they use, so a change here never alters a
// quotation, order or invoice already issued; an address is deactivated,
// never deleted.
import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { Badge, Button, Checkbox, Dialog, EmptyState, SearchField, Select, TextField } from "@vercentlabs/design-system";

import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import {
  addCustomerAddress, errorCode, errorMessage, errorPayload, fieldErrors, listCustomerAddresses, updateCustomerAddress, type AddressInput, type Customer, type CustomerAddress,
  type CustomerOptions,
} from "../api/customers-api";
import { ErrorBanner, addressLines } from "../customer-format";

type Draft = {
  addressType: string; label: string; line1: string; line2: string; city: string; district: string; state: string; stateCode: string; postalCode: string; countryCode: string;
  gstin: string; contactPerson: string; phone: string; email: string; isDefaultBilling: boolean; isDefaultShipping: boolean;
};
const draftOf = (address: CustomerAddress | null, countryCode: string): Draft => ({
  addressType: address?.addressType ?? "shipping", label: address?.label ?? "", line1: address?.line1 ?? "", line2: address?.line2 ?? "", city: address?.city ?? "",
  district: address?.district ?? "", state: address?.state === "-" ? "" : address?.state ?? "", stateCode: address?.stateCode ?? "",
  postalCode: address?.postalCode === "-" ? "" : address?.postalCode ?? "", countryCode: address?.countryCode ?? countryCode, gstin: address?.gstin ?? "",
  contactPerson: address?.contactPerson ?? "", phone: address?.phone ?? "", email: address?.email ?? "",
  isDefaultBilling: address?.isDefaultBilling ?? false, isDefaultShipping: address?.isDefaultShipping ?? false,
});
type ActionName = "default_billing" | "default_shipping" | "deactivate" | "reactivate";

export function CustomerAddressesPanel({ customer, options }: { customer: Customer; options: CustomerOptions }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const can = options.capabilities;
  const [search, setSearch] = useState("");
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "sales", "customer", customer.id, "addresses", search.trim()), queryFn: () => listCustomerAddresses(customer.id, search.trim() || undefined) });
  const [editing, setEditing] = useState<CustomerAddress | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "sales", "customer", customer.id) });
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "sales", "customers") });
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "sales", "options") });
  };
  const action = useMutation({
    mutationFn: ({ address, name }: { address: CustomerAddress; name: ActionName }) => updateCustomerAddress(customer.id, address.id, { action: name }),
    onSuccess: () => { setError(null); refresh(); },
    onError: (failure) => setError(errorMessage(failure)),
  });
  const addresses = query.data ?? [];
  const active = addresses.filter((address) => address.isActive);
  const billing = active.filter((address) => address.isDefaultBilling);
  const shipping = active.filter((address) => address.isDefaultShipping && !address.isDefaultBilling);
  const others = active.filter((address) => !address.isDefaultBilling && !address.isDefaultShipping);
  const inactive = addresses.filter((address) => !address.isActive);

  const card = (address: CustomerAddress) => (
    <li key={address.id} className={`flex flex-col gap-2 rounded-[var(--radius-card)] border border-border bg-surface p-4 text-sm ${address.isActive ? "" : "opacity-70"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-base font-semibold">{address.label || `${address.addressTypeLabel} address`}</span>
        <Badge tone="neutral">{address.addressTypeLabel}</Badge>
        {address.isDefaultBilling && <Badge tone="info">Default billing</Badge>}
        {address.isDefaultShipping && <Badge tone="info">Default shipping</Badge>}
        {!address.isActive && <Badge tone="neutral">Inactive</Badge>}
      </div>
      <address className="not-italic text-text-secondary">{addressLines({ ...address, state: address.state === "-" ? "" : address.state, postalCode: address.postalCode === "-" ? "" : address.postalCode }).map((line) => <span key={line} className="block">{line}</span>)}</address>
      {address.gstin && <p><span className="text-text-muted">GSTIN:</span> <span className="tabular-nums">{address.gstin}</span>{address.stateCode ? <span className="text-text-muted"> · State code {address.stateCode}</span> : null}</p>}
      {(address.contactPerson || address.phone || address.email) && (
        <p className="text-text-secondary">{[address.contactPerson, address.phone, address.email].filter(Boolean).join(" · ")}</p>
      )}
      <div className="mt-auto flex flex-wrap gap-2 pt-1">
        {address.isActive && can.manageAddresses && <Button variant="ghost" size="compact" onPress={() => setEditing(address)}>Edit</Button>}
        {address.isActive && !address.isDefaultBilling && can.setDefaultBilling && <Button variant="ghost" size="compact" isDisabled={action.isPending} onPress={() => action.mutate({ address, name: "default_billing" })}>Set default billing</Button>}
        {address.isActive && !address.isDefaultShipping && can.setDefaultShipping && <Button variant="ghost" size="compact" isDisabled={action.isPending} onPress={() => action.mutate({ address, name: "default_shipping" })}>Set default shipping</Button>}
        {can.inactivateAddress && (
          <Button variant="ghost" size="compact" isDisabled={action.isPending} onPress={() => action.mutate({ address, name: address.isActive ? "deactivate" : "reactivate" })}>
            {address.isActive ? "Inactivate" : "Reactivate"}
          </Button>
        )}
      </div>
    </li>
  );
  const group = (title: string, list: CustomerAddress[], hint?: string): ReactNode => list.length === 0 ? null : (
    <section aria-label={title} className="flex flex-col gap-2">
      <h3 className="text-xs font-semibold tracking-wide text-text-muted uppercase">{title}{hint ? <span className="font-normal normal-case"> · {hint}</span> : null}</h3>
      <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{list.map(card)}</ul>
    </section>
  );

  return (
    <section className="flex flex-col gap-4 pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SearchField aria-label="Search addresses" placeholder="Search label, city, state or PIN code" className="w-full sm:w-80" value={search} onChange={setSearch} />
        {can.manageAddresses && <Button variant="primary" size="compact" onPress={() => setEditing("new")}><Plus className="size-4" aria-hidden="true" />Add Address</Button>}
      </div>
      <ErrorBanner message={error} />
      {query.isLoading ? <LoadingState label="Loading addresses" rows={3} />
        : query.isError ? <ErrorBanner message={errorCode(query.error) === "PERMISSION_DENIED" ? "You do not have permission to view customer addresses." : errorMessage(query.error, "The addresses could not be loaded.")} />
        : addresses.length === 0 ? <EmptyState title={search.trim() ? "No addresses match" : "No addresses yet"} description={search.trim() ? "Try a different search." : "Add the billing address before quoting this customer."} />
        : (
          <>
            {group("Default billing", billing, billing[0]?.isDefaultShipping ? "also the default shipping address" : undefined)}
            {group("Default shipping", shipping)}
            {group("Other locations", others)}
            {group("Inactive", inactive, "kept for the documents that used them")}
          </>
        )}
      <p className="text-xs text-text-muted">Documents keep the address they were issued with. Changing an address here affects new documents only.</p>
      {editing && (
        <AddressDialog key={editing === "new" ? "new" : editing.id} customer={customer} options={options} address={editing === "new" ? null : editing}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh(); }} />
      )}
    </section>
  );
}

function AddressDialog({ customer, options, address, onClose, onSaved }: {
  customer: Customer; options: CustomerOptions; address: CustomerAddress | null; onClose: () => void; onSaved: () => void;
}) {
  const can = options.capabilities;
  const [draft, setDraft] = useState<Draft>(() => draftOf(address, customer.countryCode ?? options.defaults.countryCode));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<string | null>(null);
  const set = <K extends keyof Draft>(field: K) => (value: Draft[K]) => { setDraft((current) => ({ ...current, [field]: value })); setErrors((current) => ({ ...current, [field]: "" })); setDuplicate(null); };
  const india = draft.countryCode === "IN";
  // Changing a location's GSTIN or tax state needs its own permission.
  const taxLocked = Boolean(address) && !can.editAddressGstin;
  const save = useMutation({
    mutationFn: (allowDuplicate: boolean) => {
      const input: AddressInput = {
        ...draft, label: draft.label.trim() || null, gstin: india ? draft.gstin.trim().toUpperCase() || null : null, stateCode: draft.stateCode.trim() || null,
        contactPerson: draft.contactPerson.trim() || null, phone: draft.phone.trim() || null, email: draft.email.trim() || null, allowDuplicate,
      };
      if (taxLocked) { delete input.gstin; delete input.stateCode; delete input.state; }
      // A default is moved by choosing another address, never by clearing it.
      if (address?.isDefaultBilling || !can.setDefaultBilling) delete input.isDefaultBilling;
      if (address?.isDefaultShipping || !can.setDefaultShipping) delete input.isDefaultShipping;
      return address ? updateCustomerAddress(customer.id, address.id, input) : addCustomerAddress(customer.id, input);
    },
    onSuccess: onSaved,
    onError: (failure) => {
      if (errorPayload(failure).duplicateAddress) { setDuplicate(errorMessage(failure)); setError(null); return; }
      setErrors(fieldErrors(failure));
      setError(errorMessage(failure));
    },
  });
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={address ? `Edit ${address.label || "address"}` : "Add address"} size="lg">
      <div className="flex flex-col gap-4 overflow-y-auto pr-1">
        <ErrorBanner message={error} />
        {duplicate && (
          <div role="alert" className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-warning-emphasis/40 bg-warning-soft px-3 py-2 text-sm">
            <p>{duplicate} Use the existing address, or save this one as a separate location.</p>
            <div><Button variant="secondary" size="compact" isLoading={save.isPending} onPress={() => save.mutate(true)}>Save anyway</Button></div>
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Address label" description="The name your team knows this location by: Mumbai HQ, Nagpur Plant, Pune Warehouse." value={draft.label} onChange={set("label")} autoFocus={!address} />
          <Select label="Address type" isRequired selectedKey={draft.addressType} onSelectionChange={(value) => set("addressType")(String(value))}
            options={options.addressTypes.map((entry) => ({ value: entry.code, label: entry.label }))} errorMessage={errors.addressType} />
          <TextField className="sm:col-span-2" label="Address line 1" isRequired value={draft.line1} onChange={set("line1")} errorMessage={errors.line1} />
          <TextField className="sm:col-span-2" label="Address line 2" value={draft.line2} onChange={set("line2")} />
          <TextField label="City" isRequired value={draft.city} onChange={set("city")} errorMessage={errors.city} />
          <TextField label="District" value={draft.district} onChange={set("district")} />
          <Select label="Country" isRequired selectedKey={draft.countryCode} onSelectionChange={(value) => set("countryCode")(String(value))}
            options={options.countries.map((country) => ({ value: country.code, label: country.name }))} errorMessage={errors.countryCode} />
          {india ? (
            <Select label="State" isRequired isDisabled={taxLocked} selectedKey={options.gstStates.find((state) => state.name === draft.state)?.code ?? null} placeholder="Choose a state"
              description={draft.stateCode ? `State code ${draft.stateCode}` : undefined}
              onSelectionChange={(value) => { const state = options.gstStates.find((entry) => entry.code === String(value)); if (state) { setDraft((current) => ({ ...current, state: state.name, stateCode: state.code })); setDuplicate(null); } }}
              options={options.gstStates.map((state) => ({ value: state.code, label: `${state.name} (${state.code})` }))} errorMessage={errors.state || errors.stateCode} />
          ) : <TextField label="State / Province" value={draft.state} onChange={set("state")} errorMessage={errors.state} />}
          <TextField label={india ? "PIN code" : "Postal code"} isRequired={india} value={draft.postalCode} onChange={set("postalCode")} errorMessage={errors.postalCode} />
          {india && (
            <TextField label="GSTIN of this location" isDisabled={taxLocked} value={draft.gstin} onChange={(value) => set("gstin")(value.toUpperCase())} errorMessage={errors.gstin}
              description={taxLocked ? "Only a user who may edit GST details can change this." : "Only if this location has its own GST registration. It must belong to the state above."} />
          )}
        </div>
        <section aria-label="Contact at this address" className="grid gap-4 border-t border-border pt-4 sm:grid-cols-3">
          <TextField label="Contact person" value={draft.contactPerson} onChange={set("contactPerson")} />
          <TextField label="Phone" value={draft.phone} onChange={set("phone")} errorMessage={errors.phone} />
          <TextField label="Email" type="email" value={draft.email} onChange={set("email")} errorMessage={errors.email} />
        </section>
        <div className="flex flex-col gap-2">
          <Checkbox isSelected={draft.isDefaultBilling} isDisabled={Boolean(address?.isDefaultBilling) || !can.setDefaultBilling} onChange={set("isDefaultBilling")}>Default billing address</Checkbox>
          <Checkbox isSelected={draft.isDefaultShipping} isDisabled={Boolean(address?.isDefaultShipping) || !can.setDefaultShipping} onChange={set("isDefaultShipping")}>Default shipping address</Checkbox>
          <p className="text-xs text-text-muted">One address can be both. To move a default, set it on another address.</p>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isLoading={save.isPending} onPress={() => save.mutate(false)}>{address ? "Save address" : "Add address"}</Button>
        </div>
      </div>
    </Dialog>
  );
}
