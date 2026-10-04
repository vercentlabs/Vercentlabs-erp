"use client";

// Browser client for the CRM note and attachment routes. A failed request
// throws ContentApiError with the server's message and code.
import { CrmApiErrorWithBody } from "@/features/crm/shared/http/crm-api-error";
import { crmApiClient } from "@/features/crm/shared/http/crm-request";

export class ContentApiError extends CrmApiErrorWithBody {}

const { request } = crmApiClient(ContentApiError, "body");

export type CrmRecordType = "lead" | "party" | "contact" | "opportunity";

export type CrmNote = {
  id: string; relatedType: CrmRecordType; relatedId: string; title: string | null; bodyHtml: string; bodyText: string; isPinned: boolean;
  visibility: "shared" | "private"; version: number; attachmentCount: number; createdBy: string | null; createdByName: string | null; createdAt: string;
  updatedByName: string | null; updatedAt: string; edited: boolean; fromLead: { id: string; code: string } | null; canEdit: boolean; canDelete: boolean; canPin: boolean;
};
export type CrmContentEvent = { id: string; subjectType: "note" | "attachment"; subjectId: string; eventType: string; summary: string; createdAt: string; actorName: string | null };
export type CrmAttachment = {
  id: string; relatedType: string; relatedId: string; noteId: string | null; noteTitle: string | null; fileName: string; originalFileName: string;
  description: string | null; mimeType: string; kind: "image" | "document" | "spreadsheet" | "presentation" | "other"; preview: "pdf" | "image" | "text" | null;
  sizeBytes: number; uploadedBy: string | null; uploadedByName: string | null; uploadedAt: string; fromLead: { id: string; code: string } | null;
  canDownload: boolean; canEdit: boolean; canDelete: boolean;
};

function query(params: Record<string, unknown>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
  const text = search.toString();
  return text ? `?${text}` : "";
}

// ---- notes
export const listNotes = (relatedType: CrmRecordType, relatedId: string, search?: string) =>
  request<{ notes: CrmNote[] }>(`/api/crm/notes${query({ relatedType, relatedId, search })}`).then((result) => result.notes);
export const createNote = (input: { relatedType: CrmRecordType; relatedId: string; body: string; title?: string; isPinned?: boolean; visibility?: "shared" | "private" }) =>
  request<{ note: CrmNote }>("/api/crm/notes", { method: "POST", json: input }).then((result) => result.note);
export const updateNote = (id: string, input: { body?: string; title?: string; visibility?: "shared" | "private"; expectedVersion: number }) =>
  request<{ note: CrmNote }>(`/api/crm/notes/${id}`, { method: "PATCH", json: input }).then((result) => result.note);
export const pinNote = (id: string, pinned: boolean, expectedVersion?: number) =>
  request<{ note: CrmNote }>(`/api/crm/notes/${id}/pin`, { method: "POST", json: { pinned, expectedVersion } }).then((result) => result.note);
export const deleteNote = (id: string, expectedVersion?: number) => request<{ deleted: boolean }>(`/api/crm/notes/${id}${query({ expectedVersion })}`, { method: "DELETE" });
export const listNoteVersions = (id: string) =>
  request<{ versions: Array<{ version: number; bodyText: string; replacedAt: string; replacedByName: string | null }> }>(`/api/crm/notes/${id}/versions`).then((result) => result.versions);
export const listContentHistory = (relatedType: CrmRecordType, relatedId: string) =>
  request<{ history: CrmContentEvent[] }>(`/api/crm/notes/history${query({ relatedType, relatedId })}`).then((result) => result.history);

// ---- attachments
export const listAttachments = (relatedType: CrmRecordType, relatedId: string, filters: { kind?: string; sortBy?: string; noteId?: string } = {}) =>
  request<{ attachments: CrmAttachment[] }>(`/api/crm/attachments${query({ relatedType, relatedId, ...filters })}`).then((result) => result.attachments);
export const updateAttachment = (id: string, input: { displayName?: string; description?: string }) =>
  request<{ attachment: CrmAttachment }>(`/api/crm/attachments/${id}`, { method: "PATCH", json: input }).then((result) => result.attachment);
export const deleteAttachment = (id: string) => request<{ deleted: boolean }>(`/api/crm/attachments/${id}`, { method: "DELETE" });
export const attachmentDownloadUrl = (id: string, inline = false) => `/api/crm/attachments/${id}/download${inline ? "?inline=1" : ""}`;

// Uploads one file with progress. The key makes a retried upload return the first file.
export function uploadAttachment(
  input: { relatedType: CrmRecordType; relatedId: string; file: File; description?: string; noteId?: string; idempotencyKey: string },
  onProgress?: (fraction: number) => void,
): Promise<CrmAttachment> {
  const form = new FormData();
  form.set("file", input.file);
  form.set("relatedType", input.relatedType);
  form.set("relatedId", input.relatedId);
  form.set("idempotencyKey", input.idempotencyKey);
  if (input.description) form.set("description", input.description);
  if (input.noteId) form.set("noteId", input.noteId);
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/crm/attachments");
    xhr.responseType = "json";
    xhr.upload.onprogress = (event) => { if (event.lengthComputable) onProgress?.(event.loaded / event.total); };
    xhr.onload = () => {
      const body = xhr.response as { ok?: boolean; attachment?: CrmAttachment; data?: { attachment?: CrmAttachment }; message?: string; code?: string } | null;
      const attachment = body?.attachment ?? body?.data?.attachment;
      if (xhr.status >= 200 && xhr.status < 300 && attachment) resolve(attachment);
      else reject(new ContentApiError(body?.message || "The file could not be uploaded.", xhr.status, body?.code, body ?? {}));
    };
    xhr.onerror = () => reject(new ContentApiError("The upload failed. Check your connection and try again.", 0));
    xhr.send(form);
  });
}

export function errorMessage(error: unknown, fallback = "Something went wrong. Try again.") {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// ---- across records (the Notes & Files page)
export type LibraryNote = CrmNote & { relatedName: string | null };
export type LibraryAttachment = CrmAttachment & { relatedName: string | null };
export const searchNotes = (filters: { search?: string; relatedType?: string; createdBy?: string; createdFrom?: string; createdTo?: string; pinned?: string; limit?: number; offset?: number } = {}) =>
  request<{ notes: LibraryNote[]; total: number; limit: number; offset: number }>(`/api/crm/notes/library${query(filters)}`);
export const searchAttachments = (filters: { search?: string; kind?: string; relatedType?: string; uploadedBy?: string; limit?: number; offset?: number } = {}) =>
  request<{ attachments: LibraryAttachment[]; total: number; limit: number; offset: number }>(`/api/crm/attachments/library${query(filters)}`);

// Where a note or file lives: the record it belongs to.
export const RELATED_TYPE_LABELS: Record<string, string> = { lead: "Lead", party: "Account", contact: "Contact", opportunity: "Opportunity" };
export const relatedRecordHref = (relatedType: string, relatedId: string, tab?: "notes" | "attachments") =>
  `/crm/${{ lead: "leads", party: "accounts", contact: "contacts", opportunity: "opportunities" }[relatedType] ?? "leads"}/${relatedId}${tab ? `?tab=${tab}` : ""}`;
