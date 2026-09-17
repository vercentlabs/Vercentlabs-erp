import type { CrmContext, QueryClient } from "../index.js";

export type CrmTagAssignmentEntityType = "lead";

export type CrmRecordTag = {
  tagId: string;
  name: string;
  color: string;
  assignedAt: string;
};

export function listRecordTags(
  client: QueryClient,
  context: CrmContext,
  entityType: CrmTagAssignmentEntityType,
  entityId: string,
): Promise<CrmRecordTag[]>;

export function assignRecordTag(
  client: QueryClient,
  context: CrmContext,
  entityType: CrmTagAssignmentEntityType,
  entityId: string,
  tagId: string,
): Promise<CrmRecordTag[]>;

export function removeRecordTag(
  client: QueryClient,
  context: CrmContext,
  entityType: CrmTagAssignmentEntityType,
  entityId: string,
  tagId: string,
): Promise<CrmRecordTag[]>;
