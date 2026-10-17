// Assets — Asset Transfers, the commands. A transfer is drafted (its source loaded from the asset, never trusted from the request, each
// asset validated and reserved), submitted, approved where policy requires it (never by its requester), dispatched (the asset is then in
// transfer; its confirmed location is unchanged), and received line by line: the identity and condition are checked, the registered
// location changes once through the location record, and custody moves through the Custodian handover — the employee's acknowledgment
// stays the Custodian workflow's. Same-office custody transfers are a handover only (no location event). Exceptions (missing, damaged,
// wrong asset, disputed) are recorded and resolved; nothing dispatched is ever "cancelled" as if it had not left.
import { has, loadSettings, nextNumber, recordAssetEvent, text, uuid } from "../common.js";
import { createNotification } from "../../../core/platform/notifications/index.js";
import { ACTIVE_LINES, CONDITIONS, EXTERNAL_KINDS, REASON, TR, dayOfDb, manages, requireTr, trError } from "./tr-rules.js";

const idOf = (v, label, code = "ASSET_TRANSFER_NOT_FOUND") => { try { return uuid(v, label); } catch { throw trError(404, code); } };
const dayOf = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v ?? "")) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) ? String(v) : null);
const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const conditionOf = (v, label = "condition") => { const x = String(v ?? "").toUpperCase(); if (!CONDITIONS.includes(x)) throw trError(400, "ASSET_TRANSFER_INVALID", `Record the asset's ${label}.`, { field: "condition" }); return x; };
const timeOf = (v) => {
  if (!v) return new Date().toISOString();
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime()) || d.getTime() > Date.now() + 60_000) throw trError(400, "ASSET_TRANSFER_INVALID", "Enter a real time, not in the future.");
  return d.toISOString();
};
export async function logTransferEvent(client, c, transferId, action, { lineId = null, assetId = null, from = null, to = null, details = {}, reason = null, commandId = null } = {}) {
  await client.query(`INSERT INTO tenant.asset_transfer_events (organization_id, transfer_id, line_id, asset_id, action, from_status, to_status, details, reason, actor_user_id, command_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [c.organizationId, transferId, lineId, assetId, action, from, to, JSON.stringify(details), reason, c.userId, commandId]);
}
async function usersWith(client, c, permission) {
  return (await client.query(`SELECT DISTINCT assignment.user_id FROM user_role_assignments assignment JOIN role_permissions grant_row ON grant_row.role_id = assignment.role_id
      WHERE assignment.organization_id = $1 AND assignment.status = 'active' AND grant_row.permission_key = $2`, [c.organizationId, permission]).catch(() => ({ rows: [] }))).rows.map((r) => r.user_id);
}
async function tell(client, c, userIds, order, title, message) {
  for (const userId of [...new Set(userIds.filter(Boolean))]) {
    if (userId === c.userId) continue;
    await createNotification(client, { organizationId: c.organizationId, userId, category: "asset_register", title: `${order.transfer_number}: ${title}`, message: message ?? null, href: `/assets/transfers/${order.id}`,
      entityType: null, entityId: null });
  }
}
export async function loadOrder(client, c, id, { lock = true } = {}) {
  const o = (await client.query(`SELECT * FROM tenant.asset_transfer_orders WHERE organization_id = $1 AND id = $2${lock ? " FOR UPDATE" : ""}`, [c.organizationId, idOf(id, "Transfer")])).rows[0];
  if (!o) throw trError(404, "ASSET_TRANSFER_NOT_FOUND");
  return o;
}
export async function linesOf(client, orderId, { lock = false } = {}) {
  return (await client.query(`SELECT * FROM tenant.asset_transfer_lines WHERE transfer_id = $1 ORDER BY line_number${lock ? " FOR UPDATE" : ""}`, [orderId])).rows;
}
const versionCheck = (o, expected) => { if (expected !== undefined && expected !== null && Number(expected) !== Number(o.row_version)) throw trError(409, "ASSET_TRANSFER_VERSION_CONFLICT"); };
const commandDone = async (client, c, commandId) => (commandId ? (await client.query(`SELECT 1 FROM tenant.asset_transfer_events WHERE organization_id = $1 AND command_id = $2`, [c.organizationId, commandId])).rows[0] : null);
async function site(client, locationId) {
  if (!locationId) return null;
  return (await client.query(`WITH RECURSIVE up AS (SELECT id, parent_id, 0 AS depth FROM tenant.asset_locations WHERE id = $1 UNION ALL SELECT l.id, l.parent_id, up.depth + 1 FROM tenant.asset_locations l JOIN up ON l.id = up.parent_id WHERE up.depth < 20)
      SELECT id FROM up ORDER BY depth DESC LIMIT 1`, [locationId])).rows[0]?.id ?? null;
}
async function locationOf(client, c, id) {
  const loc = (await client.query(`SELECT * FROM tenant.asset_locations WHERE organization_id = $1 AND id = $2`, [c.organizationId, idOf(id, "Location", "ASSET_TRANSFER_DESTINATION_INVALID")])).rows[0];
  if (!loc) throw trError(400, "ASSET_TRANSFER_COMPANY_MISMATCH", "That location belongs to another Company.");
  if (!loc.active) throw trError(400, "ASSET_TRANSFER_DESTINATION_INVALID", `${loc.name} is not an active location.`);
  return loc;
}
async function currentCustody(client, assetId) {
  return (await client.query(`SELECT k.*, COALESCE(NULLIF(u.full_name, ''), u.email, d.name, s.name) AS label FROM tenant.asset_custody_assignments k LEFT JOIN public.users u ON u.id = k.user_id
      LEFT JOIN public.departments d ON d.id = k.department_id LEFT JOIN tenant.asset_locations s ON s.id = k.store_location_id WHERE k.asset_id = $1 AND k.status = 'ACTIVE'`, [assetId])).rows[0] ?? null;
}
async function targetOf(client, c, input) {
  if (!input.toCustodianType) return null;
  const { resolveCustodian } = await import("../asset-custody/custody-commands.js");
  try {
    return await resolveCustodian(client, c, { toType: input.toCustodianType, userId: input.toUserId, departmentId: input.toDepartmentId, storeLocationId: input.toStoreLocationId });
  } catch (failure) { throw trError(400, failure.code === "ASSET_CUSTODY_COMPANY_MISMATCH" ? "ASSET_TRANSFER_COMPANY_MISMATCH" : "ASSET_TRANSFER_CUSTODIAN_INVALID", failure.message); }
}

// ------------------------------------------------------------------ validation
// One asset in a transfer: may it move this way, to this destination, now? Returns the line to create, or the reason it cannot.
async function checkAsset(client, c, order, raw) {
  const { resolveAssetIdentifier } = await import("../asset-identification/ident-read.js");
  let assetId = raw.assetId;
  if (!assetId && raw.asset) {
    const hit = await resolveAssetIdentifier(client, { ...c, permissions: [...new Set([...(c.permissions ?? []), "assets.view"])] }, raw.asset).catch(() => null);
    if (!hit?.assetId) return { input: raw, error: { code: "ASSET_TRANSFER_ASSET_UNAVAILABLE", message: `${raw.asset} was not found${hit?.ambiguous ? " (it matches several assets)" : ""}.` } };
    assetId = hit.assetId;
  }
  let id;
  try { id = uuid(assetId, "Asset"); } catch { return { input: raw, error: { code: "ASSET_TRANSFER_ASSET_UNAVAILABLE", message: "Choose the asset." } }; }
  const a = (await client.query(`SELECT a.*, tenant.asset_effective_availability(a) AS effective FROM tenant.assets a WHERE a.organization_id = $1 AND a.id = $2`, [c.organizationId, id])).rows[0];
  if (!a) return { input: raw, error: { code: "ASSET_TRANSFER_COMPANY_MISMATCH", message: "That asset belongs to another Company." } };
  const fail = (code, message) => ({ input: raw, assetId: a.id, asset: `${a.asset_number} · ${a.name}`, error: { code, message } });
  if (!manages(c) && a.current_user_id !== c.userId) return fail("ASSET_TRANSFER_PERMISSION_DENIED", `${a.asset_number} is not in your custody.`);
  const active = (await client.query(`SELECT o.transfer_number FROM tenant.asset_transfer_lines l JOIN tenant.asset_transfer_orders o ON o.id = l.transfer_id WHERE l.asset_id = $1 AND l.line_status = ANY($2::text[])
      AND l.transfer_id <> $3`, [a.id, ACTIVE_LINES, order?.id ?? "00000000-0000-0000-0000-000000000000"])).rows[0];
  if (active) return fail("ASSET_TRANSFER_ALREADY_ACTIVE", `${a.asset_number} is already in ${active.transfer_number}.`);
  const reserved = (await client.query(`SELECT 1 FROM tenant.asset_operation_reservations WHERE asset_id = $1 AND status = 'ACTIVE' AND source_type <> 'TRANSFER'`, [a.id])).rows[0];
  if (reserved) return fail("ASSET_TRANSFER_ALREADY_ACTIVE", `${a.asset_number} is reserved for an asset assignment.`);
  const type = order.transfer_type;
  const toLocationId = raw.toLocationId ?? order.defaults?.toLocationId ?? null;
  const target = { toCustodianType: raw.toCustodianType ?? order.defaults?.toCustodianType, toUserId: raw.toUserId ?? order.defaults?.toUserId, toDepartmentId: raw.toDepartmentId ?? order.defaults?.toDepartmentId,
    toStoreLocationId: raw.toStoreLocationId ?? order.defaults?.toStoreLocationId };
  let dest = null;
  try { if (toLocationId && type !== "CUSTODY") dest = await locationOf(client, c, toLocationId); } catch (failure) { return fail(failure.code, failure.message); }
  let custodian = null;
  try { if (type !== "TEMPORARY") custodian = await targetOf(client, c, target); } catch (failure) { return fail(failure.code, failure.message); }
  if (["LOCATION", "COMBINED", "TEMPORARY", "RETURN"].includes(type) && !dest) return fail("ASSET_TRANSFER_DESTINATION_INVALID", "Choose the destination location.");
  if (["CUSTODY", "COMBINED"].includes(type) && !custodian) return fail("ASSET_TRANSFER_CUSTODIAN_INVALID", "Choose who will be responsible for it.");
  if (dest && dest.id === a.location_id && type !== "CUSTODY") return fail("ASSET_TRANSFER_DESTINATION_INVALID", `${a.asset_number} is already at ${dest.name}.`);
  const holder = await currentCustody(client, a.id);
  if (custodian && holder && holder.custodian_type === custodian.type && (holder.user_id ?? null) === (custodian.userId ?? null) && (holder.store_location_id ?? null) === (custodian.storeLocationId ?? null)
    && (custodian.type !== "DEPARTMENT" || holder.department_id === custodian.departmentId)) return fail("ASSET_TRANSFER_CUSTODIAN_INVALID", `${custodian.label} is already responsible for ${a.asset_number}.`);
  // What the asset's state allows.
  const reason = order.reason_code;
  const repairMove = ["REPAIR", "RETURN_FROM_REPAIR"].includes(reason);
  if (a.archived_at || a.lifecycle_status === "DISPOSED") return fail("ASSET_TRANSFER_ASSET_UNAVAILABLE", `${a.asset_number} is disposed.`);
  if (a.lifecycle_status === "LOST") return fail("ASSET_TRANSFER_ASSET_UNAVAILABLE", `${a.asset_number} is lost; it moves again once recovered.`);
  const pendingDisposal = (await client.query(`SELECT tenant.asset_disposal_pending($1) AS p`, [a.id])).rows[0].p;
  if (pendingDisposal && reason !== "DISPOSAL_MOVEMENT") return fail("ASSET_TRANSFER_ASSET_UNAVAILABLE", `${a.asset_number} is committed to disposal ${pendingDisposal}: only its disposal movement.`);
  if (a.lifecycle_status === "ON_HOLD" && !(repairMove && (reason === "RETURN_FROM_REPAIR" || dest?.kind === "REPAIR_FACILITY"))) return fail("ASSET_TRANSFER_ASSET_UNAVAILABLE", `${a.asset_number} is on hold: it moves only to or from repair.`);
  if (a.effective === "UNDER_MAINTENANCE" && !repairMove) return fail("ASSET_TRANSFER_ASSET_UNAVAILABLE", `${a.asset_number} is under maintenance: only a repair movement is possible.`);
  if (["DRAFT", "REGISTERED"].includes(a.lifecycle_status) && !(dest?.is_asset_store && type === "LOCATION")) return fail("ASSET_TRANSFER_ASSET_UNAVAILABLE", `${a.asset_number} is not commissioned: it moves only into an asset store.`);
  if (a.lifecycle_status === "RETIRED" && !(dest?.is_asset_store && ["DISPOSAL_MOVEMENT", "INTERNAL_STORAGE"].includes(reason) && manages(c))) return fail("ASSET_TRANSFER_ASSET_UNAVAILABLE", `${a.asset_number} is retired: only an authorized storage or disposal movement into a store.`);
  if (custodian && custodian.type !== "ASSET_STORE" && a.lifecycle_status !== "ACTIVE") return fail("ASSET_TRANSFER_CUSTODIAN_INVALID", `${a.asset_number} is not in service, so it can only go to a store.`);
  if (custodian && custodian.type !== "ASSET_STORE" && a.condition === "UNSERVICEABLE") return fail("ASSET_TRANSFER_CUSTODIAN_INVALID", `${a.asset_number} is unserviceable.`);
  return { input: raw, assetId: a.id, asset: `${a.asset_number} · ${a.name}`, lifecycle: a.lifecycle_status, effective: a.effective, from: { locationId: a.location_id, custodyId: holder?.id ?? null, custodian: holder?.label ?? null },
    to: { locationId: dest?.id ?? null, locationName: dest?.name ?? null, kind: dest?.kind ?? null, custodian }, capitalizedCost: Number(a.capitalized_cost ?? 0), error: null };
}
function headerOf(input) {
  const type = String(input.transferType ?? "").toUpperCase();
  if (!["LOCATION", "CUSTODY", "COMBINED", "TEMPORARY"].includes(type)) throw trError(400, "ASSET_TRANSFER_INVALID", "Choose what kind of transfer this is.", { field: "transferType" });
  const reason = String(input.reasonCode ?? "").toUpperCase();
  if (!REASON[reason]) throw trError(400, "ASSET_TRANSFER_INVALID", "Choose the reason for the transfer.", { field: "reasonCode" });
  const detail = text(input.reasonDetail, 1000) || null;
  if (reason === "OTHER" && (!detail || detail.length < 3)) throw trError(400, "ASSET_TRANSFER_INVALID", "Explain the reason.", { field: "reasonDetail" });
  const planned = input.plannedDate ? dayOf(input.plannedDate) : todayIso();
  if (!planned) throw trError(400, "ASSET_TRANSFER_INVALID", "Enter the planned date.", { field: "plannedDate" });
  const expectedReturn = input.expectedReturnAt ? dayOf(input.expectedReturnAt) : null;
  if (type === "TEMPORARY" && (!expectedReturn || expectedReturn < planned)) throw trError(400, "ASSET_TRANSFER_INVALID", "A temporary movement needs its expected return date.", { field: "expectedReturnAt" });
  let arrival = null;
  if (input.expectedArrivalAt) { const d = new Date(String(input.expectedArrivalAt)); if (Number.isNaN(d.getTime())) throw trError(400, "ASSET_TRANSFER_INVALID", "Enter a valid expected arrival.", { field: "expectedArrivalAt" }); arrival = d.toISOString(); }
  return { transfer_type: type, reason_code: reason, reason_detail: detail, planned_date: planned, expected_return_at: expectedReturn, expected_arrival_at: arrival, carrier: text(input.carrier, 200) || null,
    tracking_reference: text(input.trackingReference, 200) || null, notes: text(input.notes, 2000) || null,
    defaults: { toLocationId: input.toLocationId ?? null, toCustodianType: input.toCustodianType ?? null, toUserId: input.toUserId ?? null, toDepartmentId: input.toDepartmentId ?? null, toStoreLocationId: input.toStoreLocationId ?? null } };
}
// input: as createAssetTransfer — each asset's outcome, nothing created. The user sees every conflict before submitting.
export async function validateAssetTransfer(client, c, input = {}) {
  requireTr(c, TR.create);
  const header = headerOf(input);
  const lines = Array.isArray(input.lines) ? input.lines : [];
  if (!lines.length) throw trError(400, "ASSET_TRANSFER_INVALID", "Choose the assets to transfer.", { field: "lines" });
  const seen = new Set();
  const out = [];
  for (const raw of lines) {
    const r = await checkAsset(client, c, { ...header, id: null }, raw);
    if (r.assetId && seen.has(r.assetId) && !r.error) r.error = { code: "ASSET_TRANSFER_INVALID", message: `${r.asset} is listed twice.` };
    if (r.assetId) seen.add(r.assetId);
    out.push(r);
  }
  return { eligible: out.filter((r) => !r.error).length, blocked: out.filter((r) => r.error).length,
    lines: out.map((r) => ({ assetId: r.assetId ?? null, asset: r.asset ?? r.input.asset ?? null, ok: !r.error, error: r.error, from: r.from ?? null, to: r.to ? { locationId: r.to.locationId, location: r.to.locationName, custodian: r.to.custodian?.label ?? null } : null })) };
}

// ------------------------------------------------------------------ create, edit, submit
// input: { transferType, reasonCode, reasonDetail?, plannedDate, expectedArrivalAt?, expectedReturnAt?, carrier?, trackingReference?, notes?, toLocationId?, toCustodianType?, toUserId?, toDepartmentId?,
//   toStoreLocationId?, lines: [{ assetId? | asset?, toLocationId?, toCustodianType?, toUserId?, toDepartmentId?, toStoreLocationId? }], idempotencyKey?, submit? }
export async function createAssetTransfer(client, c, input = {}) {
  requireTr(c, TR.create);
  const key = text(input.idempotencyKey, 200) || null;
  if (key) {
    const done = (await client.query(`SELECT * FROM tenant.asset_transfer_orders WHERE organization_id = $1 AND idempotency_key = $2`, [c.organizationId, key])).rows[0];
    if (done) return { ...orderView(done), replayed: true };
  }
  const header = headerOf(input);
  const lines = Array.isArray(input.lines) ? input.lines : [];
  if (!lines.length || lines.length > 300) throw trError(400, "ASSET_TRANSFER_INVALID", "Choose between 1 and 300 assets.", { field: "lines" });
  if (lines.length > 1 && !has(c, TR.bulk)) throw trError(403, "ASSET_TRANSFER_PERMISSION_DENIED", "Transferring several assets at once needs the bulk permission.");
  const checked = [];
  const seen = new Set();
  for (const raw of lines) {
    const r = await checkAsset(client, c, { ...header, id: null }, raw);
    if (r.assetId && seen.has(r.assetId) && !r.error) r.error = { code: "ASSET_TRANSFER_INVALID", message: `${r.asset} is listed twice.` };
    if (r.assetId) seen.add(r.assetId);
    checked.push(r);
  }
  const blocked = checked.filter((r) => r.error);
  if (blocked.length) throw trError(409, blocked[0].error.code, blocked.length === 1 ? blocked[0].error.message : `${blocked.length} of ${checked.length} assets cannot be transferred; remove or fix them first.`,
    { lines: checked.map((r) => ({ asset: r.asset ?? r.input.asset ?? null, assetId: r.assetId ?? null, error: r.error })) });
  const number = await nextNumber(client, c, "asset_transfer", "ATR");
  const o = (await client.query(`INSERT INTO tenant.asset_transfer_orders (organization_id, transfer_number, transfer_type, reason_code, reason_detail, planned_date, expected_arrival_at, expected_return_at, carrier, tracking_reference,
      notes, requested_by, idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [c.organizationId, number, header.transfer_type, header.reason_code, header.reason_detail, header.planned_date, header.expected_arrival_at, header.expected_return_at, header.carrier, header.tracking_reference,
      header.notes, c.userId, key])).rows[0];
  await insertLines(client, c, o, checked, 0);
  await logTransferEvent(client, c, o.id, "CREATED", { to: "DRAFT", details: { assets: checked.length } });
  if (input.submit) return submitAssetTransfer(client, c, o.id, {});
  return orderView(o);
}
async function insertLines(client, c, o, checked, offset) {
  for (const [i, r] of checked.entries()) {
    try {
      await client.query(`INSERT INTO tenant.asset_transfer_lines (organization_id, transfer_id, line_number, asset_id, from_location_id, from_custody_assignment_id, from_custodian_label, to_location_id, to_custodian_type,
          to_user_id, to_department_id, to_store_location_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [c.organizationId, o.id, offset + i + 1, r.assetId, r.from.locationId, r.from.custodyId, r.from.custodian, r.to.locationId, r.to.custodian?.type ?? null, r.to.custodian?.userId ?? null,
          r.to.custodian?.departmentId ?? null, r.to.custodian?.storeLocationId ?? null]);
    } catch (failure) {
      if (failure.code === "23505") throw trError(409, "ASSET_TRANSFER_ALREADY_ACTIVE", `${r.asset} is already in another transfer.`);
      throw failure;
    }
  }
}
export const orderView = (o) => ({ transferId: o.id, number: o.transfer_number, status: o.status, approvalStatus: o.approval_status, version: o.row_version });
// input: { reasonDetail?, plannedDate?, expectedArrivalAt?, expectedReturnAt?, carrier?, trackingReference?, notes?, removeLineIds?, addLines?, expectedVersion } — a draft (or one sent back) only.
export async function updateAssetTransfer(client, c, transferId, input = {}) {
  requireTr(c, TR.create);
  const o = await loadOrder(client, c, transferId);
  versionCheck(o, input.expectedVersion);
  if (!["DRAFT", "CHANGES_REQUESTED"].includes(o.status)) throw trError(409, "ASSET_TRANSFER_INVALID", "Only a draft or a transfer sent back for changes is edited; an approved transfer is cancelled and prepared again.");
  if (o.requested_by !== c.userId && !manages(c)) throw trError(403, "ASSET_TRANSFER_PERMISSION_DENIED");
  const sets = {};
  if (input.reasonDetail !== undefined) sets.reason_detail = text(input.reasonDetail, 1000) || null;
  if (input.plannedDate !== undefined) { const d = dayOf(input.plannedDate); if (!d) throw trError(400, "ASSET_TRANSFER_INVALID", "Enter the planned date."); sets.planned_date = d; }
  if (input.expectedReturnAt !== undefined) sets.expected_return_at = dayOf(input.expectedReturnAt);
  if (input.expectedArrivalAt !== undefined) sets.expected_arrival_at = input.expectedArrivalAt ? new Date(String(input.expectedArrivalAt)).toISOString() : null;
  for (const [k, col] of [["carrier", "carrier"], ["trackingReference", "tracking_reference"], ["notes", "notes"]]) if (input[k] !== undefined) sets[col] = text(input[k], 2000) || null;
  const cols = Object.keys(sets);
  if (cols.length) await client.query(`UPDATE tenant.asset_transfer_orders SET ${cols.map((k, i) => `${k} = $${i + 2}`).join(", ")} WHERE id = $1`, [o.id, ...cols.map((k) => sets[k])]);
  for (const lineId of input.removeLineIds ?? []) {
    await client.query(`UPDATE tenant.asset_transfer_lines SET line_status = 'CANCELLED', close_reason = 'Removed from the draft' WHERE transfer_id = $1 AND id = $2 AND line_status = 'PENDING'`, [o.id, String(lineId)]);
  }
  if (Array.isArray(input.addLines) && input.addLines.length) {
    const header = { ...o, defaults: {} };
    const checked = [];
    for (const raw of input.addLines) checked.push(await checkAsset(client, c, header, raw));
    const blocked = checked.filter((r) => r.error);
    if (blocked.length) throw trError(409, blocked[0].error.code, blocked[0].error.message, { lines: blocked.map((r) => ({ asset: r.asset, error: r.error })) });
    const max = Number((await client.query(`SELECT COALESCE(max(line_number), 0) AS n FROM tenant.asset_transfer_lines WHERE transfer_id = $1`, [o.id])).rows[0].n);
    await insertLines(client, c, o, checked, max);
  }
  if (!(await linesOf(client, o.id)).some((l) => l.line_status === "PENDING")) throw trError(400, "ASSET_TRANSFER_INVALID", "A transfer needs at least one asset; cancel it instead.");
  await logTransferEvent(client, c, o.id, "EDITED", { details: { fields: cols, removed: (input.removeLineIds ?? []).length, added: (input.addLines ?? []).length } });
  return orderView(await loadOrder(client, c, o.id, { lock: false }));
}
// Why a transfer needs approval under the Company's policy (none: it is authorized by the person's own transfer rights).
async function approvalReasons(client, c, o, lines) {
  const settings = await loadSettings(client, c);
  if (settings.require_transfer_approval === false) return [];
  const reasons = new Set();
  for (const l of lines) {
    if (l.to_location_id && l.from_location_id && (await site(client, l.to_location_id)) !== (await site(client, l.from_location_id))) reasons.add("Moves between sites");
    if (l.to_location_id) {
      const kind = (await client.query(`SELECT kind FROM tenant.asset_locations WHERE id = $1`, [l.to_location_id])).rows[0]?.kind;
      if (EXTERNAL_KINDS.includes(kind)) reasons.add("Leaves the Company's premises");
    }
    const a = (await client.query(`SELECT lifecycle_status FROM tenant.assets WHERE id = $1`, [l.asset_id])).rows[0];
    if (a?.lifecycle_status === "RETIRED") reasons.add("A retired asset");
  }
  if (o.transfer_type === "CUSTODY" || o.transfer_type === "RETURN") return [];
  return [...reasons];
}
export async function submitAssetTransfer(client, c, transferId, input = {}) {
  requireTr(c, TR.submit);
  const o = await loadOrder(client, c, transferId);
  versionCheck(o, input.expectedVersion);
  if (!["DRAFT", "CHANGES_REQUESTED"].includes(o.status)) throw trError(409, "ASSET_TRANSFER_INVALID", "Only a draft is submitted.");
  const lines = (await linesOf(client, o.id, { lock: true })).filter((l) => l.line_status === "PENDING");
  if (!lines.length) throw trError(400, "ASSET_TRANSFER_INVALID", "A transfer needs at least one asset.");
  // Revalidated: the assets may have changed since the draft.
  for (const l of lines) {
    const r = await checkAsset(client, c, o, { assetId: l.asset_id, toLocationId: l.to_location_id, toCustodianType: l.to_custodian_type, toUserId: l.to_user_id, toDepartmentId: l.to_department_id, toStoreLocationId: l.to_store_location_id });
    if (r.error) throw trError(409, r.error.code, r.error.message);
  }
  const reasons = await approvalReasons(client, c, o, lines);
  const approved = reasons.length === 0;
  await client.query(`UPDATE tenant.asset_transfer_orders SET status = $2, approval_status = $3, approval_reasons = $4, submitted_at = clock_timestamp() WHERE id = $1`,
    [o.id, approved ? "APPROVED" : "PENDING_APPROVAL", approved ? "NOT_REQUIRED" : "PENDING", JSON.stringify(reasons)]);
  if (approved) await client.query(`UPDATE tenant.asset_transfer_lines SET line_status = 'APPROVED' WHERE transfer_id = $1 AND line_status = 'PENDING'`, [o.id]);
  await logTransferEvent(client, c, o.id, "SUBMITTED", { from: o.status, to: approved ? "APPROVED" : "PENDING_APPROVAL", details: { approval: approved ? "NOT_REQUIRED" : reasons } });
  if (!approved) await tell(client, c, await usersWith(client, c, TR.approve), o, "approval needed", reasons.join("; "));
  return orderView(await loadOrder(client, c, o.id, { lock: false }));
}
// input: { note?, expectedVersion } — the approved details are versioned; the requester never approves their own.
export async function approveAssetTransfer(client, c, transferId, input = {}) {
  requireTr(c, TR.approve);
  const o = await loadOrder(client, c, transferId);
  versionCheck(o, input.expectedVersion);
  if (o.status === "APPROVED") return { ...orderView(o), replayed: true };
  if (o.status !== "PENDING_APPROVAL") throw trError(409, "ASSET_TRANSFER_INVALID", "Only a transfer waiting for approval is approved.");
  const settings = await loadSettings(client, c);
  if (settings.prohibit_self_approval !== false && o.requested_by === c.userId) throw trError(403, "ASSET_TRANSFER_PERMISSION_DENIED", "The person who requested a transfer cannot approve it.");
  await client.query(`UPDATE tenant.asset_transfer_orders SET status = 'APPROVED', approval_status = 'APPROVED', approved_by = $2, approved_at = clock_timestamp(), approved_version = row_version + 1, decision_note = $3 WHERE id = $1`,
    [o.id, c.userId, text(input.note, 1000) || null]);
  await client.query(`UPDATE tenant.asset_transfer_lines SET line_status = 'APPROVED' WHERE transfer_id = $1 AND line_status = 'PENDING'`, [o.id]);
  await logTransferEvent(client, c, o.id, "APPROVED", { from: o.status, to: "APPROVED", reason: text(input.note, 1000) || null });
  await tell(client, c, [o.requested_by], o, "approved", input.note);
  return orderView(await loadOrder(client, c, o.id, { lock: false }));
}
export async function requestTransferChanges(client, c, transferId, input = {}) {
  requireTr(c, TR.reject);
  const o = await loadOrder(client, c, transferId);
  versionCheck(o, input.expectedVersion);
  if (o.status !== "PENDING_APPROVAL") throw trError(409, "ASSET_TRANSFER_INVALID", "Only a transfer waiting for approval is sent back.");
  const note = text(input.note, 1000);
  if (note.length < 3) throw trError(400, "ASSET_TRANSFER_INVALID", "Say what needs to change.", { field: "note" });
  await client.query(`UPDATE tenant.asset_transfer_orders SET status = 'CHANGES_REQUESTED', approval_status = 'CHANGES_REQUESTED', decision_note = $2 WHERE id = $1`, [o.id, note]);
  await logTransferEvent(client, c, o.id, "CHANGES_REQUESTED", { from: o.status, to: "CHANGES_REQUESTED", reason: note });
  await tell(client, c, [o.requested_by], o, "changes requested", note);
  return orderView(await loadOrder(client, c, o.id, { lock: false }));
}
export async function rejectAssetTransfer(client, c, transferId, input = {}) {
  requireTr(c, TR.reject);
  const o = await loadOrder(client, c, transferId);
  if (!["PENDING_APPROVAL", "CHANGES_REQUESTED"].includes(o.status)) throw trError(409, "ASSET_TRANSFER_INVALID", "Only a transfer waiting for a decision is rejected.");
  const reason = text(input.reason, 1000);
  if (reason.length < 3) throw trError(400, "ASSET_TRANSFER_INVALID", "Give the reason.", { field: "reason" });
  await client.query(`UPDATE tenant.asset_transfer_lines SET line_status = 'REJECTED', close_reason = $2 WHERE transfer_id = $1 AND line_status = ANY($3::text[])`, [o.id, reason, ACTIVE_LINES]);
  await client.query(`UPDATE tenant.asset_transfer_orders SET status = 'REJECTED', approval_status = 'REJECTED', decision_note = $2 WHERE id = $1`, [o.id, reason]);
  await logTransferEvent(client, c, o.id, "REJECTED", { from: o.status, to: "REJECTED", reason });
  await tell(client, c, [o.requested_by], o, "rejected", reason);
  return { transferId: o.id, number: o.transfer_number, status: "REJECTED" };
}
// Before anything left: the reservation is released and the history kept. After dispatch: refused — return or resolve instead.
export async function cancelAssetTransfer(client, c, transferId, input = {}) {
  const o = await loadOrder(client, c, transferId);
  if (o.status === "CANCELLED") return { transferId: o.id, number: o.transfer_number, status: "CANCELLED", replayed: true };
  if (!has(c, TR.cancel) && !(o.requested_by === c.userId && ["DRAFT", "CHANGES_REQUESTED", "PENDING_APPROVAL"].includes(o.status))) throw trError(403, "ASSET_TRANSFER_PERMISSION_DENIED");
  const lines = await linesOf(client, o.id, { lock: true });
  if (lines.some((l) => l.dispatched_at) || !["DRAFT", "PENDING_APPROVAL", "CHANGES_REQUESTED", "APPROVED"].includes(o.status)) throw trError(409, "ASSET_TRANSFER_CANNOT_CANCEL");
  const reason = text(input.reason, 1000);
  if (reason.length < 3) throw trError(400, "ASSET_TRANSFER_INVALID", "Give the reason.", { field: "reason" });
  await client.query(`UPDATE tenant.asset_transfer_lines SET line_status = 'CANCELLED', close_reason = $2 WHERE transfer_id = $1 AND line_status = ANY($3::text[])`, [o.id, reason, ACTIVE_LINES]);
  await client.query(`UPDATE tenant.asset_transfer_orders SET status = 'CANCELLED', cancelled_by = $2, cancelled_at = clock_timestamp(), cancel_reason = $3 WHERE id = $1`, [o.id, c.userId, reason]);
  await logTransferEvent(client, c, o.id, "CANCELLED", { from: o.status, to: "CANCELLED", reason });
  return { transferId: o.id, number: o.transfer_number, status: "CANCELLED" };
}

// ------------------------------------------------------------------ dispatch
// Who may act at the source: the asset team, the source location's manager, or the person holding the asset.
async function actsAtSource(client, c, line) {
  if (manages(c)) return true;
  const a = (await client.query(`SELECT current_user_id FROM tenant.assets WHERE id = $1`, [line.asset_id])).rows[0];
  if (a?.current_user_id === c.userId) return true;
  return line.from_location_id ? Boolean((await client.query(`SELECT 1 FROM tenant.asset_locations WHERE id = $1 AND manager_user_id = $2`, [line.from_location_id, c.userId])).rows[0]) : false;
}
async function actsAtDestination(client, c, line) {
  if (manages(c)) return true;
  if (line.to_user_id === c.userId) return true;
  for (const loc of [line.to_location_id, line.to_store_location_id].filter(Boolean)) {
    if ((await client.query(`SELECT 1 FROM tenant.asset_locations WHERE id = $1 AND manager_user_id = $2`, [loc, c.userId])).rows[0]) return true;
  }
  return false;
}
// The authority a confirmed transfer step carries into the workflows it coordinates (location, condition, custody, missing report): the
// person was authorized for the step itself, not for the register at large.
const custodyCtx = (c) => ({ ...c, permissions: [...new Set([...(c.permissions ?? []), "assets.verify", "assets.custody.assign", "assets.custody.reassign", "assets.custody.return", "assets.status.condition_update",
  "assets.status.report_missing"])] });
// input: { lineIds?, condition, conditions?: { [lineId]: condition }, dispatchedAt?, transitHolder?, carrier?, trackingReference?, expectedArrivalAt?, notes?, commandId? } — the physical release.
// A custody transfer has no journey: its dispatch is the handover itself, recorded in the Custodian workflow.
export async function dispatchAssetTransfer(client, c, transferId, input = {}) {
  requireTr(c, TR.dispatch);
  const command = text(input.commandId, 200) || null;
  const o = await loadOrder(client, c, transferId);
  if (await commandDone(client, c, command)) return { ...orderView(o), replayed: true };
  if (["PENDING_APPROVAL", "DRAFT", "CHANGES_REQUESTED"].includes(o.status)) throw trError(409, "ASSET_TRANSFER_APPROVAL_REQUIRED");
  if (!["APPROVED", "IN_TRANSIT", "PARTIALLY_RECEIVED", "RECEIPT_EXCEPTION"].includes(o.status)) throw trError(409, "ASSET_TRANSFER_INVALID", "This transfer is closed.");
  const all = await linesOf(client, o.id, { lock: true });
  const wanted = input.lineIds ? new Set(input.lineIds.map(String)) : null;
  const lines = all.filter((l) => l.line_status === "APPROVED" && (!wanted || wanted.has(l.id)));
  if (!lines.length) throw trError(409, "ASSET_TRANSFER_INVALID", "Nothing in this transfer is waiting to be dispatched.");
  const at = timeOf(input.dispatchedAt);
  const results = [];
  for (const l of lines) {
    if (!(await actsAtSource(client, c, l))) throw trError(403, "ASSET_TRANSFER_PERMISSION_DENIED", "Only the asset team, the source location's manager or the holder confirms dispatch.");
    const condition = conditionOf(input.conditions?.[l.id] ?? input.condition, "condition at dispatch");
    const a = (await client.query(`SELECT * FROM tenant.assets WHERE id = $1 FOR UPDATE`, [l.asset_id])).rows[0];
    if (a.lifecycle_status === "LOST" || a.lifecycle_status === "DISPOSED") throw trError(409, "ASSET_TRANSFER_ASSET_UNAVAILABLE", `${a.asset_number} can no longer be moved.`);
    if (condition !== a.condition) {
      const { recordAssetCondition } = await import("../asset-status/status-commands.js");
      await recordAssetCondition(client, custodyCtx(c), a.id, { condition, reason: `Observed at dispatch (${o.transfer_number})` }, { fromVerification: true, source: "INSPECTION" });
    }
    if (o.transfer_type === "CUSTODY") {
      const { requestCustodyHandover } = await import("../asset-custody/custody-commands.js");
      const h = await requestCustodyHandover(client, custodyCtx(c), a.id, { toType: l.to_custodian_type, userId: l.to_user_id, departmentId: l.to_department_id, storeLocationId: l.to_store_location_id,
        handOverNow: true, condition, handedOverAt: at, notes: `Transfer ${o.transfer_number}` });
      await client.query(`UPDATE tenant.asset_transfer_lines SET line_status = 'COMPLETED', dispatched_at = $2, dispatched_by = $3, dispatch_condition = $4, completed_at = clock_timestamp(), custody_handover_id = $5,
          custody_outcome = 'HANDED_OVER' WHERE id = $1`, [l.id, at, c.userId, condition, h.handoverId]);
      await logTransferEvent(client, c, o.id, "HANDED_OVER", { lineId: l.id, assetId: a.id, from: "APPROVED", to: "COMPLETED", details: { handoverId: h.handoverId, condition }, commandId: command ? `${command}:${l.line_number}` : null });
      results.push({ lineId: l.id, status: "COMPLETED", handoverId: h.handoverId });
      continue;
    }
    await client.query(`UPDATE tenant.asset_transfer_lines SET line_status = 'DISPATCHED', dispatched_at = $2, dispatched_by = $3, dispatch_condition = $4, transit_holder = $5 WHERE id = $1`,
      [l.id, at, c.userId, condition, text(input.transitHolder, 200) || null]);
    await logTransferEvent(client, c, o.id, "DISPATCHED", { lineId: l.id, assetId: a.id, from: "APPROVED", to: "DISPATCHED", details: { condition, transitHolder: text(input.transitHolder, 200) || null },
      commandId: command ? `${command}:${l.line_number}` : null });
    await recordAssetEvent(client, c, a.id, "asset.transfer_dispatched", { transferId: o.id, number: o.transfer_number });
    results.push({ lineId: l.id, status: "DISPATCHED" });
  }
  const sets = [];
  const values = [o.id];
  for (const [k, col] of [["carrier", "carrier"], ["trackingReference", "tracking_reference"]]) if (input[k]) { values.push(text(input[k], 200)); sets.push(`${col} = $${values.length}`); }
  if (input.expectedArrivalAt) { values.push(new Date(String(input.expectedArrivalAt)).toISOString()); sets.push(`expected_arrival_at = $${values.length}`); }
  if (sets.length) await client.query(`UPDATE tenant.asset_transfer_orders SET ${sets.join(", ")} WHERE id = $1`, values);
  if (command) await logTransferEvent(client, c, o.id, "DISPATCH_COMMAND", { details: { lines: results.length }, commandId: command });
  const status = await refreshOrder(client, c, o.id);
  if (o.transfer_type !== "CUSTODY") {
    const dest = (await client.query(`SELECT DISTINCT l2.manager_user_id FROM tenant.asset_transfer_lines l JOIN tenant.asset_locations l2 ON l2.id = l.to_location_id WHERE l.transfer_id = $1`, [o.id])).rows.map((r) => r.manager_user_id);
    await tell(client, c, [...dest, ...lines.map((l) => l.to_user_id)], o, "dispatched — receipt required", `${results.length} asset(s) on the way.`);
  }
  return { transferId: o.id, number: o.transfer_number, status, results };
}

// ------------------------------------------------------------------ identity
// Is what was scanned (code, serial, tag, previous code or label) this asset? Checked against the asset itself, whatever the scanner may see.
export async function identifies(client, c, asset, scanned) {
  const { normalizeIdentifier } = await import("../asset-identification/ident-rules.js");
  if (String(scanned).startsWith("VLAST:")) return String(scanned).slice(6) === String(asset.qr_token ?? "");
  const n = normalizeIdentifier(scanned);
  if (!n) return false;
  if ([normalizeIdentifier(asset.asset_number), asset.serial_normalized, asset.tag_normalized, asset.legacy_normalized].includes(n)) return true;
  return Boolean((await client.query(`SELECT 1 FROM tenant.asset_identifier_aliases WHERE organization_id = $1 AND asset_id = $2 AND normalized = $3 AND active`, [c.organizationId, asset.id, n]).catch(() => ({ rows: [] }))).rows[0]);
}
async function whichAsset(client, c, scanned) {
  const { normalizeIdentifier } = await import("../asset-identification/ident-rules.js");
  const n = normalizeIdentifier(scanned);
  if (!n) return null;
  return (await client.query(`SELECT asset_number FROM tenant.assets WHERE organization_id = $1 AND (upper(asset_number) = $2 OR serial_normalized = $2 OR tag_normalized = $2 OR legacy_normalized = $2) LIMIT 1`, [c.organizationId, n])).rows[0]?.asset_number ?? null;
}

// ------------------------------------------------------------------ receipt
// input: { identifier, condition, receivedAt?, handedToCustodian?, notes?, commandId? } — the receiver checks the asset that arrived (its code,
// serial, tag or label) and its condition. A different asset is an exception, never silently accepted. On acceptance the registered
// location changes once (the location record) and custody follows the Custodian handover: handed to the receiving person now (they then
// acknowledge), or held by the destination store until it is issued, or pending with the current custodian.
export async function receiveTransferLine(client, c, transferId, lineId, input = {}) {
  requireTr(c, TR.receive);
  const command = text(input.commandId, 200) || null;
  const o = await loadOrder(client, c, transferId);
  const l = (await client.query(`SELECT * FROM tenant.asset_transfer_lines WHERE transfer_id = $1 AND id = $2 FOR UPDATE`, [o.id, idOf(lineId, "Line")])).rows[0];
  if (!l) throw trError(404, "ASSET_TRANSFER_NOT_FOUND", "That transfer line was not found.");
  if (await commandDone(client, c, command)) return { transferId: o.id, lineId: l.id, lineStatus: l.line_status, replayed: true };
  if (["RECEIVED", "COMPLETED"].includes(l.line_status)) throw trError(409, "ASSET_TRANSFER_ALREADY_RECEIVED");
  if (l.line_status !== "DISPATCHED") throw trError(409, "ASSET_TRANSFER_NOT_DISPATCHED");
  if (!(await actsAtDestination(client, c, l))) throw trError(403, "ASSET_TRANSFER_PERMISSION_DENIED", "Only the destination's manager, the receiving custodian or the asset team confirms receipt.");
  const condition = conditionOf(input.condition, "condition at receipt");
  const a = (await client.query(`SELECT * FROM tenant.assets WHERE id = $1 FOR UPDATE`, [l.asset_id])).rows[0];
  // Identity.
  const scanned = text(input.identifier, 200);
  if (!scanned) throw trError(400, "ASSET_TRANSFER_INVALID", "Scan or type the asset code, serial or tag of what arrived.", { field: "identifier" });
  if (!(await identifies(client, c, a, scanned))) {
    const other = await whichAsset(client, c, scanned);
    const ex = await openException(client, c, o, l, { type: "WRONG_ASSET", description: `Expected ${a.asset_number}; received ${scanned}${other ? ` (that is ${other})` : " (not recognised)"}.`,
      expected: a.asset_number, observed: scanned, condition });
    await client.query(`UPDATE tenant.asset_transfer_lines SET line_status = 'RECEIPT_EXCEPTION', receipt_identifier = $2 WHERE id = $1`, [l.id, scanned]);
    await logTransferEvent(client, c, o.id, "RECEIPT_MISMATCH", { lineId: l.id, assetId: a.id, from: "DISPATCHED", to: "RECEIPT_EXCEPTION", details: { expected: a.asset_number, observed: scanned }, commandId: command });
    await refreshOrder(client, c, o.id);
    return { transferId: o.id, lineId: l.id, lineStatus: "RECEIPT_EXCEPTION", code: "ASSET_TRANSFER_RECEIPT_MISMATCH", exceptionId: ex.id };
  }
  return acceptReceipt(client, c, o, l, a, { condition, at: timeOf(input.receivedAt), handed: input.handedToCustodian === true, identifier: scanned, notes: text(input.notes, 1000) || null, command });
}
async function acceptReceipt(client, c, o, l, a, { condition, at, handed, identifier, notes, command }) {
  // Received first: the asset leaves "in transfer" before its custody moves.
  await client.query(`UPDATE tenant.asset_transfer_lines SET line_status = 'RECEIVED', received_at = $2, received_by = $3, receipt_condition = $4, receipt_identifier = $5 WHERE id = $1`, [l.id, at, c.userId, condition, identifier]);
  const { withStatusContext } = await import("../asset-status/status-commands.js");
  let locationEventId = null;
  if (l.to_location_id && l.to_location_id !== a.location_id) {
    await withStatusContext(client, c, { action: "transfer", locationEvent: "TRANSFER", reason: `Transfer ${o.transfer_number}`, effective: at.slice(0, 10), sourceType: "asset_transfer_line", sourceId: l.id },
      () => client.query(`UPDATE tenant.assets SET location_id = $3 WHERE organization_id = $1 AND id = $2`, [c.organizationId, a.id, l.to_location_id]));
    locationEventId = (await client.query(`SELECT id FROM tenant.asset_location_events WHERE asset_id = $1 AND source_id = $2 ORDER BY effective_at DESC LIMIT 1`, [a.id, l.id])).rows[0]?.id ?? null;
  }
  if (condition !== a.condition) {
    const { recordAssetCondition } = await import("../asset-status/status-commands.js");
    await recordAssetCondition(client, custodyCtx(c), a.id, { condition, reason: `Observed at receipt (${o.transfer_number})` }, { fromVerification: true, source: "INSPECTION" });
  }
  // Custody, through the Custodian workflow.
  let outcome = null;
  let handoverId = null;
  if (l.to_custodian_type && o.transfer_type !== "TEMPORARY") {
    const { requestCustodyHandover } = await import("../asset-custody/custody-commands.js");
    const cc = custodyCtx(c);
    const to = { toType: l.to_custodian_type, userId: l.to_user_id, departmentId: l.to_department_id, storeLocationId: l.to_store_location_id, notes: `Transfer ${o.transfer_number}` };
    const store = l.to_location_id ? (await client.query(`SELECT id FROM tenant.asset_locations WHERE id = $1 AND is_asset_store AND manager_user_id IS NOT NULL`, [l.to_location_id])).rows[0] : null;
    const fresh = (await client.query(`SELECT * FROM tenant.assets WHERE id = $1`, [a.id])).rows[0];
    if (handed || l.to_custodian_type !== "EMPLOYEE") {
      handoverId = (await requestCustodyHandover(client, cc, a.id, { ...to, handOverNow: true, condition, handedOverAt: at })).handoverId;
      outcome = "HANDED_OVER";
    } else if (store && fresh.current_store_location_id !== store.id) {
      await requestCustodyHandover(client, cc, a.id, { toType: "ASSET_STORE", storeLocationId: store.id, handOverNow: true, condition, handedOverAt: at, notes: `Received into store (${o.transfer_number})` });
      handoverId = (await requestCustodyHandover(client, cc, a.id, to).catch((e) => (e.code === "ASSET_CUSTODY_ASSET_UNAVAILABLE" ? { handoverId: null } : Promise.reject(e)))).handoverId;
      outcome = "IN_STORE_PENDING_ISSUE";
    } else {
      handoverId = (await requestCustodyHandover(client, cc, a.id, to).catch((e) => (e.code === "ASSET_CUSTODY_ASSET_UNAVAILABLE" ? { handoverId: null } : Promise.reject(e)))).handoverId;
      outcome = "PENDING_HANDOVER";
    }
  }
  await client.query(`UPDATE tenant.asset_transfer_lines SET line_status = 'COMPLETED', completed_at = clock_timestamp(), location_event_id = $2, custody_handover_id = $3, custody_outcome = $4 WHERE id = $1`,
    [l.id, locationEventId, handoverId, outcome]);
  // Damage on arrival: the delivery is confirmed, the condition stays open as an exception.
  let exceptionId = null;
  if (["DAMAGED", "UNSERVICEABLE"].includes(condition) && !["DAMAGED", "UNSERVICEABLE"].includes(l.dispatch_condition ?? "")) {
    exceptionId = (await openException(client, c, o, l, { type: "DAMAGED", description: notes || `Arrived ${condition.toLowerCase()} (dispatched ${String(l.dispatch_condition ?? "").toLowerCase()}).`, condition })).id;
  }
  await logTransferEvent(client, c, o.id, "RECEIVED", { lineId: l.id, assetId: a.id, from: "DISPATCHED", to: "COMPLETED", details: { condition, locationEventId, custody: outcome, handoverId }, reason: notes, commandId: command });
  await recordAssetEvent(client, c, a.id, "asset.transferred", { transferId: o.id, number: o.transfer_number });
  const status = await refreshOrder(client, c, o.id);
  if (status === "COMPLETED") await tell(client, c, [o.requested_by], o, "completed", null);
  return { transferId: o.id, lineId: l.id, lineStatus: "COMPLETED", custodyOutcome: outcome, handoverId, exceptionId, transferStatus: status };
}
// The transfer's state from its lines: a partly received transfer is never shown as complete.
export async function refreshOrder(client, c, orderId) {
  const o = (await client.query(`SELECT * FROM tenant.asset_transfer_orders WHERE id = $1`, [orderId])).rows[0];
  if (["DRAFT", "PENDING_APPROVAL", "CHANGES_REQUESTED", "REJECTED", "CANCELLED", "COMPLETED"].includes(o.status)) return o.status;
  const lines = await linesOf(client, orderId);
  const count = (s) => lines.filter((l) => s.includes(l.line_status)).length;
  const live = lines.filter((l) => !["CANCELLED", "REJECTED"].includes(l.line_status));
  let status;
  if (count(["RECEIPT_EXCEPTION"]) > 0) status = "RECEIPT_EXCEPTION";
  else if (live.length && live.every((l) => ["COMPLETED", "RETURNED"].includes(l.line_status))) status = "COMPLETED";
  else if (count(["DISPATCHED", "RETURN_IN_PROGRESS"]) > 0 && count(["COMPLETED", "RETURNED"]) > 0) status = "PARTIALLY_RECEIVED";
  else if (count(["DISPATCHED", "RETURN_IN_PROGRESS"]) > 0) status = "IN_TRANSIT";
  else if (count(["COMPLETED", "RETURNED"]) > 0) status = "PARTIALLY_RECEIVED";
  else status = "APPROVED";
  if (!live.length) status = "CANCELLED";
  if (status !== o.status) await client.query(`UPDATE tenant.asset_transfer_orders SET status = $2, completed_at = CASE WHEN $2 = 'COMPLETED' THEN clock_timestamp() ELSE completed_at END WHERE id = $1`, [orderId, status]);
  return status;
}

// ------------------------------------------------------------------ exceptions
async function openException(client, c, o, l, { type, description, expected = null, observed = null, condition = null, incidentId = null }) {
  const made = (await client.query(`INSERT INTO tenant.asset_transfer_exceptions (organization_id, transfer_id, line_id, asset_id, exception_type, description, observed_condition, expected_identifier, observed_identifier,
      related_incident_id, reported_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id, exception_number`, [c.organizationId, o.id, l.id, l.asset_id, type, description, condition, expected, observed, incidentId, c.userId])).rows[0];
  await tell(client, c, await usersWith(client, c, TR.manageException), o, `exception: ${type.toLowerCase().replace(/_/g, " ")}`, description);
  return made;
}
// input: { type: MISSING | DISPUTED | DAMAGED | OTHER, description, observedCondition? } — recorded, never a conclusion. Missing in transit opens a
// missing-asset investigation (not a loss, not a write-off) and keeps the asset out of ordinary use.
export async function reportTransferException(client, c, transferId, lineId, input = {}) {
  requireTr(c, TR.reportException);
  const o = await loadOrder(client, c, transferId);
  const l = (await client.query(`SELECT * FROM tenant.asset_transfer_lines WHERE transfer_id = $1 AND id = $2 FOR UPDATE`, [o.id, idOf(lineId, "Line")])).rows[0];
  if (!l) throw trError(404, "ASSET_TRANSFER_NOT_FOUND", "That transfer line was not found.");
  const type = String(input.type ?? "").toUpperCase();
  if (!["MISSING", "DISPUTED", "DAMAGED", "OTHER"].includes(type)) throw trError(400, "ASSET_TRANSFER_INVALID", "Choose what went wrong.", { field: "type" });
  const description = text(input.description, 1000);
  if (description.length < 3) throw trError(400, "ASSET_TRANSFER_INVALID", "Describe what happened.", { field: "description" });
  if (!(await actsAtDestination(client, c, l)) && !(await actsAtSource(client, c, l))) throw trError(403, "ASSET_TRANSFER_PERMISSION_DENIED");
  let incidentId = null;
  if (type === "MISSING") {
    if (l.line_status !== "DISPATCHED") throw trError(409, "ASSET_TRANSFER_NOT_DISPATCHED", "Only an asset in transit can go missing in transit.");
    const { reportMissingAsset } = await import("../asset-status/status-commands.js");
    // Reported for the asset whoever reports it (the receiver need not manage the register).
    incidentId = (await reportMissingAsset(client, custodyCtx(c), l.asset_id, { description: `Missing in transit (${o.transfer_number}): ${description}` }, { fromVerification: true })).incidentId;
  } else if (type !== "DAMAGED" && !["DISPATCHED", "RECEIPT_EXCEPTION", "COMPLETED"].includes(l.line_status)) throw trError(409, "ASSET_TRANSFER_NOT_DISPATCHED");
  const condition = input.observedCondition ? conditionOf(input.observedCondition) : null;
  const ex = await openException(client, c, o, l, { type, description, condition, incidentId });
  if (["MISSING", "DISPUTED"].includes(type) && l.line_status === "DISPATCHED") await client.query(`UPDATE tenant.asset_transfer_lines SET line_status = 'RECEIPT_EXCEPTION' WHERE id = $1`, [l.id]);
  await logTransferEvent(client, c, o.id, "EXCEPTION_REPORTED", { lineId: l.id, assetId: l.asset_id, details: { type, exceptionId: ex.id, incidentId }, reason: description });
  await refreshOrder(client, c, o.id);
  return { exceptionId: ex.id, number: `TEX-${ex.exception_number}`, incidentId };
}
// input: { resolution: RECEIVED | CORRECTED | ACCEPTED | RETURN_TO_SOURCE | LOST_INVESTIGATION, note, identifier?, condition?, handedToCustodian? } — a controlled decision.
export async function resolveTransferException(client, c, exceptionId, input = {}) {
  requireTr(c, TR.manageException);
  const ex = (await client.query(`SELECT * FROM tenant.asset_transfer_exceptions WHERE organization_id = $1 AND id = $2 FOR UPDATE`, [c.organizationId, idOf(exceptionId, "Exception")])).rows[0];
  if (!ex) throw trError(404, "ASSET_TRANSFER_NOT_FOUND", "That exception was not found.");
  if (ex.status === "RESOLVED") return { exceptionId: ex.id, status: "RESOLVED", replayed: true };
  const resolution = String(input.resolution ?? "").toUpperCase();
  const note = text(input.note, 1000);
  if (note.length < 3) throw trError(400, "ASSET_TRANSFER_INVALID", "Explain the resolution.", { field: "note" });
  const o = await loadOrder(client, c, ex.transfer_id);
  const l = (await client.query(`SELECT * FROM tenant.asset_transfer_lines WHERE id = $1 FOR UPDATE`, [ex.line_id])).rows[0];
  const a = (await client.query(`SELECT * FROM tenant.assets WHERE id = $1 FOR UPDATE`, [l.asset_id])).rows[0];
  let result = {};
  if (["RECEIVED", "CORRECTED"].includes(resolution) || (resolution === "ACCEPTED" && l.line_status === "RECEIPT_EXCEPTION")) {
    if (l.line_status !== "RECEIPT_EXCEPTION") throw trError(409, "ASSET_TRANSFER_INVALID", "This line has nothing waiting to be received.");
    const scanned = text(input.identifier, 200);
    if (!scanned || !(await identifies(client, c, a, scanned))) throw trError(409, "ASSET_TRANSFER_RECEIPT_MISMATCH", `Scan ${a.asset_number} itself to receive it.`);
    if (ex.related_incident_id) {
      const { closeMissingReport } = await import("../asset-status/status-commands.js");
      await closeMissingReport(client, { ...c, permissions: [...new Set([...(c.permissions ?? []), "assets.status.confirm_lost"])] }, a.id, { note: `Found: ${note}` }).catch(() => null);
    }
    await client.query(`UPDATE tenant.asset_transfer_lines SET line_status = 'DISPATCHED' WHERE id = $1`, [l.id]);
    result = await acceptReceipt(client, c, o, { ...l, line_status: "DISPATCHED" }, a, { condition: conditionOf(input.condition ?? ex.observed_condition ?? a.condition, "condition at receipt"), at: new Date().toISOString(),
      handed: input.handedToCustodian === true, identifier: scanned, notes: note, command: null });
  } else if (resolution === "RETURN_TO_SOURCE") {
    if (!["RECEIPT_EXCEPTION", "DISPATCHED"].includes(l.line_status)) throw trError(409, "ASSET_TRANSFER_INVALID", "Only an asset still on its way (or disputed) is returned to the source.");
    if (ex.related_incident_id) {
      const { closeMissingReport } = await import("../asset-status/status-commands.js");
      await closeMissingReport(client, { ...c, permissions: [...new Set([...(c.permissions ?? []), "assets.status.confirm_lost"])] }, a.id, { note: `Returned to source: ${note}` }).catch(() => null);
    }
    await client.query(`UPDATE tenant.asset_transfer_lines SET line_status = 'RETURNED', close_reason = $2 WHERE id = $1`, [l.id, `Returned to the source: ${note}`]);
  } else if (resolution === "LOST_INVESTIGATION") {
    if (!["RECEIPT_EXCEPTION", "DISPATCHED"].includes(l.line_status)) throw trError(409, "ASSET_TRANSFER_INVALID", "Only an asset still on its way is left to the loss investigation.");
    await client.query(`UPDATE tenant.asset_transfer_lines SET line_status = 'CANCELLED', close_reason = $2 WHERE id = $1`, [l.id, `Not received — left to the missing-asset investigation: ${note}`]);
  } else if (resolution === "ACCEPTED") {
    // Damage accepted: the asset was received; the condition record and any maintenance follow their own workflows.
  } else throw trError(400, "ASSET_TRANSFER_INVALID", "Choose how the exception is resolved.");
  await client.query(`UPDATE tenant.asset_transfer_exceptions SET status = 'RESOLVED', resolution = $2, resolution_note = $3, resolved_by = $4, resolved_at = clock_timestamp() WHERE id = $1`,
    [ex.id, resolution, note, c.userId]);
  await logTransferEvent(client, c, o.id, "EXCEPTION_RESOLVED", { lineId: l.id, assetId: l.asset_id, details: { exceptionId: ex.id, resolution }, reason: note });
  const status = await refreshOrder(client, c, o.id);
  return { exceptionId: ex.id, status: "RESOLVED", resolution, transferStatus: status, ...result };
}

// ------------------------------------------------------------------ temporary movements: the return leg
// input: { lineIds?, plannedDate?, notes? } — back to where each asset came from, linked to the outbound movement; already authorized.
export async function createReturnTransfer(client, c, transferId, input = {}) {
  requireTr(c, TR.create);
  const o = await loadOrder(client, c, transferId);
  if (o.transfer_type !== "TEMPORARY") throw trError(409, "ASSET_TRANSFER_INVALID", "Only a temporary movement has a return.");
  const done = (await client.query(`SELECT * FROM tenant.asset_transfer_orders WHERE return_of_id = $1 AND status NOT IN ('CANCELLED', 'REJECTED')`, [o.id])).rows[0];
  if (done) return { ...orderView(done), replayed: true };
  const wanted = input.lineIds ? new Set(input.lineIds.map(String)) : null;
  const lines = (await linesOf(client, o.id)).filter((l) => l.line_status === "COMPLETED" && (!wanted || wanted.has(l.id)));
  if (!lines.length) throw trError(409, "ASSET_TRANSFER_INVALID", "Nothing from this movement has arrived to be returned yet.");
  const number = await nextNumber(client, c, "asset_transfer", "ATR");
  const r = (await client.query(`INSERT INTO tenant.asset_transfer_orders (organization_id, transfer_number, transfer_type, reason_code, reason_detail, status, approval_status, planned_date, return_of_id, notes, requested_by, submitted_at)
      VALUES ($1,$2,'RETURN','RETURN_FROM_REPAIR',$3,'APPROVED','NOT_REQUIRED',$4,$5,$6,$7,clock_timestamp()) RETURNING *`,
    [c.organizationId, number, `Return of ${o.transfer_number}`, dayOf(input.plannedDate) ?? todayIso(), o.id, text(input.notes, 1000) || null, c.userId])).rows[0];
  for (const [i, l] of lines.entries()) {
    const a = (await client.query(`SELECT location_id FROM tenant.assets WHERE id = $1`, [l.asset_id])).rows[0];
    try {
      await client.query(`INSERT INTO tenant.asset_transfer_lines (organization_id, transfer_id, line_number, asset_id, from_location_id, to_location_id, line_status) VALUES ($1,$2,$3,$4,$5,$6,'APPROVED')`,
        [c.organizationId, r.id, i + 1, l.asset_id, a.location_id, l.from_location_id]);
    } catch (failure) { if (failure.code === "23505") throw trError(409, "ASSET_TRANSFER_ALREADY_ACTIVE"); throw failure; }
  }
  await logTransferEvent(client, c, r.id, "CREATED", { to: "APPROVED", details: { returnOf: o.transfer_number, assets: lines.length } });
  await logTransferEvent(client, c, o.id, "RETURN_CREATED", { details: { returnTransferId: r.id, number } });
  return orderView(r);
}

// ------------------------------------------------------------------ reminders
// Expected arrivals passed without receipt and temporary returns overdue: the requester and the asset team are told (to be scheduled).
export async function sendTransferReminders(client, c) {
  requireTr(c, TR.manageException);
  const late = (await client.query(`SELECT DISTINCT o.* FROM tenant.asset_transfer_orders o JOIN tenant.asset_transfer_lines l ON l.transfer_id = o.id WHERE o.organization_id = $1 AND l.line_status = 'DISPATCHED'
      AND o.expected_arrival_at < now()`, [c.organizationId])).rows;
  const team = await usersWith(client, c, TR.manageException);
  for (const o of late) await tell(client, c, [o.requested_by, ...team], o, "expected arrival passed — no receipt yet", null);
  const overdue = (await client.query(`SELECT o.* FROM tenant.asset_transfer_orders o WHERE o.organization_id = $1 AND o.transfer_type = 'TEMPORARY' AND o.status IN ('COMPLETED', 'PARTIALLY_RECEIVED') AND o.expected_return_at < current_date
      AND NOT EXISTS (SELECT 1 FROM tenant.asset_transfer_orders r WHERE r.return_of_id = o.id AND r.status = 'COMPLETED')`, [c.organizationId])).rows;
  for (const o of overdue) await tell(client, c, [o.requested_by, ...team], o, "temporary return overdue", `Expected back ${dayOfDb(o.expected_return_at)}.`);
  return { lateArrivals: late.length, overdueReturns: overdue.length };
}
