"use client";

// The charges on a quotation or order (freight, packing, installation…). A charge is billed on the order's first invoice; one marked as
// taxed carries GST like the goods it goes with (Sales audit B1), as GST treats a supplier's freight.
import { Trash2 } from "lucide-react";
import { Checkbox, IconButton, NumberField, Select, TextField } from "@vercentlabs/design-system";

export type ChargeKind = "freight" | "packing" | "installation" | "handling" | "insurance" | "other";
export type ChargeDraft = { key: number; chargeType: ChargeKind; label: string; calculationType: "fixed" | "percentage"; value: number; taxable: boolean };

export const CHARGE_KINDS: Array<{ value: ChargeKind; label: string }> = [
  { value: "freight", label: "Freight" }, { value: "packing", label: "Packing" }, { value: "installation", label: "Installation" },
  { value: "handling", label: "Handling" }, { value: "insurance", label: "Insurance" }, { value: "other", label: "Other" },
];

// A stored charge (snake_case from the server) as a draft row.
export function chargeDraftOf(charge: { charge_type?: string | null; label: string; calculation_type: string; value: number | string; taxable?: boolean | null }, key: number): ChargeDraft {
  return {
    key, chargeType: (CHARGE_KINDS.some((kind) => kind.value === charge.charge_type) ? charge.charge_type : "other") as ChargeKind, label: charge.label,
    calculationType: charge.calculation_type === "percentage" ? "percentage" : "fixed", value: Number(charge.value), taxable: charge.taxable !== false,
  };
}

// The charges as the document input sends them.
export const chargesInput = (charges: ChargeDraft[]) => charges.filter((charge) => charge.value > 0).map((charge) => ({
  chargeType: charge.chargeType, label: charge.label || CHARGE_KINDS.find((kind) => kind.value === charge.chargeType)?.label || "Charge",
  calculationType: charge.calculationType, value: charge.value, taxable: charge.taxable,
}));

export function ChargeRows({ charges, onChange }: { charges: ChargeDraft[]; onChange: (next: ChargeDraft[]) => void }) {
  const update = (key: number, patch: Partial<ChargeDraft>) => onChange(charges.map((charge) => (charge.key === key ? { ...charge, ...patch } : charge)));
  return (
    <>
      {charges.map((charge) => (
        <div key={charge.key} className="grid grid-cols-1 items-end gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto_auto]">
          <Select label="Kind" options={CHARGE_KINDS} selectedKey={charge.chargeType}
            onSelectionChange={(value) => update(charge.key, { chargeType: String(value) as ChargeKind })} />
          <TextField label="Label" value={charge.label} placeholder={CHARGE_KINDS.find((kind) => kind.value === charge.chargeType)?.label}
            onChange={(value) => update(charge.key, { label: value })} />
          <Select label="Type" options={[{ value: "fixed", label: "Fixed amount" }, { value: "percentage", label: "% of value after discount" }]} selectedKey={charge.calculationType}
            onSelectionChange={(value) => update(charge.key, { calculationType: value === "percentage" ? "percentage" : "fixed" })} />
          <NumberField label="Value" value={charge.value} minValue={0} step={0.01} onChange={(value) => update(charge.key, { value })} />
          <Checkbox isSelected={charge.taxable} onChange={(taxable) => update(charge.key, { taxable })}>GST like the goods</Checkbox>
          <IconButton aria-label="Remove charge" variant="ghost" onPress={() => onChange(charges.filter((entry) => entry.key !== charge.key))}>
            <Trash2 className="size-4" aria-hidden="true" />
          </IconButton>
        </div>
      ))}
    </>
  );
}
