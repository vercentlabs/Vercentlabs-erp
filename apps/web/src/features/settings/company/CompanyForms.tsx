"use client";

// The pieces of the company profile (Shared Platform plan 3), shared by Settings › Company and the setup wizard: legal details and
// address, the logo and signature, the bank accounts and UPI ID, the financial year and time zone.
import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button, Checkbox, Select, TextField } from "@vercentlabs/design-system";

import { MONTH_OPTIONS, STATE_OPTIONS, timeZoneOptions } from "@/shared/locale-options";
import { Notice, Panel } from "@/shared/ui/Panel";

import {
  CompanyApiError, removeBankAccount, removeCompanyImage, saveBankAccount, saveCompany, uploadCompanyImage,
  type BankAccount, type CompanyProfile,
} from "./company-api";

const errorText = (error: unknown) => (error instanceof Error ? error.message : "That did not work.");
const fieldOf = (error: unknown) => (error instanceof CompanyApiError ? error.field : undefined);

export function LegalDetailsForm({ profile, canManage, onSaved }: { profile: CompanyProfile; canManage: boolean; onSaved: (profile: CompanyProfile) => void }) {
  const [form, setForm] = useState({
    name: profile.name ?? "", legalName: profile.legalName ?? "", pan: profile.pan ?? "", gstin: profile.gstin ?? "", cin: profile.cin ?? "", udyamNumber: profile.udyamNumber ?? "",
    line1: profile.address.line1 ?? "", line2: profile.address.line2 ?? "", city: profile.address.city ?? "", stateCode: profile.address.stateCode ?? "", postalCode: profile.address.postalCode ?? "",
    phone: profile.phone ?? "", email: profile.email ?? "", website: profile.website ?? "",
  });
  const set = (key: keyof typeof form) => (value: string) => setForm((current) => ({ ...current, [key]: value }));
  // A GSTIN carries the state and the PAN: fill them when they are empty.
  const onGstin = (value: string) => {
    const gstin = value.toUpperCase().replace(/\s/g, "");
    setForm((current) => ({
      ...current, gstin,
      ...(gstin.length >= 2 && !current.stateCode && STATE_OPTIONS.some((state) => state.value === gstin.slice(0, 2)) ? { stateCode: gstin.slice(0, 2) } : {}),
      ...(gstin.length >= 12 && !current.pan ? { pan: gstin.slice(2, 12) } : {}),
    }));
  };
  const save = useMutation({
    mutationFn: () => saveCompany({
      name: form.name, legalName: form.legalName, pan: form.pan, gstin: form.gstin || undefined, cin: form.cin, udyamNumber: form.udyamNumber,
      address: { line1: form.line1, line2: form.line2, city: form.city, stateCode: form.stateCode || null, postalCode: form.postalCode },
      phone: form.phone, email: form.email, website: form.website,
    }),
    onSuccess: (result) => onSaved(result.profile),
  });
  const error = save.error;
  const invalid = (field: string) => (fieldOf(error) === field ? errorText(error) : undefined);
  return (
    <Panel title="Legal details and address" description="Printed on every invoice, quotation and order. The GSTIN of the address's state; other states' GSTINs go in Settings › Taxes.">
      {error && !fieldOf(error) && <Notice>{errorText(error)}</Notice>}
      {save.isSuccess && <Notice tone="success">Saved.</Notice>}
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label="Company name" description="The name people know you by." isRequired value={form.name} onChange={set("name")} isReadOnly={!canManage} errorMessage={invalid("name")} isInvalid={Boolean(invalid("name"))} />
        <TextField label="Legal name" description="As registered (on PAN and GST)." value={form.legalName} onChange={set("legalName")} isReadOnly={!canManage} />
        <TextField label="GSTIN" value={form.gstin} onChange={onGstin} maxLength={15} isReadOnly={!canManage} errorMessage={invalid("gstin")} isInvalid={Boolean(invalid("gstin"))} />
        <TextField label="PAN" value={form.pan} onChange={(value) => set("pan")(value.toUpperCase())} maxLength={10} isReadOnly={!canManage} errorMessage={invalid("pan")} isInvalid={Boolean(invalid("pan"))} />
        <TextField label="CIN" description="Companies registered with the MCA." value={form.cin} onChange={(value) => set("cin")(value.toUpperCase())} maxLength={21} isReadOnly={!canManage} errorMessage={invalid("cin")} isInvalid={Boolean(invalid("cin"))} />
        <TextField label="Udyam (MSME) number" value={form.udyamNumber} onChange={(value) => set("udyamNumber")(value.toUpperCase())} maxLength={19} isReadOnly={!canManage} errorMessage={invalid("udyamNumber")} isInvalid={Boolean(invalid("udyamNumber"))} />
        <TextField label="Address" value={form.line1} onChange={set("line1")} isReadOnly={!canManage} />
        <TextField label="Address line 2" value={form.line2} onChange={set("line2")} isReadOnly={!canManage} />
        <TextField label="City" value={form.city} onChange={set("city")} isReadOnly={!canManage} />
        <Select label="State" selectedKey={form.stateCode || null} onSelectionChange={(key) => set("stateCode")(String(key))} options={STATE_OPTIONS} isDisabled={!canManage}
          errorMessage={invalid("address.stateCode")} />
        <TextField label="PIN code" value={form.postalCode} onChange={set("postalCode")} maxLength={6} inputMode="numeric" isReadOnly={!canManage} errorMessage={invalid("address.postalCode")} isInvalid={Boolean(invalid("address.postalCode"))} />
        <TextField label="Phone" value={form.phone} onChange={set("phone")} isReadOnly={!canManage} errorMessage={invalid("phone")} isInvalid={Boolean(invalid("phone"))} />
        <TextField label="Email" type="email" value={form.email} onChange={set("email")} isReadOnly={!canManage} errorMessage={invalid("email")} isInvalid={Boolean(invalid("email"))} />
        <TextField label="Website" value={form.website} onChange={set("website")} isReadOnly={!canManage} errorMessage={invalid("website")} isInvalid={Boolean(invalid("website"))} />
      </div>
      {canManage && <div className="flex justify-end"><Button variant="primary" isLoading={save.isPending} onPress={() => save.mutate()}>Save</Button></div>}
    </Panel>
  );
}

