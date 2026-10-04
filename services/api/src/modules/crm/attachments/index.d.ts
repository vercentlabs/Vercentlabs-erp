import type { CrmContext } from "@vercentlabs/shared-types";
import type { ObjectStorage } from "@vercentlabs/document-engine";

type QueryClient = {
  query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }>;
};
type Input = Record<string, unknown>;
type StorageOptions = { storage?: ObjectStorage; env?: Record<string, string | undefined> };

export type CrmAttachment = {
  id: string; relatedType: string; relatedId: string; noteId: string | null; noteTitle: string | null; fileName: string; originalFileName: string;
  description: string | null; mimeType: string; kind: "image" | "document" | "spreadsheet" | "presentation" | "other"; preview: "pdf" | "image" | "text" | null;
  sizeBytes: number; uploadedBy: string | null; uploadedByName: string | null; uploadedAt: string; fromLead: { id: string; code: string } | null;
  canDownload: boolean; canEdit: boolean; canDelete: boolean;
};
export type PreparedAttachment = Readonly<{ fileName: string; mimeType: string; sizeBytes: number; bytes: Buffer; contentSha256: string; scanStatus: string }>;

export const CRM_FILE_TYPES: Readonly<Record<string, { mimeType: string; kind: string; preview?: string }>>;
export const CRM_ALLOWED_EXTENSIONS: ReadonlyArray<string>;
export const CRM_ALLOWED_MIME_TYPES: ReadonlyArray<string>;
export function crmAttachmentMaxBytes(env?: Record<string, string | undefined>): number;
export function fileTypeOf(fileName: string): ({ extension: string; mimeType: string; kind: string; preview?: string }) | null;

export function listAttachments(client: QueryClient, context: CrmContext, relatedType: string, relatedId: string, options?: { kind?: string | null; sortBy?: string; search?: string; noteId?: string | null }): Promise<CrmAttachment[]>;
export function getAttachment(client: QueryClient, context: CrmContext, attachmentId: string): Promise<CrmAttachment>;
export function prepareAttachmentUpload(input: { fileName: string; bytes: Buffer | Uint8Array }, env?: Record<string, string | undefined>): Promise<PreparedAttachment>;
export function uploadAttachment(client: QueryClient, context: CrmContext, relatedType: string, relatedId: string, input: Input & { prepared: PreparedAttachment }, options?: StorageOptions): Promise<CrmAttachment>;
export function downloadAttachment(client: QueryClient, context: CrmContext, attachmentId: string, input?: { inline?: boolean }, options?: StorageOptions): Promise<{ fileName: string; mimeType: string; body: Buffer; inline: boolean; preview: string | null }>;
export function getAttachmentPreview(client: QueryClient, context: CrmContext, attachmentId: string, options?: StorageOptions): Promise<{ fileName: string; mimeType: string; body: Buffer; inline: boolean; preview: string | null }>;
export function updateAttachment(client: QueryClient, context: CrmContext, attachmentId: string, input?: Input): Promise<CrmAttachment>;
export function deleteAttachment(client: QueryClient, context: CrmContext, attachmentId: string): Promise<{ deleted: boolean }>;

// Files across every record the caller can see (the Notes & Files page).
export function searchAttachments(client: QueryClient, context: CrmContext, filters?: { search?: string; kind?: string; relatedType?: string; uploadedBy?: string; limit?: number; offset?: number }):
  Promise<{ attachments: Array<CrmAttachment & { relatedName: string | null }>; total: number; limit: number; offset: number }>;
