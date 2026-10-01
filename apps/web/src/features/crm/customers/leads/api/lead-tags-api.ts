"use client";

import { CrmApiError } from "../../../shared/http/crm-api-error.ts";
import { crmApiClient } from "../../../shared/http/crm-request.ts";

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

export class TagApiError extends CrmApiError {}

const { request } = crmApiClient(TagApiError);

export async function listLeadTags(
  leadId: string,
): Promise<{ rows: CrmRecordTag[] }> {
  return request(`/api/crm/leads/${leadId}/tags`);
}

export async function assignLeadTag(
  leadId: string,
  tagId: string,
): Promise<{ rows: CrmRecordTag[] }> {
  return request(`/api/crm/leads/${leadId}/tags`, {
    method: "POST",
    json: { tagId },
  });
}

export async function removeLeadTag(
  leadId: string,
  tagId: string,
): Promise<{ rows: CrmRecordTag[] }> {
  return request(`/api/crm/leads/${leadId}/tags/${tagId}`, {
    method: "DELETE",
  });
}

// The tag DEFINITIONS library already goes through the generic
// /api/crm/[resource] boundary (see CRM Setup's own
// custom-fields-and-tags-api.ts) — reused here for the picker rather
// than inventing a second tag-definitions read path.
export async function listTagDefinitions(): Promise<{
  rows: CrmTagDefinition[];
}> {
  return request("/api/crm/tags?status=active&limit=100");
}
