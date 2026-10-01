"use client";

import { CrmApiError } from "../shared/http/crm-api-error.ts";
import { crmApiClient } from "../shared/http/crm-request.ts";

export type CrmCustomFieldEntityType =
  "lead" | "opportunity" | "party" | "contact";

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

export class CustomFieldApiError extends CrmApiError {}

const { request, parseResponse } = crmApiClient(CustomFieldApiError);

export async function listCustomFieldDefinitions(
  entityType: CrmCustomFieldEntityType,
): Promise<{ rows: CrmCustomFieldDefinition[] }> {
  return request(`/api/crm/custom-fields/definitions/${entityType}`);
}

export async function createCustomFieldDefinition(
  entityType: CrmCustomFieldEntityType,
  input: Record<string, unknown>,
): Promise<{ record: CrmCustomFieldDefinition }> {
  const response = await fetch(
    `/api/crm/custom-fields/definitions/${entityType}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  return parseResponse(response);
}

export async function setCustomFieldDefinitionActive(
  id: string,
  active: boolean,
): Promise<{ record: CrmCustomFieldDefinition }> {
  // Under .../definitions/by-id/[id]/active, not .../definitions/[id]/active
  // — that would make [entityType] and [id] conflicting dynamic siblings
  // at the same route level (verify:routes' Check 3 catches this).
  const response = await fetch(
    `/api/crm/custom-fields/definitions/by-id/${id}/active`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active }),
    },
  );
  return parseResponse(response);
}

export async function getCustomFieldValues(
  entityType: CrmCustomFieldEntityType,
  entityId: string,
): Promise<{ rows: CrmCustomFieldValueRow[] }> {
  return request(`/api/crm/custom-fields/values/${entityType}/${entityId}`);
}

// F028 — append-only change history; labels are as they were at the time.
export type CrmCustomFieldHistoryRow = {
  id: string;
  fieldKey: string;
  fieldLabel: string;
  previousValue: unknown;
  newValue: unknown;
  changedAt: string;
  changedByName: string | null;
};

export async function getCustomFieldValueHistory(
  entityType: CrmCustomFieldEntityType,
  entityId: string,
): Promise<{ rows: CrmCustomFieldHistoryRow[] }> {
  return request(
    `/api/crm/custom-fields/values/${entityType}/${entityId}/history`,
  );
}

export async function setCustomFieldValues(
  entityType: CrmCustomFieldEntityType,
  entityId: string,
  values: Record<string, unknown>,
): Promise<{ rows: CrmCustomFieldValueRow[] }> {
  const response = await fetch(
    `/api/crm/custom-fields/values/${entityType}/${entityId}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ values }),
    },
  );
  return parseResponse(response);
}
