"use client";

import { NumberField, Select, TextArea, TextField, type SelectOption } from "@vercentlabs/design-system";

import type { InvOptions } from "@/features/inventory/shared/client";

export type OptionSource = "items" | "warehouses" | "locations" | "batches" | "uoms" | "groups" | "taxCategories";
export type FieldValue = string | number;
export type FieldDef = {
  name: string;
  label: string;
  kind: "text" | "number" | "date" | "textarea" | "select" | "bool";
  required?: boolean;
  options?: SelectOption[] | OptionSource;
  // Narrow a dependent picker: locations by the chosen warehouse, batches by the chosen item.
  dependsOn?: string;
  placeholder?: string;
  defaultValue?: FieldValue;
  wide?: boolean;
  step?: number;
  showIf?: (values: Record<string, FieldValue>) => boolean;
  // Present on create only (e.g. an item's code once it has history).
  createOnly?: boolean;
  min?: number;
  // The row's key when it differs from the field name (stock read models are snake_case).
  rowKey?: string;
};

export function resolveOptions(field: FieldDef, options: InvOptions | undefined, values: Record<string, FieldValue>): SelectOption[] {
  const source = field.options;
  if (field.kind === "bool") return [{ value: "true", label: "Yes" }, { value: "false", label: "No" }];
  if (!source) return [];
  if (Array.isArray(source)) return source;
  const parent = field.dependsOn ? values[field.dependsOn] : undefined;
  switch (source) {
    case "items":
      return (options?.items ?? []).map((i) => ({ value: i.id, label: `${i.name} (${i.code})` }));
    case "warehouses":
      return (options?.warehouses ?? []).map((w) => ({ value: w.id, label: `${w.name} (${w.code})` }));
    case "locations":
      return (options?.locations ?? []).filter((l) => !field.dependsOn || (parent && l.warehouse_id === parent)).map((l) => ({ value: l.id, label: `${l.name} (${l.code})` }));
    case "batches":
      return (options?.batches ?? []).filter((b) => !field.dependsOn || (parent && b.item_id === parent)).map((b) => ({ value: b.id, label: b.code }));
    case "uoms":
      return (options?.uoms ?? []).map((u) => ({ value: u.id, label: `${u.name} (${u.code})` }));
    case "groups":
      return (options?.groups ?? []).map((g) => ({ value: g.id, label: `${g.name} (${g.code})` }));
    case "taxCategories":
      return (options?.taxCategories ?? []).map((t) => ({ value: t.id, label: `${t.name} (${t.code})` }));
  }
}

export function FieldInput({ field, value, onChange, options, values }: { field: FieldDef; value: FieldValue | undefined; onChange: (value: FieldValue) => void; options?: InvOptions; values: Record<string, FieldValue> }) {
  const label = field.label;
  switch (field.kind) {
    case "textarea":
      return <TextArea label={label} isRequired={field.required} value={String(value ?? "")} onChange={onChange} />;
    case "number":
      return <NumberField label={label} isRequired={field.required} value={Number(value ?? 0)} onChange={onChange} minValue={field.min ?? 0} step={field.step ?? 1} />;
    case "select":
    case "bool":
      return (
        <Select
          label={label}
          isRequired={field.required}
          options={resolveOptions(field, options, values)}
          selectedKey={value !== undefined && value !== "" ? String(value) : null}
          onSelectionChange={(key) => onChange(String(key ?? ""))}
          placeholder={field.placeholder ?? `Select ${label.toLowerCase()}`}
        />
      );
    case "date":
      return <TextField label={label} type="date" isRequired={field.required} value={String(value ?? "")} onChange={onChange} />;
    default:
      return <TextField label={label} isRequired={field.required} value={String(value ?? "")} onChange={onChange} placeholder={field.placeholder} />;
  }
}
