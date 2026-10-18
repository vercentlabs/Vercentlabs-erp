import type { CrmContext } from "@vercentlabs/shared-types";

type QueryClient = { query: (text: string, values?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> };
export type CustomFieldType = "text" | "number" | "date" | "select" | "checkbox";
export type CrmCustomField = {
  id: string; entityType: "lead" | "opportunity"; key: string; label: string; type: CustomFieldType; options: string[]; isRequired: boolean; helpText: string | null;
  sequence: number; isActive: boolean;
};
export const CUSTOM_FIELD_ENTITIES: ReadonlyArray<"lead" | "opportunity">;
export const CUSTOM_FIELD_TYPES: ReadonlyArray<CustomFieldType>;
export function listCustomFields(client: QueryClient, context: CrmContext, entity: string, options?: { includeInactive?: boolean }): Promise<CrmCustomField[]>;
export function createCustomField(client: QueryClient, context: CrmContext, input: Record<string, unknown>): Promise<CrmCustomField>;
export function updateCustomField(client: QueryClient, context: CrmContext, fieldId: string, input: Record<string, unknown>): Promise<CrmCustomField>;
