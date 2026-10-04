import "server-only";

import { HttpError } from "@/core/http";

export { readBody } from "@/features/crm/leads/server/lead-http";

// Request helpers shared by the note and attachment routes. Each route is a
// thin shell: the note and attachment operations in @vercentlabs/api/crm own
// every permission, parent-record and file rule.
export type ContentRouteParams = { params: Promise<{ id: string }> };

// The record a list belongs to: ?relatedType=lead|party|contact|opportunity&relatedId=…
export function relatedRecordFromUrl(url: URL) {
  const relatedType = url.searchParams.get("relatedType");
  const relatedId = url.searchParams.get("relatedId");
  if (!relatedType || !relatedId) throw new HttpError(400, "relatedType and relatedId are required.");
  return { relatedType, relatedId };
}

export function optionalNumber(value: unknown) {
  if (value === undefined || value === null || value === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

// Content-Disposition with an ASCII fallback and the UTF-8 name (RFC 6266).
export function contentDisposition(kind: "inline" | "attachment", fileName: string) {
  const safe = fileName.replace(/[\r\n"\\]/g, "").trim() || "file";
  const ascii = safe.replace(/[^\x20-\x7e]/g, "_");
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}
