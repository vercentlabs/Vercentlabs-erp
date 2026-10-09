"use client";

// Add or change a supplier location, a person, or a GST registration. Used
// on the supplier and, for quick-create, on a purchase order: either way the
// record is saved to the Supplier Master, never to the document alone.
// Possible duplicates are shown while typing; they warn, they never block.
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button, Checkbox, CheckboxGroup, Dialog, Select, TextField } from "@vercentlabs/design-system";

import { useSubmitKey } from "@/shared/http/submit-once";

import {
  addAddress, addContact, addRegistration, checkAddressDuplicates, checkContactDuplicates, errorMessage, fieldIssuesOf, updateAddress, updateContact,
  type AddressMatch, type ContactMatch, type SupplierAddress, type SupplierContact, type SupplierOptions, type TaxRegistration,
} from "../api/suppliers-api";
import { Notice } from "@/shared/ui/Panel";

const NEW_GSTIN = "__new__";
const NONE = "none";
const picked = (value: string) => (value && value !== NONE ? value : null);

function useDebounced<T>(value: T, delay = 500) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => { const timer = setTimeout(() => setDebounced(value), delay); return () => clearTimeout(timer); }, [value, delay]);
  return debounced;
}

function Actions({ onCancel, onConfirm, label, busy, disabled }: { onCancel: () => void; onConfirm: () => void; label: string; busy: boolean; disabled?: boolean }) {
  return (
    <div className="flex justify-end gap-2 pt-2">
      <Button variant="secondary" onPress={onCancel}>Cancel</Button>
      <Button variant="primary" isLoading={busy} isDisabled={disabled} onPress={onConfirm}>{label}</Button>
    </div>
  );
}

export type DialogAccess = { setDefaults: boolean; manageTax: boolean };

