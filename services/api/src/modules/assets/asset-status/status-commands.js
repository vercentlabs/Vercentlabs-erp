// Assets — Asset Status, the commands. Each lifecycle action is its own command with its own checks, run on the current version of the
// asset, idempotent by key, and recorded with its action, reason and actor (the database writes the lifecycle history from the command's
// context, so every change — from here or an older workflow — is traced). Nothing here posts, capitalizes, depreciates or writes off;
// Finance decides those. Disposal is the Disposal workflow's; no command here marks an asset disposed.
import { has, recordAssetEvent, text, uuid } from "../common.js";
import { createNotification } from "../../../core/platform/notifications/index.js";
import { HOLD_REASON, STATUS, requireStatus, statusError } from "./status-rules.js";

const KEYS = ["vercent.asset_action", "vercent.asset_actor", "vercent.asset_reason", "vercent.asset_key", "vercent.asset_effective", "vercent.asset_source_type", "vercent.asset_source_id", "vercent.location_event"];
// The context the history trigger records, for the statements `run` makes; cleared afterwards so nothing leaks to the next change.
export async function withStatusContext(client, c, ctx, run) {
  const values = [ctx.action, c.userId ?? "", ctx.reason ?? "", ctx.key ?? "", ctx.effective ?? "", ctx.sourceType ?? "", ctx.sourceId ?? "", ctx.locationEvent ?? ""].map((v) => String(v ?? ""));
  await client.query(`SELECT ${KEYS.map((k, i) => `set_config('${k}', $${i + 1}, true)`).join(", ")}`, values);
  try { return await run(); } finally { await client.query(`SELECT ${KEYS.map((k) => `set_config('${k}', '', true)`).join(", ")}`); }
}
// A command repeated with its key returns the first outcome instead of changing anything twice.
export async function replayOf(client, c, key) {
  if (!key) return null;
  const done = (await client.query(`SELECT asset_id, new_status FROM tenant.asset_lifecycle_events WHERE organization_id = $1 AND idempotency_key = $2 AND event_kind = 'LIFECYCLE'`, [c.organizationId, key])).rows[0];
  return done ? { assetId: done.asset_id, lifecycle: done.new_status, replayed: true } : null;
}
const keyOf = (input) => text(input?.idempotencyKey, 200) || null;
async function load(client, c, assetId, input) {
  const { loadAssetRow } = await import("../asset-register/register-commands.js");
  const row = await loadAssetRow(client, c, assetId, { lock: true });
  if (input.expectedVersion !== undefined && input.expectedVersion !== null && Number(input.expectedVersion) !== Number(row.row_version)) {
    throw statusError(409, "ASSET_STATUS_VERSION_CONFLICT", undefined, { current: row.row_version });
  }
  if (row.archived_at) throw statusError(409, "ASSET_STATUS_INVALID_TRANSITION", "An archived asset's status does not change.");
  return row;
}
const from = (row, allowed, verb) => {
  if (!allowed.includes(row.lifecycle_status)) throw statusError(409, "ASSET_STATUS_INVALID_TRANSITION", `A ${row.lifecycle_status.toLowerCase().replace(/_/g, " ")} asset cannot be ${verb}.`, { lifecycle: row.lifecycle_status });
};
const reasonOf = (input, field = "reason", code = "ASSET_STATUS_NOT_READY", message = "Give the reason.") => {
  const value = text(input[field], 1000);
  if (value.length < 3) throw statusError(400, code, message, { field });
  return value;
};
async function update(client, c, row, sets, ctx) {
  const cols = Object.keys(sets);
  return withStatusContext(client, c, ctx, async () => (await client.query(`UPDATE tenant.assets SET ${cols.map((col, i) => `${col} = $${i + 3}`).join(", ")} WHERE organization_id = $1 AND id = $2 RETURNING *`,
    [c.organizationId, row.id, ...cols.map((col) => sets[col])])).rows[0]);
}
async function notify(client, c, userIds, asset, title, message) {
  for (const userId of [...new Set(userIds.filter(Boolean))]) {
    if (userId === c.userId) continue;
    await createNotification(client, { organizationId: c.organizationId, userId, category: "asset_register", title: `${asset.asset_number}: ${title}`, message: message ?? null,
      href: `/assets/register/${asset.id}`, entityType: "assets.asset", entityId: asset.id });
  }
}
async function usersWith(client, c, permission) {
  return (await client.query(`SELECT DISTINCT assignment.user_id FROM user_role_assignments assignment JOIN role_permissions grant_row ON grant_row.role_id = assignment.role_id
      WHERE assignment.organization_id = $1 AND assignment.status = 'active' AND grant_row.permission_key = $2`, [c.organizationId, permission]).catch(() => ({ rows: [] }))).rows.map((r) => r.user_id);
}
async function openWork(client, assetId) {
  const transfer = (await client.query(`SELECT o.transfer_number FROM tenant.asset_transfer_lines l JOIN tenant.asset_transfer_orders o ON o.id = l.transfer_id WHERE l.asset_id = $1 AND l.line_status IN ('PENDING', 'APPROVED', 'DISPATCHED', 'RECEIVED', 'RECEIPT_EXCEPTION', 'RETURN_IN_PROGRESS') LIMIT 1`, [assetId])).rows[0] ?? null;
  const maintenance = (await client.query(`SELECT work_order_number FROM (SELECT work_order_number FROM tenant.asset_maintenance_orders WHERE asset_id = $1 AND status = 'in_progress' UNION ALL SELECT work_order_number FROM tenant.asset_maintenance_work_orders WHERE asset_id = $1 AND status IN ('IN_PROGRESS', 'WAITING_FOR_PARTS', 'WAITING_FOR_VENDOR', 'WORK_COMPLETED', 'PENDING_VERIFICATION')) m LIMIT 1`, [assetId])).rows[0] ?? null;
  return { transfer, maintenance };
}
async function activeUser(client, c, userId, label) {
  if (!userId) return null;
  const row = (await client.query(`SELECT u.id FROM public.users u JOIN public.organization_memberships m ON m.user_id = u.id WHERE m.organization_id = $1 AND u.id = $2 AND m.status = 'active' AND u.status = 'active'`,
    [c.organizationId, uuid(userId, label)])).rows[0];
  if (!row) throw statusError(400, "ASSET_STATUS_NOT_READY", `Select an active Company user as the ${label.toLowerCase()}.`);
  return row.id;
}
async function activeLocation(client, c, locationId) {
  const row = (await client.query(`SELECT id FROM tenant.asset_locations WHERE organization_id = $1 AND id = $2 AND active`, [c.organizationId, uuid(locationId, "Location")])).rows[0];
  if (!row) throw statusError(400, "ASSET_STATUS_NOT_READY", "Select an active location.");
  return row.id;
}
async function closeActiveHold(client, row, c, reason) {
  await client.query(`UPDATE tenant.asset_holds SET status = 'CLOSED', released_at = clock_timestamp(), released_by = $2, release_reason = $3 WHERE asset_id = $1 AND status = 'ACTIVE'`, [row.id, c.userId, reason]);
}
const day = (value, label) => {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value)) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) throw statusError(400, "ASSET_STATUS_NOT_READY", `Enter ${label} as YYYY-MM-DD.`);
  return String(value);
};
const today = async (client) => (await client.query(`SELECT to_char(current_date, 'YYYY-MM-DD') AS d`)).rows[0].d;

