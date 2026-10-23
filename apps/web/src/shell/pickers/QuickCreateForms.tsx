"use client";

// The quick-create forms a picker opens in its side drawer (Create-Where-You-Are plan): only the fields the record needs to exist,
// prefilled from what was typed. Each one saves through the module's own API, so its validation and duplicate checks apply; a
// duplicate refusal lists the existing records with Use this. The rest of a record is completed later on its own page.
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Select, TextField } from "@vercentlabs/design-system";

import { createAccount, duplicateMatchesOf as accountDuplicates } from "@/features/crm/accounts/api/accounts-api";
import { createContact, duplicateMatchesOf as contactDuplicates } from "@/features/crm/contacts/api/contacts-api";
import { createLead } from "@/features/crm/leads/api/leads-api";
import { CustomerForm } from "@/features/sales/customers/components/CustomerForm";
import { addCustomerContact, getCustomerOptions } from "@/features/sales/customers/api/customers-api";
import { createSupplier, duplicateMatchesOf as supplierDuplicates, getSupplierOptions } from "@/features/procurement/suppliers/api/suppliers-api";
import { createItem, getItemOptions } from "@/features/items/api/items-api";
import { GstinLookup } from "@/shared/ui/GstinLookup";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { QuickCreateLayout, failure, readTyped, splitName } from "./QuickCreateParts";
import type { PickedRecord, QuickCreateProps } from "./types";

// ------------------------------------------------------------------ CRM contact: name, mobile, email (linked to the form's company)
export function ContactQuickCreate({ initialText, prefill, onCreated, onCancel }: QuickCreateProps) {
  const typed = readTyped(initialText);
  const name = splitName(typed.name);
  const [firstName, setFirstName] = useState(name.first);
  const [lastName, setLastName] = useState(name.last);
  const [mobile, setMobile] = useState(typed.phone);
  const [email, setEmail] = useState(typed.email);
  const [duplicates, setDuplicates] = useState<PickedRecord[] | null>(null);
  const accountId = typeof prefill?.accountId === "string" ? prefill.accountId : null;
  const save = useMutation({
    mutationFn: () => createContact({ firstName: firstName.trim(), lastName: lastName.trim() || null, mobile: mobile.trim() || null, email: email.trim() || null,
      ...(accountId ? { accountId } : {}) }),
    onSuccess: (contact) => onCreated({ id: contact.id, label: contact.displayName, description: [contact.mobile, contact.email].filter(Boolean).join(" · "), raw: contact as unknown as Record<string, unknown> }),
    onError: (error) => {
      const matches = contactDuplicates(error);
      if (matches) setDuplicates(matches.map((match) => ({ id: match.id, label: match.name ?? match.code ?? "Contact", description: [match.accountName, match.mobile, match.email].filter(Boolean).join(" · ") })));
    },
  });
  return (
    <QuickCreateLayout error={save.isError && !duplicates ? failure(save.error) : null} duplicates={duplicates} onUse={onCreated} onCancel={onCancel}
      onSubmit={() => { setDuplicates(null); save.mutate(); }} submitLabel="Create contact" isPending={save.isPending}
      isDisabled={!firstName.trim() || (!mobile.trim() && !email.trim())}>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label="First name" isRequired autoFocus value={firstName} onChange={setFirstName} />
        <TextField label="Last name" value={lastName} onChange={setLastName} />
      </div>
      <TextField label="Mobile" type="tel" inputMode="tel" value={mobile} onChange={setMobile} description="A mobile or an email, so they can be reached." />
      <TextField label="Email" type="email" value={email} onChange={setEmail} />
      {accountId && <p className="text-xs text-text-secondary">{`Linked to ${String(prefill?.accountName ?? "the company")}.`}</p>}
    </QuickCreateLayout>
  );
}