export function AddressDialog({ supplierId, countryCode, address, registrations, options, access, presetPurposes, onClose, onDone }: {
  supplierId: string; countryCode: string | null; address: SupplierAddress | null; registrations: TaxRegistration[]; options: SupplierOptions; access: DialogAccess;
  presetPurposes?: string[]; onClose: () => void; onDone: (message: string, addressId: string) => void;
}) {
  const [values, setValues] = useState({
    label: address?.label ?? "", line1: address?.line1 ?? "", line2: address?.line2 ?? "", locality: address?.locality ?? "", city: address?.city ?? "", district: address?.district ?? "",
    state: address?.state ?? "", stateCode: address?.stateCode ?? "", postalCode: address?.postalCode ?? "", countryCode: address?.countryCode ?? countryCode ?? "IN",
    locationEmail: address?.locationEmail ?? "", locationPhone: address?.locationPhone ?? "", registration: address?.taxRegistration?.id ?? NONE, gstin: "",
    registrationType: "registered_regular",
  });
  const [purposes, setPurposes] = useState<string[]>(address?.purposes ?? presetPurposes ?? ["ordering"]);
  const [defaults, setDefaults] = useState<string[]>(address?.defaultFor ?? []);
  const set = (key: keyof typeof values) => (value: string) => setValues((current) => ({ ...current, [key]: value }));
  const probe = useDebounced(`${values.line1}|${values.line2}|${values.city}|${values.postalCode}|${values.countryCode}`);
  const [line1, line2, city, postalCode, country] = probe.split("|");
  const addressMatches = useQuery({
    queryKey: ["procurement", "supplier", supplierId, "address-duplicates", probe, address?.id ?? null],
    queryFn: () => checkAddressDuplicates(supplierId, { line1, line2, city, postalCode, countryCode: country, exceptAddressId: address?.id }).catch((): AddressMatch[] => []),
    enabled: Boolean(line1.trim() && city.trim()),
  });
  const matches = (line1.trim() && city.trim() ? addressMatches.data : undefined) ?? [];
  const defaultable = options.addressPurposes.filter((entry) => entry.hasDefault && purposes.includes(entry.code));
  const submit = useSubmitKey();
  const save = useMutation({
    mutationFn: () => submit.run(async () => {
      const body: Record<string, unknown> = {
        label: values.label || null, purposes, line1: values.line1, line2: values.line2 || null, locality: values.locality || null, city: values.city, district: values.district || null,
        state: values.state || null, stateCode: picked(values.stateCode), postalCode: values.postalCode || null, countryCode: values.countryCode, locationEmail: values.locationEmail || null,
        locationPhone: values.locationPhone || null,
      };
      if (access.manageTax) {
        if (values.registration === NEW_GSTIN) { body.gstin = values.gstin; body.registrationType = values.registrationType; }
        else if (values.registration !== (address?.taxRegistration?.id ?? NONE)) body.taxRegistrationId = picked(values.registration);
      }
      if (access.setDefaults) body.defaults = defaults.filter((purpose) => purposes.includes(purpose));
      return address ? updateAddress(supplierId, address.id, body) : addAddress(supplierId, body);
    }),
    onSuccess: (result) => onDone(address ? "The address was saved." : `${values.label || "The address"} was added.`, result.addressId),
  });
  const issues = fieldIssuesOf(save.error);
  const field = (key: keyof typeof values, label: string, props: Record<string, unknown> = {}) => (
    <TextField label={label} value={values[key]} onChange={set(key)} errorMessage={issues[key]} isInvalid={Boolean(issues[key])} {...props} />
  );
  const activeRegistrations = registrations.filter((entry) => entry.status === "active" || entry.id === address?.taxRegistration?.id);
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={address ? `Edit ${address.label}` : "Add address"}
      description="One place can serve several purposes. Documents that used this address keep the address they used.">
      <div className="flex flex-col gap-3">
        {save.error && <Notice>{errorMessage(save.error)}</Notice>}
        {matches.length > 0 && (
          <Notice tone="warning">This place may already be on file: {matches.map((match) => `${match.label} (${match.reason.toLowerCase()}${match.status !== "active" ? ", inactive" : ""})`).join(", ")}.
            Add it only if it is a different location.</Notice>
        )}
        {field("label", "Label", { isRequired: true, description: "What people call it, like Nashik Plant or Pune Head Office." })}
        <CheckboxGroup label="Used for" value={purposes} onChange={setPurposes} orientation="horizontal" errorMessage={issues.purposes} isInvalid={Boolean(issues.purposes)}>
          {options.addressPurposes.map((entry) => <Checkbox key={entry.code} value={entry.code}>{entry.label}</Checkbox>)}
        </CheckboxGroup>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {field("line1", "Address", { isRequired: true })}
          {field("line2", "Address line 2")}
          {field("locality", "Area / locality")}
          {field("city", "City", { isRequired: true })}
          {field("district", "District")}
          {field("state", "State / province")}
          <Select label="State code" options={[{ value: NONE, label: "—" }, ...options.states.map((state) => ({ value: state.code, label: `${state.code} · ${state.name}` }))]}
            selectedKey={values.stateCode || NONE} onSelectionChange={(value) => set("stateCode")(String(value ?? ""))} />
          {field("postalCode", "PIN / postal code")}
          {field("countryCode", "Country code")}
          {field("locationEmail", "Location email", { type: "email" })}
          {field("locationPhone", "Location phone")}
        </div>
        {access.manageTax && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Select label="GST registration of this location" selectedKey={values.registration} onSelectionChange={(value) => set("registration")(String(value ?? ""))}
              options={[{ value: NONE, label: "None (unregistered)" }, ...activeRegistrations.map((entry) => ({ value: entry.id, label: `${entry.gstin} · ${entry.stateName ?? entry.stateCode}${entry.isPrincipal ? " · principal" : ""}` })),
                { value: NEW_GSTIN, label: "Another GSTIN…" }]} errorMessage={issues.taxRegistrationId} />
            {values.registration === NEW_GSTIN && field("gstin", "GSTIN", { isRequired: true })}
          </div>
        )}
        {access.setDefaults && defaultable.length > 0 && (
          <CheckboxGroup label="Default address for" value={defaults} onChange={setDefaults} orientation="horizontal"
            description="A purpose has one default address; choosing this one replaces the current default.">
            {defaultable.map((entry) => <Checkbox key={entry.code} value={entry.code}>{entry.label}</Checkbox>)}
          </CheckboxGroup>
        )}
        <Actions onCancel={onClose} onConfirm={() => save.mutate()} label="Save" busy={save.isPending || save.isSuccess}
          disabled={!values.line1.trim() || !values.city.trim() || !values.label.trim() || !purposes.length || (values.registration === NEW_GSTIN && !values.gstin.trim())} />
      </div>
    </Dialog>
  );
}

