"use client";

export type CrmCustomFieldEntityType = "lead" | "opportunity" | "party" | "contact";

export type CrmCustomFieldDataType =
  | "text"
  | "textarea"
  | "number"
  | "currency"
  | "percentage"
  | "boolean"
  | "date"
  | "datetime"
  | "select"
  | "multi_select";

export const CUSTOM_FIELD_DATA_TYPES: CrmCustomFieldDataType[] = [
  "text",
  "textarea",
  "number",
  "currency",
  "percentage",
  "boolean",
  "date",
  "datetime",
  "select",
  "multi_select",
];

export type CrmCustomFieldDefinition = {
  id: string;
  entityType: CrmCustomFieldEntityType;
  fieldKey: string;
  label: string;
  dataType: CrmCustomFieldDataType;
  required: boolean;
  configuration: { options?: string[]; maxLength?: number };
  status: "active" | "inactive";
  createdAt: string;
  updatedAt: string;
};

export type CrmCustomFieldValueRow = {
  definitionId: string;
  fieldKey: string;
  label: string;
  dataType: CrmCustomFieldDataType;
  required: boolean;
  configuration: { options?: string[]; maxLength?: number };
  value: unknown;
  valueUpdatedAt: string | null;
};

export class CustomFieldApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
  }
}

async function parseResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    throw new CustomFieldApiError(payload.message || "The request could not be completed.", response.status, payload.code);
  }
  return payload;
}

export async function listCustomFieldDefinitions(entityType: CrmCustomFieldEntityType): Promise<{ rows: CrmCustomFieldDefinition[] }> {
  const response = await fetch(`/api/crm/custom-fields/definitions/${entityType}`);
  return parseResponse(response);
}

export async function createCustomFieldDefinition(entityType: CrmCustomFieldEntityType, input: Record<string, unknown>): Promise<{ record: CrmCustomFieldDefinition }> {
  const response = await fetch(`/api/crm/custom-fields/definitions/${entityType}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  return parseResponse(response);
}

export async function setCustomFieldDefinitionActive(id: string, active: boolean): Promise<{ record: CrmCustomFieldDefinition }> {
  // Under .../definitions/by-id/[id]/active, not .../definitions/[id]/active
  // — that would make [entityType] and [id] conflicting dynamic siblings
  // at the same route level (verify:routes' Check 3 catches this).
  const response = await fetch(`/api/crm/custom-fields/definitions/by-id/${id}/active`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active }) });
  return parseResponse(response);
}

export async function getCustomFieldValues(entityType: CrmCustomFieldEntityType, entityId: string): Promise<{ rows: CrmCustomFieldValueRow[] }> {
  const response = await fetch(`/api/crm/custom-fields/values/${entityType}/${entityId}`);
  return parseResponse(response);
}

export async function setCustomFieldValues(entityType: CrmCustomFieldEntityType, entityId: string, values: Record<string, unknown>): Promise<{ rows: CrmCustomFieldValueRow[] }> {
  const response = await fetch(`/api/crm/custom-fields/values/${entityType}/${entityId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ values }) });
  return parseResponse(response);
}
