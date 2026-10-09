"use client";

// The customer form: creating a customer (in full, or the compact version
// used from a quotation), creating one from a CRM account, and editing.
// Sections: Identity, Commercial, Tax, and on creation the first address and
// the primary contact. Duplicates are checked while typing and again on save.
import { useEffect, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Badge, Button, Checkbox, Select, TextArea, TextField } from "@vercentlabs/design-system";

import { FormSection } from "@/shared/ui/FormSection";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import {
  createCustomer, createCustomerFromAccount, duplicateMatches, errorMessage, fieldErrors, findDuplicateCustomers, updateCustomer,
  type AddressInput, type Customer, type CustomerInput, type CustomerOptions, type DuplicateResult,
} from "../api/customers-api";
import { ErrorBanner, NONE, orNull, withNone } from "../customer-format";
import { useSubmitKey } from "@/shared/http/submit-once";

type Values = {
  displayName: string; legalName: string; customerKind: string; status: string; email: string; phone: string; website: string; countryCode: string; currencyCode: string;
  priceListId: string; paymentTermId: string; gstRegistrationType: string; gstin: string; placeOfSupply: string; ownerUserId: string; notes: string;
};
type AddressValues = { label: string; line1: string; line2: string; city: string; district: string; state: string; postalCode: string; countryCode: string };
type ContactValues = { firstName: string; lastName: string; email: string; phone: string; jobTitle: string };

const EMPTY_ADDRESS: AddressValues = { label: "", line1: "", line2: "", city: "", district: "", state: "", postalCode: "", countryCode: "" };
const EMPTY_CONTACT: ContactValues = { firstName: "", lastName: "", email: "", phone: "", jobTitle: "" };
const IDENTITY: Array<keyof Values> = ["displayName", "legalName", "website", "email", "phone", "gstin"];

function initialValues(options: CustomerOptions, source?: Partial<CustomerInput> | Customer | null): Values {
  const from = (source ?? {}) as Record<string, string | null | undefined>;
  return {
    displayName: from.displayName ?? "",
    legalName: from.legalName ?? "",
    customerKind: from.customerKind ?? "business",
    status: "active",
    email: from.email ?? "",
    phone: from.phone ?? "",
    website: from.website ?? "",
    countryCode: from.countryCode ?? options.defaults.countryCode,
    currencyCode: from.currencyCode ?? options.defaults.currencyCode ?? "",
    priceListId: from.priceListId ?? NONE,
    paymentTermId: from.paymentTermId ?? NONE,
    gstRegistrationType: from.gstRegistrationType ?? NONE,
    gstin: from.gstin ?? "",
    placeOfSupply: from.placeOfSupply ?? NONE,
    ownerUserId: from.ownerUserId ?? (source ? NONE : options.defaults.ownerUserId ?? NONE),
    notes: from.notes ?? "",
  };
}

function toInput(values: Values): CustomerInput {
  return {
    displayName: values.displayName.trim(), legalName: values.legalName.trim() || null, customerKind: values.customerKind, email: values.email.trim() || null,
    phone: values.phone.trim() || null, website: values.website.trim() || null, countryCode: values.countryCode, currencyCode: values.currencyCode,
    priceListId: orNull(values.priceListId), paymentTermId: orNull(values.paymentTermId), gstRegistrationType: orNull(values.gstRegistrationType),
    gstin: values.gstin.trim().toUpperCase() || null, placeOfSupply: orNull(values.placeOfSupply), ownerUserId: orNull(values.ownerUserId), notes: values.notes.trim() || null,
  };
}

const addressInput = (address: AddressValues, fallbackCountry: string): AddressInput | null =>
  address.line1.trim() ? { ...address, label: address.label.trim() || null, countryCode: address.countryCode || fallbackCountry } : null;


function AddressFields({ value, onChange, errors }: { value: AddressValues; onChange: (next: AddressValues) => void; errors: Record<string, string> }) {
  const set = (key: keyof AddressValues) => (text: string) => onChange({ ...value, [key]: text });
  return (
    <>
      <TextField className="sm:col-span-2" label="Address line 1" value={value.line1} onChange={set("line1")} errorMessage={errors.line1} />
      <TextField className="sm:col-span-2" label="Address line 2" value={value.line2} onChange={set("line2")} />
      <TextField label="City" value={value.city} onChange={set("city")} errorMessage={errors.city} />
      <TextField label="District" value={value.district} onChange={set("district")} />
      <TextField label="State" value={value.state} onChange={set("state")} errorMessage={errors.state} />
      <TextField label="Postal code" value={value.postalCode} onChange={set("postalCode")} errorMessage={errors.postalCode} />
    </>
  );
}

