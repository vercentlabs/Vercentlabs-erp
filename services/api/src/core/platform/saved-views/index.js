// Saved list views (Shared Platform plan 5): on any list, a person names the filters, search, sort and grouping they use often and
// opens them again in one click — their own, or shared with the whole company (shared views are made by those who manage the
// company). One view per list may open by default. `state` is the list screen's own description of itself (opaque here).
const LIST_KEY = /^[a-z0-9._-]{1,80}$/;
const MAX_STATE = 8000;

export class SavedListViewError extends Error {
  constructor(status, message, code = "SAVED_VIEW_INVALID", field = null) {
    super(message);
    this.name = "SavedListViewError";
    this.status = status;
    this.code = code;
    if (field) this.details = { field };
  }
}

const viewOf = (row, userId) => ({ id: row.id, listKey: row.list_key, name: row.name, state: row.state ?? {}, shared: row.shared, isDefault: row.is_default, mine: row.user_id === userId,
  ownerName: row.owner_name ?? null, updatedAt: row.updated_at });
const listKeyOf = (value) => {
  const key = String(value ?? "").trim().toLowerCase();
  if (!LIST_KEY.test(key)) throw new SavedListViewError(400, "Unknown list.", "SAVED_VIEW_LIST_INVALID", "listKey");
  return key;
};
const canShare = (session) => (session.roleSlugs ?? []).includes("organization_owner") || (session.permissions ?? []).includes("organization.manage");

// The person's own views and the company's shared ones, for one list.
export async function listSavedListViews(client, session, listKey) {
  const key = listKeyOf(listKey);
  const rows = (await client.query(
    `SELECT saved.*, owner.full_name AS owner_name FROM public.saved_list_views saved LEFT JOIN public.users owner ON owner.id = saved.user_id
      WHERE saved.organization_id = $1 AND saved.list_key = $2 AND (saved.user_id = $3 OR saved.shared) ORDER BY saved.shared, lower(saved.name)`,
    [session.organizationId, key, session.userId])).rows;
  return { views: rows.map((row) => viewOf(row, session.userId)), canShare: canShare(session) };
}

// Saves under a name (the same name replaces the person's view). input: { listKey, name, state, shared?, isDefault? }
export async function saveSavedListView(client, session, input = {}) {
  const key = listKeyOf(input.listKey);
  const name = String(input.name ?? "").trim().slice(0, 80);
  if (!name) throw new SavedListViewError(400, "Give the view a name.", "SAVED_VIEW_INVALID", "name");
  const state = input.state && typeof input.state === "object" && !Array.isArray(input.state) ? input.state : {};
  if (JSON.stringify(state).length > MAX_STATE) throw new SavedListViewError(400, "This view holds too much to save.", "SAVED_VIEW_TOO_LARGE");
  const shared = Boolean(input.shared);
  if (shared && !canShare(session)) throw new SavedListViewError(403, "Only those who manage the company can share a view with everyone.", "SAVED_VIEW_SHARE_FORBIDDEN");
  if (input.isDefault) await client.query(`UPDATE public.saved_list_views SET is_default = false WHERE organization_id = $1 AND user_id = $2 AND list_key = $3 AND is_default`,
    [session.organizationId, session.userId, key]);
  const row = (await client.query(
    `INSERT INTO public.saved_list_views (organization_id, user_id, list_key, name, state, shared, is_default) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
     ON CONFLICT (organization_id, user_id, list_key, lower(name)) DO UPDATE SET state = EXCLUDED.state, shared = EXCLUDED.shared, is_default = EXCLUDED.is_default, updated_at = now()
     RETURNING *`,
    [session.organizationId, session.userId, key, name, JSON.stringify(state), shared, Boolean(input.isDefault)])).rows[0];
  return { view: viewOf(row, session.userId) };
}

async function ownView(client, session, viewId) {
  const row = (await client.query(`SELECT * FROM public.saved_list_views WHERE organization_id = $1 AND id = $2`, [session.organizationId, String(viewId ?? "")]).catch(() => ({ rows: [] }))).rows[0];
  if (!row || (row.user_id !== session.userId && !(row.shared && canShare(session)))) throw new SavedListViewError(404, "View not found.", "SAVED_VIEW_NOT_FOUND");
  return row;
}

// Opens by default (or stops); only for the person's own views.
export async function setSavedListViewDefault(client, session, viewId, isDefault) {
  const row = await ownView(client, session, viewId);
  if (row.user_id !== session.userId) throw new SavedListViewError(403, "Only your own views can open by default.", "SAVED_VIEW_NOT_OWNER");
  if (isDefault) await client.query(`UPDATE public.saved_list_views SET is_default = false WHERE organization_id = $1 AND user_id = $2 AND list_key = $3 AND is_default`,
    [session.organizationId, session.userId, row.list_key]);
  const updated = (await client.query(`UPDATE public.saved_list_views SET is_default = $2, updated_at = now() WHERE id = $1 RETURNING *`, [row.id, Boolean(isDefault)])).rows[0];
  return { view: viewOf(updated, session.userId) };
}

export async function deleteSavedListView(client, session, viewId) {
  const row = await ownView(client, session, viewId);
  await client.query(`DELETE FROM public.saved_list_views WHERE id = $1`, [row.id]);
  return { deleted: true };
}