// ------------------------------------------------------------------ CRM company: name, phone, email
export function CompanyQuickCreate({ initialText, onCreated, onCancel }: QuickCreateProps) {
  const typed = readTyped(initialText);
  const [displayName, setDisplayName] = useState(typed.name);
  const [phone, setPhone] = useState(typed.phone);
  const [email, setEmail] = useState(typed.email);
  const [duplicates, setDuplicates] = useState<PickedRecord[] | null>(null);
  const save = useMutation({
    mutationFn: () => createAccount({ displayName: displayName.trim(), phone: phone.trim() || null, email: email.trim() || null }),
    onSuccess: (account) => onCreated({ id: account.id, label: account.displayName, description: account.code, raw: account as unknown as Record<string, unknown> }),
    onError: (error) => {
      const matches = accountDuplicates(error);
      if (matches) setDuplicates(matches.map((match) => ({ id: match.id, label: match.name ?? match.code ?? "Company", description: [match.code, match.city].filter(Boolean).join(" · ") })));
    },
  });
  return (
    <QuickCreateLayout error={save.isError && !duplicates ? failure(save.error) : null} duplicates={duplicates} onUse={onCreated} onCancel={onCancel}
      onSubmit={() => { setDuplicates(null); save.mutate(); }} submitLabel="Create company" isPending={save.isPending} isDisabled={!displayName.trim()}>
      <TextField label="Company name" isRequired autoFocus value={displayName} onChange={setDisplayName} placeholder="For example: Acme Pvt Ltd" />
      <TextField label="Phone" type="tel" inputMode="tel" value={phone} onChange={setPhone} />
      <TextField label="Email" type="email" value={email} onChange={setEmail} />
    </QuickCreateLayout>
  );
}

// ------------------------------------------------------------------ CRM lead: a person or a company, and a way to reach them
export function LeadQuickCreate({ initialText, onCreated, onCancel }: QuickCreateProps) {
  const typed = readTyped(initialText);
  const name = splitName(typed.name);
  const [firstName, setFirstName] = useState(name.first);
  const [lastName, setLastName] = useState(name.last);
  const [companyName, setCompanyName] = useState("");
  const [mobile, setMobile] = useState(typed.phone);
  const [email, setEmail] = useState(typed.email);
  const save = useMutation({
    mutationFn: () => createLead({ firstName: firstName.trim() || null, lastName: lastName.trim() || null, companyName: companyName.trim() || null,
      mobile: mobile.trim() || null, email: email.trim() || null }),
    onSuccess: (lead) => onCreated({ id: lead.id, label: [lead.firstName, lead.lastName].filter(Boolean).join(" ") || lead.companyName || lead.code, description: lead.code }),
  });
  return (
    <QuickCreateLayout error={save.isError ? failure(save.error) : null} onCancel={onCancel} onSubmit={() => save.mutate()} submitLabel="Create lead"
      isPending={save.isPending} isDisabled={!firstName.trim() && !companyName.trim()}>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label="First name" autoFocus value={firstName} onChange={setFirstName} />
        <TextField label="Last name" value={lastName} onChange={setLastName} />
      </div>
      <TextField label="Company" value={companyName} onChange={setCompanyName} description="A name or a company is enough to start." />
      <TextField label="Mobile" type="tel" inputMode="tel" value={mobile} onChange={setMobile} />
      <TextField label="Email" type="email" value={email} onChange={setEmail} />
    </QuickCreateLayout>
  );
}

// ------------------------------------------------------------------ Sales customer: the compact customer form (business or person, GSTIN optional)
export function CustomerQuickCreate({ initialText, prefill, onCreated, onCancel }: QuickCreateProps) {
  const workspace = useWorkspaceContext();
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "sales", "customer-options"), queryFn: getCustomerOptions, staleTime: 60_000 });
  const typed = readTyped(initialText);
  if (options.isLoading) return <LoadingState label="Loading" rows={3} />;
  if (options.isError || !options.data) return <p role="alert" className="text-sm text-danger">{failure(options.error, "The form could not be loaded.")}</p>;
  return (
    <CustomerForm options={options.data} compact origin="quick-create"
      prefill={{ displayName: typed.name || undefined, phone: typed.phone || null, email: typed.email || null,
        ...(typeof prefill?.customerKind === "string" ? { customerKind: prefill.customerKind } : {}) }}
      onSaved={(customer) => onCreated({ id: customer.id, label: customer.displayName, description: customer.customerNumber, raw: customer as unknown as Record<string, unknown> })}
      onCancel={onCancel} />
  );
}

