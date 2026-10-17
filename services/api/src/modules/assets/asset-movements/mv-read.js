// Assets — Asset Movement History, reads: an asset's grouped timeline, the Company directory (paged and filtered in the database), one
// event with its source and corrections, the position on a past date (as now understood, or as known then), exceptions, reports, export.
// Every read first brings the projection up to date from the sources; the current location and custodian always come from the sources.
import { has, text, uuid } from "../common.js";
import { CERTAINTY, companyWide, CUSTODIAN, EVENT, EVENT_TYPES, GROUP, MV, mvError, ORDER_SQL, RANK_SQL, requireMv, seesMovements } from "./mv-rules.js";
import { ORDER_DESC, syncAssetMovements, syncCompanyMovements, syncState } from "./mv-ingest.js";

const NAME = (alias) => `COALESCE(NULLIF(${alias}.full_name, ''), ${alias}.email)`;
const HREF = Object.freeze({
  asset_transfer: (id) => `/assets/transfers/${id}`, asset_assignment: (id) => `/assets/assignments/${id}`, asset_disposal: () => "/assets/disposals", asset_disposal_case: (id) => `/assets/disposals/${id}`,
  asset_maintenance_order: () => "/assets/maintenance", asset_maintenance_work_order: (id) => `/assets/maintenance/work-orders/${id}`, asset_location_discrepancy: () => "/assets/locations", asset_missing_incident: () => "/assets/status",
  asset_verification: () => "/assets/verification", asset_opening: () => "/assets/opening", asset_opening_row: () => "/assets/opening",
});
const EXCEPTION_TYPES = ["MOVEMENT_EXCEPTION", "MISSING_REPORTED", "LOCATION_DISCREPANCY", "HANDOVER_DISPUTED"];
const iso = (v) => (v instanceof Date ? v.toISOString() : v ?? null);
const day = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v ?? "")) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) ? String(v) : null);

// Who may see this asset's history: the Company-wide roles, or someone who holds or has held it (themselves or as a department's
// accountable person). An asset id alone never grants access.
async function assetFor(client, c, assetId) {
  if (!seesMovements(c)) throw mvError(403, "ASSET_MOVEMENT_ACCESS_DENIED");
  let id;
  try { id = uuid(assetId, "Asset"); } catch { throw mvError(404, "ASSET_MOVEMENT_NOT_FOUND"); }
  const a = (await client.query(`SELECT a.id, a.asset_number, a.name, a.serial_number, a.tag_code, a.location_id, a.lifecycle_status, l.name AS location FROM tenant.assets a
      LEFT JOIN tenant.asset_locations l ON l.id = a.location_id WHERE a.organization_id = $1 AND a.id = $2`, [c.organizationId, id])).rows[0];
  if (!a) {
    const elsewhere = (await client.query(`SELECT 1 FROM tenant.assets WHERE id = $1`, [id])).rows[0];
    throw mvError(404, elsewhere ? "ASSET_MOVEMENT_COMPANY_MISMATCH" : "ASSET_MOVEMENT_NOT_FOUND");
  }
  if (!companyWide(c) && !(await heldBy(client, c, a.id))) throw mvError(403, "ASSET_MOVEMENT_ACCESS_DENIED");
  return a;
}
const heldBy = async (client, c, assetId) => (await client.query(`SELECT 1 FROM tenant.asset_custody_assignments WHERE asset_id = $1 AND (user_id = $2 OR accountable_user_id = $2) LIMIT 1`,
  [assetId, c.userId])).rows[0] !== undefined;
const HELD_SCOPE = (c, bind) => `EXISTS (SELECT 1 FROM tenant.asset_custody_assignments hk WHERE hk.asset_id = e.asset_id AND (hk.user_id = ${bind(c.userId)} OR hk.accountable_user_id = ${bind(c.userId)}))`;