// ------------------------------------------------------------------ hold
// input: { reasonCode, description, resolutionOwnerId?, expectedVersion?, idempotencyKey? } — from Registered or Active; the hold keeps where it began.
export async function placeAssetOnHold(client, c, assetId, input = {}) {
  requireStatus(c, STATUS.placeHold);
  const key = keyOf(input);
  const replay = await replayOf(client, c, key);
  if (replay) return replay;
  const row = await load(client, c, assetId, input);
  if (row.lifecycle_status === "ON_HOLD") throw statusError(409, "ASSET_STATUS_ACTIVE_HOLD_EXISTS");
  from(row, ["REGISTERED", "ACTIVE"], "placed on hold");
  const reasonCode = String(input.reasonCode ?? "");
  if (!HOLD_REASON[reasonCode]) throw statusError(400, "ASSET_STATUS_HOLD_REQUIRED", "Choose why the asset is placed on hold.", { field: "reasonCode" });
  const description = reasonOf(input, "description", "ASSET_STATUS_HOLD_REQUIRED", reasonCode === "OTHER" ? "Explain the hold." : "Describe what needs to happen.");
  const owner = (await activeUser(client, c, input.resolutionOwnerId, "Resolution owner")) ?? c.userId;
  const hold = (await client.query(`INSERT INTO tenant.asset_holds (organization_id, asset_id, reason_code, description, previous_lifecycle, reported_by, resolution_owner_id, idempotency_key)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, hold_number`, [c.organizationId, row.id, reasonCode, description, row.lifecycle_status, c.userId, owner, key])).rows[0];
  const updated = await update(client, c, row, { lifecycle_status: "ON_HOLD", current_hold_id: hold.id }, { action: "hold", reason: `${HOLD_REASON[reasonCode]}: ${description}`, key, sourceType: "asset_hold", sourceId: hold.id });
  await recordAssetEvent(client, c, row.id, "asset.hold", { holdId: hold.id, reasonCode, description, from: row.lifecycle_status, owner });
  await notify(client, c, [owner, row.current_user_id], row, `placed on hold (${HOLD_REASON[reasonCode].toLowerCase()})`, owner !== c.userId ? `${description} You are responsible for resolving it.` : description);
  return { assetId: row.id, lifecycle: "ON_HOLD", holdId: hold.id, holdNumber: `HLD-${hold.hold_number}`, version: updated.row_version };
}
// input: { reason, expectedVersion?, idempotencyKey? } — back to the state the hold began from (a registered asset stays uncommissioned).
export async function releaseAssetHold(client, c, assetId, input = {}) {
  requireStatus(c, STATUS.releaseHold);
  const key = keyOf(input);
  const replay = await replayOf(client, c, key);
  if (replay) return replay;
  const row = await load(client, c, assetId, input);
  from(row, ["ON_HOLD"], "released from hold");
  const hold = (await client.query(`SELECT * FROM tenant.asset_holds WHERE asset_id = $1 AND status = 'ACTIVE' FOR UPDATE`, [row.id])).rows[0];
  const back = hold?.previous_lifecycle ?? "ACTIVE";
  const reason = reasonOf(input, "reason", "ASSET_STATUS_HOLD_UNRESOLVED", "Say how the hold was resolved.");
  const work = await openWork(client, row.id);
  if (work.maintenance) throw statusError(409, "ASSET_STATUS_MAINTENANCE_ACTIVE", `Work order ${work.maintenance.work_order_number} is still in progress; complete it before releasing the hold.`);
  if (back === "ACTIVE" && row.condition === "UNSERVICEABLE") throw statusError(409, "ASSET_STATUS_HOLD_UNRESOLVED", "The asset is recorded as unserviceable; record its condition after repair first.");
  if (hold) await client.query(`UPDATE tenant.asset_holds SET status = 'RELEASED', released_at = clock_timestamp(), released_by = $2, release_reason = $3 WHERE id = $1`, [hold.id, c.userId, reason]);
  const updated = await update(client, c, row, { lifecycle_status: back, current_hold_id: null }, { action: "release", reason, key, sourceType: "asset_hold", sourceId: hold?.id });
  await recordAssetEvent(client, c, row.id, "asset.release", { holdId: hold?.id ?? null, to: back, reason });
  await notify(client, c, [hold?.reported_by, hold?.resolution_owner_id, row.current_user_id], row, "hold released", reason);
  return { assetId: row.id, lifecycle: back, version: updated.row_version };
}

