import type { CrmContext, QueryClient } from "../../../index.js";

export type CrmAttachmentEntityType = "lead" | "opportunity" | "party" | "contact" | "campaign";

export type CrmAttachment = {
  id: string;
  logicalId: string;
  version: number;
  isCurrent?: boolean;
  fileName: string;
  mimeType: string | null;
  sizeBytes: number | null;
  lifecycleStatus?: string;
  scanStatus?: string;
  uploadedBy: string | null;
  createdAt: string;
};

export function crmAttachmentStorageEntityType(entityType: CrmAttachmentEntityType): string;

export function listCrmAttachments(
  client: QueryClient,
  context: CrmContext,
  entityType: CrmAttachmentEntityType,
  entityId: string,
): Promise<CrmAttachment[]>;

export function listCrmAttachmentVersions(
  client: QueryClient,
  context: CrmContext,
  entityType: CrmAttachmentEntityType,
  entityId: string,
  logicalId: string,
): Promise<CrmAttachment[]>;

export function createCrmAttachment(
  client: QueryClient,
  context: CrmContext,
  entityType: CrmAttachmentEntityType,
  entityId: string,
  input: {
    id: string;
    fileName: string;
    storageKey: string;
    mimeType: string;
    sizeBytes: number;
    content: Buffer | Uint8Array;
    contentSha256: string;
    scanStatus: string;
    replacesLogicalId?: string;
  },
): Promise<CrmAttachment>;

export function getCrmAttachmentContent(
  client: QueryClient,
  context: CrmContext,
  entityType: CrmAttachmentEntityType,
  entityId: string,
  attachmentId: string,
): Promise<{ file_name: string; mime_type: string | null; size_bytes: number | null; content: Buffer }>;

export function deleteCrmAttachment(
  client: QueryClient,
  context: CrmContext,
  entityType: CrmAttachmentEntityType,
  entityId: string,
  attachmentId: string,
): Promise<CrmAttachment>;