// Another employee's identity is shown only with the custody-details permission; departments, stores and oneself are always shown.
const custodian = (c, type, id, label) => {
  if (!type && !label) return null;
  const hidden = type === "EMPLOYEE" && id !== c.userId && !has(c, MV.custody);
  return { type: type ?? null, typeLabel: type ? CUSTODIAN[type] ?? type : null, id: hidden ? null : id ?? null, label: hidden ? "Another employee" : label ?? null };
};
const viewOf = (c, e) => {
  const corrected = Boolean(e.superseded_by_event_id);
  const shownType = e.event_type === "MOVEMENT_CORRECTED" && e.details?.correctedType ? e.details.correctedType : e.event_type;
  return {
    id: e.id, assetId: e.asset_id, asset: e.asset_number ? `${e.asset_number} · ${e.asset_name}` : undefined, assetCode: e.asset_number, eventType: e.event_type,
    label: e.event_type === "MOVEMENT_CORRECTED" && e.details?.correctedType ? `${EVENT[shownType]} (corrected)` : EVENT[e.event_type] ?? e.event_type,
    certainty: corrected ? "CORRECTED" : e.certainty, certaintyLabel: CERTAINTY[corrected ? "CORRECTED" : e.certainty], isMovement: e.changes_location || e.changes_custody,
    changesLocation: e.changes_location, changesCustody: e.changes_custody,
    group: e.group_id ? { type: e.group_type, typeLabel: GROUP[e.group_type] ?? e.group_type, id: e.group_id, label: e.group_label } : null,
    from: { locationId: e.from_location_id, location: e.from_location_name, custodian: custodian(c, e.from_custodian_type, e.from_custodian_id, e.from_custodian_label) },
    to: { locationId: e.to_location_id, location: e.to_location_name, locationRole: e.to_location_role, currentLocationName: e.to_current_name ?? null,
      custodian: custodian(c, e.to_custodian_type, e.to_custodian_id, e.to_custodian_label) },
    condition: e.condition, reason: e.reason, occurredAt: iso(e.occurred_at), effectiveAt: iso(e.effective_at), recordedAt: iso(e.recorded_at), sourceCommittedAt: iso(e.source_committed_at),
    lateRecorded: new Date(e.recorded_at).getTime() - new Date(e.occurred_at).getTime() > 60 * 60 * 1000,
    actor: e.actor ?? null, approver: e.approver ?? null, source: { type: e.source_type, id: e.source_id, milestone: e.milestone },
    document: e.document_type ? { type: e.document_type, id: e.document_id, number: e.document_number, href: has(c, MV.evidence) && HREF[e.document_type] ? HREF[e.document_type](e.document_id) : null } : null,
    correctionOf: e.correction_of_event_id, supersededBy: e.superseded_by_event_id, corrected,
    details: has(c, MV.audit) ? e.details : { ...e.details, evidence: undefined, requestedBy: undefined },
  };
};
const SELECT = `SELECT e.*, a.asset_number, a.name AS asset_name, ${NAME("ua")} AS actor, ${NAME("up")} AS approver, tl.name AS to_current_name
  FROM tenant.asset_movement_events e JOIN tenant.assets a ON a.id = e.asset_id LEFT JOIN public.users ua ON ua.id = e.actor_user_id LEFT JOIN public.users up ON up.id = e.approver_user_id
  LEFT JOIN tenant.asset_locations tl ON tl.id = e.to_location_id`;

// The authoritative present: the registered location and the active custody period (never the timeline).
async function currentOf(client, c, a) {
  const k = (await client.query(`SELECT k.custodian_type, COALESCE(k.user_id, k.department_id, k.store_location_id) AS id, k.acknowledgment,
      COALESCE(${NAME("u")}, d.name, s.name) AS label FROM tenant.asset_custody_assignments k LEFT JOIN public.users u ON u.id = k.user_id
      LEFT JOIN public.departments d ON d.id = k.department_id LEFT JOIN tenant.asset_locations s ON s.id = k.store_location_id WHERE k.asset_id = $1 AND k.status = 'ACTIVE'`, [a.id])).rows[0];
  const transit = (await client.query(`SELECT o.transfer_number, l.to_location_id, tl.name AS destination FROM tenant.asset_transfer_lines l JOIN tenant.asset_transfer_orders o ON o.id = l.transfer_id
      LEFT JOIN tenant.asset_locations tl ON tl.id = l.to_location_id WHERE l.asset_id = $1 AND l.line_status IN ('PENDING', 'APPROVED', 'DISPATCHED', 'RECEIPT_EXCEPTION', 'RETURN_IN_PROGRESS') LIMIT 1`, [a.id])).rows[0];
  return { locationId: a.location_id, location: a.location, custodian: k ? custodian(c, k.custodian_type, k.id, k.label) : null, acknowledgment: k?.acknowledgment ?? null,
    lifecycle: a.lifecycle_status, pendingMovement: transit ? { number: transit.transfer_number, destination: transit.destination } : null };
}

// Groups related milestones (one transfer, assignment or handover) under one entry, ordered by their first event.
function groupsOf(events) {
  const groups = [];
  const byKey = new Map();
  for (const e of events) {
    const key = e.group ? `${e.group.type}:${e.group.id}` : `event:${e.id}`;
    let g = byKey.get(key);
    if (!g) { g = { key, group: e.group, events: [] }; byKey.set(key, g); groups.push(g); }
    g.events.push(e);
  }
  return groups.map((g) => {
    const last = g.events[g.events.length - 1];
    const live = g.events.filter((e) => !e.corrected);
    const latest = live[live.length - 1] ?? last;
    return { ...g, startedAt: g.events[0].occurredAt, lastAt: last.occurredAt, status: latest.label, certainty: latest.certainty, pending: latest.certainty === "PENDING",
      movesLocation: g.events.some((e) => e.changesLocation && !e.corrected), movesCustody: g.events.some((e) => e.changesCustody && !e.corrected) };
  });
}