// ------------------------------------------------------------------ retire and reinstate
// input: { reason, custodyReviewed?, retiredOn?, expectedVersion?, idempotencyKey? } — withdrawn from use; not a disposal, nothing is posted.
export async function retireAsset(client, c, assetId, input = {}) {
  requireStatus(c, STATUS.retire);
  const key = keyOf(input);
  const replay = await replayOf(client, c, key);
  if (replay) return replay;
  const row = await load(client, c, assetId, input);
  from(row, ["ACTIVE", "ON_HOLD"], "retired");
  const reason = reasonOf(input, "reason", "ASSET_STATUS_NOT_READY", "Give the reason for retirement.");
  const work = await openWork(client, row.id);
  if (work.transfer) throw statusError(409, "ASSET_STATUS_TRANSFER_PENDING", `Transfer ${work.transfer.transfer_number} is in progress; complete or cancel it first.`);
  if (work.maintenance) throw statusError(409, "ASSET_STATUS_MAINTENANCE_ACTIVE", `Work order ${work.maintenance.work_order_number} is still in progress.`);
  const custody = Boolean(row.current_user_id || row.current_department_id);
  if (custody && input.custodyReviewed !== true) throw statusError(409, "ASSET_STATUS_CUSTODY_REVIEW_REQUIRED", "The asset is still assigned. Confirm it has been returned before retiring it.", { custodianId: row.current_user_id, departmentId: row.current_department_id });
  const retiredOn = day(input.retiredOn, "the retirement date") ?? await today(client);
  if (custody) {
    await client.query(`UPDATE tenant.asset_assignments SET assignment_status = 'returned', returned_at = now(), returned_by = $2 WHERE asset_id = $1 AND assignment_status = 'active'`, [row.id, c.userId]);
    await client.query(`INSERT INTO tenant.asset_movements (organization_id, asset_id, movement_type, effective_date, from_user_id, from_department_id, from_location_id, to_location_id, reason, actor_user_id)
        VALUES ($1,$2,'return',$3,$4,$5,$6,$6,$7,$8)`, [c.organizationId, row.id, retiredOn, row.current_user_id, row.current_department_id, row.location_id, `Returned on retirement: ${reason}`, c.userId]);
  }
  if (row.lifecycle_status === "ON_HOLD") await closeActiveHold(client, row, c, `Retired: ${reason}`);
  // A handover not yet finished (or not yet acknowledged) no longer applies once the asset leaves service.
  await client.query(`UPDATE tenant.asset_custody_handovers SET status = 'CANCELLED', cancel_reason = $2 WHERE asset_id = $1 AND status IN ('PENDING_HANDOVER', 'AWAITING_ACKNOWLEDGMENT')`, [row.id, `Asset retired: ${reason}`]);
  const updated = await update(client, c, row, { lifecycle_status: "RETIRED", retired_at: new Date().toISOString(), current_hold_id: null, current_user_id: null, current_department_id: null, availability_status: "RESTRICTED" },
    { action: "retire", reason, key, effective: retiredOn, locationEvent: "TRANSFER" });
  await recordAssetEvent(client, c, row.id, "asset.retire", { reason, retiredOn, custodyReturned: custody });
  await notify(client, c, [row.current_user_id], row, "retired", reason);
  return { assetId: row.id, lifecycle: "RETIRED", version: updated.row_version,
    note: row.capitalization_class === "CAPITALIZED" ? "Still in Finance's books: disposal or derecognition is Finance's decision through the Disposal workflow." : null };
}
// input: { reason, suitabilityConfirmed, locationId?, expectedVersion?, idempotencyKey? } — a retired asset back in service after review.
export async function reinstateAsset(client, c, assetId, input = {}) {
  requireStatus(c, STATUS.reinstate);
  const key = keyOf(input);
  const replay = await replayOf(client, c, key);
  if (replay) return replay;
  const row = await load(client, c, assetId, input);
  from(row, ["RETIRED"], "reinstated");
  const reason = reasonOf(input, "reason", "ASSET_STATUS_NOT_READY", "Give the reason for reinstatement.");
  if (input.suitabilityConfirmed !== true) throw statusError(409, "ASSET_STATUS_NOT_READY", "Confirm the asset has been reviewed and is suitable for use.");
  if (row.condition === "UNSERVICEABLE") throw statusError(409, "ASSET_STATUS_NOT_READY", "The asset is recorded as unserviceable; record a usable condition first.");
  const location = input.locationId ? await activeLocation(client, c, input.locationId) : row.location_id;
  if (!location) throw statusError(409, "ASSET_STATUS_NOT_READY", "Choose where the asset is.");
  const updated = await update(client, c, row, { lifecycle_status: "ACTIVE", retired_at: null, location_id: location, availability_status: "AVAILABLE" }, { action: "reinstate", reason, key, locationEvent: "REINSTATEMENT" });
  await recordAssetEvent(client, c, row.id, "asset.reinstate", { reason });
  return { assetId: row.id, lifecycle: "ACTIVE", version: updated.row_version };
}

