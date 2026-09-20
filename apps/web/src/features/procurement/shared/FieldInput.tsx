"use client";

import { NumberField, Select, TextArea, TextField, type SelectOption } from "@vercentlabs/design-system";

import type { ProcOptions } from "@/features/procurement/shared/api";

export type FieldKind = "text" | "date" | "number" | "textarea" | "select";
export type OptionSource = "suppliers" | "warehouses" | "items" | "uoms" | "purchaseOrders" | "receipts" | "sourcingEvents" | "categories" | "agreements" | "requisitions";
export type FieldDef = {
  name: string;
  label: string;
  kind: FieldKind;
  required?: boolean;
  options?: SelectOption[] | OptionSource;
  placeholder?: string;
  defaultValue?: string | number;
  wide?: boolean;
  step?: number;
};

export type FieldValue = string | number;

export function resolveOptions(source: FieldDef["options"], options: ProcOptions | undefined): SelectOption[] {
  if (!source) return [];
  if (Array.isArray(source)) return source;
  const o = options;
  switch (source) {
    case "suppliers":
      return (o?.suppliers ?? []).map((s) => ({ value: s.id, label: s.label }));
    case "warehouses":
      return (o?.warehouses ?? []).map((w) => ({ value: w.id, label: `${w.name} (${w.code})` }));
    case "items":
      return (o?.items ?? []).map((i) => ({ value: i.id, label: `${i.name} (${i.code})` }));
    case "uoms":
      return (o?.uoms ?? []).map((u) => ({ value: u.id, label: `${u.name} (${u.code})` }));
    case "purchaseOrders":
      return (o?.purchaseOrders ?? []).map((p) => ({ value: p.id, label: p.label }));
    case "receipts":
      return (o?.receipts ?? []).map((r) => ({ value: r.id, label: r.label }));
    case "sourcingEvents":
      return (o?.sourcingEvents ?? []).map((e) => ({ value: e.id, label: e.label }));
    case "categories":
      return (o?.categories ?? []).map((c) => ({ value: c.id, label: c.label }));
    case "agreements":
      return (o?.agreements ?? []).map((a) => ({ value: a.id, label: a.label }));
    case "requisitions":
      return (o?.requisitions ?? []).map((r) => ({ value: r.id, label: r.label }));
  }
}

// One field, rendered by kind. Numbers are held as numbers in the form and sent
// as-is; the server validates and normalises every amount.
export function FieldInput({ field, value, onChange, options, ariaSuffix }: { field: FieldDef; value: FieldValue | undefined; onChange: (value: FieldValue) => void; options?: ProcOptions; ariaSuffix?: string }) {
  const label = field.label;
  const aria = ariaSuffix ? { "aria-label": `${label} ${ariaSuffix}` } : {};
  switch (field.kind) {
    case "textarea":
      return <TextArea label={label} isRequired={field.required} value={String(value ?? "")} onChange={onChange} />;
    case "number":
      return <NumberField {...aria} label={ariaSuffix ? undefined : label} isRequired={field.required} value={Number(value ?? 0)} onChange={onChange} minValue={0} step={field.step ?? 0.01} />;
    case "select":
      return (
        <Select
          {...aria}
          label={ariaSuffix ? undefined : label}
          isRequired={field.required}
          options={resolveOptions(field.options, options)}
          selectedKey={value ? String(value) : null}
          onSelectionChange={(key) => onChange(String(key ?? ""))}
          placeholder={field.placeholder ?? `Select ${label.toLowerCase()}`}
        />
      );
    case "date":
      return <TextField {...aria} label={ariaSuffix ? undefined : label} type="date" isRequired={field.required} value={String(value ?? "")} onChange={onChange} />;
    default:
      return <TextField {...aria} label={ariaSuffix ? undefined : label} isRequired={field.required} value={String(value ?? "")} onChange={onChange} />;
  }
}