export function ContactDialog({ supplierId, contact, addresses, options, access, presetRoles, onClose, onDone }: {
  supplierId: string; contact: SupplierContact | null; addresses: Array<Pick<SupplierAddress, "id" | "label" | "city" | "status">>; options: SupplierOptions; access: DialogAccess;
  presetRoles?: string[]; onClose: () => void; onDone: (message: string, relationshipId: string) => void;
}) {
  const [values, setValues] = useState({
    firstName: contact?.firstName ?? "", lastName: contact?.lastName ?? "", designation: contact?.designation ?? "", department: contact?.department ?? "", email: contact?.email ?? "",
    mobile: contact?.mobile ?? "", phone: contact?.phone ?? "", locationId: contact?.location?.id ?? NONE,
  });
  const [roles, setRoles] = useState<string[]>(contact?.roles ?? presetRoles ?? ["procurement"]);
  const [defaults, setDefaults] = useState<string[]>(contact?.defaultFor ?? []);
  const [linkContactId, setLinkContactId] = useState<string | null>(null);
  const set = (key: keyof typeof values) => (value: string) => setValues((current) => ({ ...current, [key]: value }));
  const probe = useDebounced(`${values.firstName}|${values.lastName}|${values.designation}|${values.email}|${values.mobile}|${values.phone}`);
  const [firstName, lastName, designation, email, mobile, phone] = probe.split("|");
  const probing = Boolean(email.trim() || mobile.trim() || phone.trim() || firstName.trim());
  const contactMatches = useQuery({
    queryKey: ["procurement", "supplier", supplierId, "contact-duplicates", probe, contact?.id ?? null],
    queryFn: () => checkContactDuplicates(supplierId, { firstName, lastName, designation, email, mobile, phone, exceptRelationshipId: contact?.id }).catch((): ContactMatch[] => []),
    enabled: probing,
  });
  const matches = (probing ? contactMatches.data : undefined) ?? [];
  const submit = useSubmitKey();
  const save = useMutation({
    mutationFn: () => submit.run(async () => {
      const relationship: Record<string, unknown> = { roles, locationId: picked(values.locationId), ...(access.setDefaults ? { defaults } : {}) };
      if (linkContactId) return addContact(supplierId, { contactId: linkContactId, ...relationship });
      const person = { firstName: values.firstName, lastName: values.lastName || null, designation: values.designation || null, department: values.department || null,
        email: values.email || null, mobile: values.mobile || null, phone: values.phone || null };
      return contact ? updateContact(supplierId, contact.id, { ...person, ...relationship }) : addContact(supplierId, { ...person, ...relationship });
    }),
    onSuccess: (result) => onDone(contact ? "The contact was saved." : linkContactId ? "The existing contact was linked to this supplier." : "The contact was added.", result.relationshipId),
  });
  const issues = fieldIssuesOf(save.error);
  const field = (key: keyof typeof values, label: string, props: Record<string, unknown> = {}) => (
    <TextField label={label} value={values[key]} onChange={set(key)} errorMessage={issues[key]} isInvalid={Boolean(issues[key])} isDisabled={Boolean(linkContactId)} {...props} />
  );
  const linked = matches.find((match) => match.contactId === linkContactId);
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={contact ? `Edit ${contact.name}` : "Add contact"}
      description={contact ? "The person's details are a shared contact: a change shows wherever they appear. Documents keep the details they were sent with." : "A person at this supplier, what they do for you, and where."}>
      <div className="flex flex-col gap-3">
        {save.error && <Notice>{errorMessage(save.error)}</Notice>}
        {!contact && matches.length > 0 && (
          <div className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-warning-emphasis/30 bg-warning-soft p-3 text-sm">
            <span className="font-medium text-text">This person may already exist</span>
            {matches.map((match) => (
              <span key={`${match.scope}:${match.contactId}`} className="flex flex-wrap items-center justify-between gap-2">
                <span>{match.name}{match.designation ? `, ${match.designation}` : ""}{match.scope === "tenant" && match.company ? ` · ${match.company}` : match.scope === "supplier" ? " · already at this supplier" : ""} · {match.reason}</span>
                {match.scope === "tenant" && (
                  <Button size="compact" variant={linkContactId === match.contactId ? "primary" : "secondary"} onPress={() => setLinkContactId(linkContactId === match.contactId ? null : match.contactId)}>
                    {linkContactId === match.contactId ? "Using this person" : "Use this person"}
                  </Button>
                )}
              </span>
            ))}
          </div>
        )}
        {linked && <Notice tone="info">{linked.name} will be linked to this supplier as they are; no new contact is created.</Notice>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {field("firstName", "First name", { isRequired: true })}
          {field("lastName", "Last name")}
          {field("designation", "Designation")}
          {field("department", "Department")}
          {field("email", "Email", { type: "email", description: "Needed only to email RFQs and orders." })}
          {field("mobile", "Mobile")}
          {field("phone", "Phone")}
          <Select label="Location (optional)" selectedKey={values.locationId} onSelectionChange={(value) => set("locationId")(String(value ?? ""))}
            options={[{ value: NONE, label: "Across the supplier" }, ...addresses.filter((entry) => entry.status === "active" || entry.id === values.locationId)
              .map((entry) => ({ value: entry.id, label: `${entry.label} · ${entry.city}` }))]} />
        </div>
        <CheckboxGroup label="Roles" value={roles} onChange={setRoles} orientation="horizontal" errorMessage={issues.roles} isInvalid={Boolean(issues.roles)}>
          {options.contactRoles.map((entry) => <Checkbox key={entry.code} value={entry.code}>{entry.label}</Checkbox>)}
        </CheckboxGroup>
        {access.setDefaults && (
          <CheckboxGroup label="Default contact for" value={defaults} onChange={setDefaults} orientation="horizontal"
            description="A purpose has one default person; choosing this one replaces the current default.">
            {options.contactPurposes.map((entry) => <Checkbox key={entry.code} value={entry.code}>{entry.label}</Checkbox>)}
          </CheckboxGroup>
        )}
        <Actions onCancel={onClose} onConfirm={() => save.mutate()} label={linkContactId ? "Link contact" : "Save"} busy={save.isPending || save.isSuccess}
          disabled={(!linkContactId && !values.firstName.trim()) || !roles.length} />
      </div>
    </Dialog>
  );
}

