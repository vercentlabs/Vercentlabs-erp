"use client";

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

export class AttachmentApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
  }
}

async function parseResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    throw new AttachmentApiError(payload.message || "The request could not be completed.", response.status, payload.code);
  }
  return payload;
}

export async function listAttachments(entityType: CrmAttachmentEntityType, entityId: string): Promise<{ rows: CrmAttachment[] }> {
  const response = await fetch(`/api/crm/attachments/${entityType}/${entityId}`);
  return parseResponse(response);
}

export async function listAttachmentVersions(entityType: CrmAttachmentEntityType, entityId: string, logicalId: string): Promise<{ rows: CrmAttachment[] }> {
  const response = await fetch(`/api/crm/attachments/${entityType}/${entityId}/${logicalId}/versions`);
  return parseResponse(response);
}

export async function uploadAttachment(
  entityType: CrmAttachmentEntityType,
  entityId: string,
  file: File,
  replacesLogicalId?: string,
): Promise<{ record: CrmAttachment }> {
  const form = new FormData();
  form.set("file", file);
  if (replacesLogicalId) form.set("replacesLogicalId", replacesLogicalId);
  const response = await fetch(`/api/crm/attachments/${entityType}/${entityId}`, { method: "POST", body: form });
  return parseResponse(response);
}

export async function deleteAttachment(entityType: CrmAttachmentEntityType, entityId: string, id: string): Promise<{ record: CrmAttachment }> {
  const response = await fetch(`/api/crm/attachments/${entityType}/${entityId}/${id}`, { method: "DELETE" });
  return parseResponse(response);
}

export function attachmentDownloadHref(entityType: CrmAttachmentEntityType, entityId: string, id: string): string {
  return `/api/crm/attachments/${entityType}/${entityId}/${id}/download`;
}

export function formatFileSize(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes)) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
