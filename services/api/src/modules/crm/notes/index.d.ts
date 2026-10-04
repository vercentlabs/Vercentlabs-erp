import type { CrmContext } from "@vercentlabs/shared-types";

type QueryClient = {
  query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }>;
};
type Input = Record<string, unknown>;
export type CrmRecordType = "lead" | "party" | "contact" | "opportunity";

export type CrmNote = {
  id: string; relatedType: CrmRecordType; relatedId: string; title: string | null; bodyHtml: string; bodyText: string; isPinned: boolean;
  visibility: "shared" | "private"; version: number; attachmentCount: number; createdBy: string | null; createdByName: string | null; createdAt: string;
  updatedByName: string | null; updatedAt: string; edited: boolean; fromLead: { id: string; code: string } | null; canEdit: boolean; canDelete: boolean; canPin: boolean;
};
export type CrmContentEvent = { id: string; subjectType: "note" | "attachment"; subjectId: string; eventType: string; summary: string; createdAt: string; actorName: string | null };

export const NOTE_PERMISSIONS: Readonly<Record<"view" | "create" | "editOwn" | "editAll" | "deleteOwn" | "deleteAll" | "pin", string>>;
export const ATTACHMENT_PERMISSIONS: Readonly<Record<"view" | "upload" | "download" | "delete", string>>;
export const RECORD_TYPES: ReadonlyArray<CrmRecordType>;
export function contentCan(context: CrmContext, permission: string): boolean;
export function recordVisible(client: QueryClient, context: CrmContext, type: string, id: string): Promise<boolean>;

export function listNotes(client: QueryClient, context: CrmContext, relatedType: string, relatedId: string, options?: { search?: string }): Promise<CrmNote[]>;
export function getNote(client: QueryClient, context: CrmContext, noteId: string): Promise<CrmNote>;
export function createNote(client: QueryClient, context: CrmContext, relatedType: string, relatedId: string, input?: Input): Promise<CrmNote>;
export function updateNote(client: QueryClient, context: CrmContext, noteId: string, input?: Input): Promise<CrmNote>;
export function setNotePinned(client: QueryClient, context: CrmContext, noteId: string, pinned: boolean, options?: { expectedVersion?: number }): Promise<CrmNote>;
export function pinNote(client: QueryClient, context: CrmContext, noteId: string, options?: { expectedVersion?: number }): Promise<CrmNote>;
export function unpinNote(client: QueryClient, context: CrmContext, noteId: string, options?: { expectedVersion?: number }): Promise<CrmNote>;
export function deleteNote(client: QueryClient, context: CrmContext, noteId: string, options?: { expectedVersion?: number }): Promise<{ deleted: boolean }>;
export function listNoteVersions(client: QueryClient, context: CrmContext, noteId: string): Promise<Array<{ version: number; bodyText: string; replacedAt: string; replacedByName: string | null }>>;
export function listContentHistory(client: QueryClient, context: CrmContext, relatedType: string, relatedId: string): Promise<CrmContentEvent[]>;
export function sanitizeNoteHtml(input: unknown): string;
export function noteHtmlToText(html: unknown): string;

// Notes across every record the caller can see (the Notes & Files page).
export function searchNotes(client: QueryClient, context: CrmContext, filters?: { search?: string; relatedType?: string; createdBy?: string; createdFrom?: string; createdTo?: string; pinned?: boolean | string; limit?: number; offset?: number }):
  Promise<{ notes: Array<CrmNote & { relatedName: string | null }>; total: number; limit: number; offset: number }>;