// input: { eventType?, from?, to?, locationId?, certainty? } — the asset's whole history (oldest first), grouped.
export async function getAssetMovementHistory(client, c, assetId, filters = {}) {
  const a = await assetFor(client, c, assetId);
  await syncAssetMovements(client, c, a.id);
  const values = [c.organizationId, a.id];
  const bind = (v) => { values.push(v); return `$${values.length}`; };
  const where = [`e.organization_id = $1`, `e.asset_id = $2`];
  if (filters.eventType && EVENT_TYPES.includes(filters.eventType)) where.push(`(e.event_type = ${bind(filters.eventType)} OR e.details ->> 'correctedType' = $${values.length})`);
  if (day(filters.from)) where.push(`e.occurred_at >= ${bind(day(filters.from))}::date`);
  if (day(filters.to)) where.push(`e.occurred_at < ${bind(day(filters.to))}::date + 1`);
  if (filters.locationId) where.push(`(e.from_location_id = ${bind(uuid(filters.locationId, "Location"))} OR e.to_location_id = $${values.length})`);
  const rows = (await client.query(`${SELECT} WHERE ${where.join(" AND ")} ORDER BY ${ORDER_SQL}`, values)).rows.map((e) => viewOf(c, e));
  const issues = has(c, MV.reconcile) || has(c, MV.audit) ? (await client.query(`SELECT id, issue_type, expected, observed, first_detected_at FROM tenant.asset_movement_reconciliation_issues
      WHERE asset_id = $1 AND status = 'OPEN' ORDER BY first_detected_at`, [a.id])).rows.map((i) => ({ id: i.id, type: i.issue_type, expected: i.expected, observed: i.observed, since: iso(i.first_detected_at) })) : [];
  const baseline = rows.find((e) => ["OPENING_BASELINE", "INITIAL_PLACEMENT"].includes(e.eventType) && !e.corrected) ?? null;
  return {
    asset: { id: a.id, code: a.asset_number, name: a.name, serialNumber: a.serial_number, tag: a.tag_code }, current: await currentOf(client, c, a),
    baseline: baseline ? { at: baseline.effectiveAt, kind: baseline.eventType, label: baseline.label } : null,
    note: baseline ? null : "No opening baseline or registration placement is recorded for this asset; earlier history is unavailable.",
    events: rows, groups: groupsOf(rows), issues, sync: await syncState(client, c),
    can: { export: has(c, MV.export), evidence: has(c, MV.evidence), audit: has(c, MV.audit), correct: has(c, MV.correct), reconcile: has(c, MV.reconcile) },
  };
}

// The Company directory: filtered, sorted and paged in the database.
// filters: { search?, eventType?, certainty?, groupType?, locationId?, custodianId?, departmentId?, from?, to?, exceptions?, movementsOnly?, assetId?, sort?, page?, pageSize? }
function directoryWhere(c, filters, values) {
  const bind = (v) => { values.push(v); return `$${values.length}`; };
  const where = [`e.organization_id = ${bind(c.organizationId)}`];
  if (!companyWide(c)) where.push(HELD_SCOPE(c, bind));
  if (filters.assetId) where.push(`e.asset_id = ${bind(uuid(filters.assetId, "Asset"))}`);
  const q = text(filters.search, 100);
  if (q) {
    const t = bind(`%${q.replace(/[%_]/g, "\\$&")}%`);
    where.push(`(a.asset_number ILIKE ${t} OR a.name ILIKE ${t} OR a.serial_number ILIKE ${t} OR a.tag_code ILIKE ${t} OR a.legacy_asset_code ILIKE ${t} OR e.document_number ILIKE ${t} OR e.group_label ILIKE ${t})`);
  }
  const types = [].concat(filters.eventType ?? []).flatMap((t) => String(t).split(",")).filter((t) => EVENT_TYPES.includes(t));
  if (types.length) where.push(`(e.event_type = ANY(${bind(types)}::text[]) OR e.details ->> 'correctedType' = ANY($${values.length}::text[]))`);
  if (filters.certainty === "CORRECTED") where.push(`e.superseded_by_event_id IS NOT NULL`);
  else if (["CONFIRMED", "PENDING", "OBSERVED", "DISPUTED"].includes(filters.certainty)) where.push(`e.certainty = ${bind(filters.certainty)} AND e.superseded_by_event_id IS NULL`);
  if (filters.groupType && GROUP[filters.groupType]) where.push(`e.group_type = ${bind(filters.groupType)}`);
  if (filters.locationId) where.push(`(e.from_location_id = ${bind(uuid(filters.locationId, "Location"))} OR e.to_location_id = $${values.length})`);
  if (filters.custodianId) {
    if (!has(c, MV.custody) && filters.custodianId !== c.userId) throw mvError(403, "ASSET_MOVEMENT_ACCESS_DENIED");
    where.push(`(e.from_custodian_id = ${bind(uuid(filters.custodianId, "Custodian"))} OR e.to_custodian_id = $${values.length})`);
  }
  if (filters.departmentId) where.push(`((e.from_custodian_type = 'DEPARTMENT' AND e.from_custodian_id = ${bind(uuid(filters.departmentId, "Department"))}) OR (e.to_custodian_type = 'DEPARTMENT' AND e.to_custodian_id = $${values.length}))`);
  if (day(filters.from)) where.push(`e.occurred_at >= ${bind(day(filters.from))}::date`);
  if (day(filters.to)) where.push(`e.occurred_at < ${bind(day(filters.to))}::date + 1`);
  if (filters.exceptions === true || filters.exceptions === "true") where.push(`(e.event_type = ANY('{${EXCEPTION_TYPES.join(",")}}'::text[]) OR e.certainty = 'DISPUTED')`);
  if (filters.movementsOnly === true || filters.movementsOnly === "true") where.push(`(e.changes_location OR e.changes_custody)`);
  return where.join(" AND ");
}
export async function getCompanyAssetMovements(client, c, filters = {}) {
  requireMv(c, MV.view);
  await syncCompanyMovements(client, c);
  const values = [];
  const where = directoryWhere(c, filters, values);
  const pageSize = Math.min(Math.max(Number(filters.pageSize) || 50, 1), 200);
  const page = Math.max(Number(filters.page) || 1, 1);
  const order = filters.sort === "oldest" ? ORDER_SQL : ORDER_DESC;
  const total = Number((await client.query(`SELECT count(*)::int AS n FROM tenant.asset_movement_events e JOIN tenant.assets a ON a.id = e.asset_id WHERE ${where}`, values)).rows[0].n);
  const rows = (await client.query(`${SELECT} WHERE ${where} ORDER BY ${order} LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`, values)).rows.map((e) => viewOf(c, e));
  return { rows, total, page, pageSize, pages: Math.max(Math.ceil(total / pageSize), 1), sync: await syncState(client, c),
    can: { export: has(c, MV.export), reconcile: has(c, MV.reconcile), audit: has(c, MV.audit), companyWide: companyWide(c), custody: has(c, MV.custody) } };
}

