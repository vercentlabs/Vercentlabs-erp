"use client";

export type CrmRecordTag = {
  tagId: string;
  name: string;
  color: string;
  assignedAt: string;
};

export type CrmTagDefinition = {
  id: string;
  name: string;
  color: string | null;
  status: "active" | "inactive";
};

export class TagApiError extends Error {
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
    throw new TagApiError(payload.message || "The request could not be completed.", response.status, payload.code);
  }
  return payload;
}

export async function listLeadTags(leadId: string): Promise<{ rows: CrmRecordTag[] }> {
  const response = await fetch(`/api/crm/leads/${leadId}/tags`);
  return parseResponse(response);
}

export async function assignLeadTag(leadId: string, tagId: string): Promise<{ rows: CrmRecordTag[] }> {
  const response = await fetch(`/api/crm/leads/${leadId}/tags`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tagId }),
  });
  return parseResponse(response);
}

export async function removeLeadTag(leadId: string, tagId: string): Promise<{ rows: CrmRecordTag[] }> {
  const response = await fetch(`/api/crm/leads/${leadId}/tags/${tagId}`, { method: "DELETE" });
  return parseResponse(response);
}

// The tag DEFINITIONS library already goes through the generic
// /api/crm/[resource] boundary (see CRM Setup's own
// custom-fields-and-tags-api.ts) — reused here for the picker rather
// than inventing a second tag-definitions read path.
export async function listTagDefinitions(): Promise<{ rows: CrmTagDefinition[] }> {
  const response = await fetch("/api/crm/tags?status=active&limit=100");
  return parseResponse(response);
}
