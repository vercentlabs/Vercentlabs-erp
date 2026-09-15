"use client";

// tenant.crm_saved_views rows via the generic /api/crm/[resource]
// boundary (resource="saved-views"). Deliberately NOT added to
// resource-permissions.ts's RESOURCE_MANAGE_PERMISSIONS map — the
// generic route falls back to module-access-only (crm.view) for any
// resource missing from that map, which is the correct floor here:
// record-policy.js's recordScope() hard-scopes every saved-views read/
// write to `record.user_id = context.userId` at the SQL level (and
// resource-mutation-service.js forces userId=context.userId on create,
// strips any client-supplied userId on update), so this is inherently a
// personal resource — no organizational "manage" permission tier applies,
// any CRM user manages only their own saved views.
export type CrmSavedView = {
  id: string;
  userId: string;
  resource: string;
  name: string;
  filters: Record<string, unknown>;
  sort: Record<string, unknown> | null;
  columns: string[] | null;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
};

export class SavedViewApiError extends Error {
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
    throw new SavedViewApiError(payload.message || "The request could not be completed.", response.status, payload.code);
  }
  return payload;
}

// The generic /api/crm/[resource] list route's LIST_FILTER_KEYS has no
// "resource" filter key (it wasn't extended for this — a deliberate,
// minimal-touch choice over widening a filter list every other
// CRM_RESOURCE_KEYS entry also reads), so this fetches every one of the
// caller's saved views (a small, personal dataset — see the type above)
// and filters by the row's own `resource` column client-side.
export async function listSavedViews(resource: string): Promise<{ rows: CrmSavedView[] }> {
  const response = await fetch(`/api/crm/saved-views?limit=100`);
  const payload = await parseResponse<{ rows: CrmSavedView[] }>(response);
  return { rows: payload.rows.filter((row) => row.resource === resource) };
}

export async function createSavedView(input: { resource: string; name: string; filters: Record<string, unknown>; isDefault?: boolean }): Promise<{ record: CrmSavedView }> {
  const response = await fetch("/api/crm/saved-views", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return parseResponse(response);
}

export async function deleteSavedView(id: string, expectedUpdatedAt: string): Promise<{ id: string; deleted: boolean }> {
  const response = await fetch(`/api/crm/saved-views/${id}?expectedUpdatedAt=${encodeURIComponent(expectedUpdatedAt)}`, { method: "DELETE" });
  return parseResponse(response);
}
