// Assets — Asset Location, the commands. Locations are created with a generated code, renamed with history, moved in the hierarchy with an
// impact preview, and deactivated only once no asset in use is registered there. An asset's registered location changes only through an
// authorized event — its initial registration, a completed transfer, an administrative correction (with a reason), recovery or
// reinstatement. Whereabouts and sightings are observations; a difference becomes a discrepancy someone reviews.
import { has, nextNumber, recordAssetEvent, text, uuid } from "../common.js";
import { createNotification } from "../../../core/platform/notifications/index.js";
import { EXTERNAL_KINDS, KIND, LOCATION, PATHS_SQL, locationError, mayCreateLocation, mayEditLocation, normalizedLocationName, requireLocation } from "./location-rules.js";

const keyOf = (input) => text(input?.idempotencyKey, 200) || null;
async function loadLocation(client, c, id, { lock = false } = {}) {
  let locationId;
  try { locationId = uuid(id, "Location"); } catch { throw locationError(404, "ASSET_LOCATION_NOT_FOUND"); }
  const row = (await client.query(`SELECT * FROM tenant.asset_locations WHERE organization_id = $1 AND id = $2${lock ? " FOR UPDATE" : ""}`, [c.organizationId, locationId])).rows[0];
  if (!row) throw locationError(404, "ASSET_LOCATION_NOT_FOUND");
  return row;
}
export { loadLocation };
const versionCheck = (row, expected) => {
  if (expected !== undefined && expected !== null && Number(expected) !== Number(row.row_version)) throw locationError(409, "ASSET_LOCATION_VERSION_CONFLICT", undefined, { current: row.row_version });
};
async function pathOf(client, c, id) {
  if (!id) return null;
  return (await client.query(`${PATHS_SQL.replace("SELECT id, path, root_id, depth FROM tree", "SELECT path FROM tree WHERE id = $2")}`, [c.organizationId, id])).rows[0]?.path ?? null;
}
async function logChange(client, c, locationId, action, changes = {}, reason = null) {
  await client.query(`INSERT INTO tenant.asset_location_changes (organization_id, location_id, action, changes, reason, actor_user_id) VALUES ($1,$2,$3,$4,$5,$6)`,
    [c.organizationId, locationId, action, JSON.stringify(changes), reason, c.userId]);
}
async function notify(client, c, userIds, title, message, href, entity = {}) {
  for (const userId of [...new Set(userIds.filter(Boolean))]) {
    if (userId === c.userId) continue;
    await createNotification(client, { organizationId: c.organizationId, userId, category: "asset_register", title, message: message ?? null, href, entityType: entity.type ?? null, entityId: entity.id ?? null });
  }
}
async function usersWith(client, c, permission) {
  return (await client.query(`SELECT DISTINCT assignment.user_id FROM user_role_assignments assignment JOIN role_permissions grant_row ON grant_row.role_id = assignment.role_id
      WHERE assignment.organization_id = $1 AND assignment.status = 'active' AND grant_row.permission_key = $2`, [c.organizationId, permission]).catch(() => ({ rows: [] }))).rows.map((r) => r.user_id);
}
// The validated fields of a location.
async function clean(client, c, input, { creating, row } = {}) {
  const out = {};
  if (input.name !== undefined || creating) {
    const name = text(input.name, 160).replace(/\s+/g, " ");
    if (name.length < 2) throw locationError(400, "ASSET_LOCATION_NAME_REQUIRED", undefined, { field: "name" });
    out.name = name;
  }
  if (input.kind !== undefined || creating) {
    const kind = String(input.kind ?? "");
    if (!KIND[kind]) throw locationError(400, "ASSET_LOCATION_INVALID", "Choose the type of location.", { field: "kind" });
    out.kind = kind;
  }
  for (const [k, col, max] of [["description", "description", 1000], ["floorRoom", "floor_room", 160], ["address", "address", 500]]) if (input[k] !== undefined) out[col] = text(input[k], max) || null;
  if (input.managerUserId !== undefined) {
    if (!input.managerUserId) out.manager_user_id = null;
    else {
      const user = (await client.query(`SELECT u.id FROM public.users u JOIN public.organization_memberships m ON m.user_id = u.id WHERE m.organization_id = $1 AND u.id = $2 AND m.status = 'active'`,
        [c.organizationId, uuid(input.managerUserId, "Manager")])).rows[0];
      if (!user) throw locationError(400, "ASSET_LOCATION_INVALID", "Choose an active Company user as the manager.", { field: "managerUserId" });
      out.manager_user_id = user.id;
    }
  }
  const kind = out.kind ?? row?.kind;
  if (input.externalPartyId !== undefined) {
    if (!input.externalPartyId) out.external_party_id = null;
    else {
      const party = (await client.query(`SELECT id FROM tenant.business_parties WHERE organization_id = $1 AND id = $2`, [c.organizationId, uuid(input.externalPartyId, "Customer or vendor")])).rows[0];
      if (!party) throw locationError(400, "ASSET_LOCATION_INVALID", "Choose the customer or vendor of this external site.", { field: "externalPartyId" });
      out.external_party_id = party.id;
    }
  }
  if (input.isAssetStore !== undefined) out.is_asset_store = Boolean(input.isAssetStore);
  if ((out.is_asset_store ?? row?.is_asset_store) && !(out.manager_user_id ?? (input.managerUserId === undefined ? row?.manager_user_id : null))) {
    throw locationError(400, "ASSET_LOCATION_INVALID", "An asset store needs a manager who is accountable for what it holds.", { field: "managerUserId" });
  }
  if (out.external_party_id && !EXTERNAL_KINDS.includes(kind)) throw locationError(400, "ASSET_LOCATION_INVALID", "Only a customer site or a repair facility belongs to a customer or vendor.");
  return out;
}
async function parentOf(client, c, parentId, selfId = null) {
  if (!parentId) return null;
  let parent;
  try { parent = await loadLocation(client, c, parentId); } catch { throw locationError(400, "ASSET_LOCATION_PARENT_INVALID"); }
  if (!parent.active) throw locationError(409, "ASSET_LOCATION_PARENT_INVALID", "The parent location is inactive.");
  if (selfId) {
    let cursor = parent;
    for (let depth = 0; cursor && depth < 50; depth += 1) {
      if (cursor.id === selfId) throw locationError(409, "ASSET_LOCATION_HIERARCHY_CYCLE");
      cursor = cursor.parent_id ? (await client.query(`SELECT id, parent_id FROM tenant.asset_locations WHERE id = $1`, [cursor.parent_id])).rows[0] : null;
    }
  }
  return parent;
}
async function assertUnique(client, c, name, parentId, exceptId = null) {
  const dup = (await client.query(`SELECT code FROM tenant.asset_locations WHERE organization_id = $1 AND normalized_name = $2 AND parent_id IS NOT DISTINCT FROM $3 AND id IS DISTINCT FROM $4 LIMIT 1`,
    [c.organizationId, normalizedLocationName(name), parentId, exceptId])).rows[0];
  if (dup) throw locationError(409, "ASSET_LOCATION_DUPLICATE", undefined, { code: dup.code });
}

