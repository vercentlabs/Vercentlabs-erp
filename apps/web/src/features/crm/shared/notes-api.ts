"use client";

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

export class NoteApiError extends Error {
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
    throw new NoteApiError(payload.message || "The request could not be completed.", response.status, payload.code);
  }
  return payload;
}

export async function listNotes(entityType: string, entityId: string): Promise<{ notes: CrmNote[] }> {
  const params = new URLSearchParams({ entityType, entityId });
  const response = await fetch(`/api/crm/notes?${params.toString()}`);
  return parseResponse(response);
}

export async function createNote(entityType: string, entityId: string, body: string, visibility: "shared" | "private" = "shared"): Promise<{ note: CrmNote }> {
  const response = await fetch("/api/crm/notes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entityType, entityId, body, visibility }),
  });
  return parseResponse(response);
}

export type NotePatch = { body?: string; isPinned?: boolean; visibility?: "shared" | "private" };

export async function updateNote(id: string, patch: NotePatch, expectedVersion: number): Promise<{ note: CrmNote }> {
  const response = await fetch(`/api/crm/notes/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...patch, expectedVersion }),
  });
  return parseResponse(response);
}

export async function archiveNote(id: string, expectedVersion: number): Promise<{ note: CrmNote }> {
  const response = await fetch(`/api/crm/notes/${id}?expectedVersion=${expectedVersion}`, { method: "DELETE" });
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

export async function listNoteVersions(id: string): Promise<{ versions: NoteVersion[] }> {
  const response = await fetch(`/api/crm/notes/${id}/versions`);
  return parseResponse(response);
}
