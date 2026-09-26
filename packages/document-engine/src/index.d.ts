export function sanitizeFileName(value: unknown): string;
export function validateAttachment(input: { fileName: string; mimeType: string; sizeBytes: number }, options?: { maximumBytes?: number; allowedTypes?: Iterable<string> }): Readonly<{ fileName: string; mimeType: string; sizeBytes: number }>;
export function attachmentStorageKey(input: { organizationId: string; attachmentId?: string; fileName: string }): string;
export function sha256(content: string | ArrayBufferView): string;
export function assertAttachmentTransition(current: string, next: string): string;
export type ObjectStorage = Readonly<{
  name: string;
  put(key: string, bytes: Uint8Array, options?: { contentType?: string }): Promise<{ key: string; size: number }>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
  head(key: string): Promise<{ size: number; contentType: string | null } | null>;
}>;
export function assertStorageKey(key: unknown): string;
export function defineObjectStorage(adapter: Omit<ObjectStorage, never>): ObjectStorage;
export function createMemoryObjectStorage(): ObjectStorage;
export function createLocalObjectStorage(options: { root: string }): Promise<ObjectStorage>;