// ------------------------------------------------------------------ the master
// input: { name, kind, parentId?, description?, floorRoom?, address?, managerUserId?, externalPartyId?, idempotencyKey? }
export async function createAssetLocation(client, c, input = {}) {
  requireLocation(c, mayCreateLocation(c));
  const key = keyOf(input);
  if (key) {
    const done = (await client.query(`SELECT id, code FROM tenant.asset_locations WHERE organization_id = $1 AND create_key = $2`, [c.organizationId, key])).rows[0];
    if (done) return { locationId: done.id, code: done.code, replayed: true };
  }
  const fields = await clean(client, c, input, { creating: true });
  const parent = await parentOf(client, c, input.parentId);
  await assertUnique(client, c, fields.name, parent?.id ?? null);
  const code = await nextNumber(client, c, "asset_location", "ALOC");
  const cols = Object.keys(fields);
  const row = (await client.query(`INSERT INTO tenant.asset_locations (organization_id, code, parent_id, created_by, create_key, active, location_type, ${cols.join(", ")})
      VALUES ($1,$2,$3,$4,$5,true,'other',${cols.map((_, i) => `$${i + 6}`).join(",")}) RETURNING *`, [c.organizationId, code, parent?.id ?? null, c.userId, key, ...cols.map((k) => fields[k])])).rows[0];
  await logChange(client, c, row.id, "CREATED", { name: row.name, kind: row.kind, parent: parent?.code ?? null });
  return { locationId: row.id, code, path: await pathOf(client, c, row.id), version: row.row_version };
}
// input: { …fields, expectedVersion?, reason? } — a rename keeps the location's identity and every asset's history.
export async function updateAssetLocation(client, c, locationId, input = {}) {
  requireLocation(c, mayEditLocation(c));
  const row = await loadLocation(client, c, locationId, { lock: true });
  versionCheck(row, input.expectedVersion);
  if (input.parentId !== undefined) throw locationError(400, "ASSET_LOCATION_INVALID", "Move a location under another parent through Move location.");
  const fields = await clean(client, c, input, { row });
  if (fields.name) await assertUnique(client, c, fields.name, row.parent_id, row.id);
  const changed = Object.keys(fields).filter((k) => String(fields[k] ?? "") !== String(row[k] ?? ""));
  if (!changed.length) return { locationId: row.id, version: row.row_version, changed: [] };
  const updated = (await client.query(`UPDATE tenant.asset_locations SET ${changed.map((k, i) => `${k} = $${i + 3}`).join(", ")}, updated_by = $${changed.length + 3} WHERE organization_id = $1 AND id = $2 RETURNING *`,
    [c.organizationId, row.id, ...changed.map((k) => fields[k]), c.userId])).rows[0];
  await logChange(client, c, row.id, "UPDATED", Object.fromEntries(changed.map((k) => [k, { from: row[k] ?? null, to: fields[k] ?? null }])), text(input.reason, 500) || null);
  return { locationId: row.id, version: updated.row_version, changed };
}
// What moving a location under another parent changes: its new path and the assets inside it.
export async function previewAssetLocationMove(client, c, locationId, input = {}) {
  requireLocation(c, has(c, LOCATION.hierarchy));
  const row = await loadLocation(client, c, locationId);
  const parent = await parentOf(client, c, input.parentId || null, row.id);
  const assets = Number((await client.query(`WITH RECURSIVE s AS (SELECT id FROM tenant.asset_locations WHERE id = $1 UNION ALL SELECT l.id FROM tenant.asset_locations l JOIN s ON l.parent_id = s.id)
      SELECT count(*)::int AS n FROM tenant.assets WHERE location_id IN (SELECT id FROM s) AND archived_at IS NULL`, [row.id])).rows[0].n);
  const parentPath = parent ? await pathOf(client, c, parent.id) : null;
  return { from: await pathOf(client, c, row.id), to: parentPath ? `${parentPath} → ${row.name}` : row.name, assetsAffected: assets, note: "Assets keep their registered location; only its place in the hierarchy changes." };
}
// input: { parentId (null = top level), reason, expectedVersion? }
export async function moveAssetLocation(client, c, locationId, input = {}) {
  requireLocation(c, has(c, LOCATION.hierarchy));
  const row = await loadLocation(client, c, locationId, { lock: true });
  versionCheck(row, input.expectedVersion);
  const reason = text(input.reason, 500);
  if (reason.length < 3) throw locationError(400, "ASSET_LOCATION_INVALID", "Give the reason for the reorganization.", { field: "reason" });
  const preview = await previewAssetLocationMove(client, c, locationId, input);
  const parentId = input.parentId ? uuid(input.parentId, "Parent location") : null;
  if (parentId === row.parent_id) return { locationId: row.id, changed: false, path: preview.from };
  await assertUnique(client, c, row.name, parentId, row.id);
  const updated = (await client.query(`UPDATE tenant.asset_locations SET parent_id = $3, updated_by = $4 WHERE organization_id = $1 AND id = $2 RETURNING *`, [c.organizationId, row.id, parentId, c.userId])).rows[0];
  await logChange(client, c, row.id, "MOVED", { from: preview.from, to: preview.to }, reason);
  return { locationId: row.id, changed: true, path: preview.to, version: updated.row_version };
}
// What stands in the way of closing a location: assets in use here or below, active child locations, open transfers, maintenance, discrepancies.
export async function previewAssetLocationDeactivation(client, c, locationId) {
  requireLocation(c, has(c, LOCATION.deactivate) || has(c, LOCATION.legacyManage));
  const row = await loadLocation(client, c, locationId);
  const n = async (sql) => Number((await client.query(sql, [row.id])).rows[0].n);
  const sub = `WITH RECURSIVE s AS (SELECT id FROM tenant.asset_locations WHERE id = $1 UNION ALL SELECT l.id FROM tenant.asset_locations l JOIN s ON l.parent_id = s.id)`;
  const inUse = "a.archived_at IS NULL AND a.lifecycle_status IN ('DRAFT', 'REGISTERED', 'ACTIVE', 'ON_HOLD')";
  const out = {
    directAssets: await n(`SELECT count(*)::int AS n FROM tenant.assets a WHERE a.location_id = $1 AND ${inUse}`),
    subtreeAssets: await n(`${sub} SELECT count(*)::int AS n FROM tenant.assets a WHERE a.location_id IN (SELECT id FROM s WHERE id <> $1) AND ${inUse}`),
    activeChildren: await n(`SELECT count(*)::int AS n FROM tenant.asset_locations WHERE parent_id = $1 AND active`),
    pendingTransfers: await n(`SELECT count(*)::int AS n FROM tenant.asset_transfer_lines WHERE (to_location_id = $1 OR from_location_id = $1) AND line_status IN ('PENDING', 'APPROVED', 'DISPATCHED', 'RECEIVED', 'RECEIPT_EXCEPTION', 'RETURN_IN_PROGRESS')`),
    openMaintenance: await n(`SELECT count(*)::int AS n FROM tenant.asset_maintenance_orders m JOIN tenant.assets a ON a.id = m.asset_id WHERE a.location_id = $1 AND m.status IN ('planned', 'scheduled', 'in_progress', 'on_hold')`),
    openDiscrepancies: await n(`SELECT count(*)::int AS n FROM tenant.asset_location_discrepancies WHERE (expected_location_id = $1 OR observed_location_id = $1) AND status = 'OPEN'`),
    historicalAssets: await n(`SELECT count(*)::int AS n FROM tenant.assets a WHERE a.location_id = $1 AND NOT (${inUse})`),
  };
  const blocking = [out.directAssets && `${out.directAssets} asset(s) in use are registered here`, out.subtreeAssets && `${out.subtreeAssets} asset(s) in use are in its child locations`,
    out.activeChildren && `${out.activeChildren} child location(s) are still active`, out.pendingTransfers && `${out.pendingTransfers} transfer(s) to or from it are open`].filter(Boolean);
  return { ...out, blocking, canDeactivate: blocking.length === 0, warnings: [out.openMaintenance && `${out.openMaintenance} open work order(s)`, out.openDiscrepancies && `${out.openDiscrepancies} open discrepancy(ies)`,
    out.historicalAssets && `${out.historicalAssets} retired, lost or disposed asset(s) keep it as their last location`].filter(Boolean) };
}
export async function deactivateAssetLocation(client, c, locationId, input = {}) {
  const row = await loadLocation(client, c, locationId, { lock: true });
  versionCheck(row, input.expectedVersion);
  if (!row.active) return { locationId: row.id, active: false, replayed: true };
  const preview = await previewAssetLocationDeactivation(client, c, locationId);
  if (!preview.canDeactivate) {
    await notify(client, c, [row.manager_user_id], `${row.name}: closure blocked`, preview.blocking.join("; "), `/assets/locations/${row.id}`);
    throw locationError(409, "ASSET_LOCATION_IN_USE", `${preview.blocking.join("; ")}. Transfer them first.`, preview);
  }
  const reason = text(input.reason, 500) || null;
  await client.query(`UPDATE tenant.asset_locations SET active = false, deactivated_at = clock_timestamp(), updated_by = $3 WHERE organization_id = $1 AND id = $2`, [c.organizationId, row.id, c.userId]);
  await logChange(client, c, row.id, "DEACTIVATED", { warnings: preview.warnings }, reason);
  return { locationId: row.id, active: false, warnings: preview.warnings };
}
export async function reactivateAssetLocation(client, c, locationId, input = {}) {
  requireLocation(c, has(c, LOCATION.deactivate) || has(c, LOCATION.legacyManage));
  const row = await loadLocation(client, c, locationId, { lock: true });
  versionCheck(row, input.expectedVersion);
  if (row.active) return { locationId: row.id, active: true, replayed: true };
  if (row.parent_id && !(await loadLocation(client, c, row.parent_id)).active) throw locationError(409, "ASSET_LOCATION_PARENT_INVALID", "Reactivate the parent location first.");
  await client.query(`UPDATE tenant.asset_locations SET active = true, deactivated_at = NULL, updated_by = $3 WHERE organization_id = $1 AND id = $2`, [c.organizationId, row.id, c.userId]);
  await logChange(client, c, row.id, "REACTIVATED", {}, text(input.reason, 500) || null);
  return { locationId: row.id, active: true };
}