export function DuplicatePanel({ result, reason, onReasonChange, acknowledged, onAcknowledge }: {
  result: DuplicateResult; reason: string; onReasonChange: (value: string) => void; acknowledged: boolean; onAcknowledge: (value: boolean) => void;
}) {
  if (!result.matches.length) return null;
  const strong = result.hasBlockingMatch;
  return (
    <div role={strong ? "alert" : "status"} className={`flex flex-col gap-2 rounded-[var(--radius-control)] border px-3 py-3 text-sm ${strong ? "border-warning-emphasis/40 bg-warning-soft" : "border-border bg-surface-muted"}`}>
      <p className="font-medium">{strong ? "This looks like a customer you already have" : "Possible duplicates"}</p>
      <ul className="flex flex-col gap-2">
        {result.matches.map((match) => (
          <li key={match.id} className="flex flex-wrap items-center gap-2">
            <Badge tone={match.strength === "strong" ? "warning" : "neutral"}>{match.strength === "strong" ? "Strong match" : "Possible"}</Badge>
            <Link href={match.href} target="_blank" className="font-medium text-brand underline-offset-2 hover:underline">{match.name ?? "Open record"}</Link>
            <span className="text-text-secondary">
              {[match.isCustomer ? match.customerNumber : `CRM account ${match.accountNumber ?? ""}`.trim(), match.city, match.reasons.map((entry) => entry.label).join(", ")].filter(Boolean).join(" · ")}
            </span>
            {!match.isCustomer && <Link href={`/sales/customers/new?accountId=${match.id}`} className="text-brand underline-offset-2 hover:underline">Create the customer from this account</Link>}
          </li>
        ))}
      </ul>
      {strong && (result.canOverride ? (
        <>
          <Checkbox isSelected={acknowledged} onChange={onAcknowledge}>This is a different customer. Save it anyway.</Checkbox>
          {acknowledged && <TextField label="Why is this not a duplicate?" value={reason} onChange={onReasonChange} isRequired />}
        </>
      ) : <p className="text-text-secondary">Use the existing customer. Only a Sales manager can save a customer that matches another one.</p>)}
    </div>
  );
}

