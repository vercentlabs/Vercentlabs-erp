// Saved personal views (CRM plan 5.5): a person's own named filters on the lead list, the deal list or the pipeline — "My Pune
// leads, hot", "Closing this quarter over ₹5 lakh". A view keeps the list's query string as it was; one view per screen can open by
// default. Views are personal: nobody else sees or changes them.
import { CrmError } from "../data-management/errors.js";

const SCREENS = Object.freeze(["leads", "opportunities", "pipeline"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const invalid = (field, message) => new CrmError(400, message, "CRM_SAVED_VIEW_VALIDATION", { issues: [{ field, message }] });
const toView = (row) => ({ id: row.id, screen: row.screen, name: row.name, query: row.query, isDefault: row.is_default, updatedAt: row.updated_at });

function requireScreen(screen) {
  if (!SCREENS.includes(screen)) throw invalid("screen", "Views are for the lead list, the deal list and the pipeline.");
}
// The list's own filters only: no paging, no ids.
function cleanQuery(value) {
  const params = new URLSearchParams(String(value ?? "").replace(/^\?/, ""));
  for (const key of ["offset", "limit", "ids", "page"]) params.delete(key);
  const query = params.toString();
  if (query.length > 4000) throw invalid("query", "This view has too many filters to save.");
  return query;
}

export async function listSavedViews(client, context, screen) {
  requireScreen(screen);
  const { rows } = await client.query("SELECT * FROM tenant.crm_saved_views WHERE organization_id = $1 AND user_id = $2 AND screen = $3 ORDER BY is_default DESC, lower(name)",
    [context.organizationId, context.userId, screen]);
  return rows.map(toView);
}

// input: { screen, name, query, isDefault? } — saving under an existing name replaces that view.
export async function saveView(client, context, input = {}) {
  requireScreen(input.screen);
  const name = String(input.name ?? "").trim();
  if (!name || name.length > 60) throw invalid("name", "Name the view (up to 60 characters).");
  const count = (await client.query("SELECT count(*)::int AS n FROM tenant.crm_saved_views WHERE organization_id = $1 AND user_id = $2 AND screen = $3 AND lower(name) <> lower($4)",
    [context.organizationId, context.userId, input.screen, name])).rows[0].n;
  if (count >= 30) throw invalid("name", "Keep up to 30 views per list: delete one first.");
  if (input.isDefault)
    await client.query("UPDATE tenant.crm_saved_views SET is_default = false WHERE organization_id = $1 AND user_id = $2 AND screen = $3 AND is_default", [context.organizationId, context.userId, input.screen]);
  const existing = (await client.query("SELECT id FROM tenant.crm_saved_views WHERE organization_id = $1 AND user_id = $2 AND screen = $3 AND lower(name) = lower($4)",
    [context.organizationId, context.userId, input.screen, name])).rows[0];
  const row = existing
    ? (await client.query("UPDATE tenant.crm_saved_views SET name = $2, query = $3, is_default = $4, updated_at = now() WHERE id = $1 RETURNING *", [existing.id, name, cleanQuery(input.query), Boolean(input.isDefault)])).rows[0]
    : (await client.query("INSERT INTO tenant.crm_saved_views (organization_id, user_id, screen, name, query, is_default) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *",
      [context.organizationId, context.userId, input.screen, name, cleanQuery(input.query), Boolean(input.isDefault)])).rows[0];
  return toView(row);
}

// input: { isDefault } — the view that opens by default (only one per screen), or none.
export async function setDefaultView(client, context, viewId, isDefault) {
  const view = UUID.test(String(viewId ?? "")) ? (await client.query("SELECT * FROM tenant.crm_saved_views WHERE organization_id = $1 AND user_id = $2 AND id = $3",
    [context.organizationId, context.userId, viewId])).rows[0] : null;
  if (!view) throw new CrmError(404, "View not found.", "CRM_SAVED_VIEW_NOT_FOUND");
  if (isDefault)
    await client.query("UPDATE tenant.crm_saved_views SET is_default = false WHERE organization_id = $1 AND user_id = $2 AND screen = $3 AND is_default", [context.organizationId, context.userId, view.screen]);
  return toView((await client.query("UPDATE tenant.crm_saved_views SET is_default = $2, updated_at = now() WHERE id = $1 RETURNING *", [view.id, Boolean(isDefault)])).rows[0]);
}

export async function deleteSavedView(client, context, viewId) {
  if (!UUID.test(String(viewId ?? ""))) throw new CrmError(404, "View not found.", "CRM_SAVED_VIEW_NOT_FOUND");
  const { rowCount } = await client.query("DELETE FROM tenant.crm_saved_views WHERE organization_id = $1 AND user_id = $2 AND id = $3", [context.organizationId, context.userId, viewId]);
  if (!rowCount) throw new CrmError(404, "View not found.", "CRM_SAVED_VIEW_NOT_FOUND");
  return { deleted: true };
}
