"use client";

// Supplier → Addresses & Contacts: the supplier's locations (each with its
// purposes, GST registration and the defaults it holds), its people (roles,
// location, defaults) and its GST registrations. Nothing is ever deleted
// here: an old location or a person who left is deactivated, stops being a
// default, and stays on the documents that used it.
import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button, Menu, MenuItem, MenuTrigger, SearchField, Select, StatusBadge } from "@vercentlabs/design-system";


import { errorMessage, setDefault, updateAddress, updateContact, updateRegistration, type SupplierAddress, type SupplierContact, type SupplierDetail, type SupplierOptions } from "../api/suppliers-api";
import { formatAddress } from "../supplier-format";
import { AddressDialog, ContactDialog, RegistrationDialog } from "./LocationContactDialogs";
import { Notice, Panel } from "@/shared/ui/Panel";

const ANY = "any";
const DEFAULT_LABEL: Record<string, string> = {
  registered: "Default registered", ordering: "Default ordering", billing: "Default billing", ship_from: "Default ship-from", return_to: "Default return-to",
  primary: "Primary", rfq: "Default RFQ", accounts: "Default accounts", dispatch: "Default dispatch",
};
const contactDefaultLabel = (purpose: string) => (purpose === "ordering" ? "Default ordering" : DEFAULT_LABEL[purpose] ?? purpose);

