"use client";

import { NumberField, Select, TextArea, TextField, type SelectOption } from "@vercentlabs/design-system";

import type { ProjectsOptions } from "@/features/projects/shared/client";

export type OptionSource = "projects" | "templates" | "users" | "customers" | "suppliers" | "items" | "warehouses" | "tasks" | "milestones" | "purchaseOrders" | "receipts" | "requisitions" | "sourcingEvents" | "vendorBills";
export type FieldValue = string | number;
export type FieldDef = {
  name: string;
  label: string;
  kind: "text" | "number" | "date" | "datetime" | "textarea" | "select" | "bool";
  required?: boolean;
  options?: SelectOption[] | OptionSource;
  dependsOn?: string;
  placeholder?: string;
  defaultValue?: FieldValue;
  wide?: boolean;
  step?: number;
  showIf?: (values: Record<string, FieldValue>) => boolean;
  createOnly?: boolean;
  /** Shown only to callers holding any of these permissions (the domain refuses the field otherwise). */
  anyPermission?: string[];
  min?: number;
  rowKey?: string;
};

export function resolveOptions(field: FieldDef, options: ProjectsOptions | undefined): SelectOption[] {
  const source = field.options;
  if (field.kind === "bool") return [{ value: "true", label: "Yes" }, { value: "false", label: "No" }];
  if (!source) return [];
  if (Array.isArray(source)) return source;
  return (options?.[source] ?? []).map((o) => ({ value: o.id, label: o.code && o.code !== o.name ? `${o.name} (${o.code})` : o.name }));
}

export function FieldInput({ field, value, onChange, options }: { field: FieldDef; value: FieldValue | undefined; onChange: (value: FieldValue) => void; options?: ProjectsOptions; values: Record<string, FieldValue> }) {
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
          options={resolveOptions(field, options)}
          selectedKey={value !== undefined && value !== "" ? String(value) : null}
          onSelectionChange={(key) => onChange(String(key ?? ""))}
          placeholder={field.placeholder ?? `Select ${label.toLowerCase()}`}
        />
      );
    case "datetime":
      return <TextField label={label} type="datetime-local" isRequired={field.required} value={String(value ?? "")} onChange={onChange} />;
    case "date":
      return <TextField label={label} type="date" isRequired={field.required} value={String(value ?? "")} onChange={onChange} />;
    default:
      return <TextField label={label} isRequired={field.required} value={String(value ?? "")} onChange={onChange} placeholder={field.placeholder} />;
  }
}