async function eventFor(client, c, eventId) {
  if (!seesMovements(c)) throw mvError(403, "ASSET_MOVEMENT_ACCESS_DENIED");
  let id;
  try { id = uuid(eventId, "Movement"); } catch { throw mvError(404, "ASSET_MOVEMENT_NOT_FOUND"); }
  const e = (await client.query(`${SELECT} WHERE e.organization_id = $1 AND e.id = $2`, [c.organizationId, id])).rows[0];
  if (!e) throw mvError(404, "ASSET_MOVEMENT_NOT_FOUND");
  if (!companyWide(c) && !(await heldBy(client, c, e.asset_id))) throw mvError(403, "ASSET_MOVEMENT_ACCESS_DENIED");
  return e;
}
// One event, the other milestones of its group, and its correction trail.
export async function getAssetMovement(client, c, eventId) {
  const e = await eventFor(client, c, eventId);
  const group = e.group_id ? (await client.query(`${SELECT} WHERE e.organization_id = $1 AND e.group_id = $2 AND e.asset_id = $3 ORDER BY ${ORDER_SQL}`, [c.organizationId, e.group_id, e.asset_id])).rows.map((x) => viewOf(c, x)) : [];
  return { ...viewOf(c, e), groupEvents: group, corrections: await correctionsOf(client, c, { eventId: e.id }),
    can: { correct: has(c, MV.correct) && correctable(e), evidence: has(c, MV.evidence) } };
}
// The authoritative source record behind an event: evidence access is its own permission.
export async function getAssetMovementSource(client, c, eventId) {
  const e = await eventFor(client, c, eventId);
  requireMv(c, MV.evidence);
  if (!e.document_type) throw mvError(404, "ASSET_MOVEMENT_SOURCE_UNAVAILABLE");
  return { type: e.document_type, id: e.document_id, number: e.document_number, href: HREF[e.document_type]?.(e.document_id) ?? null, sourceType: e.source_type, sourceId: e.source_id };
}
// A timing correction is possible for confirmed physical steps; what happened (which asset, where, to whom) is corrected in the source workflow.
export const correctable = (e) => e.certainty === "CONFIRMED" && !e.superseded_by_event_id && e.source_type !== "CORRECTION"
  && ["TRANSFER_RECEIVED", "TRANSFER_DISPATCHED", "RETURN_FROM_TEMPORARY_MOVEMENT", "ASSIGNMENT_ISSUED", "ASSIGNMENT_RETURNED", "CUSTODY_CHANGED", "LOCATION_CHANGED", "TEMPORARY_MOVEMENT"].includes(e.event_type);

