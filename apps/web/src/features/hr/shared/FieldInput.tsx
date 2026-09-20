"use client";

import { NumberField, Select, TextArea, TextField, type SelectOption } from "@vercentlabs/design-system";

import type { HrOptions } from "@/features/hr/shared/client";

export type OptionSource = "employees" | "openOpenings" | "candidatesList" | "offerApplications" | "interviewApplications" | "departments" | "designations" | "branches" | "documentTypes" | "leaveTypes" | "shifts" | "holidayCalendars" | "salaryComponents" | "salaryStructures" | "payrollPeriods" | "salaryComponents" | "expenseCategories" | "jobOpenings" | "candidates" | "skills" | "goals" | "reviewCycles" | "courses" | "trainingSessions" | "banks" | "accounts";
export type FieldValue = string | number;
export type FieldDef = {
  name: string;
  label: string;
  kind: "text" | "number" | "date" | "datetime" | "textarea" | "select" | "bool";
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
  // The row's key when it differs from the field name (read models are snake_case).
  rowKey?: string;
};

export function resolveOptions(field: FieldDef, options: HrOptions | undefined): SelectOption[] {
  const source = field.options;
  if (field.kind === "bool") return [{ value: "true", label: "Yes" }, { value: "false", label: "No" }];
  if (!source) return [];
  if (Array.isArray(source)) return source;
  return (options?.[source] ?? []).map((o) => ({ value: o.id, label: o.code && o.code !== o.name ? `${o.name} (${o.code})` : o.name }));
}

export function FieldInput({ field, value, onChange, options, values }: { field: FieldDef; value: FieldValue | undefined; onChange: (value: FieldValue) => void; options?: HrOptions; values: Record<string, FieldValue> }) {
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
