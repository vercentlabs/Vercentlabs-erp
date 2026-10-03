import "server-only";

import { HttpError, readJson } from "@/core/http";

// Request and response helpers shared by the lead routes under
// /api/crm/leads. Each route itself is a thin shell: workspaceRoute
// authenticates and opens the tenant transaction, then the route calls one
// lead operation from @vercentlabs/api/crm, which owns every business rule.
export type LeadRouteParams = { params: Promise<{ id: string }> };

export async function readBody(request: Request): Promise<Record<string, unknown>> {
  const body = await readJson(request);
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new HttpError(400, "Invalid request.");
  return body as Record<string, unknown>;
}

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

// The uploaded import file (multipart field "file") and the other form fields.
export async function readUpload(request: Request) {
  const form = await request.formData().catch(() => {
    throw new HttpError(400, "Upload a CSV or XLSX file.");
  });
  const file = form.get("file");
  if (!(file instanceof File)) throw new HttpError(400, "Upload a CSV or XLSX file.");
  if (file.size > MAX_UPLOAD_BYTES) throw new HttpError(413, "The file is larger than 5 MB.");
  if (!/\.(csv|xlsx)$/i.test(file.name)) throw new HttpError(400, "Upload a .csv or .xlsx file.");
  return {
    bytes: Buffer.from(await file.arrayBuffer()),
    fileName: file.name.slice(0, 240),
    field: (name: string) => {
      const value = form.get(name);
      return typeof value === "string" ? value : "";
    },
  };
}

export function csvResponse(csv: string, fileName: string) {
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

const FILTER_KEYS = [
  "view", "search", "status", "stage", "priority", "rating", "ownerId", "teamId", "sourceId", "tagId",
  "createdFrom", "createdTo", "qualificationStatus", "disqualificationReason", "countryCode", "state", "city", "productInterest", "olderThanDays", "assignedFrom", "assignedTo", "sortBy", "sortDirection",
] as const;

// The list filters accepted from the query string (list and export).
export function leadFiltersFromUrl(url: URL) {
  const filters: Record<string, unknown> = {};
  for (const key of FILTER_KEYS) {
    const value = url.searchParams.get(key);
    if (value) filters[key] = value;
  }
  for (const key of ["limit", "offset"]) {
    const value = url.searchParams.get(key);
    if (value) filters[key] = Number(value);
  }
  return filters;
}