async function correctionsOf(client, c, { eventId = null, status = null } = {}) {
  const rows = (await client.query(`SELECT r.*, a.asset_number, a.name AS asset_name, e.event_type, ${NAME("rq")} AS requester, ${NAME("dc")} AS decider
      FROM tenant.asset_movement_corrections r JOIN tenant.assets a ON a.id = r.asset_id JOIN tenant.asset_movement_events e ON e.id = r.event_id
      LEFT JOIN public.users rq ON rq.id = r.requested_by LEFT JOIN public.users dc ON dc.id = r.decided_by
      WHERE r.organization_id = $1 AND ($2::uuid IS NULL OR r.event_id = $2) AND ($3::text IS NULL OR r.status = $3) ORDER BY r.requested_at DESC LIMIT 500`, [c.organizationId, eventId, status])).rows;
  return rows.map((r) => ({ id: r.id, number: r.correction_number, eventId: r.event_id, event: EVENT[r.event_type] ?? r.event_type, assetId: r.asset_id, asset: `${r.asset_number} · ${r.asset_name}`,
    field: r.field, originalValue: iso(r.original_value), correctedValue: iso(r.corrected_value), reason: r.reason, evidence: has(c, MV.audit) || r.requested_by === c.userId ? r.evidence : null,
    status: r.status, requestedBy: r.requester, requestedAt: iso(r.requested_at), decidedBy: r.decider, decidedAt: iso(r.decided_at), decisionNote: r.decision_note,
    canDecide: has(c, MV.reconcile) && r.status === "REQUESTED" && r.requested_by !== c.userId }));
}
export async function getAssetMovementCorrections(client, c, filters = {}) {
  if (!has(c, MV.audit) && !has(c, MV.reconcile) && !has(c, MV.correct)) throw mvError(403, "ASSET_MOVEMENT_ACCESS_DENIED");
  return correctionsOf(client, c, { eventId: filters.eventId ?? null, status: ["REQUESTED", "APPLIED", "REJECTED"].includes(filters.status) ? filters.status : null });
}

// Where the asset was and who was accountable at the end of a date. EFFECTIVE: the best reconstruction now (corrections applied).
// KNOWN: what Vercentlabs had recorded by then (later entries and corrections left out). Before the baseline nothing is invented.
export async function getAssetPositionAsOf(client, c, assetId, input = {}) {
  const a = await assetFor(client, c, assetId);
  const date = day(input.date);
  if (!date) throw mvError(400, "ASSET_MOVEMENT_INVALID", "Choose a date.");
  const mode = input.mode === "KNOWN" ? "KNOWN" : "EFFECTIVE";
  if (mode === "KNOWN" && !has(c, MV.audit)) throw mvError(403, "ASSET_MOVEMENT_ACCESS_DENIED", "Only auditors can see history as it was known at the time.");
  await syncAssetMovements(client, c, a.id);
  const t = (await client.query(`SELECT ($1::date + 1)::timestamptz AS t`, [date])).rows[0].t;
  const live = mode === "EFFECTIVE"
    ? `e.superseded_by_event_id IS NULL AND e.effective_at < $3`
    : `e.recorded_at < $3 AND e.effective_at < $3 AND NOT EXISTS (SELECT 1 FROM tenant.asset_movement_events s WHERE s.id = e.superseded_by_event_id AND s.recorded_at < $3)`;
  const pick = async (flag) => (await client.query(`${SELECT} WHERE e.organization_id = $1 AND e.asset_id = $2 AND ${live} AND ${flag}
      ORDER BY ${ORDER_DESC} LIMIT 1`, [c.organizationId, a.id, t])).rows[0];
  const baselineRow = (await client.query(`${SELECT} WHERE e.organization_id = $1 AND e.asset_id = $2 AND e.superseded_by_event_id IS NULL AND e.event_type IN ('OPENING_BASELINE', 'INITIAL_PLACEMENT')
      ORDER BY ${ORDER_SQL} LIMIT 1`, [c.organizationId, a.id])).rows[0];
  const base = { asset: { id: a.id, code: a.asset_number, name: a.name }, date, mode, baselineAt: iso(baselineRow?.effective_at) };
  if (mode === "KNOWN" && baselineRow && new Date(baselineRow.recorded_at) >= new Date(t)) {
    return { ...base, available: false, code: "ASSET_MOVEMENT_HISTORY_INCOMPLETE", message: `Nothing about this asset had been recorded by then (first recorded ${iso(baselineRow.recorded_at).slice(0, 10)}).` };
  }
  if (!baselineRow || new Date(baselineRow.effective_at) >= new Date(t)) {
    return { ...base, available: false, code: "ASSET_MOVEMENT_HISTORY_INCOMPLETE", message: baselineRow ? `History unavailable before the opening baseline (${iso(baselineRow.effective_at).slice(0, 10)}).` : "History unavailable: no baseline is recorded for this asset." };
  }
  const loc = await pick("e.changes_location");
  const cus = await pick("e.changes_custody");
  const last = await pick("(e.changes_location OR e.changes_custody)");
  const life = (await client.query(`SELECT new_status FROM tenant.asset_lifecycle_events WHERE asset_id = $1 AND occurred_at < $2 ORDER BY occurred_at DESC, id DESC LIMIT 1`, [a.id, t])).rows[0];
  const corrections = (await client.query(`SELECT count(*)::int AS n FROM tenant.asset_movement_events e WHERE e.asset_id = $1 AND e.source_type = 'CORRECTION' AND e.effective_at < $2`, [a.id, t])).rows[0].n;
  const v = (row) => (row ? viewOf(c, row) : null);
  return {
    ...base, available: true,
    location: loc ? { id: loc.to_location_id, name: loc.to_location_name, currentName: loc.to_current_name } : null,
    custodian: cus ? custodian(c, cus.to_custodian_type, cus.to_custodian_id, cus.to_custodian_label) : null,
    lifecycle: life?.new_status ?? null, lastMovement: v(last), evidence: [v(loc), v(cus)].filter(Boolean).map((e) => e.document).filter(Boolean),
    corrected: corrections > 0,
  };
}
export const getAssetLocationAsOf = async (client, c, assetId, input) => { const p = await getAssetPositionAsOf(client, c, assetId, input); return p.available ? { ...p, custodian: undefined } : p; };
export const getAssetCustodyAsOf = async (client, c, assetId, input) => { const p = await getAssetPositionAsOf(client, c, assetId, input); return p.available ? { ...p, location: undefined } : p; };

