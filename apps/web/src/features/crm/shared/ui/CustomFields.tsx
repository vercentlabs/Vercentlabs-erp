"use client";

// The organization's custom fields on a lead or deal (CRM plan 5.3): inputs on the form, and the values on the record.
import { Checkbox, Select, TextField } from "@vercentlabs/design-system";

import { DateInput } from "@/features/crm/shared/ui/DateTimeInput";
import { formatDate } from "@/shared/format/human";

import type { CustomField, CustomValues } from "../fields-api";

export function CustomFieldInputs({ fields, values, onChange }: { fields: CustomField[]; values: CustomValues; onChange: (values: CustomValues) => void }) {
  if (!fields.length) return null;
  const set = (key: string, value: CustomValues[string]) => onChange({ ...values, [key]: value });
  return (
    <>
      {fields.map((field) => {
        const value = values[field.key];
        const description = field.helpText ?? undefined;
        if (field.type === "checkbox")
          return <Checkbox key={field.key} isSelected={value === true} onChange={(selected) => set(field.key, selected)}>{field.label}</Checkbox>;
        if (field.type === "select") {
          // A choice since taken off the list stays selectable on the records that have it.
          const retired = typeof value === "string" && value && !field.options.includes(value) ? [{ value, label: `${value} (no longer on the list)` }] : [];
          return (
            <Select key={field.key} label={field.label} isRequired={field.isRequired} description={description} selectedKey={typeof value === "string" && value ? value : "none"}
              onSelectionChange={(key) => set(field.key, String(key) === "none" ? null : String(key))}
              options={[{ value: "none", label: "Not set" }, ...retired, ...field.options.map((option) => ({ value: option, label: option }))]} />
          );
        }
        if (field.type === "date")
          return <DateInput key={field.key} label={field.label} isRequired={field.isRequired} description={description} value={typeof value === "string" ? value : ""} onChange={(next) => set(field.key, next || null)} />;
        return (
          <TextField key={field.key} label={field.label} isRequired={field.isRequired} description={description} inputMode={field.type === "number" ? "decimal" : undefined}
            value={value === null || value === undefined ? "" : String(value)} onChange={(next) => set(field.key, next)} />
        );
      })}
    </>
  );
}

// The values as the record page lists them: [{ label, value }] for the property list, set ones only.
export function customFieldProperties(fields: CustomField[], values: CustomValues | undefined) {
  return fields
    .filter((field) => values?.[field.key] !== undefined && values?.[field.key] !== null && values?.[field.key] !== "")
    .map((field) => {
      const value = values![field.key];
      return { label: field.label, value: field.type === "checkbox" ? (value ? "Yes" : "No") : field.type === "date" ? formatDate(String(value)) : String(value) };
    });
}

// The organization's choice and yes/no fields as list filters (CRM audit M4): one Select each, "any" when not filtering. values: { key: value }.
export function CustomFieldFilters({ fields, values, onChange, anyValue }: { fields: CustomField[]; values: Record<string, string>; onChange: (values: Record<string, string>) => void; anyValue: string }) {
  return (
    <>
      {fields.filter((field) => field.type === "select" || field.type === "checkbox").map((field) => (
        <Select key={field.key} label={field.label} size="compact" selectedKey={values[field.key] ?? anyValue}
          onSelectionChange={(key) => onChange({ ...values, [field.key]: String(key) })}
          options={[{ value: anyValue, label: "Any" }, ...(field.type === "checkbox" ? [{ value: "true", label: "Yes" }, { value: "false", label: "No" }] : field.options.map((option) => ({ value: option, label: option })))]} />
      ))}
    </>
  );
}

// The custom filters set (not "any") as the list's query parameters: { "cf.<key>": value }.
export const customFilterParams = (values: Record<string, string>, anyValue: string) =>
  Object.fromEntries(Object.entries(values).filter(([, value]) => value && value !== anyValue).map(([key, value]) => [`cf.${key}`, value]));
