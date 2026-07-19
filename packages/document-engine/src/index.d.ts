export function sanitizeFileName(value: unknown): string;
export function validateAttachment(input: { fileName: string; mimeType: string; sizeBytes: number }, options?: { maximumBytes?: number; allowedTypes?: Iterable<string> }): Readonly<{ fileName: string; mimeType: string; sizeBytes: number }>;
export function attachmentStorageKey(input: { organizationId: string; attachmentId?: string; fileName: string }): string;
export function sha256(content: string | ArrayBufferView): string;
export function assertAttachmentTransition(current: string, next: string): string;
export function createStorageAdapter(adapter: { createUpload(...args: unknown[]): unknown; createDownload(...args: unknown[]): unknown; remove(...args: unknown[]): unknown }): Readonly<Record<string, Function>>;
