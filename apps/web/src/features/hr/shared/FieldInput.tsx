"use client";

import { useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import {
  ComboBox,
  NumberField,
  Select,
  TextArea,
  TextField,
  type SelectOption,
} from "@vercentlabs/design-system";

import type { HrOptions } from "@/features/hr/shared/client";
import { useQuickCreate } from "@/shell/pickers/useQuickCreate";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

export type OptionSource =
  | "employees"
  | "departments"
  | "designations"
  | "leaveTypes"
  | "shifts"
  | "holidayCalendars"
  | "salaryComponents"
  | "salaryStructures"
  | "payrollPeriods";
export type FieldValue = string | number;
export type FieldDef = {
  name: string;
  label: string;
  kind:
    "text" | "number" | "date" | "datetime" | "textarea" | "select" | "bool";
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
  // A department or designation not on file yet is created in place (Create-Where-You-Are H1).
  creatable?: boolean;
};

// Lists kept as setup (Create-Where-You-Are H2): when empty, the field links to the page that sets one up.
const SETUP_PAGES: Partial<Record<OptionSource, { href: string; noun: string }>> = {
  leaveTypes: { href: "/hr/leave-types", noun: "leave type" },
  shifts: { href: "/hr/shifts", noun: "shift" },
  salaryStructures: { href: "/hr/salary-structures", noun: "salary structure" },
};

function CreatableMasterSelect({ field, value, onChange, options }: {
  field: FieldDef; value: FieldValue | undefined; onChange: (value: FieldValue) => void; options: SelectOption[];
}) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const [added, setAdded] = useState<SelectOption[]>([]);
  const quickCreate = useQuickCreate(field.options === "designations" ? "designation" : "department", {
    onCreated: (record) => {
      setAdded((current) => [...current, { value: record.id, label: record.label }]);
      onChange(record.id);
      void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "hr", "options") });
    },
  });
  const known = new Set(options.map((option) => option.value));
  return (
    <>
      <ComboBox
        label={field.label}
        isRequired={field.required}
        options={[...options, ...added.filter((option) => !known.has(option.value))]}
        selectedKey={value !== undefined && value !== "" ? String(value) : null}
        onSelectionChange={(key) => onChange(String(key ?? ""))}
        placeholder={field.placeholder ?? `Search ${field.label.toLowerCase()}`}
        onCreate={quickCreate.canCreate ? quickCreate.open : undefined}
        createLabel={(text) => (text ? `+ New ${quickCreate.noun} "${text}"` : `+ New ${quickCreate.noun}`)}
      />
      {quickCreate.drawer}
    </>
  );
}

function resolveOptions(
  field: FieldDef,
  options: HrOptions | undefined,
): SelectOption[] {
  const source = field.options;
  if (field.kind === "bool")
    return [
      { value: "true", label: "Yes" },
      { value: "false", label: "No" },
    ];
  if (!source) return [];
  if (Array.isArray(source)) return source;
  return (options?.[source] ?? []).map((o) => ({
    value: o.id,
    label: o.code && o.code !== o.name ? `${o.name} (${o.code})` : o.name,
  }));
}

// `values` is part of the props contract every call site passes (kept identical to inventory's FieldInput, which
// uses it to narrow a dependent picker's options), but no HR field currently declares `dependsOn`, so it is unread here.
export function FieldInput({
  field,
  value,
  onChange,
  options,
}: {
  field: FieldDef;
  value: FieldValue | undefined;
  onChange: (value: FieldValue) => void;
  options?: HrOptions;
  values: Record<string, FieldValue>;
}) {
  const label = field.label;
  switch (field.kind) {
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
    case "bool": {
      const choices = resolveOptions(field, options);
      if (field.creatable && (field.options === "departments" || field.options === "designations"))
        return <CreatableMasterSelect field={field} value={value} onChange={onChange} options={choices} />;
      const setup = typeof field.options === "string" ? SETUP_PAGES[field.options] : undefined;
      if (setup && options && !choices.length)
        return (
          <div className="flex flex-col gap-1 text-sm">
            <span className="font-medium">{label}</span>
            <span className="text-text-secondary">
              No {setup.noun} is set up yet. <Link className="font-medium text-brand underline-offset-2 hover:underline" href={setup.href}>Set up a {setup.noun}</Link>, then come back.
            </span>
          </div>
        );
      return (
        <Select
          label={label}
          isRequired={field.required}
          options={resolveOptions(field, options)}
          selectedKey={
            value !== undefined && value !== "" ? String(value) : null
          }
          onSelectionChange={(key) => onChange(String(key ?? ""))}
          placeholder={field.placeholder ?? `Select ${label.toLowerCase()}`}
        />
      );
    }
    case "datetime":
      return (
        <TextField
          label={label}
          type="datetime-local"
          isRequired={field.required}
          value={String(value ?? "")}
          onChange={onChange}
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
