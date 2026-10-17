// Assets — Asset Maintenance, the commands: a reported problem (with an immediate safety restriction when it may be unsafe), triage, the
// Work Order from approval to closure — assignment, schedule, start (the asset's maintenance restriction), diagnosis, checklist, parts and
// vendor costs linked from their authoritative documents, technician completion, an independent verification and the return to service —
// and preventive plans that generate one Work Order per due occurrence. Availability is always recomputed from every restriction.
import { createNotification } from "../../../core/platform/notifications/index.js";
import { has, loadSettings, nextNumber, recordAssetEvent, text, uuid } from "../common.js";
import { normalizeIdentifier } from "../asset-identification/ident-rules.js";
import { CONDITIONS, MT, OPEN_WO, PRIORITIES, TYPES, WORKING, addInterval, dayOfDb, maintenanceTeam, mtError, requireMt } from "./mt-rules.js";

const today = () => new Date().toISOString().slice(0, 10);
const oneOf = (v, allowed, fallback, field) => {
  const x = v === undefined || v === null || v === "" ? fallback : String(v).toUpperCase();
  if (!allowed.includes(x)) throw mtError(400, "ASSET_MAINTENANCE_INVALID", `Choose a valid ${field}.`, { field });
  return x;
};
const timeOf = (v, field) => {
  if (v === undefined || v === null || v === "") return null;
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) throw mtError(400, "ASSET_MAINTENANCE_INVALID", `Enter a valid ${field}.`, { field });
  return d.toISOString();
};