// ------------------------------------------------------------------ Sales customer's contact: name, phone, email (Sales without CRM too)
export function CustomerContactQuickCreate({ initialText, prefill, onCreated, onCancel }: QuickCreateProps) {
  const typed = readTyped(initialText);
  const name = splitName(typed.name);
  const [firstName, setFirstName] = useState(name.first);
  const [lastName, setLastName] = useState(name.last);
  const [phone, setPhone] = useState(typed.phone);
  const [email, setEmail] = useState(typed.email);
  const partyId = typeof prefill?.partyId === "string" ? prefill.partyId : "";
  const save = useMutation({
    mutationFn: () => addCustomerContact(partyId, { firstName: firstName.trim(), lastName: lastName.trim() || undefined, phone: phone.trim() || undefined, email: email.trim() || undefined }),
    onSuccess: ({ contact }) => onCreated({ id: contact.id, label: contact.name, description: [phone.trim(), email.trim()].filter(Boolean).join(" · "), raw: contact as unknown as Record<string, unknown> }),
  });
  return (
    <QuickCreateLayout error={save.isError ? failure(save.error) : !partyId ? "Choose the customer first." : null} onCancel={onCancel} onSubmit={() => save.mutate()}
      submitLabel="Add contact" isPending={save.isPending} isDisabled={!partyId || !firstName.trim()}>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label="First name" isRequired autoFocus value={firstName} onChange={setFirstName} />
        <TextField label="Last name" value={lastName} onChange={setLastName} />
      </div>
      <TextField label="Phone" type="tel" inputMode="tel" value={phone} onChange={setPhone} />
      <TextField label="Email" type="email" value={email} onChange={setEmail} />
      {typeof prefill?.partyName === "string" && <p className="text-xs text-text-secondary">{`Added to ${prefill.partyName}.`}</p>}
    </QuickCreateLayout>
  );
}

// ------------------------------------------------------------------ Procurement supplier: name, GSTIN (looked up on the portal), mobile, email
export function SupplierQuickCreate({ initialText, onCreated, onCancel }: QuickCreateProps) {
  const typed = readTyped(initialText);
  const looksLikeGstin = /^[0-9]{2}[A-Z0-9]{13}$/i.test(initialText.trim());
  const [supplierName, setSupplierName] = useState(looksLikeGstin ? "" : typed.name);
  const [gstin, setGstin] = useState(looksLikeGstin ? initialText.trim().toUpperCase() : "");
  const [primaryPhone, setPrimaryPhone] = useState(typed.phone);
  const [primaryEmail, setPrimaryEmail] = useState(typed.email);
  // A supplier needs a category; "Other" unless chosen.
  const [category, setCategory] = useState("other");
  const workspace = useWorkspaceContext();
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "supplier-options"), queryFn: getSupplierOptions, staleTime: 5 * 60_000 });
  const [duplicates, setDuplicates] = useState<PickedRecord[] | null>(null);
  const save = useMutation({
    mutationFn: () => createSupplier({ supplierName: supplierName.trim(), gstin: gstin.trim().toUpperCase() || null, primaryPhone: primaryPhone.trim() || null,
      primaryEmail: primaryEmail.trim() || null, category }),
    onSuccess: ({ supplier }) => onCreated({ id: supplier.id, label: supplier.supplierName, description: [supplier.supplierNumber, supplier.gstin].filter(Boolean).join(" · "),
      raw: supplier as unknown as Record<string, unknown> }),
    onError: (error) => {
      const matches = supplierDuplicates(error);
      if (matches) setDuplicates(matches.filter((match) => match.supplierId).map((match) => ({ id: match.supplierId!, label: match.name,
        description: [match.number, match.gstin, match.city].filter(Boolean).join(" · ") })));
    },
  });
  return (
    <QuickCreateLayout error={save.isError && !duplicates?.length ? failure(save.error) : null} duplicates={duplicates} onUse={onCreated} onCancel={onCancel}
      onSubmit={() => { setDuplicates(null); save.mutate(); }} submitLabel="Create supplier" isPending={save.isPending} isDisabled={!supplierName.trim()}>
      <TextField label="Supplier name" isRequired autoFocus value={supplierName} onChange={setSupplierName} />
      <div className="flex flex-col gap-1.5">
        <TextField label="GSTIN" value={gstin} onChange={(value) => setGstin(value.toUpperCase())} description="Optional. Its name and address can be read from the GST portal." />
        <GstinLookup gstin={gstin} onFound={(found) => { if (!supplierName.trim() && (found.displayName || found.legalName)) setSupplierName(found.displayName ?? found.legalName ?? ""); }} />
      </div>
      <TextField label="Mobile" type="tel" inputMode="tel" value={primaryPhone} onChange={setPrimaryPhone} />
      <TextField label="Email" type="email" value={primaryEmail} onChange={setPrimaryEmail} />
      <Select label="Category" selectedKey={category} onSelectionChange={(key) => setCategory(String(key ?? "other"))}
        options={(options.data?.categories ?? [{ code: "other", label: "Other" }]).map((entry) => ({ value: entry.code, label: entry.label }))} />
      <p className="text-xs text-text-secondary">The company&apos;s default payment terms apply; the rest can be completed on the supplier later.</p>
    </QuickCreateLayout>
  );
}

