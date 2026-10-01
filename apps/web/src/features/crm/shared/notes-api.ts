"use client";

import { CrmApiError } from "../shared/http/crm-api-error.ts";
import { crmApiClient } from "../shared/http/crm-request.ts";

// F017 Notes — one shared client for every 360 that embeds a NotesPanel
// (Lead/Account/Contact/Opportunity), not a per-feature duplicate.
export type CrmNote = {
  id: string;
  entityType: string;
  entityId: string;
  body: string;
  isPinned: boolean;
  visibility: "shared" | "private";
  version: number;
  createdBy: string;
  createdByName?: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export class NoteApiError extends CrmApiError {}

const { request, parseResponse } = crmApiClient(NoteApiError);

export async function listNotes(
  entityType: string,
  entityId: string,
): Promise<{ notes: CrmNote[] }> {
  const params = new URLSearchParams({ entityType, entityId });
  return request(`/api/crm/notes?${params.toString()}`);
}

export async function createNote(
  entityType: string,
  entityId: string,
  body: string,
  visibility: "shared" | "private" = "shared",
): Promise<{ note: CrmNote }> {
  return request("/api/crm/notes", {
    method: "POST",
    json: { entityType, entityId, body, visibility },
  });
}

export type NotePatch = {
  body?: string;
  isPinned?: boolean;
  visibility?: "shared" | "private";
};

export async function updateNote(
  id: string,
  patch: NotePatch,
  expectedVersion: number,
): Promise<{ note: CrmNote }> {
  return request(`/api/crm/notes/${id}`, {
    method: "PATCH",
    json: { ...patch, expectedVersion },
  });
}

export async function archiveNote(
  id: string,
  expectedVersion: number,
): Promise<{ note: CrmNote }> {
  const response = await fetch(
    `/api/crm/notes/${id}?expectedVersion=${expectedVersion}`,
    { method: "DELETE" },
  );
  return parseResponse(response);
}

// F017 gap-closure — listCrmNoteVersions (a Note's append-only edit history)
// existed with no route or UI. Each row is a PRIOR version; the current text
// is the note itself.
export type NoteVersion = {
  id: string;
  version: number;
  body: string;
  isPinned: boolean;
  visibility: "shared" | "private" | null;
  actorName: string | null;
  createdAt: string;
};

export async function listNoteVersions(
  id: string,
): Promise<{ versions: NoteVersion[] }> {
  return request(`/api/crm/notes/${id}/versions`);
}