// ------------------------------------------------------------------ missing, lost and recovered
// input: { description, missingSince?, lastKnownLocationText?, idempotencyKey? } — an incident, not proof of loss; the custodian may report.
export async function reportMissingAsset(client, c, assetId, input = {}, options = {}) {
  if (!options.fromVerification) requireStatus(c, STATUS.reportMissing);
  const key = keyOf(input);
  if (key) {
    const done = (await client.query(`SELECT id, incident_number FROM tenant.asset_missing_incidents WHERE organization_id = $1 AND idempotency_key = $2`, [c.organizationId, key])).rows[0];
    if (done) return { incidentId: done.id, number: `MIS-${done.incident_number}`, replayed: true };
  }
  const { loadAssetRow } = await import("../asset-register/register-commands.js");
  const row = await loadAssetRow(client, c, assetId, { lock: true });
  from(row, ["REGISTERED", "ACTIVE", "ON_HOLD"], "reported missing");
  const open = (await client.query(`SELECT id, incident_number FROM tenant.asset_missing_incidents WHERE asset_id = $1 AND status = 'OPEN'`, [row.id])).rows[0];
  if (open) return { incidentId: open.id, number: `MIS-${open.incident_number}`, alreadyReported: true };
  const description = reasonOf(input, "description", "ASSET_STATUS_NOT_READY", "Describe when and where it was last seen.");
  const made = (await client.query(`INSERT INTO tenant.asset_missing_incidents (organization_id, asset_id, source, reported_by, missing_since, last_known_location_id, last_known_location_text, last_known_custodian_id,
      description, idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id, incident_number`, [c.organizationId, row.id, options.fromVerification ? "VERIFICATION" : "REPORT", c.userId,
    day(input.missingSince, "the date it went missing"), row.location_id, text(input.lastKnownLocationText, 300) || null, row.current_user_id, description, key])).rows[0];
  await recordAssetEvent(client, c, row.id, "asset.reported_missing", { incidentId: made.id, description, source: options.fromVerification ? "VERIFICATION" : "REPORT" });
  // Missing equipment can hold business information: those who investigate are told at once.
  await notify(client, c, [...await usersWith(client, c, STATUS.confirmLost), row.current_user_id], row, "reported missing", description);
  return { incidentId: made.id, number: `MIS-${made.incident_number}` };
}
async function openIncident(client, row) {
  return (await client.query(`SELECT * FROM tenant.asset_missing_incidents WHERE asset_id = $1 AND status = 'OPEN' FOR UPDATE`, [row.id])).rows[0] ?? null;
}
// input: { note, expectedVersion?, idempotencyKey? } — after the investigation; Finance decides any write-off.
export async function confirmAssetLost(client, c, assetId, input = {}) {
  requireStatus(c, STATUS.confirmLost);
  const key = keyOf(input);
  const replay = await replayOf(client, c, key);
  if (replay) return replay;
  const row = await load(client, c, assetId, input);
  from(row, ["ACTIVE", "ON_HOLD"], "confirmed lost");
  const incident = await openIncident(client, row);
  if (!incident) throw statusError(409, "ASSET_STATUS_LOSS_REVIEW_REQUIRED", "Record a missing-asset report and investigate it before confirming the loss.");
  const note = reasonOf(input, "note", "ASSET_STATUS_LOSS_REVIEW_REQUIRED", "Summarize the investigation.");
  await client.query(`UPDATE tenant.asset_missing_incidents SET status = 'CONFIRMED_LOST', decided_by = $2, decided_at = clock_timestamp(), decision_note = $3, investigation_owner_id = COALESCE(investigation_owner_id, $2) WHERE id = $1`,
    [incident.id, c.userId, note]);
  if (row.lifecycle_status === "ON_HOLD") await closeActiveHold(client, row, c, `Confirmed lost: ${note}`);
  const updated = await update(client, c, row, { lifecycle_status: "LOST", lost_incident_id: incident.id, current_hold_id: null, availability_status: "RESTRICTED" },
    { action: "confirm-lost", reason: note, key, sourceType: "asset_missing_incident", sourceId: incident.id });
  await recordAssetEvent(client, c, row.id, "asset.confirm_lost", { incidentId: incident.id, note, note2: "Finance decides any write-off; nothing is posted." });
  await notify(client, c, [row.current_user_id, incident.reported_by, ...(row.capitalization_class === "CAPITALIZED" ? await usersWith(client, c, "assets.capitalize") : [])], row, "confirmed lost", note);
  return { assetId: row.id, lifecycle: "LOST", incidentId: incident.id, version: updated.row_version };
}
// input: { note } — the report was a false alarm: the asset was found before any loss was confirmed.
export async function closeMissingReport(client, c, assetId, input = {}) {
  requireStatus(c, STATUS.confirmLost);
  const row = await load(client, c, assetId, input);
  const incident = await openIncident(client, row);
  if (!incident) throw statusError(409, "ASSET_STATUS_INVALID_TRANSITION", "There is no open missing-asset report.");
  const note = reasonOf(input, "note", "ASSET_STATUS_NOT_READY", "Say where it was found.");
  await client.query(`UPDATE tenant.asset_missing_incidents SET status = 'CLOSED_FOUND', decided_by = $2, decided_at = clock_timestamp(), decision_note = $3 WHERE id = $1`, [incident.id, c.userId, note]);
  await recordAssetEvent(client, c, row.id, "asset.missing_report_closed", { incidentId: incident.id, note });
  await notify(client, c, [incident.reported_by], row, "found — missing report closed", note);
  return { assetId: row.id, incidentId: incident.id, status: "CLOSED_FOUND" };
}
// input: { recoveredOn, condition, locationId, custodianUserId?, identityConfirmed, note?, financeReviewed?, expectedVersion?, idempotencyKey? }
export async function recoverAsset(client, c, assetId, input = {}) {
  requireStatus(c, STATUS.recover);
  const key = keyOf(input);
  const replay = await replayOf(client, c, key);
  if (replay) return replay;
  const row = await load(client, c, assetId, input);
  from(row, ["LOST"], "recovered");
  if (input.identityConfirmed !== true) throw statusError(409, "ASSET_STATUS_NOT_READY", "Confirm the asset code or serial matches the recovered item.");
  const recoveredOn = day(input.recoveredOn, "the recovery date");
  if (!recoveredOn) throw statusError(400, "ASSET_STATUS_NOT_READY", "Enter the date it was recovered.", { field: "recoveredOn" });
  const condition = ["NEW", "GOOD", "FAIR", "DAMAGED", "UNSERVICEABLE"].includes(String(input.condition)) ? String(input.condition) : null;
  if (!condition) throw statusError(400, "ASSET_STATUS_NOT_READY", "Inspect the asset and record its condition.", { field: "condition" });
  if (!input.locationId) throw statusError(400, "ASSET_STATUS_NOT_READY", "Choose where the asset is now.", { field: "locationId" });
  const location = await activeLocation(client, c, input.locationId);
  const custodian = await activeUser(client, c, input.custodianUserId, "Custodian");
  if (custodian && condition === "UNSERVICEABLE") throw statusError(409, "ASSET_STATUS_NOT_READY", "An unserviceable asset cannot be issued to a custodian.");
  const incident = row.lost_incident_id ? (await client.query(`SELECT * FROM tenant.asset_missing_incidents WHERE id = $1 FOR UPDATE`, [row.lost_incident_id])).rows[0] : null;
  // Finance may have recognized the loss (an impairment after the loss was confirmed): it reviews before the asset returns.
  const recognized = row.capitalization_class === "CAPITALIZED" && incident ? (await client.query(`SELECT 1 FROM tenant.asset_value_adjustments WHERE asset_id = $1 AND adjustment_type = 'impairment' AND status = 'posted'
      AND effective_date >= (SELECT decided_at::date FROM tenant.asset_missing_incidents WHERE id = $2)`, [row.id, incident.id])).rows[0] : null;
  if (recognized && !(input.financeReviewed === true && has(c, "assets.capitalize"))) throw statusError(409, "ASSET_STATUS_FINANCE_REVIEW_REQUIRED", "Finance recorded the loss in the books; Finance reviews the recovery first.");
  if (incident) await client.query(`UPDATE tenant.asset_missing_incidents SET status = 'RECOVERED', recovered_at = $2, decision_note = COALESCE(decision_note, '') || $3 WHERE id = $1`,
    [incident.id, recoveredOn, ` · Recovered: ${text(input.note, 500) || "recovered"}`]);
  await client.query(`INSERT INTO tenant.asset_condition_events (organization_id, asset_id, previous_condition, new_condition, observed_on, source, status, reason, source_id, observed_by) VALUES ($1,$2,$3,$4,$5,'RECOVERY','APPLIED',$6,$7,$8)`,
    [c.organizationId, row.id, row.condition, condition, recoveredOn, "Inspected on recovery", incident?.id ?? null, c.userId]);
  if (location !== row.location_id || custodian !== row.current_user_id) {
    await client.query(`INSERT INTO tenant.asset_movements (organization_id, asset_id, movement_type, effective_date, from_user_id, to_user_id, from_location_id, to_location_id, reason, actor_user_id)
        VALUES ($1,$2,'status_change',$3,$4,$5,$6,$7,'Recovered after loss',$8)`, [c.organizationId, row.id, recoveredOn, row.current_user_id, custodian, row.location_id, location, c.userId]);
  }
  const updated = await update(client, c, row, { lifecycle_status: "ACTIVE", condition, condition_observed_at: new Date().toISOString(), location_id: location, current_user_id: custodian, lost_incident_id: null,
    availability_status: custodian ? "ASSIGNED" : "AVAILABLE" }, { action: "recover", reason: text(input.note, 500) || "Recovered", key, effective: recoveredOn, locationEvent: "RECOVERY", sourceType: "asset_missing_incident", sourceId: incident?.id });
  await recordAssetEvent(client, c, row.id, "asset.recover", { incidentId: incident?.id ?? null, recoveredOn, condition });
  await notify(client, c, [incident?.reported_by, row.current_user_id, custodian], row, "recovered", text(input.note, 500) || null);
  return { assetId: row.id, lifecycle: "ACTIVE", version: updated.row_version };
}