// ------------------------------------------------------------------ Item: name, product or service, unit, HSN/SAC and GST
export function ItemQuickCreate({ initialText, prefill, onCreated, onCancel }: QuickCreateProps) {
  const workspace = useWorkspaceContext();
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "products", "options"), queryFn: getItemOptions, staleTime: 60_000 });
  const [name, setName] = useState(initialText.trim());
  const [type, setType] = useState<string>(typeof prefill?.type === "string" ? prefill.type : "");
  const [uomId, setUomId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [hsnSacCode, setHsnSacCode] = useState("");
  const [taxCategoryId, setTaxCategoryId] = useState("");
  const data = options.data;
  const types = data?.types ?? [];
  const chosenType = type || (types.find((entry) => entry.code === "service")?.code ?? types[0]?.code ?? "");
  const goods = types.find((entry) => entry.code === chosenType)?.goods ?? false;
  const uoms = data?.uoms ?? [];
  const chosenUom = uomId || (uoms.find((uom) => ["NOS", "EA", "PCS"].includes(uom.code))?.id ?? uoms[0]?.id ?? "");
  const categories = (data?.categories ?? []).filter((category) => !category.effectiveItemTypes?.length || category.effectiveItemTypes.includes(chosenType as never));
  const taxes = (data?.taxCategories ?? []).filter((tax) => tax.appliesTo !== "purchase");
  const save = useMutation({
    mutationFn: () => createItem({ name: name.trim(), type: chosenType as never, baseUomId: chosenUom, categoryId: categoryId || null, hsnSacCode: hsnSacCode.trim() || null,
      taxCategoryId: taxCategoryId || null, isSellable: prefill?.isSellable !== false, isPurchasable: prefill?.isPurchasable !== false }),
    onSuccess: (item) => onCreated({ id: item.id, label: item.name, description: item.code, raw: item as unknown as Record<string, unknown> }),
  });
  if (options.isLoading) return <LoadingState label="Loading" rows={3} />;
  if (options.isError || !data) return <p role="alert" className="text-sm text-danger">{failure(options.error, "The form could not be loaded.")}</p>;
  return (
    <QuickCreateLayout error={save.isError ? failure(save.error) : null} onCancel={onCancel} onSubmit={() => save.mutate()} submitLabel="Create item"
      isPending={save.isPending} isDisabled={!name.trim() || !chosenUom || !chosenType}>
      <TextField label="Name" isRequired autoFocus value={name} onChange={setName} placeholder="For example: Weekend batch – Python" />
      <div className="grid gap-3 sm:grid-cols-2">
        <Select label="Kind" isRequired selectedKey={chosenType} onSelectionChange={(key) => setType(String(key))} options={types.map((entry) => ({ value: entry.code, label: entry.label }))} />
        <Select label="Unit" isRequired selectedKey={chosenUom} onSelectionChange={(key) => setUomId(String(key))} options={uoms.map((uom) => ({ value: uom.id, label: `${uom.name} (${uom.code})` }))} />
      </div>
      {categories.length > 0 && (
        <Select label="Category" selectedKey={categoryId || "none"} description={goods ? "Stock items usually need one." : undefined}
          onSelectionChange={(key) => {
            const id = String(key) === "none" ? "" : String(key);
            setCategoryId(id);
            const category = categories.find((entry) => entry.id === id);
            if (category?.defaultHsnSacCode && !hsnSacCode) setHsnSacCode(category.defaultHsnSacCode);
            if (category?.defaultTaxCategoryId && !taxCategoryId) setTaxCategoryId(category.defaultTaxCategoryId);
          }}
          options={[{ value: "none", label: "No category" }, ...categories.map((category) => ({ value: category.id, label: category.label ?? category.name }))]} />
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label={goods ? "HSN code" : "SAC code"} value={hsnSacCode} onChange={setHsnSacCode} inputMode="numeric" />
        <Select label="GST" selectedKey={taxCategoryId || "none"} onSelectionChange={(key) => setTaxCategoryId(String(key) === "none" ? "" : String(key))}
          options={[{ value: "none", label: "Not set" }, ...taxes.map((tax) => ({ value: tax.id, label: tax.name }))]} />
      </div>
      <p className="text-xs text-text-secondary">Prices, barcodes and stock settings can be added on the item later.</p>
    </QuickCreateLayout>
  );
}