export function FinancialYearForm({ profile, canManage, onSaved }: { profile: CompanyProfile; canManage: boolean; onSaved: (profile: CompanyProfile) => void }) {
  const [month, setMonth] = useState(String(profile.fiscalYearStartMonth ?? 4));
  const [zone, setZone] = useState(profile.timezone ?? "Asia/Kolkata");
  const [zones] = useState(timeZoneOptions);
  const save = useMutation({ mutationFn: () => saveCompany({ fiscalYearStartMonth: Number(month), timezone: zone }), onSuccess: (result) => onSaved(result.profile) });
  return (
    <Panel title="Financial year and time zone" description="Invoice numbers restart each financial year, and dates and daily jobs follow the company's time zone.">
      {save.error && <Notice>{errorText(save.error)}</Notice>}
      {save.isSuccess && <Notice tone="success">Saved.</Notice>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Select label="Financial year starts in" selectedKey={month} onSelectionChange={(key) => setMonth(String(key))} options={MONTH_OPTIONS} isDisabled={!canManage}
          description="April in India (April to March)." />
        <Select label="Time zone" selectedKey={zone} onSelectionChange={(key) => setZone(String(key))} options={zones} isDisabled={!canManage} />
      </div>
      {canManage && <div className="flex justify-end"><Button variant="primary" isLoading={save.isPending} onPress={() => save.mutate()}>Save</Button></div>}
    </Panel>
  );
}

function ImageSlot({ kind, label, present, canManage, onChanged }: { kind: "logo" | "signature"; label: string; present: boolean; canManage: boolean; onChanged: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [version, setVersion] = useState(0);
  const upload = useMutation({ mutationFn: (file: File) => uploadCompanyImage(kind, file), onSuccess: () => { setVersion((value) => value + 1); onChanged(); } });
  const remove = useMutation({ mutationFn: () => removeCompanyImage(kind), onSuccess: () => { setVersion((value) => value + 1); onChanged(); } });
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium">{label}</span>
      <div className="flex h-24 w-48 items-center justify-center rounded-[var(--radius-control)] border border-dashed border-border bg-surface-muted">
        {/* eslint-disable-next-line @next/next/no-img-element -- a private, session-authorised image; next/image cannot fetch it */}
        {present ? <img src={`/api/settings/company/images/${kind}?v=${version}`} alt={label} className="max-h-20 max-w-44 object-contain" /> : <span className="text-xs text-text-muted">None</span>}
      </div>
      {(upload.error || remove.error) && <Notice>{errorText(upload.error ?? remove.error)}</Notice>}
      {canManage && (
        <div className="flex gap-2">
          <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) upload.mutate(file); event.target.value = ""; }} />
          <Button variant="secondary" size="compact" isLoading={upload.isPending} onPress={() => input.current?.click()}>{present ? "Replace" : "Upload"}</Button>
          {present && <Button variant="ghost" size="compact" isLoading={remove.isPending} onPress={() => remove.mutate()}>Remove</Button>}
        </div>
      )}
    </div>
  );
}