// ------------------------------------------------------------------ condition
// input: { condition, observedOn?, reason?, source? } — applied by someone allowed; the custodian's report is a proposal for the asset team.
export async function recordAssetCondition(client, c, assetId, input = {}, options = {}) {
  const { loadAssetRow } = await import("../asset-register/register-commands.js");
  const row = await loadAssetRow(client, c, assetId, { lock: true });
  if (row.lifecycle_status === "DISPOSED" || row.archived_at) throw statusError(409, "ASSET_STATUS_INVALID_TRANSITION", "A disposed or archived asset keeps its last recorded condition.");
  const applies = has(c, STATUS.condition);
  const proposes = !applies && (options.fromVerification || (row.current_user_id === c.userId && has(c, STATUS.reportMissing)));
  if (!applies && !proposes) throw statusError(403, "ASSET_STATUS_PERMISSION_DENIED");
  const condition = ["NEW", "GOOD", "FAIR", "DAMAGED", "UNSERVICEABLE"].includes(String(input.condition)) ? String(input.condition) : null;
  if (!condition) throw statusError(400, "ASSET_STATUS_NOT_READY", "Choose the condition observed.", { field: "condition" });
  const observedOn = day(input.observedOn, "the observation date") ?? await today(client);
  if (observedOn > await today(client)) throw statusError(400, "ASSET_STATUS_NOT_READY", "The observation date cannot be in the future.");
  const reason = text(input.reason, 1000) || null;
  if (!applies && !reason && !options.fromVerification) throw statusError(400, "ASSET_STATUS_NOT_READY", "Describe the damage.", { field: "reason" });
  const source = options.source ?? (["INSPECTION", "MAINTENANCE", "VERIFICATION", "REPORT"].includes(String(input.source)) ? String(input.source) : applies ? "INSPECTION" : "REPORT");
  const event = (await client.query(`INSERT INTO tenant.asset_condition_events (organization_id, asset_id, previous_condition, new_condition, observed_on, source, status, reason, source_id, observed_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`, [c.organizationId, row.id, row.condition, condition, observedOn, source, applies ? "APPLIED" : "PROPOSED", reason, options.sourceId ?? null, c.userId])).rows[0];
  if (applies && condition !== row.condition) await client.query(`UPDATE tenant.assets SET condition = $3, condition_observed_at = clock_timestamp() WHERE organization_id = $1 AND id = $2`, [c.organizationId, row.id, condition]);
  else if (applies) await client.query(`UPDATE tenant.assets SET condition_observed_at = clock_timestamp() WHERE organization_id = $1 AND id = $2`, [c.organizationId, row.id]);
  await recordAssetEvent(client, c, row.id, applies ? "asset.condition_recorded" : "asset.condition_reported", { from: row.condition, to: condition, observedOn, source, reason });
  if (!applies) await notify(client, c, await usersWith(client, c, STATUS.condition), row, `condition reported as ${condition.toLowerCase()}`, reason);
  return { assetId: row.id, conditionEventId: event.id, status: applies ? "APPLIED" : "PROPOSED", condition: applies ? condition : row.condition };
}

