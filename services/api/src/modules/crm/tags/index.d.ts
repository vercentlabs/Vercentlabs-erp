import type { CrmContext } from "@vercentlabs/shared-types";

type QueryClient = { query: (text: string, values?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> };

export type CrmTagColor = "neutral" | "blue" | "green" | "amber" | "red" | "purple" | "teal";
export type CrmTag = { id: string; name: string; color: CrmTagColor; leadCount?: number; dealCount?: number };
export const TAG_COLORS: ReadonlyArray<CrmTagColor>;
export function listTags(client: QueryClient, context: CrmContext, options?: { withCounts?: boolean }): Promise<CrmTag[]>;
export function tagsByRecord(client: QueryClient, organizationId: string, entityType: "lead" | "opportunity", entityIds: string[]): Promise<Map<string, CrmTag[]>>;
export function setRecordTags(client: QueryClient, context: CrmContext, entityType: "lead" | "opportunity", entityId: string, tags: Array<{ id?: string; name?: string } | string>): Promise<CrmTag[]>;
export function copyLeadTagsToDeal(client: QueryClient, organizationId: string, leadId: string, opportunityId: string, userId?: string | null): Promise<void>;
export function createTag(client: QueryClient, context: CrmContext, input: { name: string; color?: CrmTagColor }): Promise<CrmTag>;
export function updateTag(client: QueryClient, context: CrmContext, tagId: string, input: { name?: string; color?: CrmTagColor }): Promise<CrmTag>;
export function deleteTag(client: QueryClient, context: CrmContext, tagId: string): Promise<{ deleted: true }>;