// What needs attention: unresolved disputes, exceptions, missing assets and discrepancies; pending corrections; reconciliation issues.
export async function getMovementExceptions(client, c) {
  requireMv(c, MV.view);
  await syncCompanyMovements(client, c);
  const values = [];
  const where = directoryWhere(c, { exceptions: true }, values);
  // An exception is open until a later confirmed milestone of the same source group exists.
  const rows = (await client.query(`${SELECT} WHERE ${where} AND e.superseded_by_event_id IS NULL AND NOT EXISTS (SELECT 1 FROM tenant.asset_movement_events z
      WHERE z.asset_id = e.asset_id AND z.group_id = e.group_id AND z.certainty = 'CONFIRMED' AND z.recorded_at > e.recorded_at
        AND (z.event_type = e.event_type OR z.event_type IN ('TRANSFER_RECEIVED', 'TRANSFER_COMPLETED', 'HANDOVER_ACKNOWLEDGED', 'HANDOVER_CONFIRMED_BY_EXCEPTION')))
      ORDER BY ${ORDER_DESC} LIMIT 300`, values)).rows.map((e) => viewOf(c, e));
  const issues = has(c, MV.reconcile) || has(c, MV.audit) ? await issuesOf(client, c, "OPEN") : [];
  const corrections = has(c, MV.reconcile) || has(c, MV.audit) ? await correctionsOf(client, c, { status: "REQUESTED" }) : [];
  return { rows, issues, corrections };
}
export async function issuesOf(client, c, status = null) {
  return (await client.query(`SELECT i.*, a.asset_number, a.name AS asset_name, ${NAME("u")} AS resolver FROM tenant.asset_movement_reconciliation_issues i JOIN tenant.assets a ON a.id = i.asset_id
      LEFT JOIN public.users u ON u.id = i.resolved_by WHERE i.organization_id = $1 AND ($2::text IS NULL OR i.status = $2) ORDER BY i.status, i.first_detected_at DESC LIMIT 500`, [c.organizationId, status])).rows
    .map((i) => ({ id: i.id, assetId: i.asset_id, asset: `${i.asset_number} · ${i.asset_name}`, type: i.issue_type, expected: i.expected, observed: i.observed, related: i.related,
      status: i.status, firstDetectedAt: iso(i.first_detected_at), lastDetectedAt: iso(i.last_detected_at), resolution: i.resolution, resolvedBy: i.resolver, resolvedAt: iso(i.resolved_at),
      href: `/assets/register/${i.asset_id}?tab=custody` }));
}

export const MOVEMENT_REPORTS = Object.freeze(["complete-history", "by-location", "by-custodian", "interbranch", "internal-room", "temporary-repair", "pending", "partial-exceptions",
  "corrections", "last-confirmed", "unverified-observations", "no-movement", "historical-position", "reconciliation"]);
