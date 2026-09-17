// tenant.crm_tags / tenant.crm_custom_object_definitions /
// tenant.crm_custom_field_definitions rows via the generic
// /api/crm/[resource] boundary — see resource-registry.js's "tags",
// "custom-object-definitions" and "custom-field-definitions" definitions
// for the authoritative field map.
export type CrmTag = {
  id: string;
  name: string;
  color: string | null;
  status: "active" | "inactive";
  createdAt: string;
  updatedAt: string;
};

// This is a standalone custom-object/custom-record system (build your own
// entity type, with its own custom fields, and create records of it) — it
// is NOT a mechanism for adding fields onto the built-in Lead/Opportunity/
// Account/Contact entities. See the register's note on why binding these
// definitions to built-in entities was deliberately not attempted this
// pass (Lead/Opportunity's own customData JSONB column has no schema
// validation wired to this definition system).
export type CrmCustomObjectDefinition = {
  id: string;
  objectKey: string;
  singularLabel: string;
  pluralLabel: string;
  description: string | null;
  primaryNameField: string | null;
  companyScoped: boolean;
  status: "active" | "inactive";
  createdAt: string;
  updatedAt: string;
};

export type CrmCustomFieldDataType = "text" | "number" | "boolean" | "date" | "select" | "textarea";

export type CrmCustomFieldDefinition = {
  id: string;
  objectDefinitionId: string;
  fieldKey: string;
  label: string;
  dataType: CrmCustomFieldDataType | string;
  required: boolean;
  uniqueValue: boolean;
  indexed: boolean;
  options: unknown;
  defaultValue: unknown;
  sequence: number | null;
  status: "active" | "inactive";
  createdAt: string;
  updatedAt: string;
};

export type CrmListResponse<T> = { rows: T[]; total: number; limit: number; offset: number };
