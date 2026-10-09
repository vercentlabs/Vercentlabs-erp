"use client";

// Tax on a quotation or sales order form. The server works the tax out from
// the company registration, the customer and the addresses; this panel shows
// what it decided and why (place of supply, CGST + SGST or IGST). Changing
// the supply type or the place of supply is an exception: it needs its own
// permission and a reason. Nobody types a tax amount.
import { Select, TextField } from "@vercentlabs/design-system";

import type { SalesDocumentPreview, SalesOptions } from "@/features/sales/quotations/api/quotations-api";
import { Notice, Panel } from "@/shared/ui/Panel";

// "" means "worked out automatically".
export type DocumentTaxDraft = { sellerRegistrationId: string; supplyType: string; taxOverrideReason: string; placeOfSupply: string; placeOfSupplyReason: string };
export const AUTOMATIC_TAX: DocumentTaxDraft = { sellerRegistrationId: "", supplyType: "", taxOverrideReason: "", placeOfSupply: "", placeOfSupplyReason: "" };

// What the form sends: only what the user chose to override.
export const taxInput = (draft: DocumentTaxDraft) => ({
  sellerRegistrationId: draft.sellerRegistrationId || undefined,
  supplyType: draft.supplyType || undefined,
  taxOverrideReason: draft.supplyType ? draft.taxOverrideReason.trim() || undefined : undefined,
  placeOfSupply: draft.placeOfSupply || undefined,
  placeOfSupplyReason: draft.placeOfSupply ? draft.placeOfSupplyReason.trim() || undefined : undefined,
});

// The stored override of a saved document, for editing it.
export const taxDraftOf = (document: {
  seller_registration_id?: string | null; supply_type?: string | null; tax_override_reason?: string | null; place_of_supply?: string | null;
  place_of_supply_source?: string | null; place_of_supply_reason?: string | null;
}): DocumentTaxDraft => ({
  sellerRegistrationId: document.seller_registration_id ?? "",
  supplyType: document.tax_override_reason ? document.supply_type ?? "" : "",
  taxOverrideReason: document.tax_override_reason ?? "",
  placeOfSupply: document.place_of_supply_source === "override" ? document.place_of_supply ?? "" : "",
  placeOfSupplyReason: document.place_of_supply_reason ?? "",
});

const NATURE: Record<string, string> = { intra_state: "Within the state: CGST + SGST", inter_state: "Between states: IGST" };

export function DocumentTaxPanel({ tax, value, onChange, preview }: {
  tax: SalesOptions["tax"]; value: DocumentTaxDraft; onChange: (next: DocumentTaxDraft) => void; preview: SalesDocumentPreview | undefined;
}) {
  if (!tax.enabled) return <Panel title="Tax"><p className="text-sm text-text-muted">Tax is switched off for this organization: documents are calculated without tax.</p></Panel>;
  const result = preview?.tax;
  const derivedSupply = tax.supplyTypes.find((entry) => entry.code === result?.derivedSupplyType)?.label;
  const place = result?.placeOfSupply;
  return (
    <Panel title="Tax" description="Worked out from the company registration, the customer and the addresses.">
      {tax.registrations.length === 0 && <Notice tone="warning">Add the company&apos;s GST registration in Settings → Taxes so GST can be calculated.</Notice>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {tax.registrations.length > 1 && (
          <Select
            label="Issued by"
            description="The company registration that issues this document."
            options={[{ value: "", label: "Default registration" }, ...tax.registrations.map((entry) => ({ value: entry.id, label: `${entry.name}${entry.registrationNumber ? ` · ${entry.registrationNumber}` : ""}` }))]}
            selectedKey={value.sellerRegistrationId}
            onSelectionChange={(key) => onChange({ ...value, sellerRegistrationId: String(key ?? "") })}
          />
        )}
        <Select
          label="Supply type"
          description={tax.canOverrideTreatment ? undefined : "From the customer's GST registration type. Only an authorised user can change it."}
          options={[{ value: "", label: `Automatic${derivedSupply ? `: ${derivedSupply}` : ""}` }, ...tax.supplyTypes.map((entry) => ({ value: entry.code, label: entry.label }))]}
          selectedKey={value.supplyType}
          onSelectionChange={(key) => onChange({ ...value, supplyType: String(key ?? "") })}
          isDisabled={!tax.canOverrideTreatment}
        />
        {value.supplyType && (
          <TextField label="Reason for the tax treatment" isRequired value={value.taxOverrideReason} onChange={(taxOverrideReason) => onChange({ ...value, taxOverrideReason })} />
        )}
        <Select
          label="Place of supply"
          description={tax.canOverridePlaceOfSupply ? undefined : "From the shipping or billing address. Only an authorised user can change it."}
          options={[{ value: "", label: `Automatic${place && place.source === "derived" ? `: ${place.name ?? place.code} (${place.basis})` : ""}` }, ...tax.states.map((state) => ({ value: state.code, label: `${state.name} (${state.code})` }))]}
          selectedKey={value.placeOfSupply}
          onSelectionChange={(key) => onChange({ ...value, placeOfSupply: String(key ?? "") })}
          isDisabled={!tax.canOverridePlaceOfSupply}
        />
        {value.placeOfSupply && (
          <TextField label="Reason for the place of supply" isRequired value={value.placeOfSupplyReason} onChange={(placeOfSupplyReason) => onChange({ ...value, placeOfSupplyReason })} />
        )}
      </div>
      {result && (
        <p className="text-sm text-text-secondary">
          {[
            result.seller ? `Issued by ${result.seller.name}${result.seller.gstin ? ` (GSTIN ${result.seller.gstin})` : ""}${result.seller.stateName ? `, ${result.seller.stateName}` : ""}` : null,
            place ? `Place of supply: ${place.name ?? place.code}` : "No place of supply yet",
            result.treatment !== "taxable" ? `${tax.supplyTypes.find((entry) => entry.code === result.supplyType)?.label ?? result.supplyType}: no tax charged` : result.supplyNature ? NATURE[result.supplyNature] : null,
          ].filter(Boolean).join(" · ")}
        </p>
      )}
    </Panel>
  );
}
