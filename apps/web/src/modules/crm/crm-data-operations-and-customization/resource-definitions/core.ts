import type { CrmResourceKey } from "@vercentlabs/shared-types";

export type CrmField = {
  name: string;
  label: string;
  type: "text" | "email" | "number" | "date" | "datetime-local" | "select" | "checkbox" | "textarea";
  structuredKind?: "list" | "key-value" | "actions" | "schedule" | "value";
  structuredOptionsKey?: string;
  helpText?: string;
  formHidden?: boolean;
  required?: boolean;
  optionsKey?: string;
  options?: Array<{ value: string; label: string }>;
};

export type CrmColumn = { key: string; label: string; optionsKey?: string; format?: "status" | "currency" | "date" | "datetime" | "score"; };
export type CrmDefinition = {
  key: CrmResourceKey; title: string; singular: string; description: string;
  group: "Work" | "Engagement" | "Configuration" | "Automation" | "Intelligence" | "Analytics" | "Customization" | "Partner" | "Field Sales";
  permission: string; fields: CrmField[]; columns: CrmColumn[];
};

export const status = (...values: string[]) => values.map((value) => ({ value, label: value.replaceAll("_", "  ").replace(/^./, (c) => c.toUpperCase()) }));
export const company = { name: "companyId", label: "Company", type: "select" as const, optionsKey: "companies" };
export const branch = { name: "branchId", label: "Branch", type: "select" as const, optionsKey: "branches" };
export const owner = { name: "ownerUserId", label: "Owner", type: "select" as const, optionsKey: "users" };

export function workspace(key: CrmResourceKey, title: string, singular: string, group: CrmDefinition["group"], permission: string, description: string, fields: CrmField[], columns: CrmColumn[]): CrmDefinition {
  return { key, title, singular, group, permission, description, fields, columns };
}

export function config(key: CrmResourceKey, title: string, singular: string, permission: string, fields: CrmField[]): CrmDefinition {
  return { key, title, singular, permission, fields, group: key === "scoring-rules" || key === "assignment-rules" || key === "sequences" ? "Automation" : "Configuration", description: `Configure governed ${title.toLowerCase()} for the CRM workspace.`, columns: [{ key: "name", label: "Name" }, { key: "code", label: "Code" }, { key: "status", label: "Status", format: "status" }] };
}