export async function logMaintenanceEvent(client, c, refs, action, { from = null, to = null, details = {}, reason = null, commandId = null } = {}) {
  await client.query(`INSERT INTO tenant.asset_maintenance_events (organization_id, asset_id, request_id, work_order_id, plan_id, action, from_status, to_status, details, reason, actor_user_id, command_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [c.organizationId, refs.assetId ?? null, refs.requestId ?? null, refs.workOrderId ?? null, refs.planId ?? null, action, from, to, JSON.stringify(details), reason, c.userId ?? null, commandId]);
}
const replayed = async (client, c, commandId) => commandId && (await client.query(`SELECT 1 FROM tenant.asset_maintenance_events WHERE organization_id = $1 AND command_id = $2`, [c.organizationId, commandId])).rows[0];

// The asset by id, or by what a person can read off it (code, serial, tag, earlier code).
export async function maintenanceAsset(client, c, input, { lock = false } = {}) {
  let a = null;
  if (input.assetId) {
    let id;
    try { id = uuid(input.assetId, "Asset"); } catch { throw mtError(400, "ASSET_MAINTENANCE_ASSET_INVALID"); }
    a = (await client.query(`SELECT * FROM tenant.assets WHERE organization_id = $1 AND id = $2 ${lock ? "FOR UPDATE" : ""}`, [c.organizationId, id])).rows[0];
  } else if (input.asset) {
    const raw = text(input.asset, 200);
    const n = normalizeIdentifier(raw);
    a = (await client.query(`SELECT * FROM tenant.assets WHERE organization_id = $1 AND (upper(asset_number) = upper($2) OR serial_normalized = $3 OR tag_normalized = $3 OR legacy_normalized = $3)
        ORDER BY (upper(asset_number) = upper($2)) DESC LIMIT 1 ${lock ? "FOR UPDATE" : ""}`, [c.organizationId, raw, n])).rows[0];
  }
  if (!a) throw mtError(404, "ASSET_MAINTENANCE_ASSET_INVALID");
  if (a.lifecycle_status === "DISPOSED" || a.status === "disposed") throw mtError(409, "ASSET_MAINTENANCE_ASSET_DISPOSED");
  if (a.lifecycle_status === "DRAFT") throw mtError(409, "ASSET_MAINTENANCE_ASSET_INVALID", "A draft asset is not yet in use; register it first.");
  return a;
}
const heldBy = async (client, c, assetId) => (await client.query(`SELECT 1 FROM tenant.asset_custody_assignments WHERE asset_id = $1 AND status = 'ACTIVE' AND (user_id = $2 OR accountable_user_id = $2)`,
  [assetId, c.userId])).rows[0] !== undefined;
async function placeAndHolder(client, a) {
  const r = (await client.query(`SELECT l.name AS location, COALESCE(NULLIF(u.full_name, ''), u.email, d.name, s.name) AS custodian FROM tenant.assets a
      LEFT JOIN tenant.asset_locations l ON l.id = a.location_id LEFT JOIN tenant.asset_custody_assignments k ON k.asset_id = a.id AND k.status = 'ACTIVE'
      LEFT JOIN public.users u ON u.id = k.user_id LEFT JOIN public.departments d ON d.id = k.department_id LEFT JOIN tenant.asset_locations s ON s.id = k.store_location_id WHERE a.id = $1`, [a.id])).rows[0];
  return r ?? {};
}
// Warranty readback: in warranty means "potentially covered — check coverage", never a promise of a free repair.
export async function warrantyOf(client, a) {
  const w = (await client.query(`SELECT provider_name, end_date, coverage FROM tenant.asset_warranties WHERE asset_id = $1 ORDER BY end_date DESC NULLS LAST LIMIT 1`, [a.id])).rows[0];
  const end = dayOfDb(w?.end_date ?? a.warranty_end_date);
  const status = !end ? "UNKNOWN" : end >= today() ? "POTENTIALLY_COVERED" : "EXPIRED";
  return { status, label: { UNKNOWN: "Unknown", POTENTIALLY_COVERED: "Potentially under warranty — check coverage", EXPIRED: "Warranty expired" }[status], endDate: end, provider: w?.provider_name ?? null, coverage: w?.coverage ?? null };
}
async function notify(client, c, userIds, title, message, href, entityId) {
  for (const userId of [...new Set(userIds.filter(Boolean))]) {
    await createNotification(client, { organizationId: c.organizationId, userId, category: "asset_maintenance", title, message, href, entityType: "asset_maintenance", entityId });
  }
}
async function teamUsers(client, organizationId) {
  return (await client.query(`SELECT DISTINCT m.user_id FROM public.organization_memberships m JOIN public.user_role_assignments a ON a.organization_id = m.organization_id AND a.user_id = m.user_id AND a.status = 'active'
      JOIN public.roles role ON role.id = a.role_id AND role.status = 'active' WHERE m.organization_id = $1 AND m.status = 'active'
        AND EXISTS (SELECT 1 FROM public.role_permissions p WHERE p.role_id = role.id AND p.permission_key = $2)`, [organizationId, MT.triage])).rows.map((r) => r.user_id);
}

// ------------------------------------------------------------------ restrictions
async function restrict(client, c, assetId, sourceType, sourceId, type, reason) {
  await client.query(`INSERT INTO tenant.asset_maintenance_restrictions (organization_id, asset_id, source_type, source_id, restriction_type, reason, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (source_type, source_id, restriction_type) WHERE status = 'ACTIVE' DO NOTHING`, [c.organizationId, assetId, sourceType, sourceId, type, reason, c.userId ?? null]);
}
// Releases only the restrictions the given source owns; then the asset's availability is whatever every remaining restriction says.
async function release(client, c, sourceType, sourceId, reason, verificationId = null, types = null) {
  const rows = (await client.query(`UPDATE tenant.asset_maintenance_restrictions SET status = 'RELEASED', ended_at = clock_timestamp(), released_by = $3, release_reason = $4, release_verification_id = $5
      WHERE source_type = $1 AND source_id = $2 AND status = 'ACTIVE' AND ($6::text[] IS NULL OR restriction_type = ANY($6::text[])) RETURNING asset_id`, [sourceType, sourceId, c.userId ?? null, reason, verificationId, types])).rows;
  for (const r of rows) await settleAsset(client, r.asset_id);
  return rows.length;
}
// The older status column ('in_maintenance') is brought back only when nothing keeps the asset under maintenance.
async function settleAsset(client, assetId) {
  const live = (await client.query(`SELECT 1 FROM tenant.asset_maintenance_restrictions WHERE asset_id = $1 AND status = 'ACTIVE' AND restriction_type IN ('SAFETY', 'UNDER_MAINTENANCE')
      UNION ALL SELECT 1 FROM tenant.asset_maintenance_orders WHERE asset_id = $1 AND status = 'in_progress' AND took_asset_out_of_service LIMIT 1`, [assetId])).rows[0];
  if (live) return;
  await client.query(`UPDATE tenant.assets SET status = CASE WHEN current_user_id IS NOT NULL OR current_department_id IS NOT NULL THEN 'assigned' ELSE 'available' END, updated_at = now()
      WHERE id = $1 AND status = 'in_maintenance'`, [assetId]);
}
export const effectiveAvailability = async (client, assetId) => (await client.query(`SELECT tenant.asset_effective_availability(a) AS e, a.lifecycle_status FROM tenant.assets a WHERE a.id = $1`, [assetId])).rows[0];

// ------------------------------------------------------------------ requests
// input: { assetId | asset (code, serial, tag), maintenanceType?, priority?, description, symptoms?, safetyConcern?, observedCondition?, distinctIssue?, idempotencyKey? }
export async function createMaintenanceRequest(client, c, input = {}) {
  requireMt(c, MT.request);
  const key = text(input.idempotencyKey, 200) || null;
  if (key) {
    const done = (await client.query(`SELECT * FROM tenant.asset_maintenance_requests WHERE organization_id = $1 AND idempotency_key = $2`, [c.organizationId, key])).rows[0];
    if (done) return { requestId: done.id, number: done.request_number, status: done.status, replayed: true };
  }
  const a = await maintenanceAsset(client, c, input);
  if (!maintenanceTeam(c) && !(await heldBy(client, c, a.id))) throw mtError(403, "ASSET_MAINTENANCE_PERMISSION_DENIED", "You can report problems with assets in your care.");
  const description = text(input.description, 2000);
  if (description.length < 5) throw mtError(400, "ASSET_MAINTENANCE_INVALID", "Describe the problem.", { field: "description" });
  const type = oneOf(input.maintenanceType, TYPES, "CORRECTIVE", "maintenance type");
  const priority = oneOf(input.priority, PRIORITIES, type === "EMERGENCY" ? "URGENT" : "NORMAL", "priority");
  const safety = oneOf(input.safetyConcern, ["YES", "NO", "UNKNOWN"], "UNKNOWN", "safety concern");
  const condition = input.observedCondition ? oneOf(input.observedCondition, CONDITIONS, null, "condition") : null;
  const open = (await client.query(`SELECT request_number FROM tenant.asset_maintenance_requests WHERE asset_id = $1 AND status IN ('OPEN', 'NEEDS_INFORMATION', 'ACCEPTED')
      AND (work_order_id IS NULL OR EXISTS (SELECT 1 FROM tenant.asset_maintenance_work_orders w WHERE w.id = work_order_id AND w.status = ANY($2::text[])))`, [a.id, OPEN_WO])).rows[0];
  if (open && input.distinctIssue !== true) throw mtError(409, "ASSET_MAINTENANCE_DUPLICATE_REQUEST", `${open.request_number} is already open for this asset; add to it, or report this as a distinct issue.`, { existing: open.request_number });
  const where = await placeAndHolder(client, a);
  const number = await nextNumber(client, c, "asset_maintenance_request", "AMR");
  const r = (await client.query(`INSERT INTO tenant.asset_maintenance_requests (organization_id, request_number, asset_id, maintenance_type, priority, description, symptoms, safety_concern, observed_condition,
      location_id, location_label, custodian_label, reported_by, idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
    [c.organizationId, number, a.id, type, priority, description, text(input.symptoms, 2000) || null, safety, condition, a.location_id, where.location ?? null, where.custodian ?? null, c.userId, key])).rows[0];
  await logMaintenanceEvent(client, c, { assetId: a.id, requestId: r.id }, "REQUEST_REPORTED", { to: "OPEN", details: { safety, priority, type } });
  // A possibly unsafe asset is restricted at once, before any Work Order — the Company's policy decides.
  const settings = await loadSettings(client, c);
  let restricted = false;
  if (safety === "YES" && settings.maintenance_restrict_on_safety !== false) {
    await restrict(client, c, a.id, "SAFETY_REPORT", r.id, "SAFETY", `Safety concern reported in ${number}: ${description.slice(0, 200)}`);
    restricted = true;
    await logMaintenanceEvent(client, c, { assetId: a.id, requestId: r.id }, "SAFETY_RESTRICTED", {});
  }
  await notify(client, c, await teamUsers(client, c.organizationId), `${number}: ${a.asset_number} problem reported${restricted ? " — use restricted for safety" : ""}`, description.slice(0, 300), `/assets/maintenance/requests/${r.id}`, r.id);
  await recordAssetEvent(client, c, a.id, "asset.maintenance_requested", { requestId: r.id, safety });
  return { requestId: r.id, number, status: r.status, safetyRestricted: restricted };
}
const loadRequest = async (client, c, requestId, { lock = true } = {}) => {
  let id;
  try { id = uuid(requestId, "Request"); } catch { throw mtError(404, "ASSET_MAINTENANCE_NOT_FOUND"); }
  const r = (await client.query(`SELECT * FROM tenant.asset_maintenance_requests WHERE organization_id = $1 AND id = $2 ${lock ? "FOR UPDATE" : ""}`, [c.organizationId, id])).rows[0];
  if (!r) throw mtError(404, "ASSET_MAINTENANCE_NOT_FOUND");
  return r;
};
// input: { decision: ACCEPT | REJECT | NEEDS_INFORMATION | DUPLICATE, note, duplicateOf? (request number or id), safetyAssessed? } — rejecting or closing as a
// duplicate releases this request's own safety restriction only when the assessor says the asset is safe to use.
export async function triageMaintenanceRequest(client, c, requestId, input = {}) {
  requireMt(c, MT.triage);
  const r = await loadRequest(client, c, requestId);
  if (!["OPEN", "NEEDS_INFORMATION"].includes(r.status)) throw mtError(409, "ASSET_MAINTENANCE_INVALID", "Only an open request is triaged.");
  const decision = oneOf(input.decision, ["ACCEPT", "REJECT", "NEEDS_INFORMATION", "DUPLICATE"], null, "decision");
  const note = text(input.note, 2000);
  if (decision !== "ACCEPT" && note.length < 3) throw mtError(400, "ASSET_MAINTENANCE_INVALID", "Give the reason.", { field: "note" });
  let duplicateOf = null;
  if (decision === "DUPLICATE") {
    const ref = text(input.duplicateOf, 100);
    duplicateOf = (await client.query(`SELECT id FROM tenant.asset_maintenance_requests WHERE organization_id = $1 AND (request_number = $2 OR id::text = $2) AND id <> $3`, [c.organizationId, ref, r.id])).rows[0]?.id;
    if (!duplicateOf) throw mtError(400, "ASSET_MAINTENANCE_INVALID", "Name the original request.", { field: "duplicateOf" });
  }
  const status = { ACCEPT: "ACCEPTED", REJECT: "REJECTED", NEEDS_INFORMATION: "NEEDS_INFORMATION", DUPLICATE: "CLOSED" }[decision];
  await client.query(`UPDATE tenant.asset_maintenance_requests SET status = $2, triage_note = $3, triaged_by = $4, triaged_at = clock_timestamp(), duplicate_of_request_id = $5, row_version = row_version + 1 WHERE id = $1`,
    [r.id, status, note || null, c.userId, duplicateOf]);
  if (["REJECT", "DUPLICATE"].includes(decision) && input.safetyAssessed === true) await release(client, c, "SAFETY_REPORT", r.id, `Assessed safe on triage: ${note}`);
  await logMaintenanceEvent(client, c, { assetId: r.asset_id, requestId: r.id }, `REQUEST_${decision}`, { from: r.status, to: status, details: { duplicateOf }, reason: note || null });
  if (decision === "NEEDS_INFORMATION") await notify(client, c, [r.reported_by], `${r.request_number}: more information needed`, note, `/assets/maintenance/requests/${r.id}`, r.id);
  return { requestId: r.id, status };
}
// input: { note } — the reporter answers a request for information; the request is open again.
export async function respondToMaintenanceRequest(client, c, requestId, input = {}) {
  requireMt(c, MT.request);
  const r = await loadRequest(client, c, requestId);
  if (r.status !== "NEEDS_INFORMATION") throw mtError(409, "ASSET_MAINTENANCE_INVALID", "Nothing was asked on this request.");
  if (r.reported_by !== c.userId && !maintenanceTeam(c)) throw mtError(403, "ASSET_MAINTENANCE_PERMISSION_DENIED");
  const note = text(input.note, 2000);
  if (note.length < 3) throw mtError(400, "ASSET_MAINTENANCE_INVALID", "Add the information asked for.", { field: "note" });
  await client.query(`UPDATE tenant.asset_maintenance_requests SET status = 'OPEN', symptoms = concat_ws(E'\\n', symptoms, $2::text), row_version = row_version + 1 WHERE id = $1`, [r.id, note]);
  await logMaintenanceEvent(client, c, { assetId: r.asset_id, requestId: r.id }, "REQUEST_INFORMATION_ADDED", { from: "NEEDS_INFORMATION", to: "OPEN", reason: note });
  return { requestId: r.id, status: "OPEN" };
}

// ------------------------------------------------------------------ Work Orders
const loadWo = async (client, c, workOrderId, { lock = true } = {}) => {
  let id;
  try { id = uuid(workOrderId, "Work Order"); } catch { throw mtError(404, "ASSET_MAINTENANCE_NOT_FOUND"); }
  const w = (await client.query(`SELECT * FROM tenant.asset_maintenance_work_orders WHERE organization_id = $1 AND id = $2 ${lock ? "FOR UPDATE" : ""}`, [c.organizationId, id])).rows[0];
  if (!w) throw mtError(404, "ASSET_MAINTENANCE_NOT_FOUND");
  return w;
};
const versionCheck = (w, expected) => { if (expected !== undefined && expected !== null && Number(expected) !== w.row_version) throw mtError(409, "ASSET_MAINTENANCE_VERSION_CONFLICT"); };
async function setStatus(client, c, w, status, extra = {}, event = null) {
  const cols = Object.keys(extra);
  const sets = cols.map((k, i) => `${k} = $${i + 3}`).join(", ");
  const row = (await client.query(`UPDATE tenant.asset_maintenance_work_orders SET status = $2${sets ? `, ${sets}` : ""}, row_version = row_version + 1, updated_at = clock_timestamp() WHERE id = $1 RETURNING *`,
    [w.id, status, ...cols.map((k) => extra[k])])).rows[0];
  if (event) await logMaintenanceEvent(client, c, { assetId: w.asset_id, workOrderId: w.id, requestId: w.request_id }, event.action, { from: w.status, to: status, details: event.details ?? {}, reason: event.reason ?? null, commandId: event.commandId ?? null });
  return row;
}
// An eligible technician: an active Company member allowed to carry out maintenance.
async function technician(client, c, userId) {
  if (!userId) return null;
  let id;
  try { id = uuid(userId, "Technician"); } catch { throw mtError(400, "ASSET_MAINTENANCE_TECHNICIAN_INVALID"); }
  const ok = (await client.query(`SELECT 1 FROM public.organization_memberships m JOIN public.user_role_assignments a ON a.organization_id = m.organization_id AND a.user_id = m.user_id AND a.status = 'active'
      JOIN public.roles role ON role.id = a.role_id AND role.status = 'active' WHERE m.organization_id = $1 AND m.user_id = $2 AND m.status = 'active'
        AND (role.slug = 'organization_owner' OR EXISTS (SELECT 1 FROM public.role_permissions p WHERE p.role_id = role.id AND p.permission_key = $3)) LIMIT 1`, [c.organizationId, id, MT.execute])).rows[0];
  if (!ok) throw mtError(400, "ASSET_MAINTENANCE_TECHNICIAN_INVALID");
  return id;
}
async function supplier(client, c, supplierId) {
  if (!supplierId) return null;
  let id;
  try { id = uuid(supplierId, "Supplier"); } catch { throw mtError(400, "ASSET_MAINTENANCE_VENDOR_REFERENCE_INVALID"); }
  const s = (await client.query(`SELECT id FROM tenant.procurement_suppliers WHERE organization_id = $1 AND id = $2 AND status = 'active'`, [c.organizationId, id])).rows[0];
  if (!s) throw mtError(400, "ASSET_MAINTENANCE_VENDOR_REFERENCE_INVALID");
  return id;
}
async function needsApproval(client, c, execution, estimate) {
  const settings = await loadSettings(client, c);
  return execution !== "INTERNAL" || (estimate !== null && Number(estimate) >= Number(settings.maintenance_approval_threshold ?? 10000));
}
// input: { requestId? | assetId? | asset?, maintenanceType?, priority?, title?, problem?, execution?, technicianUserId?, supplierId?, responsibleUserId?, scheduledStartAt?,
//   expectedCompletionAt?, estimateAmount?, restrictUse?, checklist?: [{ text, mandatory? }], followUpOf?, draft?, idempotencyKey? }
export async function createMaintenanceWorkOrder(client, c, input = {}, internal = {}) {
  if (!internal.system) requireMt(c, MT.create);
  const key = text(input.idempotencyKey, 200) || null;
  if (key) {
    const done = (await client.query(`SELECT * FROM tenant.asset_maintenance_work_orders WHERE organization_id = $1 AND idempotency_key = $2`, [c.organizationId, key])).rows[0];
    if (done) return { workOrderId: done.id, number: done.work_order_number, status: done.status, replayed: true };
  }
  let request = null;
  if (input.requestId) {
    request = await loadRequest(client, c, input.requestId);
    if (["REJECTED", "CLOSED"].includes(request.status)) throw mtError(409, "ASSET_MAINTENANCE_INVALID", "This request is closed.");
    if (request.status !== "ACCEPTED") {
      if (!has(c, MT.triage) && !internal.system) throw mtError(409, "ASSET_MAINTENANCE_INVALID", "The request must be accepted first.");
      await triageMaintenanceRequest(client, c, request.id, { decision: "ACCEPT", note: "Accepted with its Work Order" });
    }
    const live = (await client.query(`SELECT work_order_number FROM tenant.asset_maintenance_work_orders WHERE request_id = $1 AND status <> 'CANCELLED'`, [request.id])).rows[0];
    if (live) throw mtError(409, "ASSET_MAINTENANCE_DUPLICATE_REQUEST", `${live.work_order_number} already handles this request.`);
  }
  const a = await maintenanceAsset(client, c, request ? { assetId: request.asset_id } : input, { lock: true });
  const pendingDisposal = (await client.query(`SELECT tenant.asset_disposal_pending($1) AS p`, [a.id])).rows[0].p;
  if (pendingDisposal) throw mtError(409, "ASSET_MAINTENANCE_INVALID", `${a.asset_number} is committed to disposal ${pendingDisposal}; no new maintenance is started.`);
  const type = oneOf(input.maintenanceType ?? request?.maintenance_type, TYPES, "CORRECTIVE", "maintenance type");
  const priority = oneOf(input.priority ?? request?.priority, PRIORITIES, "NORMAL", "priority");
  const execution = oneOf(input.execution, ["INTERNAL", "EXTERNAL", "MIXED"], "INTERNAL", "execution");
  const tech = await technician(client, c, input.technicianUserId);
  const vendor = await supplier(client, c, input.supplierId);
  if (execution !== "INTERNAL" && !vendor) throw mtError(400, "ASSET_MAINTENANCE_VENDOR_REFERENCE_INVALID", "External work needs the service vendor.", { field: "supplierId" });
  const estimate = input.estimateAmount === undefined || input.estimateAmount === null || input.estimateAmount === "" ? null : Number(input.estimateAmount);
  if (estimate !== null && !(estimate >= 0)) throw mtError(400, "ASSET_MAINTENANCE_INVALID", "Enter a valid estimate.", { field: "estimateAmount" });
  const approval = await needsApproval(client, c, execution, estimate);
  const title = text(input.title, 200) || (request ? request.description.slice(0, 200) : "");
  if (title.length < 3) throw mtError(400, "ASSET_MAINTENANCE_INVALID", "Give the Work Order a title.", { field: "title" });
  let followUp = null;
  if (input.followUpOf) followUp = (await loadWo(client, c, input.followUpOf, { lock: false })).id;
  const warranty = await warrantyOf(client, a);
  const start = timeOf(input.scheduledStartAt, "start");
  const status = input.draft === true ? "DRAFT" : approval ? "PENDING_APPROVAL" : start && (tech || vendor) ? "SCHEDULED" : "APPROVED";
  const number = await nextNumber(client, c, "asset_maintenance_work_order", "AMW");
  const w = (await client.query(`INSERT INTO tenant.asset_maintenance_work_orders (organization_id, work_order_number, asset_id, request_id, plan_id, occurrence_id, follow_up_of_id, maintenance_type, priority, execution,
      status, title, problem, technician_user_id, supplier_id, responsible_user_id, scheduled_start_at, expected_completion_at, estimate_amount, approval_required, restrict_use, warranty_status, idempotency_key, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24) RETURNING *`,
    [c.organizationId, number, a.id, request?.id ?? null, internal.planId ?? null, internal.occurrenceId ?? null, followUp, type, priority, execution, status, title, text(input.problem, 2000) || request?.description || null,
      tech, vendor, input.responsibleUserId ? uuid(input.responsibleUserId, "Responsible") : (c.userId ?? null), start, timeOf(input.expectedCompletionAt, "expected completion"),
      estimate, approval, input.restrictUse !== false, warranty.status, key, c.userId ?? null])).rows[0];
  const items = Array.isArray(input.checklist) ? input.checklist : [];
  for (const [i, item] of items.entries()) {
    const t = text(item?.text ?? item, 500);
    if (t) await client.query(`INSERT INTO tenant.asset_maintenance_checklist_items (organization_id, work_order_id, line_number, item_text, mandatory) VALUES ($1,$2,$3,$4,$5)`, [c.organizationId, w.id, i + 1, t, item?.mandatory !== false]);
  }
  if (request) await client.query(`UPDATE tenant.asset_maintenance_requests SET work_order_id = $2, row_version = row_version + 1 WHERE id = $1`, [request.id, w.id]);
  await logMaintenanceEvent(client, c, { assetId: a.id, workOrderId: w.id, requestId: request?.id }, "WORK_ORDER_CREATED", { to: status, details: { execution, approval, warranty: warranty.status } });
  if (tech) await notify(client, c, [tech], `${number}: assigned to you`, title, `/assets/maintenance/work-orders/${w.id}`, w.id);
  return { workOrderId: w.id, number, status, approvalRequired: approval, warranty, warrantyReview: warranty.status === "POTENTIALLY_COVERED" ? "ASSET_MAINTENANCE_WARRANTY_REVIEW" : null };
}
export async function submitMaintenanceWorkOrder(client, c, workOrderId, input = {}) {
  requireMt(c, MT.create);
  const w = await loadWo(client, c, workOrderId);
  versionCheck(w, input.expectedVersion);
  if (w.status !== "DRAFT") throw mtError(409, "ASSET_MAINTENANCE_INVALID", "Only a draft is submitted.");
  return setStatus(client, c, w, w.approval_required ? "PENDING_APPROVAL" : "APPROVED", {}, { action: "SUBMITTED" }).then((r) => ({ workOrderId: r.id, status: r.status }));
}
// input: { note? } — never by the person who raised it, when the Company prohibits self-approval.
export async function approveMaintenanceWorkOrder(client, c, workOrderId, input = {}) {
  requireMt(c, MT.approve);
  const w = await loadWo(client, c, workOrderId);
  versionCheck(w, input.expectedVersion);
  if (w.status === "APPROVED") return { workOrderId: w.id, status: w.status, replayed: true };
  if (w.status !== "PENDING_APPROVAL") throw mtError(409, "ASSET_MAINTENANCE_INVALID", "Only work waiting for approval is approved.");
  const settings = await loadSettings(client, c);
  if (settings.prohibit_self_approval !== false && w.created_by === c.userId) throw mtError(403, "ASSET_MAINTENANCE_PERMISSION_DENIED", "Someone other than the requester approves the work.");
  const r = await setStatus(client, c, w, w.scheduled_start_at && (w.technician_user_id || w.supplier_id) ? "SCHEDULED" : "APPROVED", { approved_by: c.userId, approved_at: new Date().toISOString() },
    { action: "APPROVED", reason: text(input.note, 1000) || null });
  return { workOrderId: r.id, status: r.status };
}
// input: { technicianUserId?, supplierId?, execution? }
export async function assignMaintenanceExecutor(client, c, workOrderId, input = {}) {
  requireMt(c, MT.assign);
  const w = await loadWo(client, c, workOrderId);
  versionCheck(w, input.expectedVersion);
  if (!OPEN_WO.includes(w.status) || ["WORK_COMPLETED", "PENDING_VERIFICATION"].includes(w.status)) throw mtError(409, "ASSET_MAINTENANCE_INVALID", "This Work Order is no longer assigned.");
  const tech = input.technicianUserId !== undefined ? await technician(client, c, input.technicianUserId) : w.technician_user_id;
  const vendor = input.supplierId !== undefined ? await supplier(client, c, input.supplierId) : w.supplier_id;
  const execution = oneOf(input.execution, ["INTERNAL", "EXTERNAL", "MIXED"], w.execution, "execution");
  if (execution !== "INTERNAL" && !vendor) throw mtError(400, "ASSET_MAINTENANCE_VENDOR_REFERENCE_INVALID", "External work needs the service vendor.");
  // Moving the work to an outside vendor is a new authorization when it was not needed before.
  const approval = w.approval_required || (await needsApproval(client, c, execution, w.estimate_amount));
  const back = approval && !w.approval_required && ["APPROVED", "SCHEDULED"].includes(w.status);
  const r = await setStatus(client, c, w, back ? "PENDING_APPROVAL" : w.status, { technician_user_id: tech, supplier_id: vendor, execution, approval_required: approval },
    { action: "ASSIGNED", details: { technician: tech, supplier: vendor, execution } });
  if (tech && tech !== w.technician_user_id) await notify(client, c, [tech], `${w.work_order_number}: assigned to you`, w.title, `/assets/maintenance/work-orders/${w.id}`, w.id);
  return { workOrderId: r.id, status: r.status };
}
// input: { scheduledStartAt, expectedCompletionAt? }
export async function scheduleMaintenanceWorkOrder(client, c, workOrderId, input = {}) {
  requireMt(c, MT.schedule);
  const w = await loadWo(client, c, workOrderId);
  versionCheck(w, input.expectedVersion);
  if (!["APPROVED", "SCHEDULED"].includes(w.status)) throw mtError(409, w.status === "PENDING_APPROVAL" ? "ASSET_MAINTENANCE_APPROVAL_REQUIRED" : "ASSET_MAINTENANCE_INVALID");
  const start = timeOf(input.scheduledStartAt, "start");
  if (!start) throw mtError(400, "ASSET_MAINTENANCE_INVALID", "Choose when the work starts.", { field: "scheduledStartAt" });
  const r = await setStatus(client, c, w, "SCHEDULED", { scheduled_start_at: start, expected_completion_at: timeOf(input.expectedCompletionAt, "expected completion") ?? w.expected_completion_at }, { action: "SCHEDULED" });
  return { workOrderId: r.id, status: r.status };
}
const executor = (c, w) => { if (!has(c, MT.execute) || (w.technician_user_id && w.technician_user_id !== c.userId && !has(c, MT.assign))) throw mtError(403, "ASSET_MAINTENANCE_PERMISSION_DENIED", "This work is assigned to someone else."); };
// input: { intakeCondition, startedAt?, commandId? } — the asset is under maintenance from now (when the work restricts use).
export async function startMaintenanceWork(client, c, workOrderId, input = {}) {
  const w = await loadWo(client, c, workOrderId);
  executor(c, w);
  const command = text(input.commandId, 200) || null;
  if (await replayed(client, c, command)) return { workOrderId: w.id, status: w.status, replayed: true };
  if (["DRAFT", "PENDING_APPROVAL"].includes(w.status)) throw mtError(409, "ASSET_MAINTENANCE_APPROVAL_REQUIRED");
  if (!["APPROVED", "SCHEDULED"].includes(w.status)) throw mtError(409, "ASSET_MAINTENANCE_INVALID", "This work has already started or ended.");
  const a = await maintenanceAsset(client, c, { assetId: w.asset_id }, { lock: true });
  const condition = oneOf(input.intakeCondition, CONDITIONS, null, "condition at intake");
  const at = timeOf(input.startedAt, "start") ?? new Date().toISOString();
  const r = await setStatus(client, c, w, "IN_PROGRESS", { actual_start_at: at, intake_condition: condition }, { action: "STARTED", details: { condition }, commandId: command });
  if (w.restrict_use) await restrict(client, c, a.id, "WORK_ORDER", w.id, "UNDER_MAINTENANCE", `${w.work_order_number}: ${w.title}`.slice(0, 300));
  await recordAssetEvent(client, c, a.id, "asset.maintenance_started", { workOrderId: w.id });
  return { workOrderId: r.id, status: r.status, availability: (await effectiveAvailability(client, a.id)).e };
}
// input: { waitingFor: PARTS | VENDOR | NONE, note? } — the waiting time is on record (it is not technician working time).
export async function setMaintenanceWaiting(client, c, workOrderId, input = {}) {
  const w = await loadWo(client, c, workOrderId);
  executor(c, w);
  if (!WORKING.includes(w.status)) throw mtError(409, "ASSET_MAINTENANCE_INVALID", "Only work in progress waits.");
  const to = { PARTS: "WAITING_FOR_PARTS", VENDOR: "WAITING_FOR_VENDOR", NONE: "IN_PROGRESS" }[oneOf(input.waitingFor, ["PARTS", "VENDOR", "NONE"], null, "waiting for")];
  if (to === w.status) return { workOrderId: w.id, status: w.status, replayed: true };
  const r = await setStatus(client, c, w, to, {}, { action: to === "IN_PROGRESS" ? "RESUMED" : to, reason: text(input.note, 1000) || null });
  return { workOrderId: r.id, status: r.status };
}
// input: { diagnosis?, rootCause?, workPerformed?, remainingIssues?, recommendation?, checklist?: [{ lineNumber, result, notes? }], expectedVersion? }
export async function recordMaintenanceWork(client, c, workOrderId, input = {}) {
  const w = await loadWo(client, c, workOrderId);
  executor(c, w);
  versionCheck(w, input.expectedVersion);
  if (!WORKING.includes(w.status)) throw mtError(409, "ASSET_MAINTENANCE_INVALID", "Work is recorded while it is in progress.");
  const fields = {};
  for (const [k, col] of [["diagnosis", "diagnosis"], ["rootCause", "root_cause"], ["workPerformed", "work_performed"], ["remainingIssues", "remaining_issues"], ["recommendation", "recommendation"]]) {
    if (input[k] !== undefined) fields[col] = text(input[k], 4000) || null;
  }
  for (const item of Array.isArray(input.checklist) ? input.checklist : []) {
    const result = oneOf(item.result, ["PASS", "FAIL", "NOT_APPLICABLE"], null, "check result");
    const done = await client.query(`UPDATE tenant.asset_maintenance_checklist_items SET result = $3, notes = $4, completed_by = $5, completed_at = clock_timestamp() WHERE work_order_id = $1 AND line_number = $2`,
      [w.id, Number(item.lineNumber), result, text(item.notes, 1000) || null, c.userId]);
    if (!done.rowCount) throw mtError(400, "ASSET_MAINTENANCE_INVALID", `There is no check ${item.lineNumber}.`);
  }
  const r = await setStatus(client, c, w, w.status, fields, { action: "WORK_RECORDED", details: { fields: Object.keys(fields), checks: (input.checklist ?? []).length } });
  return { workOrderId: r.id, status: r.status, version: r.row_version };
}
// input: { completionCondition, workPerformed?, completedAt?, commandId? } — the technician's work is finished: not yet safe to use.
export async function completeMaintenanceWork(client, c, workOrderId, input = {}) {
  requireMt(c, MT.complete);
  const w = await loadWo(client, c, workOrderId);
  executor(c, w);
  const command = text(input.commandId, 200) || null;
  if (await replayed(client, c, command)) return { workOrderId: w.id, status: w.status, replayed: true };
  if (!WORKING.includes(w.status)) throw mtError(409, "ASSET_MAINTENANCE_INVALID", "Only work in progress is completed.");
  const performed = text(input.workPerformed, 4000) || w.work_performed;
  if (!performed) throw mtError(400, "ASSET_MAINTENANCE_INVALID", "Describe the work performed.", { field: "workPerformed" });
  const open = (await client.query(`SELECT line_number, item_text FROM tenant.asset_maintenance_checklist_items WHERE work_order_id = $1 AND mandatory AND result IS NULL ORDER BY line_number`, [w.id])).rows;
  if (open.length) throw mtError(409, "ASSET_MAINTENANCE_VERIFICATION_REQUIRED", `Record the required checks first: ${open.map((x) => x.item_text).join("; ")}.`, { checks: open.map((x) => x.line_number) });
  const condition = oneOf(input.completionCondition, CONDITIONS, null, "condition at completion");
  const r = await setStatus(client, c, w, "PENDING_VERIFICATION", { work_performed: performed, completion_condition: condition, work_completed_at: timeOf(input.completedAt, "completion") ?? new Date().toISOString() },
    { action: "WORK_COMPLETED", details: { condition }, commandId: command });
  await notify(client, c, await teamUsers(client, c.organizationId), `${w.work_order_number}: work completed — verification needed`, w.title, `/assets/maintenance/work-orders/${w.id}`, w.id);
  return { workOrderId: r.id, status: r.status };
}
// input: { identifier, finalCondition, testsPassed, testResults?, decision: RETURN_TO_SERVICE | RETURN_WITH_LIMITATIONS | KEEP_RESTRICTED | NOT_REPAIRABLE, evidence?, notes? }
// — the independent check (not the technician who did the work, when the Company prohibits self-approval).
export async function verifyMaintenanceRepair(client, c, workOrderId, input = {}) {
  requireMt(c, MT.verify);
  const w = await loadWo(client, c, workOrderId);
  if (w.status !== "PENDING_VERIFICATION") throw mtError(409, "ASSET_MAINTENANCE_INVALID", "Only completed work is verified.");
  const settings = await loadSettings(client, c);
  const doer = (await client.query(`SELECT actor_user_id FROM tenant.asset_maintenance_events WHERE work_order_id = $1 AND action = 'WORK_COMPLETED' ORDER BY occurred_at DESC LIMIT 1`, [w.id])).rows[0]?.actor_user_id;
  if (settings.prohibit_self_approval !== false && doer && doer === c.userId) throw mtError(403, "ASSET_MAINTENANCE_PERMISSION_DENIED", "Someone other than the technician verifies the repair.");
  const a = (await client.query(`SELECT * FROM tenant.assets WHERE id = $1`, [w.asset_id])).rows[0];
  const { identifies } = await import("../asset-transfers/tr-commands.js");
  const scanned = text(input.identifier, 200);
  const identity = Boolean(scanned) && (await identifies(client, c, a, scanned));
  if (!identity) throw mtError(409, "ASSET_MAINTENANCE_VERIFICATION_REQUIRED", `Scan or type ${a.asset_number}'s code, serial or tag to confirm the asset checked.`);
  const condition = oneOf(input.finalCondition, CONDITIONS, null, "final condition");
  const decision = oneOf(input.decision, ["RETURN_TO_SERVICE", "RETURN_WITH_LIMITATIONS", "KEEP_RESTRICTED", "NOT_REPAIRABLE"], null, "decision");
  const passed = input.testsPassed === true || input.testsPassed === "true";
  if (decision.startsWith("RETURN") && !passed) throw mtError(409, "ASSET_MAINTENANCE_VERIFICATION_REQUIRED", "A return to service needs the safety and functional checks passed.");
  if (decision.startsWith("RETURN") && condition === "UNSERVICEABLE") throw mtError(409, "ASSET_MAINTENANCE_VERIFICATION_REQUIRED", "An unserviceable asset is not returned to service.");
  const v = (await client.query(`INSERT INTO tenant.asset_maintenance_verifications (organization_id, work_order_id, verifier_user_id, identity_confirmed, final_condition, tests_passed, test_results, decision, evidence, notes)
      VALUES ($1,$2,$3,true,$4,$5,$6,$7,$8,$9) RETURNING *`, [c.organizationId, w.id, c.userId, condition, passed, text(input.testResults, 2000) || null, decision, text(input.evidence, 1000) || null, text(input.notes, 2000) || null])).rows[0];
  const status = await import("../asset-status/status-commands.js");
  if (condition !== a.condition) await status.recordAssetCondition(client, c, a.id, { condition, reason: `Verified on ${w.work_order_number}` }, { fromVerification: true, source: "INSPECTION" });
  let next = w.status;
  if (decision === "KEEP_RESTRICTED") {
    next = (await setStatus(client, c, w, "IN_PROGRESS", { outcome: null }, { action: "VERIFICATION_FAILED", details: { verificationId: v.id }, reason: text(input.notes, 1000) || null })).status;
  } else if (decision === "NOT_REPAIRABLE") {
    // Referred for retirement or disposal review — never disposed automatically; the restriction stays.
    next = (await setStatus(client, c, w, "CLOSED", { outcome: "UNREPAIRABLE", closed_at: new Date().toISOString() }, { action: "UNREPAIRABLE", details: { verificationId: v.id } })).status;
    await closeRequest(client, w, "Unrepairable");
    await notify(client, c, await teamUsers(client, c.organizationId), `${a.asset_number} is unrepairable — retirement review`, `${w.work_order_number}: ${text(input.notes, 300)}`, `/assets/maintenance/work-orders/${w.id}`, w.id);
  } else {
    await logMaintenanceEvent(client, c, { assetId: w.asset_id, workOrderId: w.id }, "VERIFIED", { details: { verificationId: v.id, decision } });
  }
  return { workOrderId: w.id, verificationId: v.id, decision, status: next };
}
const closeRequest = async (client, w, note) => {
  if (w.request_id) await client.query(`UPDATE tenant.asset_maintenance_requests SET status = 'CLOSED', triage_note = COALESCE(triage_note, $2), row_version = row_version + 1 WHERE id = $1 AND status <> 'CLOSED'`, [w.request_id, note]);
};
// input: { note?, commandId? } — the return to service after a passed verification: releases this Work Order's restriction (and its request's
// safety restriction), keeps a limitation when there is one, and reports what availability every other restriction leaves.
export async function returnAssetToService(client, c, workOrderId, input = {}) {
  requireMt(c, MT.release);
  const w = await loadWo(client, c, workOrderId);
  const command = text(input.commandId, 200) || null;
  if (await replayed(client, c, command) || w.status === "CLOSED" && ["REPAIRED", "REPAIRED_WITH_LIMITATIONS"].includes(w.outcome)) return { workOrderId: w.id, status: w.status, replayed: true };
  if (w.status !== "PENDING_VERIFICATION") throw mtError(409, "ASSET_MAINTENANCE_VERIFICATION_REQUIRED");
  const v = (await client.query(`SELECT * FROM tenant.asset_maintenance_verifications WHERE work_order_id = $1 ORDER BY verified_at DESC LIMIT 1`, [w.id])).rows[0];
  if (!v || !v.decision.startsWith("RETURN")) throw mtError(409, "ASSET_MAINTENANCE_VERIFICATION_REQUIRED");
  const a = (await client.query(`SELECT * FROM tenant.assets WHERE id = $1 FOR UPDATE`, [w.asset_id])).rows[0];
  if (a.lifecycle_status === "DISPOSED" || a.status === "disposed") throw mtError(409, "ASSET_MAINTENANCE_ASSET_DISPOSED");
  const reason = `Returned to service by ${w.work_order_number}`;
  await release(client, c, "WORK_ORDER", w.id, reason, v.id, ["UNDER_MAINTENANCE", "SAFETY"]);
  if (w.request_id) await release(client, c, "SAFETY_REPORT", w.request_id, reason, v.id);
  const limited = v.decision === "RETURN_WITH_LIMITATIONS";
  if (limited) await restrict(client, c, a.id, "WORK_ORDER", w.id, "LIMITATION", v.notes ?? "Returned with limitations");
  const r = await setStatus(client, c, w, "CLOSED", { outcome: limited ? "REPAIRED_WITH_LIMITATIONS" : "REPAIRED", closed_at: new Date().toISOString() }, { action: "RETURNED_TO_SERVICE", details: { verificationId: v.id }, reason: text(input.note, 1000) || null, commandId: command });
  await closeRequest(client, w, "Repaired");
  if (w.occurrence_id) await completeOccurrence(client, c, w);
  await recordAssetEvent(client, c, a.id, "asset.returned_to_service", { workOrderId: w.id, limited });
  const after = await effectiveAvailability(client, a.id);
  const still = ["UNDER_MAINTENANCE", "IN_TRANSFER", "NOT_AVAILABLE"].includes(after.e) || after.lifecycle_status !== "ACTIVE";
  return { workOrderId: r.id, status: r.status, outcome: r.outcome, availability: after.e, lifecycle: after.lifecycle_status, code: still ? "ASSET_MAINTENANCE_RESTRICTION_ACTIVE" : null,
    message: still ? "This Work Order's restriction is released; another restriction still prevents normal use." : null };
}
// input: { reason } — cancelling releases this Work Order's own restriction; parts already issued stay issued (Inventory reverses them).
export async function cancelMaintenanceWorkOrder(client, c, workOrderId, input = {}) {
  requireMt(c, MT.cancel);
  const w = await loadWo(client, c, workOrderId);
  if (w.status === "CANCELLED") return { workOrderId: w.id, status: w.status, replayed: true };
  if (w.status === "CLOSED") throw mtError(409, "ASSET_MAINTENANCE_INVALID", "A closed Work Order is reopened, not cancelled.");
  const reason = text(input.reason, 1000);
  if (reason.length < 3) throw mtError(400, "ASSET_MAINTENANCE_INVALID", "Give the reason.", { field: "reason" });
  const r = await setStatus(client, c, w, "CANCELLED", { cancel_reason: reason, outcome: "CANCELLED_NO_WORK" }, { action: "CANCELLED", reason });
  await release(client, c, "WORK_ORDER", w.id, `Cancelled: ${reason}`);
  if (w.occurrence_id) await client.query(`UPDATE tenant.asset_maintenance_occurrences SET status = 'CANCELLED' WHERE id = $1`, [w.occurrence_id]);
  const issued = Number((await client.query(`SELECT count(*)::int AS n FROM tenant.asset_maintenance_cost_links WHERE work_order_id = $1 AND status = 'ACTIVE' AND source_type = 'GOODS_ISSUE'`, [w.id])).rows[0].n);
  return { workOrderId: r.id, status: r.status, partsStillIssued: issued, note: issued ? "Parts already issued stay issued; return unused parts through Inventory." : null };
}
// input: { reason } — a controlled correction: the Work Order is open again, and restricts use again when it should.
export async function reopenMaintenanceWorkOrder(client, c, workOrderId, input = {}) {
  requireMt(c, MT.reopen);
  const w = await loadWo(client, c, workOrderId);
  if (w.status !== "CLOSED") throw mtError(409, "ASSET_MAINTENANCE_INVALID", "Only a closed Work Order is reopened.");
  const reason = text(input.reason, 1000);
  if (reason.length < 3) throw mtError(400, "ASSET_MAINTENANCE_INVALID", "Give the reason.", { field: "reason" });
  await maintenanceAsset(client, c, { assetId: w.asset_id }, { lock: true });
  const r = await setStatus(client, c, w, "IN_PROGRESS", { outcome: null, closed_at: null, reopened_count: w.reopened_count + 1 }, { action: "REOPENED", reason });
  await release(client, c, "WORK_ORDER", w.id, "Reopened", null, ["LIMITATION"]);
  if (w.restrict_use) await restrict(client, c, w.asset_id, "WORK_ORDER", w.id, "UNDER_MAINTENANCE", `${w.work_order_number} reopened: ${reason}`.slice(0, 300));
  return { workOrderId: r.id, status: r.status };
}
// input: { warrantyClaimReference?, warrantyClaimStatus? } — the claim is recorded; coverage is never assumed.
export async function recordMaintenanceWarranty(client, c, workOrderId, input = {}) {
  requireMt(c, MT.create);
  const w = await loadWo(client, c, workOrderId);
  const st = input.warrantyClaimStatus ? oneOf(input.warrantyClaimStatus, ["PENDING", "APPROVED", "DENIED"], null, "claim outcome") : w.warranty_claim_status;
  const r = await setStatus(client, c, w, w.status, { warranty_claim_reference: text(input.warrantyClaimReference, 200) || w.warranty_claim_reference, warranty_claim_status: st }, { action: "WARRANTY_RECORDED", details: { status: st } });
  return { workOrderId: r.id, warrantyClaimStatus: r.warranty_claim_status };
}
// input: { transferId } — the vendor trip is an Asset Transfer (temporary, for repair); the Work Order points to it.
export async function linkMaintenanceTransfer(client, c, workOrderId, input = {}) {
  requireMt(c, MT.assign);
  const w = await loadWo(client, c, workOrderId);
  const t = (await client.query(`SELECT o.id, o.transfer_number FROM tenant.asset_transfer_orders o JOIN tenant.asset_transfer_lines l ON l.transfer_id = o.id AND l.asset_id = $3
      WHERE o.organization_id = $1 AND o.id = $2`, [c.organizationId, uuid(input.transferId, "Transfer"), w.asset_id])).rows[0];
  if (!t) throw mtError(400, "ASSET_MAINTENANCE_INVALID", "Choose a transfer that moves this asset.");
  await setStatus(client, c, w, w.status, { transfer_id: t.id }, { action: "TRANSFER_LINKED", details: { transfer: t.transfer_number } });
  return { workOrderId: w.id, transferId: t.id, transfer: t.transfer_number };
}

// ------------------------------------------------------------------ cost links (Inventory, Procurement and Finance stay authoritative)
async function link(client, c, w, sourceType, sourceId, sourceNumber, role, commandId) {
  {
    const row = (await client.query(`INSERT INTO tenant.asset_maintenance_cost_links (organization_id, work_order_id, asset_id, source_type, source_id, source_number, cost_role, linked_by, command_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (organization_id, source_type, source_id) WHERE status = 'ACTIVE' DO NOTHING RETURNING id`,
      [c.organizationId, w.id, w.asset_id, sourceType, sourceId, sourceNumber, role, c.userId, commandId])).rows[0];
    if (!row) {
      const other = (await client.query(`SELECT l.work_order_id, w.work_order_number FROM tenant.asset_maintenance_cost_links l JOIN tenant.asset_maintenance_work_orders w ON w.id = l.work_order_id
          WHERE l.organization_id = $1 AND l.source_type = $2 AND l.source_id = $3 AND l.status = 'ACTIVE'`, [c.organizationId, sourceType, sourceId])).rows[0];
      if (other?.work_order_id === w.id) return { linkId: null, replayed: true };
      throw mtError(409, "ASSET_MAINTENANCE_INVALID", `${sourceNumber} is already linked to ${other?.work_order_number}; one cost is never counted twice.`);
    }
    await logMaintenanceEvent(client, c, { assetId: w.asset_id, workOrderId: w.id }, "COST_LINKED", { details: { sourceType, sourceNumber, role } });
    return { linkId: row.id };
  }
}
// input: { goodsIssue (number or id) } — a goods issue Inventory posted for this Work Order (its external reference is the Work Order code).
export async function linkMaintenancePartsConsumption(client, c, workOrderId, input = {}) {
  requireMt(c, MT.parts);
  const w = await loadWo(client, c, workOrderId);
  if (["CANCELLED"].includes(w.status)) throw mtError(409, "ASSET_MAINTENANCE_INVALID", "This Work Order is cancelled.");
  const ref = text(input.goodsIssue, 100);
  const g = (await client.query(`SELECT id, document_number, status, external_reference FROM tenant.goods_issues WHERE organization_id = $1 AND (document_number = $2 OR id::text = $2)`, [c.organizationId, ref])).rows[0];
  if (!g) throw mtError(400, "ASSET_MAINTENANCE_PART_UNAVAILABLE", "No such goods issue.");
  if (g.status !== "posted") throw mtError(409, "ASSET_MAINTENANCE_STOCK_ISSUE_PENDING");
  if (String(g.external_reference ?? "").trim().toUpperCase() !== w.work_order_number.toUpperCase()) throw mtError(409, "ASSET_MAINTENANCE_INVALID", `Inventory issues parts for this Work Order with ${w.work_order_number} as the reference.`);
  return { ...(await link(client, c, w, "GOODS_ISSUE", g.id, g.document_number, "PARTS", text(input.commandId, 200) || null)), workOrderId: w.id };
}
// input: { sourceType: SUPPLIER_BILL | PURCHASE_ORDER, source (number or id) } — the vendor's own document; a quoted estimate is never a cost.
export async function linkMaintenanceVendorCost(client, c, workOrderId, input = {}) {
  if (!has(c, MT.parts) && !has(c, MT.create)) throw mtError(403, "ASSET_MAINTENANCE_PERMISSION_DENIED");
  const w = await loadWo(client, c, workOrderId);
  if (!w.supplier_id) throw mtError(409, "ASSET_MAINTENANCE_VENDOR_REFERENCE_INVALID", "Assign the service vendor first.");
  const ref = text(input.source, 100);
  const type = oneOf(input.sourceType, ["SUPPLIER_BILL", "PURCHASE_ORDER"], null, "source");
  const doc = type === "SUPPLIER_BILL"
    ? (await client.query(`SELECT b.id, b.bill_number AS number, b.status, s.id AS supplier_id FROM tenant.accounting_vendor_bills b LEFT JOIN tenant.procurement_suppliers s ON s.organization_id = b.organization_id AND s.party_id = b.party_id
        WHERE b.organization_id = $1 AND (b.bill_number = $2 OR b.id::text = $2) ORDER BY (s.id = $3) DESC NULLS LAST LIMIT 1`, [c.organizationId, ref, w.supplier_id])).rows[0]
    : (await client.query(`SELECT id, purchase_order_number AS number, status, supplier_id FROM tenant.purchase_orders WHERE organization_id = $1 AND (purchase_order_number = $2 OR id::text = $2)`, [c.organizationId, ref])).rows[0];
  if (!doc || doc.supplier_id !== w.supplier_id) throw mtError(400, "ASSET_MAINTENANCE_VENDOR_REFERENCE_INVALID", "Choose a document of this Work Order's vendor.");
  // A supplier bill is an actual cost once Finance posted it; a purchase order is a commitment once confirmed.
  const live = type === "SUPPLIER_BILL" ? ["posted", "partially_paid", "paid", "overdue", "disputed"] : ["confirmed", "closed"];
  if (!live.includes(String(doc.status))) throw mtError(409, "ASSET_MAINTENANCE_VENDOR_REFERENCE_INVALID", `${doc.number} is ${String(doc.status).replace(/_/g, " ")}; link it once ${type === "SUPPLIER_BILL" ? "Finance has posted it" : "it is confirmed"}.`);
  return { ...(await link(client, c, w, type, doc.id, doc.number, type === "SUPPLIER_BILL" ? "EXTERNAL_SERVICE" : "COMMITMENT", text(input.commandId, 200) || null)), workOrderId: w.id };
}
// input: { adjustmentId } — a capital improvement is Finance's decision: the Work Order points to the posted capitalization adjustment.
export async function linkMaintenanceCapitalImprovement(client, c, workOrderId, input = {}) {
  requireMt(c, MT.create);
  const w = await loadWo(client, c, workOrderId);
  const adj = (await client.query(`SELECT j.id, j.status, cp.asset_id FROM tenant.asset_capitalization_adjustments j JOIN tenant.asset_capitalizations cp ON cp.id = j.capitalization_id
      WHERE j.organization_id = $1 AND j.id = $2`, [c.organizationId, uuid(input.adjustmentId, "Adjustment")])).rows[0];
  if (!adj || adj.asset_id !== w.asset_id || adj.status !== "POSTED") throw mtError(409, "ASSET_MAINTENANCE_INVALID", "Only a capitalization adjustment Finance posted for this asset is linked.");
  return { ...(await link(client, c, w, "CAPITALIZATION_ADJUSTMENT", adj.id, null, "CAPITAL_IMPROVEMENT", null)), workOrderId: w.id };
}
export async function unlinkMaintenanceCost(client, c, linkId, input = {}) {
  if (!has(c, MT.parts) && !has(c, MT.create)) throw mtError(403, "ASSET_MAINTENANCE_PERMISSION_DENIED");
  const reason = text(input.reason, 1000);
  if (reason.length < 3) throw mtError(400, "ASSET_MAINTENANCE_INVALID", "Give the reason.", { field: "reason" });
  const r = (await client.query(`UPDATE tenant.asset_maintenance_cost_links SET status = 'UNLINKED', unlinked_by = $3, unlinked_at = clock_timestamp(), unlink_reason = $4 WHERE organization_id = $1 AND id = $2 AND status = 'ACTIVE' RETURNING *`,
    [c.organizationId, uuid(linkId, "Link"), c.userId, reason])).rows[0];
  if (!r) throw mtError(404, "ASSET_MAINTENANCE_NOT_FOUND");
  await logMaintenanceEvent(client, c, { assetId: r.asset_id, workOrderId: r.work_order_id }, "COST_UNLINKED", { details: { sourceType: r.source_type, sourceNumber: r.source_number }, reason });
  return { linkId: r.id, status: "UNLINKED" };
}

// ------------------------------------------------------------------ preventive plans
// input: { assetId | asset, name, maintenanceType?, frequencyType: DAYS | MONTHS | ONCE, interval?, startDate, dueRule?, leadDays?, checklist?, technicianUserId?, supplierId?, estimatedMinutes?, defaultPriority? }
export async function createPreventiveMaintenancePlan(client, c, input = {}) {
  requireMt(c, MT.plans);
  const a = await maintenanceAsset(client, c, input);
  const f = await planFields(client, c, input);
  const number = await nextNumber(client, c, "asset_maintenance_plan", "AMP");
  const p = (await client.query(`INSERT INTO tenant.asset_maintenance_service_plans (organization_id, plan_number, asset_id, name, maintenance_type, frequency_type, interval_value, start_date, next_due_date, due_rule,
      lead_days, checklist, technician_user_id, supplier_id, estimated_minutes, default_priority, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
    [c.organizationId, number, a.id, f.name, f.type, f.frequency, f.interval, f.start, f.dueRule, f.leadDays, JSON.stringify(f.checklist), f.tech, f.vendor, f.minutes, f.priority, c.userId])).rows[0];
  await logMaintenanceEvent(client, c, { assetId: a.id, planId: p.id }, "PLAN_CREATED", { details: { frequency: f.frequency, interval: f.interval, start: f.start, dueRule: f.dueRule } });
  return { planId: p.id, number, nextDueDate: dayOfDb(p.next_due_date) };
}
async function planFields(client, c, input, base = {}) {
  const pick = (k, d) => (input[k] !== undefined ? input[k] : base[k] ?? d);
  const name = text(pick("name"), 200);
  if (name.length < 2) throw mtError(400, "ASSET_MAINTENANCE_INVALID", "Name the plan.", { field: "name" });
  const frequency = oneOf(pick("frequencyType"), ["DAYS", "MONTHS", "ONCE"], null, "frequency");
  const interval = frequency === "ONCE" ? null : Number(pick("interval"));
  if (frequency !== "ONCE" && !(Number.isInteger(interval) && interval >= 1 && interval <= 3650)) throw mtError(400, "ASSET_MAINTENANCE_INVALID", "Enter how often, in whole days or months.", { field: "interval" });
  const start = String(pick("startDate") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) throw mtError(400, "ASSET_MAINTENANCE_INVALID", "Enter the first service date.", { field: "startDate" });
  const leadDays = Number(pick("leadDays", 7));
  if (!(Number.isInteger(leadDays) && leadDays >= 0 && leadDays <= 120)) throw mtError(400, "ASSET_MAINTENANCE_INVALID", "Lead time is 0 to 120 days.", { field: "leadDays" });
  const checklist = (Array.isArray(pick("checklist", [])) ? pick("checklist", []) : []).map((x) => ({ text: text(x?.text ?? x, 500), mandatory: x?.mandatory !== false })).filter((x) => x.text);
  return { name, type: oneOf(pick("maintenanceType"), ["PREVENTIVE", "INSPECTION"], "PREVENTIVE", "type"), frequency, interval, start, dueRule: oneOf(pick("dueRule"), ["SCHEDULED_DATE", "COMPLETION_DATE"], "SCHEDULED_DATE", "due rule"),
    leadDays, checklist, tech: await technician(client, c, pick("technicianUserId")), vendor: await supplier(client, c, pick("supplierId")), minutes: pick("estimatedMinutes") ? Number(pick("estimatedMinutes")) : null,
    priority: oneOf(pick("defaultPriority"), PRIORITIES, "NORMAL", "priority") };
}
// input: { status?: ACTIVE | PAUSED | INACTIVE, …plan fields, reason } — a change is a new version of the plan.
export async function updatePreventiveMaintenancePlan(client, c, planId, input = {}) {
  requireMt(c, MT.plans);
  const p = (await client.query(`SELECT * FROM tenant.asset_maintenance_service_plans WHERE organization_id = $1 AND id = $2 FOR UPDATE`, [c.organizationId, uuid(planId, "Plan")])).rows[0];
  if (!p) throw mtError(404, "ASSET_MAINTENANCE_NOT_FOUND");
  const status = input.status ? oneOf(input.status, ["ACTIVE", "PAUSED", "INACTIVE"], null, "status") : p.status;
  const f = await planFields(client, c, input, { name: p.name, maintenanceType: p.maintenance_type, frequencyType: p.frequency_type, interval: p.interval_value, startDate: dayOfDb(p.start_date), dueRule: p.due_rule,
    leadDays: p.lead_days, checklist: p.checklist, technicianUserId: p.technician_user_id, supplierId: p.supplier_id, estimatedMinutes: p.estimated_minutes, defaultPriority: p.default_priority });
  const next = input.nextDueDate ? String(input.nextDueDate) : dayOfDb(p.next_due_date);
  await client.query(`UPDATE tenant.asset_maintenance_service_plans SET name = $2, maintenance_type = $3, frequency_type = $4, interval_value = $5, due_rule = $6, lead_days = $7, checklist = $8, technician_user_id = $9,
      supplier_id = $10, estimated_minutes = $11, default_priority = $12, status = $13, next_due_date = $14, version = version + 1, updated_at = clock_timestamp() WHERE id = $1`,
    [p.id, f.name, f.type, f.frequency, f.interval, f.dueRule, f.leadDays, JSON.stringify(f.checklist), f.tech, f.vendor, f.minutes, f.priority, status, next]);
  await logMaintenanceEvent(client, c, { assetId: p.asset_id, planId: p.id }, "PLAN_CHANGED", { from: p.status, to: status, reason: text(input.reason, 1000) || null });
  return { planId: p.id, status, version: p.version + 1 };
}
// One Work Order per due occurrence, however often this runs: the occurrence (plan, due date) is unique. input: { today? }
export async function generateDueMaintenanceOccurrences(client, c, input = {}) {
  const system = !c.userId;
  if (!system) requireMt(c, MT.plans);
  const day = input.today ?? today();
  await client.query(`SELECT pg_advisory_xact_lock(hashtext('asset_maintenance_plans:' || $1::text))`, [c.organizationId]);
  const due = (await client.query(`SELECT p.* FROM tenant.asset_maintenance_service_plans p JOIN tenant.assets a ON a.id = p.asset_id WHERE p.organization_id = $1 AND p.status = 'ACTIVE'
      AND p.next_due_date IS NOT NULL AND p.next_due_date - p.lead_days <= $2::date AND a.lifecycle_status NOT IN ('DISPOSED', 'RETIRED') FOR UPDATE OF p`, [c.organizationId, day])).rows;
  const made = [];
  for (const p of due) {
    const dueDate = dayOfDb(p.next_due_date);
    const index = Number((await client.query(`SELECT count(*)::int + 1 AS n FROM tenant.asset_maintenance_occurrences WHERE plan_id = $1`, [p.id])).rows[0].n);
    const occ = (await client.query(`INSERT INTO tenant.asset_maintenance_occurrences (organization_id, plan_id, due_date, occurrence_index) VALUES ($1,$2,$3,$4) ON CONFLICT (plan_id, due_date) DO NOTHING RETURNING *`,
      [c.organizationId, p.id, dueDate, index])).rows[0];
    if (!occ) continue;
    const wo = await createMaintenanceWorkOrder(client, c, { assetId: p.asset_id, maintenanceType: p.maintenance_type, priority: p.default_priority, title: `${p.name} — due ${dueDate}`,
      problem: `Preventive service from ${p.plan_number}`, technicianUserId: p.technician_user_id ?? undefined, supplierId: p.supplier_id ?? undefined, execution: p.supplier_id ? "EXTERNAL" : "INTERNAL",
      scheduledStartAt: `${dueDate}T09:00:00Z`, checklist: p.checklist, idempotencyKey: `plan:${p.id}:${dueDate}` }, { system: true, planId: p.id, occurrenceId: occ.id });
    await client.query(`UPDATE tenant.asset_maintenance_occurrences SET work_order_id = $2 WHERE id = $1`, [occ.id, wo.workOrderId]);
    // The next due date: from this scheduled date now, or (completion rule) once this service is done; a one-time plan is due once.
    const next = p.frequency_type === "ONCE" || p.due_rule === "COMPLETION_DATE" ? null : addInterval(dueDate, p.frequency_type, p.interval_value);
    await client.query(`UPDATE tenant.asset_maintenance_service_plans SET next_due_date = $2, updated_at = clock_timestamp() WHERE id = $1`, [p.id, next]);
    await logMaintenanceEvent(client, c, { assetId: p.asset_id, planId: p.id, workOrderId: wo.workOrderId }, "OCCURRENCE_GENERATED", { details: { dueDate, workOrder: wo.number } });
    made.push({ planId: p.id, dueDate, workOrderId: wo.workOrderId, number: wo.number });
  }
  if (made.length) await notify(client, c, await teamUsers(client, c.organizationId), `${made.length} preventive service${made.length === 1 ? "" : "s"} due`, made.map((m) => m.number).join(", "), "/assets/maintenance?view=scheduled", null);
  return { generated: made.length, workOrders: made };
}
async function completeOccurrence(client, c, w) {
  const o = (await client.query(`UPDATE tenant.asset_maintenance_occurrences SET status = 'COMPLETED', completed_at = clock_timestamp() WHERE id = $1 RETURNING *`, [w.occurrence_id])).rows[0];
  if (!o) return;
  const p = (await client.query(`SELECT * FROM tenant.asset_maintenance_service_plans WHERE id = $1 FOR UPDATE`, [o.plan_id])).rows[0];
  const done = today();
  const next = p.frequency_type !== "ONCE" && p.due_rule === "COMPLETION_DATE" ? addInterval(done, p.frequency_type, p.interval_value) : dayOfDb(p.next_due_date);
  await client.query(`UPDATE tenant.asset_maintenance_service_plans SET last_completed_date = $2, next_due_date = $3, status = CASE WHEN frequency_type = 'ONCE' THEN 'INACTIVE' ELSE status END, updated_at = clock_timestamp() WHERE id = $1`,
    [p.id, done, next]);
}
// Overdue Work Orders (past their expected completion) and plans due soon: one notification per Work Order and day.
export async function notifyMaintenanceDue(client, c, input = {}) {
  const day = input.today ?? today();
  const overdue = (await client.query(`SELECT * FROM tenant.asset_maintenance_work_orders WHERE organization_id = $1 AND status = ANY($2::text[]) AND expected_completion_at IS NOT NULL AND expected_completion_at::date < $3::date`,
    [c.organizationId, OPEN_WO, day])).rows;
  let sent = 0;
  for (const w of overdue) {
    const key = `overdue:${w.id}:${day}`;
    if (await replayed(client, c, key)) continue;
    await logMaintenanceEvent(client, c, { assetId: w.asset_id, workOrderId: w.id }, "OVERDUE_NOTIFIED", { commandId: key });
    await notify(client, c, [w.technician_user_id, w.responsible_user_id], `${w.work_order_number} is overdue`, w.title, `/assets/maintenance/work-orders/${w.id}`, w.id);
    sent += 1;
  }
  return { overdue: overdue.length, notified: sent };
}
