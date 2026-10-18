"use client";

// A company's tax identity and terms: GSTIN (read as you type — its kind, state and PAN), PAN, GST treatment and payment terms. Any
// company can hold them, a prospect included. Once a company is a customer and the organization has Sales, they are kept in Sales'
// Customer Master; without Sales, CRM keeps them.
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button, Dialog, Select, TextField } from "@vercentlabs/design-system";
import { parseGstin } from "@vercentlabs/shared-types";

import { GST_STATES_BY_CODE } from "@/features/crm/shared/gst-states";
import { Notice } from "@/shared/ui/Panel";
import { PropertyList } from "@/shared/ui/PropertyList";

import { errorMessage, updateAccountTaxIdentity, type Account, type AccountOptions } from "../api/accounts-api";

const NONE = "";
const stateName = (code: string | null) => (code ? `${GST_STATES_BY_CODE.get(code) ?? "State"} (${code})` : null);

export function AccountTaxIdentityPanel({ account, options, salesHref, onChanged }: {
  account: Account; options: AccountOptions; salesHref: string | null; onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const parsed = account.gstin ? parseGstin(account.gstin) : null;
  const mismatch = account.gstStateCode && account.billingStateCode && account.gstStateCode !== account.billingStateCode;
  const editable = account.taxIdentity?.editable ?? false;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Tax identity and terms</h3>
        {editable ? <Button size="compact" variant="ghost" onPress={() => setEditing(true)}>Edit</Button>
          : account.taxIdentity?.reason === "sales" ? (salesHref ? <a className="text-sm text-brand hover:underline" href={salesHref}>Change in Sales</a> : <span className="text-xs text-text-muted">Kept in Sales</span>) : null}
      </div>
      {mismatch && (
        <Notice tone="warning">The GSTIN is registered in {stateName(account.gstStateCode)}, but the billing address is in {stateName(account.billingStateCode)}. Check that this is the right registration.</Notice>
      )}
      {warnings.map((warning) => <Notice key={warning} tone="warning">{warning}</Notice>)}
      <PropertyList columns={3} items={[
        { label: "GSTIN", value: account.gstin ? `${account.gstin}${parsed?.typeLabel && parsed.type !== "regular" ? ` · ${parsed.typeLabel}` : ""}` : null },
        { label: "GST state", value: stateName(account.gstStateCode) },
        { label: "PAN", value: account.pan },
        { label: "GST treatment", value: account.gstTreatmentLabel },
        { label: "Payment terms", value: account.paymentTermName },
      ]} />
      {editing && <TaxIdentityDialog account={account} options={options} onClose={() => setEditing(false)}
        onSaved={(next) => { setWarnings(next); setEditing(false); onChanged(); }} />}
    </div>
  );
}

function TaxIdentityDialog({ account, options, onClose, onSaved }: { account: Account; options: AccountOptions; onClose: () => void; onSaved: (warnings: string[]) => void }) {
  const [gstin, setGstin] = useState(account.gstin ?? "");
  const [pan, setPan] = useState(account.pan ?? "");
  const [treatment, setTreatment] = useState(account.gstTreatment ?? NONE);
  const [paymentTermId, setPaymentTermId] = useState(account.paymentTermId ?? NONE);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const reading = parseGstin(gstin);
  const save = useMutation({
    mutationFn: () => updateAccountTaxIdentity(account.id, {
      gstin: gstin.trim() || null, pan: pan.trim() || null, gstTreatment: treatment || null, paymentTermId: paymentTermId || null, expectedUpdatedAt: account.updatedAt,
    }),
    onSuccess: (result) => onSaved(result.warnings.map((warning) => warning.message)),
    onError: (failure) => {
      const issues = (failure as { details?: { issues?: Array<{ field: string; message: string }> } }).details?.issues ?? [];
      setFieldErrors(Object.fromEntries(issues.map((issue) => [issue.field, issue.message])));
    },
  });
  const gstinHelp = !gstin.trim() ? "15 characters, such as 27ABCDE1234F1Z0."
    : reading.valid ? `${reading.typeLabel} · ${stateName(reading.stateCode)}${reading.pan ? ` · PAN ${reading.pan}` : ""}` : undefined;
  const needsGstin = options.gstTreatments.find((entry) => entry.code === treatment)?.needsGstin;
  return (
    <Dialog isOpen onOpenChange={(open) => { if (!open) onClose(); }} title="Tax identity and terms" size="lg"
      description="The GSTIN sets the GST state and, for most registrations, the PAN.">
      <div className="flex flex-col gap-4">
        {save.error && !Object.keys(fieldErrors).length && <Notice>{errorMessage(save.error)}</Notice>}
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="GSTIN" value={gstin} onChange={(value) => { setGstin(value.toUpperCase()); setFieldErrors({}); }}
            description={gstinHelp} isInvalid={Boolean(fieldErrors.gstin) || Boolean(gstin.trim() && reading.gstin.length === 15 && !reading.valid)}
            errorMessage={fieldErrors.gstin ?? (gstin.trim() && reading.gstin.length === 15 && !reading.valid ? reading.error ?? undefined : undefined)} />
          <TextField label="PAN" value={pan} onChange={(value) => { setPan(value.toUpperCase()); setFieldErrors({}); }}
            description={reading.pan ? "Taken from the GSTIN when left empty." : undefined} isInvalid={Boolean(fieldErrors.pan)} errorMessage={fieldErrors.pan} />
          <Select label="GST treatment" selectedKey={treatment} onSelectionChange={(key) => setTreatment(String(key ?? NONE))} isInvalid={Boolean(fieldErrors.gstTreatment)}
            errorMessage={fieldErrors.gstTreatment} description={needsGstin && !gstin.trim() ? "This treatment needs a GSTIN." : undefined}
            options={[{ value: NONE, label: reading.valid ? "Registered – Regular (from the GSTIN)" : "Not set" }, ...options.gstTreatments.map((entry) => ({ value: entry.code, label: entry.label }))]} />
          <Select label="Payment terms" selectedKey={paymentTermId} onSelectionChange={(key) => setPaymentTermId(String(key ?? NONE))} isInvalid={Boolean(fieldErrors.paymentTermId)}
            errorMessage={fieldErrors.paymentTermId} options={[{ value: NONE, label: "Not set" }, ...options.paymentTerms.map((term) => ({ value: term.id, label: term.name }))]} />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isLoading={save.isPending} isDisabled={Boolean(gstin.trim()) && reading.gstin.length === 15 && !reading.valid} onPress={() => save.mutate()}>Save</Button>
        </div>
      </div>
    </Dialog>
  );
}
