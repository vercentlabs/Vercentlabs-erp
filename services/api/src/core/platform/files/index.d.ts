import type { ObjectStorage } from "@vercentlabs/document-engine";

type Client = { query(text: string, values?: unknown[]): Promise<{ rows: any[] }> };
type Env = Record<string, string | undefined>;

export const FILE_ENTITY_TYPES: Readonly<Record<string, { moduleKey: string | null; purposes: readonly string[] }>>;
export function getFileEntityType(entityType: string): { moduleKey: string | null; purposes: readonly string[] } | null;

export class FileStorageError extends Error {
  status: number;
  code: string;
}
export function setObjectStorageForTests(storage: ObjectStorage | null): void;
export function resolveObjectStorage(env?: Env): Promise<ObjectStorage>;

export class FileError extends Error {
  status: number;
  code: string;
}
export type FilePurpose = "attachment" | "export" | "report_output" | "inbound_mail";
export type PreparedUpload = Readonly<{ fileName: string; mimeType: string; sizeBytes: number; bytes: Buffer; contentSha256: string; scanStatus: string }>;
export type FileMetadata = {
  id: string;
  logicalId: string;
  version: number;
  isCurrent: boolean;
  entityType: string;
  entityId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  contentSha256: string | null;
  lifecycleStatus: string;
  scanStatus: string;
  classification: string;
  purpose: FilePurpose;
  storageMode: "database_legacy" | "object";
  expiresAt: string | null;
  contentRemovedAt: string | null;
  uploadedBy: string | null;
  createdAt: string;
};
export function prepareFileUpload(input: { fileName: string; mimeType: string; bytes: Uint8Array; maximumBytes?: number; allowedTypes?: Iterable<string> }, env?: Env): Promise<PreparedUpload>;
export function storeFile(
  client: Client,
  input: { organizationId: string; entityType: string; entityId: string; prepared: PreparedUpload; uploadedBy?: string | null; purpose?: FilePurpose; replacesLogicalId?: string | null; expiresAt?: Date | string | null; classification?: string },
  options?: { storage?: ObjectStorage; env?: Env },
): Promise<FileMetadata>;
export function listFiles(client: Client, input: { organizationId: string; entityType: string; entityId: string }): Promise<FileMetadata[]>;
export function listFileVersions(client: Client, input: { organizationId: string; entityType: string; entityId: string; logicalId: string }): Promise<FileMetadata[]>;
export function getFileMetadata(client: Client, input: { organizationId: string; fileId: string }): Promise<FileMetadata | null>;
export function readFileContent(
  client: Client,
  input: { organizationId: string; entityType: string; entityId: string; fileId: string },
  options?: { storage?: ObjectStorage; env?: Env },
): Promise<{ id: string; fileName: string; mimeType: string; sizeBytes: number; contentSha256: string | null; body: Buffer }>;
export function archiveFile(client: Client, input: { organizationId: string; entityType: string; entityId: string; fileId: string; actorUserId?: string | null }): Promise<FileMetadata & { wasCurrent: boolean }>;
export function purgeExpiredFileContent(client: Client, options?: { storage?: ObjectStorage; env?: Env; limit?: number }): Promise<{ removed: number }>;
