"use client";

import {
  NumberField,
  Select,
  TextArea,
  TextField,
  type SelectOption,
} from "@vercentlabs/design-system";

import type { InvOptions } from "@/features/inventory/shared/client";

type OptionSource =
  | "items"
  | "itemUnits"
  | "warehouses"
  | "locations"
  | "batches";
export type FieldValue = string | number;
export type FieldDef = {
  name: string;
  label: string;
  kind: "text" | "number" | "date" | "textarea" | "select" | "bool" | "info";
  // An "info" field shows a line worked out from the other values (such as the base-quantity impact) and is never sent.
  info?: (values: Record<string, FieldValue>, options: InvOptions | undefined) => string | null;
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

function resolveOptions(
  field: FieldDef,
  options: InvOptions | undefined,
  values: Record<string, FieldValue>,
): SelectOption[] {
  const source = field.options;
  if (field.kind === "bool")
    return [
      { value: "true", label: "Yes" },
      { value: "false", label: "No" },
    ];
  if (!source) return [];
  if (Array.isArray(source)) return source;
  const parent = field.dependsOn ? values[field.dependsOn] : undefined;
  switch (source) {
    case "items":
      return (options?.items ?? []).map((i) => ({
        value: i.id,
        label: `${i.name} (${i.code})`,
      }));
    case "warehouses":
      return (options?.warehouses ?? []).map((w) => ({
        value: w.id,
        label: `${w.name} (${w.code})`,
      }));
    case "locations":
      return (options?.locations ?? [])
        .filter(
          (l) => !field.dependsOn || (parent && l.warehouse_id === parent),
        )
        .map((l) => ({ value: l.id, label: `${l.name} (${l.code})` }));
    case "itemUnits": {
      // The chosen item's base unit and the alternate units it may be entered in.
      const item = (options?.items ?? []).find((entry) => entry.id === parent);
      if (!item) return [];
      return [{ value: "", label: `${item.base_uom ?? "Base unit"} (base)` },
        ...(item.units ?? []).map((unit) => ({ value: unit.uomId, label: `${unit.code} (1 = ${Number(unit.factor)} ${item.base_uom ?? ""})` }))];
    }
    case "batches":
      return (options?.batches ?? [])
        .filter((b) => !field.dependsOn || (parent && b.item_id === parent))
        .map((b) => ({ value: b.id, label: b.code }));
  }
}

export function FieldInput({
  field,
  value,
  onChange,
  options,
  values,
}: {
  field: FieldDef;
  value: FieldValue | undefined;
  onChange: (value: FieldValue) => void;
  options?: InvOptions;
  values: Record<string, FieldValue>;
}) {
  const label = field.label;
  switch (field.kind) {
    case "info": {
      const text = field.info?.(values, options);
      return text ? <p className="rounded-[var(--radius-control)] bg-surface-muted px-3 py-2 text-sm tabular-nums">{text}</p> : null;
    }
    case "textarea":
      return (
        <TextArea
          label={label}
          isRequired={field.required}
          value={String(value ?? "")}
          onChange={onChange}
        />
      );
    case "number":
      return (
        <NumberField
          label={label}
          isRequired={field.required}
          value={Number(value ?? 0)}
          onChange={onChange}
          minValue={field.min ?? 0}
          step={field.step ?? 1}
        />
      );
    case "select":
    case "bool":
      return (
        <Select
          label={label}
          isRequired={field.required}
          options={resolveOptions(field, options, values)}
          selectedKey={
            value !== undefined && value !== "" ? String(value) : null
          }
          onSelectionChange={(key) => onChange(String(key ?? ""))}
          placeholder={field.placeholder ?? `Select ${label.toLowerCase()}`}
        />
      );
    case "date":
      return (
        <TextField
          label={label}
          type="date"
          isRequired={field.required}
          value={String(value ?? "")}
          onChange={onChange}
        />
      );
    default:
      return (
        <TextField
          label={label}
          isRequired={field.required}
          value={String(value ?? "")}
          onChange={onChange}
          placeholder={field.placeholder}
        />
      );
  }
}