// ------------------------------------------------------------------ an asset's location
async function assetRow(client, c, assetId, lock = true) {
  const { loadAssetRow } = await import("../asset-register/register-commands.js");
  return loadAssetRow(client, c, assetId, { lock });
}
async function activeLocation(client, c, locationId) {
  const row = await loadLocation(client, c, locationId);
  if (!row.active) throw locationError(409, "ASSET_LOCATION_INACTIVE");
  return row;
}
// input: { locationId, reason, expectedVersion?, idempotencyKey? } — fixes a wrong record (bad import, a sighting confirmed); not a movement.
export async function correctAssetLocation(client, c, assetId, input = {}, options = {}) {
  requireLocation(c, has(c, LOCATION.review));
  const row = await assetRow(client, c, assetId);
  if (input.expectedVersion !== undefined && input.expectedVersion !== null && Number(input.expectedVersion) !== Number(row.row_version)) throw locationError(409, "ASSET_LOCATION_VERSION_CONFLICT");
  if (row.lifecycle_status === "DISPOSED" || row.archived_at) throw locationError(409, "ASSET_LOCATION_ASSET_RESTRICTED", "A disposed or archived asset keeps its last location.");
  const reason = text(input.reason, 1000);
  if (reason.length < 3) throw locationError(400, "ASSET_LOCATION_INVALID", "Give the reason for the correction.", { field: "reason" });
  const location = await activeLocation(client, c, input.locationId);
  if (location.id === row.location_id) return { assetId: row.id, changed: false };
  const { withStatusContext } = await import("../asset-status/status-commands.js");
  await withStatusContext(client, c, { action: "location-correction", locationEvent: "ADMIN_CORRECTION", reason, key: keyOf(input), sourceType: options.sourceType, sourceId: options.sourceId },
    () => client.query(`UPDATE tenant.assets SET location_id = $3 WHERE organization_id = $1 AND id = $2`, [c.organizationId, row.id, location.id]));
  await recordAssetEvent(client, c, row.id, "asset.location_corrected", { from: row.location_id, to: location.id, reason });
  return { assetId: row.id, changed: true, locationId: location.id };
}
// input: { kind: TEMPORARY | MAINTENANCE, locationId? | locationText?, reason, expiresAt?, flagDiscrepancy? } — whereabouts; never a movement.
export async function recordAssetLocationObservation(client, c, assetId, input = {}, options = {}) {
  if (!options.fromVerification) requireLocation(c, has(c, LOCATION.observe));
  const row = await assetRow(client, c, assetId);
  if (["DISPOSED"].includes(row.lifecycle_status)) throw locationError(409, "ASSET_LOCATION_ASSET_RESTRICTED", "A disposed asset has no whereabouts to record.");
  const kind = options.fromVerification ? "VERIFICATION" : String(input.kind ?? "TEMPORARY");
  if (!["TEMPORARY", "MAINTENANCE", "VERIFICATION"].includes(kind)) throw locationError(400, "ASSET_LOCATION_INVALID", "Choose what kind of whereabouts this is.");
  const location = input.locationId ? await loadLocation(client, c, input.locationId) : null;
  const where = text(input.locationText, 300) || null;
  if (!location && !where) throw locationError(400, "ASSET_LOCATION_INVALID", "Say where the asset is.", { field: "locationId" });
  const reason = text(input.reason, 1000) || null;
  if (kind !== "VERIFICATION" && !reason) throw locationError(400, "ASSET_LOCATION_INVALID", "Give the business reason.", { field: "reason" });
  const expires = input.expiresAt ? new Date(String(input.expiresAt)) : null;
  if (expires && Number.isNaN(expires.getTime())) throw locationError(400, "ASSET_LOCATION_INVALID", "Enter a valid end date.");
  const different = location ? location.id !== row.location_id : true;
  const flag = kind === "VERIFICATION" ? different : Boolean(input.flagDiscrepancy);
  // A new whereabouts replaces the current one; an old one never stands as proof of where the asset is now.
  if (kind !== "VERIFICATION") await client.query(`UPDATE tenant.asset_location_observations SET ended_at = clock_timestamp() WHERE asset_id = $1 AND ended_at IS NULL AND kind <> 'VERIFICATION'`, [row.id]);
  const obs = (await client.query(`INSERT INTO tenant.asset_location_observations (organization_id, asset_id, kind, observed_location_id, observed_location_text, registered_location_id, expires_at, reason, discrepancy, verification_id, observed_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`, [c.organizationId, row.id, kind, location?.id ?? null, where, row.location_id, expires ? expires.toISOString() : null, reason, flag, options.verificationId ?? null, c.userId])).rows[0];
  let discrepancy = null;
  if (flag) discrepancy = await openDiscrepancy(client, c, row, { observedLocationId: location?.id ?? null, observedText: where, source: kind === "VERIFICATION" ? "VERIFICATION" : "OBSERVATION", sourceId: options.verificationId ?? obs.id });
  await recordAssetEvent(client, c, row.id, "asset.location_observed", { kind, observedLocationId: location?.id ?? null, observedText: where, reason, discrepancy: Boolean(discrepancy) });
  return { observationId: obs.id, discrepancyId: discrepancy?.id ?? null, registeredLocationUnchanged: true };
}
export async function endAssetLocationObservation(client, c, assetId) {
  requireLocation(c, has(c, LOCATION.observe));
  const row = await assetRow(client, c, assetId);
  const ended = (await client.query(`UPDATE tenant.asset_location_observations SET ended_at = clock_timestamp() WHERE asset_id = $1 AND ended_at IS NULL AND kind <> 'VERIFICATION' RETURNING id`, [row.id])).rows.length;
  return { assetId: row.id, ended };
}
async function openDiscrepancy(client, c, asset, { observedLocationId, observedText, source, sourceId }) {
  const open = (await client.query(`SELECT id, discrepancy_number FROM tenant.asset_location_discrepancies WHERE asset_id = $1 AND status = 'OPEN'`, [asset.id])).rows[0];
  if (open) return open;
  const made = (await client.query(`INSERT INTO tenant.asset_location_discrepancies (organization_id, asset_id, expected_location_id, observed_location_id, observed_location_text, source, source_id, reported_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, discrepancy_number`, [c.organizationId, asset.id, asset.location_id, observedLocationId, observedText, source, sourceId, c.userId])).rows[0];
  const manager = asset.location_id ? (await client.query(`SELECT manager_user_id FROM tenant.asset_locations WHERE id = $1`, [asset.location_id])).rows[0]?.manager_user_id : null;
  await notify(client, c, [...await usersWith(client, c, LOCATION.review), manager], `${asset.asset_number}: location discrepancy`, `Seen somewhere other than its registered location.`,
    `/assets/register/${asset.id}?tab=custody`, { type: "assets.asset", id: asset.id });
  return made;
}
// input: { resolution: TRANSFER | CORRECTION | DISMISS, note, toLocationId? } — a sighting is confirmed by a transfer or a correction, or dismissed.
export async function resolveAssetLocationDiscrepancy(client, c, discrepancyId, input = {}) {
  requireLocation(c, has(c, LOCATION.review));
  const d = (await client.query(`SELECT * FROM tenant.asset_location_discrepancies WHERE organization_id = $1 AND id = $2 FOR UPDATE`, [c.organizationId, uuid(discrepancyId, "Discrepancy")])).rows[0];
  if (!d) throw locationError(404, "ASSET_LOCATION_NOT_FOUND", "That discrepancy was not found.");
  if (d.status !== "OPEN") return { discrepancyId: d.id, status: d.status, replayed: true };
  const resolution = String(input.resolution ?? "").toUpperCase();
  const note = text(input.note, 1000);
  if (note.length < 3) throw locationError(400, "ASSET_LOCATION_INVALID", "Explain the resolution.", { field: "note" });
  const target = input.toLocationId ?? d.observed_location_id;
  let status;
  let transferId = null;
  if (resolution === "DISMISS") status = "DISMISSED";
  else if (resolution === "CORRECTION") {
    if (!target) throw locationError(400, "ASSET_LOCATION_INVALID", "Choose the correct location.", { field: "toLocationId" });
    await correctAssetLocation(client, c, d.asset_id, { locationId: target, reason: note }, { sourceType: "asset_location_discrepancy", sourceId: d.id });
    status = "RESOLVED_CORRECTION";
  } else if (resolution === "TRANSFER") {
    if (!target) throw locationError(400, "ASSET_LOCATION_INVALID", "Choose where the asset is moving.", { field: "toLocationId" });
    const { createAssetTransfer } = await import("../asset-transfers/tr-commands.js");
    const transfer = await createAssetTransfer(client, c, { transferType: "LOCATION", reasonCode: "OTHER", reasonDetail: `Location discrepancy: ${note}`, lines: [{ assetId: d.asset_id, toLocationId: target }], submit: true });
    transferId = transfer.transferId ?? null;
    status = "RESOLVED_TRANSFER";
  } else throw locationError(400, "ASSET_LOCATION_INVALID", "Resolve by a transfer, a correction or dismissal.");
  await client.query(`UPDATE tenant.asset_location_discrepancies SET status = $2, resolution_note = $3, resolved_by = $4, resolved_at = clock_timestamp(), transfer_id = $5 WHERE id = $1`, [d.id, status, note, c.userId, transferId]);
  await recordAssetEvent(client, c, d.asset_id, "asset.location_discrepancy_resolved", { discrepancyId: d.id, status, note });
  return { discrepancyId: d.id, status, transferId };
}