export function RegistrationDialog({ supplierId, options, onClose, onDone }: { supplierId: string; options: SupplierOptions; onClose: () => void; onDone: (message: string) => void }) {
  const [gstin, setGstin] = useState("");
  const [type, setType] = useState("registered_regular");
  const submit = useSubmitKey();
  const save = useMutation({
    mutationFn: () => submit.run(() => addRegistration(supplierId, { gstin, registrationType: type })),
    onSuccess: () => onDone(`GST registration ${gstin.toUpperCase()} was added.`),
  });
  const issues = fieldIssuesOf(save.error);
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title="Add GST registration" description="Another state registration of this supplier. Link it to the locations that trade under it.">
      <div className="flex flex-col gap-3">
        {save.error && <Notice>{errorMessage(save.error)}</Notice>}
        <TextField label="GSTIN" isRequired value={gstin} onChange={setGstin} errorMessage={issues.gstin} isInvalid={Boolean(issues.gstin)} description="The state is read from its first two digits." />
        <Select label="Registration type" selectedKey={type} onSelectionChange={(value) => setType(String(value))}
          options={options.gstRegistrationTypes.filter((entry) => entry.needsGstin || entry.code === "deemed_export").map((entry) => ({ value: entry.code, label: entry.label }))} />
        <Actions onCancel={onClose} onConfirm={() => save.mutate()} label="Add" busy={save.isPending || save.isSuccess} disabled={gstin.trim().length < 15} />
      </div>
    </Dialog>
  );
}