// show: only the addresses or only the contacts (the supplier's Addresses and Contacts tabs); both when omitted.
export function AddressesContactsPanel({ detail, options, onChanged, onShowHistory, show }: {
  detail: SupplierDetail; options: SupplierOptions; onChanged: (message: string) => void; onShowHistory: () => void; show?: "addresses" | "contacts";
}) {
  const { supplier, addresses, contacts, taxRegistrations, actions } = detail;
  const access = { setDefaults: actions.setDefaults, manageTax: actions.manageTaxRegistrations };
  const [address, setAddress] = useState<SupplierAddress | "new" | null>(null);
  const [contact, setContact] = useState<SupplierContact | "new" | null>(null);
  const [registering, setRegistering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [addressSearch, setAddressSearch] = useState("");
  const [purpose, setPurpose] = useState(ANY);
  const [addressStatus, setAddressStatus] = useState("active");
  const [contactSearch, setContactSearch] = useState("");
  const [role, setRole] = useState(ANY);
  const [contactStatus, setContactStatus] = useState("active");
  const done = (message: string) => { setError(null); onChanged(message); };
  const fail = (failure: unknown) => setError(errorMessage(failure));

  const toggleAddress = useMutation({
    mutationFn: (entry: SupplierAddress) => updateAddress(supplier.id, entry.id, { active: entry.status !== "active" }),
    onSuccess: (result, entry) => {
      setWarning(entry.status === "active" && result.openDocuments ? `${result.openDocuments} open purchase order${result.openDocuments === 1 ? "" : "s"} name ${entry.label}; they keep it as it was.` : null);
      done(entry.status === "active" ? `${entry.label} was deactivated.` : `${entry.label} was reactivated.`);
    },
    onError: fail,
  });
  const toggleContact = useMutation({
    mutationFn: (entry: SupplierContact) => updateContact(supplier.id, entry.id, { active: entry.status !== "active" }),
    onSuccess: (_result, entry) => done(entry.status === "active" ? `${entry.name} was deactivated for this supplier.` : `${entry.name} was reactivated.`),
    onError: fail,
  });
  const makeDefault = useMutation({
    mutationFn: (input: { kind: "address" | "contact"; purpose: string; id: string }) => setDefault(supplier.id, input.kind, input.purpose, input.id),
    onSuccess: () => done("The default was changed."),
    onError: fail,
  });
  const toggleRegistration = useMutation({
    mutationFn: (entry: { id: string; status: string }) => updateRegistration(supplier.id, entry.id, { status: entry.status === "active" ? "inactive" : "active" }),
    onSuccess: () => done("The GST registration was changed."),
    onError: fail,
  });

  const shownAddresses = useMemo(() => addresses.filter((entry) => (addressStatus === ANY || entry.status === addressStatus) && (purpose === ANY || entry.purposes.includes(purpose))
    && (!addressSearch.trim() || [entry.label, entry.line1, entry.city, entry.state, entry.postalCode, entry.taxRegistration?.gstin].filter(Boolean).join(" ").toLowerCase()
      .includes(addressSearch.trim().toLowerCase()))), [addresses, addressStatus, purpose, addressSearch]);
  const shownContacts = useMemo(() => contacts.filter((entry) => (contactStatus === ANY || entry.status === contactStatus) && (role === ANY || entry.roles.includes(role))
    && (!contactSearch.trim() || [entry.name, entry.email, entry.mobile, entry.phone, entry.designation, entry.location?.label, ...entry.roleLabels].filter(Boolean).join(" ").toLowerCase()
      .includes(contactSearch.trim().toLowerCase()))), [contacts, contactStatus, role, contactSearch]);
  const statusOptions = [{ value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }, { value: ANY, label: "All" }];

  return (
    <div className="flex flex-col gap-4">
      {error && <Notice>{error}</Notice>}
      {warning && <Notice tone="warning">{warning}</Notice>}

      {actions.viewAddresses && show !== "contacts" && <Panel title="Addresses" description="Each location with what it is used for. A purpose has one default; documents start from it and can choose another active location."
        actions={actions.manageAddresses ? <Button size="compact" variant="secondary" onPress={() => setAddress("new")}>Add address</Button> : undefined}>
        <div className="flex flex-wrap gap-2">
          <SearchField aria-label="Search addresses" placeholder="Label, city, state, PIN or GSTIN" className="w-full sm:w-72" value={addressSearch} onChange={setAddressSearch} />
          <Select aria-label="Purpose" size="compact" selectedKey={purpose} onSelectionChange={(value) => setPurpose(String(value))}
            options={[{ value: ANY, label: "Any purpose" }, ...options.addressPurposes.map((entry) => ({ value: entry.code, label: entry.label }))]} />
          <Select aria-label="Address status" size="compact" selectedKey={addressStatus} onSelectionChange={(value) => setAddressStatus(String(value))} options={statusOptions} />
        </div>
        {!shownAddresses.length ? <p className="text-sm text-text-muted">{addresses.length ? "No address matches." : "No addresses yet."}</p> : (
          <ul className="flex flex-col divide-y divide-border">
            {shownAddresses.map((entry) => (
              <li key={entry.id} className={`flex flex-wrap items-start justify-between gap-3 py-3 ${entry.status !== "active" ? "opacity-60" : ""}`}>
                <span className="flex min-w-0 flex-col gap-1 text-sm">
                  <span className="flex flex-wrap items-center gap-2 font-medium">
                    {entry.label}
                    {entry.defaultFor.map((purposeCode) => <StatusBadge key={purposeCode} tone="info">{DEFAULT_LABEL[purposeCode]}</StatusBadge>)}
                    {entry.status !== "active" && <StatusBadge tone="neutral">Inactive</StatusBadge>}
                  </span>
                  <span className="text-xs text-text-muted">{entry.purposeLabels.join(" · ")}</span>
                  <span className="text-text-secondary">{formatAddress(entry)}</span>
                  <span className="text-xs text-text-muted">
                    {[entry.taxRegistration ? `GSTIN ${entry.taxRegistration.gstin}${entry.taxRegistration.status !== "active" ? " (inactive)" : ""}` : "No GST registration", entry.locationEmail, entry.locationPhone]
                      .filter(Boolean).join(" · ")}
                  </span>
                </span>
                <span className="flex flex-wrap gap-1">
                  {actions.manageAddresses && entry.status === "active" && <Button size="compact" variant="ghost" onPress={() => setAddress(entry)}>Edit</Button>}
                  {actions.setDefaults && entry.status === "active" && (
                    <MenuTrigger>
                      <Button size="compact" variant="ghost">Set default</Button>
                      <Menu onAction={(key) => makeDefault.mutate({ kind: "address", purpose: String(key), id: entry.id })}>
                        {options.addressPurposes.filter((p) => p.hasDefault && entry.purposes.includes(p.code) && !entry.defaultFor.includes(p.code))
                          .map((p) => <MenuItem key={p.code} id={p.code}>{`Default ${p.label}`}</MenuItem>)}
                      </Menu>
                    </MenuTrigger>
                  )}
                  {actions.deactivateAddresses && (
                    <Button size="compact" variant="ghost" isLoading={toggleAddress.isPending && toggleAddress.variables?.id === entry.id} onPress={() => toggleAddress.mutate(entry)}>
                      {entry.status === "active" ? "Deactivate" : "Reactivate"}
                    </Button>
                  )}
                  <Button size="compact" variant="ghost" onPress={onShowHistory}>View history</Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>}

      {actions.viewContacts && show !== "addresses" && <Panel title="Contacts" description="The people at this supplier. One person can hold several roles; documents keep the person they named even if they leave."
        actions={actions.manageContacts ? <Button size="compact" variant="secondary" onPress={() => setContact("new")}>Add contact</Button> : undefined}>
        <div className="flex flex-wrap gap-2">
          <SearchField aria-label="Search contacts" placeholder="Name, email, phone, designation or location" className="w-full sm:w-72" value={contactSearch} onChange={setContactSearch} />
          <Select aria-label="Role" size="compact" selectedKey={role} onSelectionChange={(value) => setRole(String(value))}
            options={[{ value: ANY, label: "Any role" }, ...options.contactRoles.map((entry) => ({ value: entry.code, label: entry.label }))]} />
          <Select aria-label="Contact status" size="compact" selectedKey={contactStatus} onSelectionChange={(value) => setContactStatus(String(value))} options={statusOptions} />
        </div>
        {!shownContacts.length ? <p className="text-sm text-text-muted">{contacts.length ? "No contact matches." : "No contacts yet."}</p> : (
          <ul className="flex flex-col divide-y divide-border">
            {shownContacts.map((entry) => (
              <li key={entry.id} className={`flex flex-wrap items-start justify-between gap-3 py-3 ${entry.status !== "active" ? "opacity-60" : ""}`}>
                <span className="flex min-w-0 flex-col gap-1 text-sm">
                  <span className="flex flex-wrap items-center gap-2 font-medium">
                    {entry.name}
                    {entry.defaultFor.map((purposeCode) => <StatusBadge key={purposeCode} tone="info">{contactDefaultLabel(purposeCode)}</StatusBadge>)}
                    {entry.status !== "active" && <StatusBadge tone="neutral">Inactive</StatusBadge>}
                  </span>
                  {entry.designation && <span className="text-text-secondary">{entry.designation}{entry.department ? ` · ${entry.department}` : ""}</span>}
                  <span className="text-xs text-text-muted">{entry.roleLabels.join(" · ")}{entry.location ? ` · ${entry.location.label}` : ""}</span>
                  <span className="text-text-secondary">{[entry.email, entry.mobile ?? entry.phone].filter(Boolean).join(" · ") || <span className="text-text-muted">No email or phone</span>}</span>
                </span>
                <span className="flex flex-wrap gap-1">
                  {actions.manageContacts && entry.status === "active" && <Button size="compact" variant="ghost" onPress={() => setContact(entry)}>Edit</Button>}
                  {actions.setDefaults && entry.status === "active" && (
                    <MenuTrigger>
                      <Button size="compact" variant="ghost">Set default</Button>
                      <Menu onAction={(key) => makeDefault.mutate({ kind: "contact", purpose: String(key), id: entry.id })}>
                        {options.contactPurposes.filter((p) => !entry.defaultFor.includes(p.code)).map((p) => <MenuItem key={p.code} id={p.code}>{p.label}</MenuItem>)}
                      </Menu>
                    </MenuTrigger>
                  )}
                  {actions.deactivateContacts && (
                    <Button size="compact" variant="ghost" isLoading={toggleContact.isPending && toggleContact.variables?.id === entry.id} onPress={() => toggleContact.mutate(entry)}>
                      {entry.status === "active" ? "Deactivate" : "Reactivate"}
                    </Button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>}

      {actions.viewAddresses && <Panel title="GST registrations" description="One supplier can hold a registration per state, and one registration can cover several locations."
        actions={actions.manageTaxRegistrations ? <Button size="compact" variant="secondary" onPress={() => setRegistering(true)}>Add registration</Button> : undefined}>
        {!taxRegistrations.length ? <p className="text-sm text-text-muted">No GST registrations.</p> : (
          <ul className="flex flex-col divide-y divide-border text-sm">
            {taxRegistrations.map((entry) => {
              const locations = addresses.filter((item) => item.taxRegistration?.id === entry.id && item.status === "active");
              return (
                <li key={entry.id} className={`flex flex-wrap items-center justify-between gap-3 py-2 ${entry.status !== "active" ? "opacity-60" : ""}`}>
                  <span className="flex flex-col gap-0.5">
                    <span className="flex flex-wrap items-center gap-2 font-medium tabular-nums">
                      {entry.gstin}{entry.isPrincipal && <StatusBadge tone="info">Principal</StatusBadge>}{entry.status !== "active" && <StatusBadge tone="neutral">Inactive</StatusBadge>}
                    </span>
                    <span className="text-xs text-text-muted">{entry.registrationLabel} · {entry.stateName ?? entry.stateCode} · {locations.length ? locations.map((item) => item.label).join(", ") : "no location linked"}</span>
                  </span>
                  {actions.manageTaxRegistrations && !entry.isPrincipal && (
                    <Button size="compact" variant="ghost" isLoading={toggleRegistration.isPending && toggleRegistration.variables?.id === entry.id} onPress={() => toggleRegistration.mutate(entry)}>
                      {entry.status === "active" ? "Deactivate" : "Reactivate"}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>}

      {address && <AddressDialog supplierId={supplier.id} countryCode={supplier.countryCode} address={address === "new" ? null : address} registrations={taxRegistrations} options={options}
        access={access} onClose={() => setAddress(null)} onDone={(message) => { setAddress(null); done(message); }} />}
      {contact && <ContactDialog supplierId={supplier.id} contact={contact === "new" ? null : contact} addresses={addresses} options={options} access={access}
        onClose={() => setContact(null)} onDone={(message) => { setContact(null); done(message); }} />}
      {registering && <RegistrationDialog supplierId={supplier.id} options={options} onClose={() => setRegistering(false)} onDone={(message) => { setRegistering(false); done(message); }} />}
    </div>
  );
}