// Counts keep three things apart: movement transactions (one transfer or handover), assets moved (distinct units) and events (milestones).
export async function getMovementReport(client, c, kind, input = {}) {
  if (!MOVEMENT_REPORTS.includes(kind)) throw mvError(404, "ASSET_MOVEMENT_NOT_FOUND", "There is no such report.");
  requireMv(c, MV.view);
  if (!companyWide(c)) throw mvError(403, "ASSET_MOVEMENT_ACCESS_DENIED");
  await syncCompanyMovements(client, c);
  const org = c.organizationId;
  const q = async (sql, params = []) => (await client.query(sql, [org, ...params])).rows;
  const list = async (extra, limit = 500) => (await client.query(`${SELECT} WHERE e.organization_id = $1 AND e.superseded_by_event_id IS NULL AND ${extra} ORDER BY ${ORDER_DESC} LIMIT ${limit}`, [org])).rows.map((e) => viewOf(c, e));
  const summary = async (extra = "true") => {
    const s = (await client.query(`SELECT count(DISTINCT COALESCE(e.group_id, e.id))::int AS transactions, count(DISTINCT e.asset_id)::int AS assets, count(*)::int AS events
        FROM tenant.asset_movement_events e WHERE e.organization_id = $1 AND e.superseded_by_event_id IS NULL AND ${extra}`, [org])).rows[0];
    return { transactions: s.transactions, assetsMoved: s.assets, events: s.events };
  };
  const moveRoot = `tenant.asset_location_root(e.from_location_id) IS DISTINCT FROM tenant.asset_location_root(e.to_location_id)`;
  switch (kind) {
    case "complete-history": return { rows: await list("true"), summary: await summary() };
    case "by-location": return { rows: (await q(`SELECT l.id, l.name, count(*) FILTER (WHERE e.to_location_id = l.id AND e.changes_location)::int AS arrived,
        count(*) FILTER (WHERE e.from_location_id = l.id AND e.changes_location)::int AS departed, count(DISTINCT e.asset_id)::int AS assets, count(*)::int AS events
        FROM tenant.asset_locations l JOIN tenant.asset_movement_events e ON (e.to_location_id = l.id OR e.from_location_id = l.id) AND e.superseded_by_event_id IS NULL
        WHERE l.organization_id = $1 GROUP BY l.id, l.name ORDER BY l.name`)).map((r) => ({ locationId: r.id, location: r.name, arrived: r.arrived, departed: r.departed, assets: r.assets, events: r.events })) };
    case "by-custodian": {
      const rows = await q(`SELECT x.type, x.id, max(x.label) AS label, count(*) FILTER (WHERE x.dir = 'IN')::int AS received, count(*) FILTER (WHERE x.dir = 'OUT')::int AS handed_on, count(DISTINCT x.asset_id)::int AS assets
          FROM (SELECT e.to_custodian_type AS type, e.to_custodian_id AS id, e.to_custodian_label AS label, 'IN' AS dir, e.asset_id FROM tenant.asset_movement_events e
                 WHERE e.organization_id = $1 AND e.changes_custody AND e.superseded_by_event_id IS NULL
                UNION ALL SELECT e.from_custodian_type, e.from_custodian_id, e.from_custodian_label, 'OUT', e.asset_id FROM tenant.asset_movement_events e
                 WHERE e.organization_id = $1 AND e.changes_custody AND e.superseded_by_event_id IS NULL AND e.from_custodian_id IS NOT NULL) x
          GROUP BY x.type, x.id ORDER BY 3`);
      return { rows: rows.map((r) => ({ custodian: custodian(c, r.type, r.id, r.label), received: r.received, handedOn: r.handed_on, assets: r.assets })) };
    }
    case "interbranch": return { rows: await list(`e.event_type IN ('TRANSFER_RECEIVED', 'RETURN_FROM_TEMPORARY_MOVEMENT') AND e.changes_location AND ${moveRoot}`), summary: await summary(`e.event_type IN ('TRANSFER_RECEIVED', 'RETURN_FROM_TEMPORARY_MOVEMENT') AND e.changes_location AND ${moveRoot}`) };
    case "internal-room": return { rows: await list(`e.changes_location AND e.from_location_id IS NOT NULL AND e.event_type <> 'INITIAL_PLACEMENT' AND NOT (${moveRoot})`) };
    case "temporary-repair": return { rows: await list(`e.event_type IN ('TEMPORARY_MOVEMENT', 'RETURN_FROM_TEMPORARY_MOVEMENT')`) };
    case "pending": return { rows: await list(`e.certainty = 'PENDING' AND NOT EXISTS (SELECT 1 FROM tenant.asset_movement_events z WHERE z.asset_id = e.asset_id AND z.group_id = e.group_id
        AND (z.recorded_at > e.recorded_at OR (z.recorded_at = e.recorded_at AND ${RANK_SQL.replace(/e\.event_type/g, "z.event_type")} > ${RANK_SQL})))`) };
    case "partial-exceptions": return { rows: await list(`(e.event_type = 'MOVEMENT_EXCEPTION' OR (e.event_type = 'TRANSFER_DISPATCHED' AND EXISTS (SELECT 1 FROM tenant.asset_transfer_orders o
        WHERE o.id = e.group_id AND o.status IN ('PARTIALLY_RECEIVED', 'RECEIPT_EXCEPTION'))))`) };
    case "corrections": return { rows: await correctionsOf(client, c) };
    case "last-confirmed": return { rows: (await client.query(`SELECT DISTINCT ON (e.asset_id) e.*, a.asset_number, a.name AS asset_name, NULL AS actor, NULL AS approver, NULL AS to_current_name
        FROM tenant.asset_movement_events e JOIN tenant.assets a ON a.id = e.asset_id WHERE e.organization_id = $1 AND e.certainty = 'CONFIRMED' AND e.superseded_by_event_id IS NULL
        AND (e.changes_location OR e.changes_custody) ORDER BY e.asset_id, ${ORDER_DESC}`, [org])).rows.map((e) => viewOf(c, e)) };
    case "unverified-observations": return { rows: await list(`e.event_type IN ('LOCATION_OBSERVED', 'LOCATION_DISCREPANCY') AND e.certainty = 'OBSERVED'
        AND e.to_location_id IS DISTINCT FROM (SELECT a2.location_id FROM tenant.assets a2 WHERE a2.id = e.asset_id)`) };
    case "no-movement": return { rows: (await q(`SELECT a.id, a.asset_number, a.name, l.name AS location, min(e.effective_at) AS since FROM tenant.assets a
        JOIN tenant.asset_movement_events e ON e.asset_id = a.id AND e.superseded_by_event_id IS NULL LEFT JOIN tenant.asset_locations l ON l.id = a.location_id
        WHERE a.organization_id = $1 GROUP BY a.id, a.asset_number, a.name, l.name
        HAVING bool_and(e.event_type IN ('OPENING_BASELINE', 'INITIAL_PLACEMENT', 'INITIAL_CUSTODY') OR NOT (e.changes_location OR e.changes_custody)) ORDER BY a.asset_number`))
      .map((r) => ({ assetId: r.id, asset: `${r.asset_number} · ${r.name}`, location: r.location, since: iso(r.since), href: `/assets/register/${r.id}` })) };
    case "historical-position": {
      const date = day(input.asOf) ?? new Date().toISOString().slice(0, 10);
      const rows = await q(`WITH t AS (SELECT ($2::date + 1)::timestamptz AS t),
          live AS (SELECT e.* FROM tenant.asset_movement_events e, t WHERE e.organization_id = $1 AND e.superseded_by_event_id IS NULL AND e.effective_at < t.t),
          loc AS (SELECT DISTINCT ON (e.asset_id) e.asset_id, e.to_location_name, e.document_number FROM live e WHERE e.changes_location ORDER BY e.asset_id, ${ORDER_DESC}),
          cus AS (SELECT DISTINCT ON (e.asset_id) e.asset_id, e.to_custodian_type, e.to_custodian_id, e.to_custodian_label FROM live e WHERE e.changes_custody ORDER BY e.asset_id, ${ORDER_DESC})
        SELECT a.id, a.asset_number, a.name, loc.to_location_name AS location, loc.document_number, cus.to_custodian_type, cus.to_custodian_id, cus.to_custodian_label
        FROM tenant.assets a JOIN loc ON loc.asset_id = a.id LEFT JOIN cus ON cus.asset_id = a.id WHERE a.organization_id = $1 ORDER BY a.asset_number`, [date]);
      return { date, rows: rows.map((r) => ({ assetId: r.id, asset: `${r.asset_number} · ${r.name}`, location: r.location, custodian: custodian(c, r.to_custodian_type, r.to_custodian_id, r.to_custodian_label), evidence: r.document_number })) };
    }
    case "reconciliation": return { rows: await issuesOf(client, c) };
    default: return { rows: [] };
  }
}

