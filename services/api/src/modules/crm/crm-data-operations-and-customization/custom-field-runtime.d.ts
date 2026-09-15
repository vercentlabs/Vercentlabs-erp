import type { CrmContext, QueryClient } from "../index.js";

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

export function listCustomFieldDefinitions(
  client: QueryClient,
  context: CrmContext,
  entityType: CrmCustomFieldEntityType,
): Promise<CrmCustomFieldDefinition[]>;

export function createCustomFieldDefinition(
  client: QueryClient,
  context: CrmContext,
  input?: Record<string, unknown>,
): Promise<CrmCustomFieldDefinition>;

export function setCustomFieldDefinitionActive(
  client: QueryClient,
  context: CrmContext,
  id: string,
  active: boolean,
): Promise<CrmCustomFieldDefinition>;

export function getCustomFieldValues(
  client: QueryClient,
  context: CrmContext,
  entityType: CrmCustomFieldEntityType,
  entityId: string,
): Promise<CrmCustomFieldValueRow[]>;

export function setCustomFieldValues(
  client: QueryClient,
  context: CrmContext,
  entityType: CrmCustomFieldEntityType,
  entityId: string,
  values?: Record<string, unknown>,
): Promise<CrmCustomFieldValueRow[]>;