// ------------------------------------------------------------------ bulk
// input: { action: commission | hold | release | retire, assetIds, …the action's fields, idempotencyKey? } — each asset on its own; one failure never undoes another.
export async function bulkAssetStatusAction(client, c, input = {}) {
  requireStatus(c, STATUS.bulk);
  const action = String(input.action ?? "");
  const run = { commission: null, hold: placeAssetOnHold, release: releaseAssetHold, retire: retireAsset }[action];
  if (run === undefined) throw statusError(400, "ASSET_STATUS_INVALID_TRANSITION", "Choose commission, hold, release or retire.");
  const ids = [...new Set((Array.isArray(input.assetIds) ? input.assetIds : []).map(String))];
  if (!ids.length || ids.length > 200) throw statusError(400, "ASSET_STATUS_NOT_READY", "Choose between 1 and 200 assets.");
  const { transitionAsset } = await import("../asset-register/register-commands.js");
  const base = text(input.idempotencyKey, 150) || null;
  const shared = Object.fromEntries(Object.entries(input).filter(([k]) => !["action", "assetIds", "idempotencyKey", "expectedVersion"].includes(k)));
  const results = [];
  for (const [i, id] of ids.entries()) {
    const itemKey = base ? `${base}:${id}` : undefined;
    await client.query(`SAVEPOINT bulk_status_${i}`);
    try {
      const done = run ? await run(client, c, id, { ...shared, idempotencyKey: itemKey }) : await transitionAsset(client, c, id, "activate", { ...shared, idempotencyKey: itemKey });
      await client.query(`RELEASE SAVEPOINT bulk_status_${i}`);
      results.push({ assetId: id, ok: true, lifecycle: done.lifecycle, replayed: Boolean(done.replayed) });
    } catch (failure) {
      await client.query(`ROLLBACK TO SAVEPOINT bulk_status_${i}`);
      results.push({ assetId: id, ok: false, errorCode: failure.code ?? "ASSET_STATUS_INVALID_TRANSITION", message: failure.message });
    }
  }
  const codes = (await client.query(`SELECT id, asset_number FROM tenant.assets WHERE organization_id = $1 AND id = ANY($2::uuid[])`, [c.organizationId, ids.filter((x) => /^[0-9a-f-]{36}$/i.test(x))])).rows;
  const codeOf = new Map(codes.map((r) => [r.id, r.asset_number]));
  return { action, results: results.map((r) => ({ ...r, assetNumber: codeOf.get(r.assetId) ?? null })), succeeded: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length };
}