export function CustomerForm({ options, customer, accountId, prefill, initialAddress, compact = false, origin, onSaved, onCancel }: {
  options: CustomerOptions;
  /** Editing this customer. */
  customer?: Customer;
  /** Creating the customer from this CRM account. */
  accountId?: string;
  prefill?: CustomerInput;
  initialAddress?: Partial<AddressValues> | null;
  /** The quick-create version: the fields a quotation needs. */
  compact?: boolean;
  origin?: string;
  onSaved: (customer: Customer) => void;
  onCancel: () => void;
}) {
  const workspace = useWorkspaceContext();
  const editing = Boolean(customer);
  const can = options.capabilities;
  const [values, setValues] = useState<Values>(() => initialValues(options, customer ?? prefill));
  const [billing, setBilling] = useState<AddressValues>({ ...EMPTY_ADDRESS, ...(initialAddress ?? {}) });
  const [shipping, setShipping] = useState<AddressValues>(EMPTY_ADDRESS);
  const [sameShipping, setSameShipping] = useState(true);
  const [contact, setContact] = useState<ContactValues>(EMPTY_CONTACT);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [serverDuplicates, setServerDuplicates] = useState<DuplicateResult | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [reason, setReason] = useState("");

  const set = <K extends keyof Values>(key: K) => (value: string) => {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: "" }));
    if (IDENTITY.includes(key)) setServerDuplicates(null);
  };

  // The duplicate check follows the typing after a short pause.
  const [probe, setProbe] = useState<Record<string, string>>({});
  useEffect(() => {
    const timer = setTimeout(() => setProbe({
      displayName: values.displayName.trim(), legalName: values.legalName.trim(), website: values.website.trim(), email: values.email.trim(), phone: values.phone.trim(),
      gstin: values.gstin.trim().toUpperCase(), city: billing.city.trim(),
    }), 500);
    return () => clearTimeout(timer);
  }, [values.displayName, values.legalName, values.website, values.email, values.phone, values.gstin, billing.city]);
  const excludeId = customer?.id ?? accountId ?? null;
  const duplicateQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "sales", "customer-duplicates", probe, excludeId),
    queryFn: () => findDuplicateCustomers({ ...probe, excludeId }),
    enabled: !editing && (probe.displayName ?? "").length >= 3,
    staleTime: 30_000,
  });
  const duplicates = serverDuplicates ?? (editing ? null : duplicateQuery.data ?? null);

  const india = values.countryCode === "IN";
  const registration = options.gstRegistrationTypes.find((entry) => entry.code === values.gstRegistrationType);
  const gstinRequired = india && Boolean(registration?.needsGstin);
  const derivedState = /^[0-9]{2}/.test(values.gstin) ? options.gstStates.find((state) => state.code === values.gstin.slice(0, 2))?.name : undefined;

  const submitKey = useSubmitKey();
  const mutation = useMutation({
    mutationFn: () => submitKey.run(async () => {
      const input = toInput(values);
      const override = acknowledged ? { allowDuplicate: true, duplicateReason: reason.trim() } : {};
      if (customer) {
        const before = toInput(initialValues(options, customer));
        const changed = Object.fromEntries(Object.entries(input).filter(([key, value]) => (value ?? "") !== ((before as Record<string, unknown>)[key] ?? "")));
        return updateCustomer(customer.id, { ...changed, ...override });
      }
      const created: CustomerInput = {
        ...input, ...override, status: values.status, origin,
        billingAddress: addressInput(billing, values.countryCode),
        shippingAddress: sameShipping ? null : addressInput(shipping, values.countryCode),
        primaryContact: contact.firstName.trim() ? { ...contact, firstName: contact.firstName.trim() } : null,
      };
      return accountId ? createCustomerFromAccount(accountId, created) : createCustomer(created);
    }),
    onSuccess: (saved) => onSaved(saved),
    onError: (failure) => {
      setErrors(fieldErrors(failure));
      const matches = duplicateMatches(failure);
      setServerDuplicates(matches);
      setError(matches ? null : errorMessage(failure));
    },
  });

  const submit = () => {
    setError(null);
    const missing: Record<string, string> = {};
    if (!values.displayName.trim()) missing.displayName = "Enter the customer name.";
    if (!values.countryCode) missing.countryCode = "Choose the country.";
    if (!values.currencyCode) missing.currencyCode = "Choose the currency.";
    if (gstinRequired && !values.gstin.trim()) missing.gstin = `Enter the GSTIN. It is required for a ${registration?.label} customer.`;
    if (Object.keys(missing).length) { setErrors(missing); return; }
    mutation.mutate();
  };
  const blocked = Boolean(duplicates?.hasBlockingMatch) && !(acknowledged && reason.trim());

  const kindOptions = options.kinds.map((entry) => ({ value: entry.code, label: entry.label }));
  const stateOptions = withNone(options.gstStates.map((state) => ({ value: state.code, label: `${state.code} – ${state.name}` })));

  return (
    <div className="flex flex-col gap-5">
      <ErrorBanner message={error} />

      <FormSection title="Identity">
        <TextField label="Customer name" isRequired value={values.displayName} onChange={set("displayName")} errorMessage={errors.displayName} autoFocus={!editing} />
        <Select label="Customer type" isRequired selectedKey={values.customerKind} onSelectionChange={(key) => set("customerKind")(String(key))} options={kindOptions} errorMessage={errors.customerKind} />
        {!compact && <TextField label="Legal name" description="The registered name, as it should print on invoices." value={values.legalName} onChange={set("legalName")} errorMessage={errors.legalName} />}
        <TextField label="Phone" value={values.phone} onChange={set("phone")} errorMessage={errors.phone} />
        <TextField label="Email" type="email" value={values.email} onChange={set("email")} errorMessage={errors.email} />
        {!compact && <TextField label="Website" value={values.website} onChange={set("website")} errorMessage={errors.website} placeholder="acme.example" />}
        <Select label="Country" isRequired selectedKey={values.countryCode} onSelectionChange={(key) => set("countryCode")(String(key))}
          options={options.countries.map((country) => ({ value: country.code, label: country.name }))} errorMessage={errors.countryCode} />
        {!editing && !compact && (
          <Select label="Status" isRequired selectedKey={values.status} onSelectionChange={(key) => set("status")(String(key))}
            options={[{ value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }]} />
        )}
        {!compact && (
          <Select label="Salesperson" selectedKey={values.ownerUserId} onSelectionChange={(key) => set("ownerUserId")(String(key))}
            options={withNone(options.salespeople.map((user) => ({ value: user.id, label: user.name })), "Unassigned")} errorMessage={errors.ownerUserId} />
        )}
      </FormSection>

      {duplicates && <DuplicatePanel result={duplicates} reason={reason} onReasonChange={setReason} acknowledged={acknowledged} onAcknowledge={setAcknowledged} />}

      <FormSection title="Commercial" description={editing ? "Changing these affects new documents only. Documents already issued keep their terms." : "The defaults a new quotation or order starts with."}>
        <Select label="Currency" isRequired selectedKey={values.currencyCode} onSelectionChange={(key) => set("currencyCode")(String(key))}
          options={options.currencies.map((currency) => ({ value: currency.code, label: `${currency.code} – ${currency.name}` }))}
          isDisabled={editing && !can.changeCurrency} errorMessage={errors.currencyCode} />
        {!compact && (
          <>
            <Select label="Payment terms" selectedKey={values.paymentTermId} onSelectionChange={(key) => set("paymentTermId")(String(key))}
              options={withNone(options.paymentTerms.map((term) => ({ value: term.id, label: term.name })))} isDisabled={editing && !can.changePaymentTerms} errorMessage={errors.paymentTermId} />
            <Select label="Price list" selectedKey={values.priceListId} onSelectionChange={(key) => set("priceListId")(String(key))}
              options={withNone(options.priceLists.map((list) => ({ value: list.id, label: list.name })), "Standard prices")} isDisabled={editing && !can.changePriceList} errorMessage={errors.priceListId} />
          </>
        )}
      </FormSection>

      <FormSection title="Tax" description={india ? undefined : "GST details apply to customers in India."}>
        <Select label="GST registration type" selectedKey={values.gstRegistrationType} onSelectionChange={(key) => set("gstRegistrationType")(String(key))}
          options={withNone(options.gstRegistrationTypes.map((entry) => ({ value: entry.code, label: entry.label })))} isDisabled={editing && !can.editGstin} errorMessage={errors.gstRegistrationType} />
        {india && (
          <>
            <TextField label="GSTIN" isRequired={gstinRequired} value={values.gstin} onChange={(value) => set("gstin")(value.toUpperCase())} placeholder="27ABCDE1234F1Z5"
              description={derivedState ? `State: ${derivedState}` : undefined} isDisabled={editing && !can.editGstin} errorMessage={errors.gstin} />
            {!compact && (
              <Select label="Place of supply" description="Left empty, it follows the GSTIN or the billing address." selectedKey={values.placeOfSupply}
                onSelectionChange={(key) => set("placeOfSupply")(String(key))} options={stateOptions} isDisabled={editing && !can.editGstin} errorMessage={errors.placeOfSupply} />
            )}
          </>
        )}
      </FormSection>

      {!editing && (
        <>
          <FormSection title="Billing address" description={accountId ? "Add one only if the account has no address yet." : "Optional now; a quotation needs one."}>
            <AddressFields value={billing} onChange={setBilling} errors={errors} />
            {!compact && <div className="sm:col-span-2"><Checkbox isSelected={sameShipping} onChange={setSameShipping}>Deliver to the billing address</Checkbox></div>}
          </FormSection>
          {!sameShipping && !compact && <FormSection title="Shipping address"><AddressFields value={shipping} onChange={setShipping} errors={{}} /></FormSection>}
          <FormSection title="Primary contact" description="Optional. The person quotations and invoices are addressed to.">
            <TextField label="First name" value={contact.firstName} onChange={(value) => setContact({ ...contact, firstName: value })} errorMessage={errors.firstName} />
            <TextField label="Last name" value={contact.lastName} onChange={(value) => setContact({ ...contact, lastName: value })} />
            <TextField label="Email" type="email" value={contact.email} onChange={(value) => setContact({ ...contact, email: value })} />
            <TextField label="Phone" value={contact.phone} onChange={(value) => setContact({ ...contact, phone: value })} />
          </FormSection>
        </>
      )}

      {!compact && (
        <section aria-label="Notes" className="flex flex-col gap-3 border-t border-border pt-5">
          <TextArea label="Notes" description="Internal. Not printed on documents." rows={3} value={values.notes} onChange={set("notes")} />
        </section>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="secondary" onPress={onCancel}>Cancel</Button>
        <Button variant="primary" onPress={submit} isLoading={mutation.isPending || mutation.isSuccess} isDisabled={blocked}>{editing ? "Save changes" : "Create customer"}</Button>
      </div>
    </div>
  );
}