const csvCell = (v) => { const s = v === null || v === undefined ? "" : String(v); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
// The same scope and masking as the screens; at most 10,000 events per file.
export async function exportAssetMovementHistory(client, c, filters = {}) {
  requireMv(c, MV.export);
  if (filters.assetId) await assetFor(client, c, filters.assetId);
  await syncCompanyMovements(client, c);
  const values = [];
  const where = directoryWhere(c, filters, values);
  const rows = (await client.query(`${SELECT} WHERE ${where} ORDER BY ${ORDER_SQL} LIMIT 10000`, values)).rows.map((e) => viewOf(c, e));
  const head = ["Occurred", "Recorded", "Asset", "Movement", "Certainty", "From location", "To location", "To location role", "From custodian", "To custodian", "Source reference", "Recorded by", "Approved by", "Condition", "Reason"];
  const lines = rows.map((e) => [e.occurredAt, e.recordedAt, e.asset, e.label, e.certaintyLabel, e.from.location, e.to.location, e.to.locationRole, e.from.custodian?.label, e.to.custodian?.label,
    e.document?.number ?? e.group?.label, e.actor, e.approver, e.condition, e.reason].map(csvCell).join(","));
  return { filename: `asset-movements-${new Date().toISOString().slice(0, 10)}.csv`, csv: [head.join(","), ...lines].join("\r\n"), count: rows.length };
}