export function CompanyImages({ profile, canManage, onChanged }: { profile: CompanyProfile; canManage: boolean; onChanged: () => void }) {
  return (
    <Panel title="Logo and signature" description="The logo heads your documents; the signature fills the authorised signatory block. PNG, JPEG or WebP, up to 1 MB.">
      <div className="flex flex-wrap gap-6">
        <ImageSlot kind="logo" label="Logo" present={profile.hasLogo} canManage={canManage} onChanged={onChanged} />
        <ImageSlot kind="signature" label="Authorised signatory's signature" present={profile.hasSignature} canManage={canManage} onChanged={onChanged} />
      </div>
    </Panel>
  );
}

const EMPTY_ACCOUNT = { accountName: "", bankName: "", accountNumber: "", ifsc: "", branch: "", isDefault: false, showOnDocuments: true };

export function BankAccountsForm({ profile, canManage, onChanged }: { profile: CompanyProfile; canManage: boolean; onChanged: (profile?: CompanyProfile) => void }) {
  const [accounts, setAccounts] = useState<BankAccount[]>(profile.bankAccounts);
  const [draft, setDraft] = useState(EMPTY_ACCOUNT);
  const [upi, setUpi] = useState(profile.upiId ?? "");
  const set = (key: keyof typeof EMPTY_ACCOUNT) => (value: string | boolean) => setDraft((current) => ({ ...current, [key]: value }));
  const add = useMutation({ mutationFn: () => saveBankAccount(draft), onSuccess: (result) => { setAccounts(result.bankAccounts); setDraft(EMPTY_ACCOUNT); onChanged(); } });
  const remove = useMutation({ mutationFn: (id: string) => removeBankAccount(id), onSuccess: (result) => { setAccounts(result.bankAccounts); onChanged(); } });
  const saveUpi = useMutation({ mutationFn: () => saveCompany({ upiId: upi }), onSuccess: (result) => onChanged(result.profile) });
  const invalid = (field: string) => (fieldOf(add.error) === field ? errorText(add.error) : undefined);
  return (
    <Panel title="Bank details and UPI" description="Printed on invoices so customers can pay: the default account, and a UPI QR code from the UPI ID.">
      {accounts.length > 0 && (
        <ul className="flex flex-col divide-y divide-border rounded-[var(--radius-control)] border border-border text-sm">
          {accounts.map((account) => (
            <li key={account.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
              <span>
                <span className="font-medium">{account.bankName}</span>{` · ${account.accountName} · A/c ${account.accountNumber} · IFSC ${account.ifsc}`}
                {account.isDefault && <span className="ml-2 text-xs text-brand">Default</span>}
              </span>
              {canManage && <Button variant="ghost" size="compact" isDisabled={remove.isPending} onPress={() => remove.mutate(account.id)}>Remove</Button>}
            </li>
          ))}
        </ul>
      )}
      {canManage && (
        <div className="flex flex-col gap-3 rounded-[var(--radius-control)] border border-border p-3">
          {add.error && !fieldOf(add.error) && <Notice>{errorText(add.error)}</Notice>}
          <div className="grid gap-3 sm:grid-cols-3">
            <TextField label="Account holder" value={draft.accountName} onChange={set("accountName")} errorMessage={invalid("accountName")} isInvalid={Boolean(invalid("accountName"))} />
            <TextField label="Bank" value={draft.bankName} onChange={set("bankName")} errorMessage={invalid("bankName")} isInvalid={Boolean(invalid("bankName"))} />
            <TextField label="Branch" value={draft.branch} onChange={set("branch")} />
            <TextField label="Account number" value={draft.accountNumber} onChange={set("accountNumber")} inputMode="numeric" errorMessage={invalid("accountNumber")} isInvalid={Boolean(invalid("accountNumber"))} />
            <TextField label="IFSC" value={draft.ifsc} onChange={(value) => set("ifsc")(value.toUpperCase())} maxLength={11} errorMessage={invalid("ifsc")} isInvalid={Boolean(invalid("ifsc"))} />
            <div className="flex items-end"><Checkbox isSelected={draft.isDefault} onChange={set("isDefault")}>Default account</Checkbox></div>
          </div>
          <div className="flex justify-end"><Button variant="secondary" isLoading={add.isPending} onPress={() => add.mutate()}>Add bank account</Button></div>
        </div>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-64"><TextField label="UPI ID" description="Like yourcompany@okhdfcbank." value={upi} onChange={setUpi} isReadOnly={!canManage}
          errorMessage={fieldOf(saveUpi.error) === "upiId" ? errorText(saveUpi.error) : undefined} isInvalid={fieldOf(saveUpi.error) === "upiId"} /></div>
        {canManage && <Button variant="secondary" isLoading={saveUpi.isPending} onPress={() => saveUpi.mutate()}>Save UPI ID</Button>}
      </div>
    </Panel>
  );
}