// ------------------------------------------------------------------ bulk
async function eachAsset(client, ids, run) {
  const list = [...new Set((Array.isArray(ids) ? ids : []).map(String))];
  if (!list.length || list.length > 200) throw locationError(400, "ASSET_LOCATION_INVALID", "Choose between 1 and 200 assets.");
  const results = [];
  for (const [i, id] of list.entries()) {
    await client.query(`SAVEPOINT bulk_location_${i}`);
    try { await run(id); await client.query(`RELEASE SAVEPOINT bulk_location_${i}`); results.push({ assetId: id, ok: true }); }
    catch (failure) { await client.query(`ROLLBACK TO SAVEPOINT bulk_location_${i}`); results.push({ assetId: id, ok: false, errorCode: failure.code ?? "ASSET_LOCATION_INVALID", message: failure.message }); }
  }
  const codes = new Map((await client.query(`SELECT id, asset_number FROM tenant.assets WHERE id = ANY($1::uuid[])`, [list.filter((x) => /^[0-9a-f-]{36}$/i.test(x))])).rows.map((r) => [r.id, r.asset_number]));
  return { results: results.map((r) => ({ ...r, assetNumber: codes.get(r.assetId) ?? null })), succeeded: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length };
}
// input: { assetIds, locationId } — the initial location of assets not yet commissioned.
export async function setInitialAssetLocations(client, c, input = {}) {
  await activeLocation(client, c, input.locationId);
  const { updateAsset } = await import("../asset-register/register-commands.js");
  return eachAsset(client, input.assetIds, async (id) => {
    const row = await assetRow(client, c, id, false);
    if (!["DRAFT", "REGISTERED"].includes(row.lifecycle_status)) throw locationError(409, "ASSET_LOCATION_TRANSFER_REQUIRED");
    await updateAsset(client, c, id, { locationId: input.locationId });
  });
}
// input: { assetIds, toLocationId, reason } — one transfer of the assets that can move (each refusal reported with its reason), submitted.
export async function requestBulkAssetTransfers(client, c, input = {}) {
  await activeLocation(client, c, input.toLocationId);
  const { createAssetTransfer, validateAssetTransfer } = await import("../asset-transfers/tr-commands.js");
  const ids = [...new Set((Array.isArray(input.assetIds) ? input.assetIds : []).map(String))];
  if (!ids.length || ids.length > 200) throw locationError(400, "ASSET_LOCATION_INVALID", "Choose between 1 and 200 assets.");
  const header = { transferType: "LOCATION", reasonCode: "OTHER", reasonDetail: text(input.reason, 1000) || "Moved together", toLocationId: input.toLocationId };
  const checked = await validateAssetTransfer(client, c, { ...header, lines: ids.map((assetId) => ({ assetId })) });
  const ok = checked.lines.filter((l) => l.ok).map((l) => l.assetId);
  const made = ok.length ? await createAssetTransfer(client, c, { ...header, lines: ok.map((assetId) => ({ assetId })), submit: true }) : null;
  const codes = new Map((await client.query(`SELECT id, asset_number FROM tenant.assets WHERE id = ANY($1::uuid[])`, [ids.filter((x) => /^[0-9a-f-]{36}$/i.test(x))])).rows.map((r) => [r.id, r.asset_number]));
  const results = ids.map((id) => { const l = checked.lines.find((x) => x.assetId === id); return { assetId: id, assetNumber: codes.get(id) ?? null, ok: Boolean(l?.ok), errorCode: l?.error?.code, message: l?.error?.message }; });
  return { transferId: made?.transferId ?? null, transferNumber: made?.number ?? null, results, succeeded: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length };
}
