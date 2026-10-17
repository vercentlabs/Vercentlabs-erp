// Assets — Asset Movement History, ingestion: each source workflow's committed records are normalised into movement events with a stable
// identity (source type, source id, milestone), so ingesting the same record again is a no-op and the projection can be rebuilt at any
// time. Location and custodian names are taken as they were at the moment of the event, so a renamed room stays intelligible.
import { has } from "../common.js";
import { MV, mvError, RANK_SQL } from "./mv-rules.js";

const COLS = `organization_id, asset_id, source_type, source_id, milestone, group_type, group_id, group_label, event_type, certainty, changes_location, changes_custody,
  from_location_id, from_location_name, to_location_id, to_location_name, to_location_role, from_custodian_type, from_custodian_id, from_custodian_label,
  to_custodian_type, to_custodian_id, to_custodian_label, condition, reason, occurred_at, effective_at, recorded_at, source_committed_at, actor_user_id, approver_user_id,
  document_type, document_id, document_number, correction_of_event_id, details`;
const ON_CONFLICT = `ON CONFLICT (organization_id, source_type, source_id, milestone) DO NOTHING`;
const LOC = (id, at) => `tenant.asset_location_name_at(${id}, ${at})`;
const WHO = (type, u, d, s, at) => `CASE ${type} WHEN 'EMPLOYEE' THEN (SELECT COALESCE(NULLIF(x.full_name, ''), x.email) FROM public.users x WHERE x.id = ${u})
  WHEN 'DEPARTMENT' THEN (SELECT x.name FROM public.departments x WHERE x.id = ${d}) WHEN 'ASSET_STORE' THEN ${LOC(s, at)} END`;
const scope = (alias, time) => `${alias}.organization_id = $1 AND ($2::uuid IS NULL OR ${alias}.asset_id = $2) AND ${time} >= $3::timestamptz`;
// What a custody handover belongs to: the transfer that delivered it, else the assignment it issued (or, for a return, the one it closed).
const HANDOVER_LINKS = (h, prevHandover) => `
  LEFT JOIN LATERAL (SELECT o.id, o.transfer_number FROM tenant.asset_transfer_orders o WHERE o.id = ${h}.related_transfer_id
     OR o.id = (SELECT l.transfer_id FROM tenant.asset_transfer_lines l WHERE l.custody_handover_id = ${h}.id LIMIT 1) LIMIT 1) tr ON ${h}.id IS NOT NULL
  LEFT JOIN LATERAL (SELECT r.id, r.request_number FROM tenant.asset_assignment_requests r WHERE r.custody_handover_id = ${h}.id
     OR (${h}.kind = 'RETURN' AND ${prevHandover} IS NOT NULL AND r.custody_handover_id = ${prevHandover}) ORDER BY (r.custody_handover_id = ${h}.id) DESC LIMIT 1) rq ON ${h}.id IS NOT NULL`;
const HANDOVER_GROUP = (h, base = "NULL") => ({
  type: `CASE WHEN tr.id IS NOT NULL THEN 'TRANSFER' WHEN rq.id IS NOT NULL THEN 'ASSIGNMENT' WHEN ${h}.id IS NOT NULL THEN 'HANDOVER' ELSE ${base} END`,
  id: `COALESCE(tr.id, rq.id, ${h}.id)`,
  label: `COALESCE(tr.transfer_number, rq.request_number, 'HND-' || ${h}.handover_number)`,
  docType: `CASE WHEN tr.id IS NOT NULL THEN 'asset_transfer' WHEN rq.id IS NOT NULL THEN 'asset_assignment' WHEN ${h}.id IS NOT NULL THEN 'asset_custody_handover' END`,
});

// A location event dated on its own record day happened at the record time; a dated one (opening cutover, late entry) on its date.
const LE_TIME = `CASE WHEN le.effective_at IS NULL OR le.effective_at = le.recorded_at::date THEN le.recorded_at ELSE le.effective_at::timestamptz END`;
const KH = HANDOVER_GROUP("h");
const AH = HANDOVER_GROUP("h");

export const NORMALIZERS = Object.freeze([
  // Registered location changes, except a transfer receipt (the transfer's own Received milestone carries it, once).
  ["LOCATION_EVENT", `INSERT INTO tenant.asset_movement_events (${COLS})
    SELECT le.organization_id, le.asset_id, 'LOCATION_EVENT', le.id, 'MAIN',
      CASE le.event_type WHEN 'INITIAL' THEN 'REGISTRATION' WHEN 'IMPORT' THEN 'OPENING' WHEN 'ADMIN_CORRECTION' THEN 'CORRECTION' END,
      CASE WHEN le.event_type IN ('INITIAL', 'IMPORT') THEN le.asset_id WHEN le.event_type = 'ADMIN_CORRECTION' THEN le.id END,
      CASE le.event_type WHEN 'IMPORT' THEN 'Opening migration' WHEN 'INITIAL' THEN 'Registration' END,
      CASE le.event_type WHEN 'INITIAL' THEN 'INITIAL_PLACEMENT' WHEN 'IMPORT' THEN 'OPENING_BASELINE' WHEN 'ADMIN_CORRECTION' THEN 'MOVEMENT_CORRECTED' ELSE 'LOCATION_CHANGED' END,
      'CONFIRMED', true, false, le.previous_location_id, ${LOC("le.previous_location_id", "le.recorded_at")}, le.new_location_id, ${LOC("le.new_location_id", "le.recorded_at")}, 'CONFIRMED',
      NULL, NULL, NULL, NULL, NULL, NULL, NULL, le.reason, ${LE_TIME}, ${LE_TIME}, le.recorded_at, le.recorded_at, le.changed_by, NULL,
      le.source_type, le.source_id, NULL, NULL, jsonb_build_object('locationEventType', le.event_type)
    FROM tenant.asset_location_events le WHERE ${scope("le", "le.recorded_at")} AND COALESCE(le.source_type, '') <> 'asset_transfer_line' ${ON_CONFLICT}`],

  // Custody periods: each start is one accountable-holder change, with the holder before it; the location is where the asset was then.
  ["CUSTODY_PERIOD", `INSERT INTO tenant.asset_movement_events (${COLS})
    SELECT k.organization_id, k.asset_id, 'CUSTODY_PERIOD', k.id, 'START',
      CASE k.source WHEN 'OPENING' THEN 'OPENING' WHEN 'REGISTRATION' THEN 'REGISTRATION' ELSE ${KH.type} END,
      CASE WHEN k.source IN ('OPENING', 'REGISTRATION') THEN k.asset_id ELSE ${KH.id} END,
      CASE k.source WHEN 'OPENING' THEN 'Opening migration' WHEN 'REGISTRATION' THEN 'Registration' ELSE ${KH.label} END,
      CASE WHEN k.source = 'OPENING' THEN 'OPENING_BASELINE' WHEN k.source = 'REGISTRATION' THEN 'INITIAL_CUSTODY' WHEN h.kind = 'RETURN' THEN 'ASSIGNMENT_RETURNED'
           WHEN rq.id IS NOT NULL AND tr.id IS NULL THEN 'ASSIGNMENT_ISSUED' ELSE 'CUSTODY_CHANGED' END,
      'CONFIRMED', false, true, at.loc, ${LOC("at.loc", "k.created_at")}, at.loc, ${LOC("at.loc", "k.created_at")}, CASE WHEN at.loc IS NULL THEN NULL ELSE 'CONFIRMED' END,
      p.custodian_type, COALESCE(p.user_id, p.department_id, p.store_location_id), ${WHO("p.custodian_type", "p.user_id", "p.department_id", "p.store_location_id", "k.effective_from")},
      k.custodian_type, COALESCE(k.user_id, k.department_id, k.store_location_id), ${WHO("k.custodian_type", "k.user_id", "k.department_id", "k.store_location_id", "k.effective_from")},
      COALESCE(h.condition_at_handover, k.condition_at_issue), h.notes, COALESCE(ob.cutover::timestamptz, k.effective_from), COALESCE(ob.cutover::timestamptz, k.effective_from), k.created_at, k.created_at,
      COALESCE(h.issued_by, k.created_by), NULL,
      CASE WHEN k.source = 'OPENING' THEN 'asset_opening' ELSE ${KH.docType} END, CASE WHEN k.source = 'OPENING' THEN NULL ELSE ${KH.id} END,
      CASE WHEN k.source = 'OPENING' THEN NULL ELSE ${KH.label} END, NULL,
      jsonb_build_object('source', k.source, 'handoverId', h.id, 'handoverNumber', h.handover_number, 'kind', h.kind, 'accessories', h.accessories, 'accountableUserId', k.accountable_user_id,
        'expectedReturnAt', k.expected_return_at)
    FROM tenant.asset_custody_assignments k
    LEFT JOIN tenant.asset_custody_handovers h ON h.id = k.source_handover_id
    -- An opening custodian is the baseline as of the cutover, like the opening location.
    LEFT JOIN LATERAL (SELECT b.cutover_date AS cutover FROM tenant.asset_opening_rows r JOIN tenant.asset_opening_batches b ON b.id = r.batch_id
       WHERE r.asset_id = k.asset_id ORDER BY b.created_at LIMIT 1) ob ON k.source = 'OPENING'
    LEFT JOIN LATERAL (SELECT * FROM tenant.asset_custody_assignments x WHERE x.asset_id = k.asset_id AND x.id <> k.id AND x.effective_from <= k.effective_from
       AND (x.effective_from < k.effective_from OR x.created_at < k.created_at) ORDER BY x.effective_from DESC, x.created_at DESC LIMIT 1) p ON true
    ${HANDOVER_LINKS("h", "p.source_handover_id")}
    CROSS JOIN LATERAL (SELECT (SELECT le.new_location_id FROM tenant.asset_location_events le WHERE le.asset_id = k.asset_id AND le.recorded_at <= k.created_at
       ORDER BY le.recorded_at DESC, le.id DESC LIMIT 1) AS loc) at
    WHERE ${scope("k", "k.created_at")} ${ON_CONFLICT}`],

  // The recipient's acknowledgment, dispute or the manager's exception: a milestone of the handover, never a second custody change.
  ["ACKNOWLEDGMENT", `INSERT INTO tenant.asset_movement_events (${COLS})
    SELECT a.organization_id, h.asset_id, 'ACKNOWLEDGMENT', a.id, 'MAIN', ${AH.type}, ${AH.id}, ${AH.label},
      CASE a.decision WHEN 'ACKNOWLEDGED' THEN 'HANDOVER_ACKNOWLEDGED' WHEN 'DISPUTED' THEN 'HANDOVER_DISPUTED' ELSE 'HANDOVER_CONFIRMED_BY_EXCEPTION' END,
      CASE a.decision WHEN 'DISPUTED' THEN 'DISPUTED' ELSE 'CONFIRMED' END, false, false, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
      h.to_type, COALESCE(h.to_user_id, h.to_department_id, h.to_store_location_id), ${WHO("h.to_type", "h.to_user_id", "h.to_department_id", "h.to_store_location_id", "a.recorded_at")},
      NULL, COALESCE(a.dispute_reason, a.comment), a.recorded_at, a.recorded_at, a.recorded_at, a.recorded_at, a.user_id, NULL, ${AH.docType}, ${AH.id}, ${AH.label}, NULL,
      jsonb_build_object('handoverId', h.id, 'physicalHandoverAt', h.physical_handover_at, 'onBehalf', a.on_behalf, 'conditionConfirmed', a.condition_confirmed)
    FROM tenant.asset_custody_acknowledgments a JOIN tenant.asset_custody_handovers h ON h.id = a.handover_id
    ${HANDOVER_LINKS("h", "NULL::uuid")}
    WHERE a.organization_id = $1 AND ($2::uuid IS NULL OR h.asset_id = $2) AND a.recorded_at >= $3::timestamptz ${ON_CONFLICT}`],

  // Transfer decisions recorded on the order apply to each asset on it: requested and approved are pending; rejected or cancelled closes it.
  ["TRANSFER_ORDER_EVENT", `INSERT INTO tenant.asset_movement_events (${COLS})
    SELECT e.organization_id, l.asset_id, 'TRANSFER_EVENT', e.id, l.id::text, 'TRANSFER', o.id, o.transfer_number,
      CASE WHEN e.action IN ('SUBMITTED', 'CREATED') THEN 'TRANSFER_REQUESTED' WHEN e.action = 'APPROVED' THEN 'TRANSFER_APPROVED' ELSE 'TRANSFER_CANCELLED' END,
      CASE WHEN e.action IN ('SUBMITTED', 'CREATED', 'APPROVED') THEN 'PENDING' ELSE 'CONFIRMED' END, false, false,
      l.from_location_id, ${LOC("l.from_location_id", "e.occurred_at")}, l.to_location_id, ${LOC("l.to_location_id", "e.occurred_at")}, CASE WHEN l.to_location_id IS NULL THEN NULL ELSE 'PROPOSED' END,
      fk.custodian_type, COALESCE(fk.user_id, fk.department_id, fk.store_location_id), l.from_custodian_label,
      l.to_custodian_type, COALESCE(l.to_user_id, l.to_department_id, l.to_store_location_id), ${WHO("l.to_custodian_type", "l.to_user_id", "l.to_department_id", "l.to_store_location_id", "e.occurred_at")},
      NULL, COALESCE(e.reason, o.reason_detail), e.occurred_at, e.occurred_at, e.occurred_at, e.occurred_at, e.actor_user_id, CASE WHEN e.action = 'APPROVED' THEN e.actor_user_id END,
      'asset_transfer', o.id, o.transfer_number, NULL,
      jsonb_build_object('action', e.action, 'transferType', o.transfer_type, 'reasonCode', o.reason_code, 'approval', e.to_status, 'lineNumber', l.line_number)
    FROM tenant.asset_transfer_events e JOIN tenant.asset_transfer_orders o ON o.id = e.transfer_id
    JOIN tenant.asset_transfer_lines l ON l.transfer_id = o.id AND l.created_at <= e.occurred_at
    LEFT JOIN tenant.asset_custody_assignments fk ON fk.id = l.from_custody_assignment_id
    WHERE e.organization_id = $1 AND ($2::uuid IS NULL OR l.asset_id = $2) AND e.occurred_at >= $3::timestamptz AND e.line_id IS NULL
      AND (e.action IN ('SUBMITTED', 'APPROVED', 'REJECTED', 'CANCELLED') OR (e.action = 'CREATED' AND e.to_status <> 'DRAFT')) ${ON_CONFLICT}`],

  // Each asset's own physical steps: dispatch (in transit, destination proposed), receipt (the one confirmed location change), exceptions.
  ["TRANSFER_LINE_EVENT", `INSERT INTO tenant.asset_movement_events (${COLS})
    SELECT e.organization_id, l.asset_id, 'TRANSFER_EVENT', e.id, 'MAIN', 'TRANSFER', o.id, o.transfer_number,
      CASE WHEN e.action = 'DISPATCHED' AND o.transfer_type = 'TEMPORARY' THEN 'TEMPORARY_MOVEMENT' WHEN e.action = 'DISPATCHED' THEN 'TRANSFER_DISPATCHED'
           WHEN e.action = 'RECEIVED' AND o.return_of_id IS NOT NULL THEN 'RETURN_FROM_TEMPORARY_MOVEMENT' WHEN e.action = 'RECEIVED' THEN 'TRANSFER_RECEIVED' ELSE 'MOVEMENT_EXCEPTION' END,
      CASE WHEN e.action = 'DISPATCHED' THEN 'PENDING' WHEN e.action IN ('RECEIPT_MISMATCH', 'EXCEPTION_REPORTED') THEN 'DISPUTED' ELSE 'CONFIRMED' END,
      e.action = 'RECEIVED' AND l.to_location_id IS NOT NULL AND l.to_location_id IS DISTINCT FROM l.from_location_id, false,
      l.from_location_id, ${LOC("l.from_location_id", "e.occurred_at")}, l.to_location_id, ${LOC("l.to_location_id", "e.occurred_at")},
      CASE WHEN l.to_location_id IS NULL THEN NULL WHEN e.action = 'RECEIVED' THEN 'CONFIRMED' ELSE 'PROPOSED' END,
      fk.custodian_type, COALESCE(fk.user_id, fk.department_id, fk.store_location_id), l.from_custodian_label,
      l.to_custodian_type, COALESCE(l.to_user_id, l.to_department_id, l.to_store_location_id), ${WHO("l.to_custodian_type", "l.to_user_id", "l.to_department_id", "l.to_store_location_id", "e.occurred_at")},
      e.details ->> 'condition', e.reason,
      CASE e.action WHEN 'DISPATCHED' THEN COALESCE(l.dispatched_at, e.occurred_at) WHEN 'RECEIVED' THEN COALESCE(l.received_at, e.occurred_at) ELSE e.occurred_at END,
      CASE e.action WHEN 'DISPATCHED' THEN COALESCE(l.dispatched_at, e.occurred_at) WHEN 'RECEIVED' THEN COALESCE(l.received_at, e.occurred_at) ELSE e.occurred_at END,
      e.occurred_at, e.occurred_at, e.actor_user_id, o.approved_by, 'asset_transfer', o.id, o.transfer_number, NULL,
      e.details || jsonb_build_object('action', e.action, 'transferType', o.transfer_type, 'transitHolder', l.transit_holder, 'lineNumber', l.line_number, 'carrier', o.carrier)
    FROM tenant.asset_transfer_events e JOIN tenant.asset_transfer_orders o ON o.id = e.transfer_id JOIN tenant.asset_transfer_lines l ON l.id = e.line_id
    LEFT JOIN tenant.asset_custody_assignments fk ON fk.id = l.from_custody_assignment_id
    WHERE e.organization_id = $1 AND ($2::uuid IS NULL OR l.asset_id = $2) AND e.occurred_at >= $3::timestamptz
      AND e.action IN ('DISPATCHED', 'RECEIVED', 'RECEIPT_MISMATCH', 'EXCEPTION_REPORTED', 'EXCEPTION_RESOLVED') ${ON_CONFLICT}`],

  ["TRANSFER_LINE", `INSERT INTO tenant.asset_movement_events (${COLS})
    SELECT l.organization_id, l.asset_id, 'TRANSFER_LINE', l.id, 'COMPLETED', 'TRANSFER', o.id, o.transfer_number, 'TRANSFER_COMPLETED', 'CONFIRMED', false, false,
      l.from_location_id, ${LOC("l.from_location_id", "l.completed_at")}, l.to_location_id, ${LOC("l.to_location_id", "l.completed_at")}, CASE WHEN l.to_location_id IS NULL THEN NULL ELSE 'CONFIRMED' END,
      fk.custodian_type, COALESCE(fk.user_id, fk.department_id, fk.store_location_id), l.from_custodian_label,
      l.to_custodian_type, COALESCE(l.to_user_id, l.to_department_id, l.to_store_location_id), ${WHO("l.to_custodian_type", "l.to_user_id", "l.to_department_id", "l.to_store_location_id", "l.completed_at")},
      l.receipt_condition, l.close_reason, l.completed_at, l.completed_at, l.completed_at, l.completed_at, COALESCE(l.received_by, l.dispatched_by), o.approved_by,
      'asset_transfer', o.id, o.transfer_number, NULL, jsonb_build_object('custodyOutcome', l.custody_outcome, 'lineNumber', l.line_number, 'transferType', o.transfer_type)
    FROM tenant.asset_transfer_lines l JOIN tenant.asset_transfer_orders o ON o.id = l.transfer_id
    LEFT JOIN tenant.asset_custody_assignments fk ON fk.id = l.from_custody_assignment_id
    WHERE ${scope("l", "l.completed_at")} AND l.line_status = 'COMPLETED' ${ON_CONFLICT}`],

  // Physical observations are evidence, never a registered location.
  ["OBSERVATION", `INSERT INTO tenant.asset_movement_events (${COLS})
    SELECT ob.organization_id, ob.asset_id, 'OBSERVATION', ob.id, 'MAIN', 'OBSERVATION', ob.id, NULL,
      CASE ob.kind WHEN 'VERIFICATION' THEN 'LOCATION_OBSERVED' ELSE 'TEMPORARY_MOVEMENT' END, 'OBSERVED', false, false,
      ob.registered_location_id, ${LOC("ob.registered_location_id", "ob.observed_at")}, ob.observed_location_id, COALESCE(${LOC("ob.observed_location_id", "ob.observed_at")}, ob.observed_location_text), 'OBSERVED',
      NULL, NULL, NULL, NULL, NULL, NULL, NULL, ob.reason, ob.observed_at, ob.observed_at, ob.observed_at, ob.observed_at, ob.observed_by, NULL,
      CASE WHEN ob.verification_id IS NOT NULL THEN 'asset_verification' END, ob.verification_id, NULL, NULL,
      jsonb_build_object('kind', ob.kind, 'discrepancy', ob.discrepancy, 'expiresAt', ob.expires_at)
    FROM tenant.asset_location_observations ob WHERE ${scope("ob", "ob.observed_at")} ${ON_CONFLICT}`],
  ["OBSERVATION_END", `INSERT INTO tenant.asset_movement_events (${COLS})
    SELECT ob.organization_id, ob.asset_id, 'OBSERVATION', ob.id, 'ENDED', 'OBSERVATION', ob.id, NULL, 'RETURN_FROM_TEMPORARY_MOVEMENT', 'OBSERVED', false, false,
      ob.observed_location_id, COALESCE(${LOC("ob.observed_location_id", "ob.ended_at")}, ob.observed_location_text), ob.registered_location_id, ${LOC("ob.registered_location_id", "ob.ended_at")}, 'CONFIRMED',
      NULL, NULL, NULL, NULL, NULL, NULL, NULL, ob.reason, ob.ended_at, ob.ended_at, ob.ended_at, ob.ended_at, ob.observed_by, NULL, NULL, NULL, NULL, NULL, jsonb_build_object('kind', ob.kind)
    FROM tenant.asset_location_observations ob WHERE ${scope("ob", "ob.ended_at")} AND ob.ended_at IS NOT NULL AND ob.kind <> 'VERIFICATION' ${ON_CONFLICT}`],
  ["DISCREPANCY", `INSERT INTO tenant.asset_movement_events (${COLS})
    SELECT d.organization_id, d.asset_id, 'DISCREPANCY', d.id, m.milestone, 'OBSERVATION', d.id, 'DSC-' || d.discrepancy_number, 'LOCATION_DISCREPANCY',
      CASE m.milestone WHEN 'REPORTED' THEN 'OBSERVED' ELSE 'CONFIRMED' END, false, false,
      d.expected_location_id, ${LOC("d.expected_location_id", "m.at")}, d.observed_location_id, COALESCE(${LOC("d.observed_location_id", "m.at")}, d.observed_location_text), 'OBSERVED',
      NULL, NULL, NULL, NULL, NULL, NULL, NULL, CASE m.milestone WHEN 'REPORTED' THEN NULL ELSE d.resolution_note END, m.at, m.at, m.at, m.at, m.actor, NULL,
      'asset_location_discrepancy', d.id, 'DSC-' || d.discrepancy_number, NULL,
      jsonb_build_object('status', CASE m.milestone WHEN 'REPORTED' THEN 'OPEN' ELSE d.status END, 'source', d.source, 'transferId', d.transfer_id)
    FROM tenant.asset_location_discrepancies d
    CROSS JOIN LATERAL (VALUES ('REPORTED', d.reported_at, d.reported_by), ('RESOLVED', d.resolved_at, d.resolved_by)) AS m(milestone, at, actor)
    WHERE d.organization_id = $1 AND ($2::uuid IS NULL OR d.asset_id = $2) AND m.at IS NOT NULL AND m.at >= $3::timestamptz
      AND (m.milestone = 'REPORTED' OR d.status <> 'OPEN') ${ON_CONFLICT}`],

  // A missing report is an incident marker: it never invents a new location.
  ["MISSING_INCIDENT", `INSERT INTO tenant.asset_movement_events (${COLS})
    SELECT i.organization_id, i.asset_id, 'MISSING_INCIDENT', i.id, m.milestone, 'INCIDENT', i.id, 'MIS-' || i.incident_number, 'MISSING_REPORTED',
      CASE m.milestone WHEN 'REPORTED' THEN 'DISPUTED' ELSE 'CONFIRMED' END, false, false,
      i.last_known_location_id, COALESCE(${LOC("i.last_known_location_id", "m.at")}, i.last_known_location_text), NULL, NULL, NULL,
      CASE WHEN i.last_known_custodian_id IS NOT NULL THEN 'EMPLOYEE' END, i.last_known_custodian_id, ${WHO("'EMPLOYEE'", "i.last_known_custodian_id", "NULL::uuid", "NULL::uuid", "m.at")},
      NULL, NULL, NULL, NULL, CASE m.milestone WHEN 'REPORTED' THEN i.description ELSE i.decision_note END,
      CASE WHEN m.milestone = 'REPORTED' AND i.missing_since IS NOT NULL AND i.missing_since < i.reported_at::date THEN i.missing_since::timestamptz ELSE m.at END,
      CASE WHEN m.milestone = 'REPORTED' AND i.missing_since IS NOT NULL AND i.missing_since < i.reported_at::date THEN i.missing_since::timestamptz ELSE m.at END,
      m.at, m.at, m.actor, NULL, 'asset_missing_incident', i.id, 'MIS-' || i.incident_number, NULL,
      jsonb_build_object('status', CASE m.milestone WHEN 'REPORTED' THEN 'REPORTED' ELSE i.status END, 'recoveredAt', i.recovered_at)
    FROM tenant.asset_missing_incidents i
    CROSS JOIN LATERAL (VALUES ('REPORTED', i.reported_at, i.reported_by), ('DECIDED', i.decided_at, i.decided_by)) AS m(milestone, at, actor)
    WHERE i.organization_id = $1 AND ($2::uuid IS NULL OR i.asset_id = $2) AND m.at IS NOT NULL AND m.at >= $3::timestamptz ${ON_CONFLICT}`],

  // Out-of-service maintenance: temporary possession by the repairer, linked to its work order; the registered location is unchanged.
  ["MAINTENANCE_ORDER", `INSERT INTO tenant.asset_movement_events (${COLS})
    SELECT w.organization_id, w.asset_id, 'MAINTENANCE_ORDER', w.id, m.milestone, 'MAINTENANCE', w.id, w.work_order_number,
      CASE m.milestone WHEN 'STARTED' THEN 'TEMPORARY_MOVEMENT' ELSE 'RETURN_FROM_TEMPORARY_MOVEMENT' END, 'CONFIRMED', false, false,
      at.loc, ${LOC("at.loc", "m.at")}, at.loc, ${LOC("at.loc", "m.at")}, CASE WHEN at.loc IS NULL THEN NULL ELSE 'CONFIRMED' END,
      NULL, NULL, NULL, NULL, NULL, NULL, NULL, COALESCE(w.problem_description, w.maintenance_type), m.at, m.at, m.rec, m.rec, m.actor, NULL,
      'asset_maintenance_order', w.id, w.work_order_number, NULL,
      jsonb_build_object('maintenanceType', w.maintenance_type, 'supplierId', w.supplier_id, 'external', w.supplier_id IS NOT NULL, 'status', w.status)
    FROM tenant.asset_maintenance_orders w
    CROSS JOIN LATERAL (VALUES ('STARTED', COALESCE(w.actual_start_at, w.created_at), w.created_at, w.created_by),
      ('ENDED', CASE WHEN w.status IN ('completed', 'closed') THEN COALESCE(w.actual_end_at, w.updated_at) END, COALESCE(w.updated_at, w.actual_end_at), w.completed_by)) AS m(milestone, at, rec, actor)
    CROSS JOIN LATERAL (SELECT (SELECT le.new_location_id FROM tenant.asset_location_events le WHERE le.asset_id = w.asset_id AND le.recorded_at <= COALESCE(m.rec, m.at)
       ORDER BY le.recorded_at DESC, le.id DESC LIMIT 1) AS loc) at
    WHERE w.organization_id = $1 AND ($2::uuid IS NULL OR w.asset_id = $2) AND w.took_asset_out_of_service AND m.at IS NOT NULL AND m.rec >= $3::timestamptz ${ON_CONFLICT}`],

  // A maintenance Work Order that restricted use: the asset is with the technician or vendor from the start until it is closed or cancelled.
  ["MAINTENANCE_WORK_ORDER", `INSERT INTO tenant.asset_movement_events (${COLS})
    SELECT w.organization_id, w.asset_id, 'MAINTENANCE_ORDER', w.id, m.milestone, 'MAINTENANCE', w.id, w.work_order_number,
      CASE m.milestone WHEN 'STARTED' THEN 'TEMPORARY_MOVEMENT' ELSE 'RETURN_FROM_TEMPORARY_MOVEMENT' END, 'CONFIRMED', false, false,
      at.loc, ${LOC("at.loc", "m.at")}, at.loc, ${LOC("at.loc", "m.at")}, CASE WHEN at.loc IS NULL THEN NULL ELSE 'CONFIRMED' END,
      NULL, NULL, NULL, NULL, NULL, NULL, NULL, w.title, m.at, m.at, m.at, m.at, m.actor, NULL,
      'asset_maintenance_work_order', w.id, w.work_order_number, NULL,
      jsonb_build_object('maintenanceType', w.maintenance_type, 'supplierId', w.supplier_id, 'external', w.execution <> 'INTERNAL', 'status', w.status, 'outcome', w.outcome)
    FROM tenant.asset_maintenance_work_orders w
    CROSS JOIN LATERAL (VALUES ('STARTED', w.actual_start_at, w.technician_user_id),
      ('ENDED', CASE WHEN w.status IN ('CLOSED', 'CANCELLED') AND w.actual_start_at IS NOT NULL THEN GREATEST(COALESCE(w.closed_at, w.updated_at), w.actual_start_at) END, NULL::uuid)) AS m(milestone, at, actor)
    CROSS JOIN LATERAL (SELECT (SELECT le.new_location_id FROM tenant.asset_location_events le WHERE le.asset_id = w.asset_id AND le.recorded_at <= m.at
       ORDER BY le.recorded_at DESC, le.id DESC LIMIT 1) AS loc) at
    WHERE w.organization_id = $1 AND ($2::uuid IS NULL OR w.asset_id = $2) AND w.restrict_use AND w.legacy_order_id IS NULL AND m.at IS NOT NULL AND m.at >= $3::timestamptz ${ON_CONFLICT}`],

  ["DISPOSAL", `INSERT INTO tenant.asset_movement_events (${COLS})
    SELECT x.organization_id, x.asset_id, 'DISPOSAL', x.id, 'MAIN', 'DISPOSAL', x.id, x.disposal_number, 'DISPOSED', 'CONFIRMED', false, false,
      at.loc, ${LOC("at.loc", "x.completed_at")}, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, COALESCE(x.reason, x.disposal_method),
      CASE WHEN x.disposal_date < x.completed_at::date THEN x.disposal_date::timestamptz ELSE x.completed_at END,
      CASE WHEN x.disposal_date < x.completed_at::date THEN x.disposal_date::timestamptz ELSE x.completed_at END,
      x.completed_at, x.completed_at, x.completed_by, x.approved_by, 'asset_disposal', x.id, x.disposal_number, NULL, jsonb_build_object('method', x.disposal_method)
    FROM tenant.asset_disposals x
    CROSS JOIN LATERAL (SELECT (SELECT le.new_location_id FROM tenant.asset_location_events le WHERE le.asset_id = x.asset_id AND le.recorded_at <= x.completed_at
       ORDER BY le.recorded_at DESC, le.id DESC LIMIT 1) AS loc) at
    WHERE ${scope("x", "x.completed_at")} AND x.completed_at IS NOT NULL AND x.status IN ('completed', 'posted') ${ON_CONFLICT}`],

  // A completed disposal case line: the asset left the Company (or was written off as lost) — its final event.
  ["DISPOSAL_CASE", `INSERT INTO tenant.asset_movement_events (${COLS})
    SELECT l.organization_id, l.asset_id, 'DISPOSAL', l.id, 'MAIN', 'DISPOSAL', k.id, k.case_number, 'DISPOSED', 'CONFIRMED', false, false,
      at.loc, ${LOC("at.loc", "l.completed_at")}, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, COALESCE(l.handover_recipient, k.explanation),
      LEAST(COALESCE(l.actual_disposition_date::timestamptz, l.completed_at), l.completed_at), LEAST(COALESCE(l.actual_disposition_date::timestamptz, l.completed_at), l.completed_at),
      l.completed_at, l.completed_at, l.completed_by, NULL, 'asset_disposal_case', k.id, k.case_number, NULL, jsonb_build_object('method', k.disposal_type, 'handover', l.handover_kind)
    FROM tenant.asset_disposal_lines l JOIN tenant.asset_disposal_cases k ON k.id = l.case_id
    CROSS JOIN LATERAL (SELECT (SELECT le.new_location_id FROM tenant.asset_location_events le WHERE le.asset_id = l.asset_id AND le.recorded_at <= l.completed_at
       ORDER BY le.recorded_at DESC, le.id DESC LIMIT 1) AS loc) at
    WHERE ${scope("l", "l.completed_at")} AND l.completed_at IS NOT NULL AND l.line_status IN ('COMPLETED', 'REINSTATED') ${ON_CONFLICT}`],

  // An applied correction is itself an event: the original's facts with the corrected time; the original stays and points to it.
  ["CORRECTION", `INSERT INTO tenant.asset_movement_events (${COLS.replace("correction_of_event_id, details", "correction_of_event_id, details")})
    SELECT o.organization_id, o.asset_id, 'CORRECTION', r.id, 'MAIN', o.group_type, o.group_id, o.group_label, 'MOVEMENT_CORRECTED', o.certainty, o.changes_location, o.changes_custody,
      o.from_location_id, o.from_location_name, o.to_location_id, o.to_location_name, o.to_location_role, o.from_custodian_type, o.from_custodian_id, o.from_custodian_label,
      o.to_custodian_type, o.to_custodian_id, o.to_custodian_label, o.condition, r.reason, r.corrected_value, r.corrected_value, r.decided_at, r.decided_at, r.decided_by, r.decided_by,
      o.document_type, o.document_id, o.document_number, o.id,
      jsonb_build_object('correctedType', o.event_type, 'field', r.field, 'originalValue', r.original_value, 'correctedValue', r.corrected_value, 'evidence', r.evidence,
        'correctionNumber', r.correction_number, 'requestedBy', r.requested_by)
    FROM tenant.asset_movement_corrections r JOIN tenant.asset_movement_events o ON o.id = r.event_id
    WHERE r.organization_id = $1 AND ($2::uuid IS NULL OR r.asset_id = $2) AND r.status = 'APPLIED' AND r.decided_at >= $3::timestamptz ${ON_CONFLICT}`],
]);

// Points each corrected event at the correction that supersedes it (the one update the projection allows).
const LINK_CORRECTIONS = `UPDATE tenant.asset_movement_events o SET superseded_by_event_id = n.id FROM tenant.asset_movement_events n
  WHERE n.organization_id = $1 AND n.source_type = 'CORRECTION' AND n.correction_of_event_id = o.id AND o.superseded_by_event_id IS NULL AND ($2::uuid IS NULL OR o.asset_id = $2)
    AND NOT EXISTS (SELECT 1 FROM tenant.asset_movement_events later WHERE later.correction_of_event_id = o.id AND later.source_type = 'CORRECTION' AND later.recorded_at > n.recorded_at)`;

// Normalises every source stream (for one asset, or the Company since a moment); each stream runs in its own savepoint, so one failing
// stream is recorded on its checkpoint and retried next time while the others still land. Repeating it inserts nothing new.
export async function ingestAssetMovements(client, c, { assetId = null, since = null } = {}) {
  let ingested = 0;
  const failed = [];
  for (const [stream, sql] of NORMALIZERS) {
    await client.query("SAVEPOINT movement_ingest");
    try {
      const r = await client.query(sql, [c.organizationId, assetId, since ?? "-infinity"]);
      await client.query("RELEASE SAVEPOINT movement_ingest");
      ingested += r.rowCount;
    } catch (error) {
      await client.query("ROLLBACK TO SAVEPOINT movement_ingest");
      failed.push({ stream, error: String(error.message).slice(0, 500) });
    }
  }
  await client.query(LINK_CORRECTIONS, [c.organizationId, assetId]);
  return { ingested, failed };
}

async function checkpoint(client, c, status, { ingested = 0, failed = [] } = {}) {
  await client.query(`INSERT INTO tenant.asset_movement_checkpoints (organization_id, stream, last_source_at, last_run_at, last_run_status, last_error, ingested_count)
      VALUES ($1, 'ALL', clock_timestamp(), clock_timestamp(), $2, $3, $4)
    ON CONFLICT (organization_id, stream) DO UPDATE SET last_source_at = EXCLUDED.last_source_at, last_run_at = EXCLUDED.last_run_at, last_run_status = EXCLUDED.last_run_status,
      last_error = EXCLUDED.last_error, ingested_count = tenant.asset_movement_checkpoints.ingested_count + EXCLUDED.ingested_count`,
    [c.organizationId, failed.length ? "FAILED" : status, failed.length ? failed.map((f) => `${f.stream}: ${f.error}`).join("; ").slice(0, 2000) : null, ingested]);
}

// Catches the Company's projection up from its checkpoint (with an overlap, since ingestion is idempotent). One run at a time per Company.
export async function syncCompanyMovements(client, c) {
  await client.query(`SELECT pg_advisory_xact_lock(hashtext('asset_movements:' || $1::text))`, [c.organizationId]);
  const cp = (await client.query(`SELECT last_run_at, last_run_status FROM tenant.asset_movement_checkpoints WHERE organization_id = $1 AND stream = 'ALL'`, [c.organizationId])).rows[0];
  const since = cp?.last_run_at && cp.last_run_status !== "FAILED" ? new Date(new Date(cp.last_run_at).getTime() - 15 * 60 * 1000).toISOString() : null;
  const result = await ingestAssetMovements(client, c, { since });
  await checkpoint(client, c, "OK", result);
  return result;
}
export const syncAssetMovements = (client, c, assetId) => ingestAssetMovements(client, c, { assetId });

export async function syncState(client, c) {
  const cp = (await client.query(`SELECT last_run_at, last_run_status, last_error FROM tenant.asset_movement_checkpoints WHERE organization_id = $1 AND stream = 'ALL'`, [c.organizationId])).rows[0];
  return { lastRunAt: cp?.last_run_at ?? null, status: cp?.last_run_status ?? "NEVER", delayed: cp?.last_run_status === "FAILED", error: has(c, MV.reconcile) ? cp?.last_error ?? null : null };
}

// Rebuild: re-derive the projection from the sources. Rows nothing depends on are removed and re-ingested (same source identities, same
// facts); corrected rows and corrections stay, since their identity anchors the correction trail. Source records are never touched.
export async function rebuildAssetMovementProjection(client, c, input = {}) {
  if (!has(c, MV.reconcile)) throw mvError(403, "ASSET_MOVEMENT_ACCESS_DENIED");
  const assetId = input.assetId ?? null;
  await client.query(`SELECT pg_advisory_xact_lock(hashtext('asset_movements:' || $1::text))`, [c.organizationId]);
  await client.query(`SELECT set_config('vercent.movement_rebuild', 'on', true)`);
  let removed = 0;
  try {
    removed = (await client.query(`DELETE FROM tenant.asset_movement_events e WHERE e.organization_id = $1 AND ($2::uuid IS NULL OR e.asset_id = $2) AND e.source_type <> 'CORRECTION'
        AND e.superseded_by_event_id IS NULL AND NOT EXISTS (SELECT 1 FROM tenant.asset_movement_corrections r WHERE r.event_id = e.id)`, [c.organizationId, assetId])).rowCount;
  } finally { await client.query(`SELECT set_config('vercent.movement_rebuild', 'off', true)`); }
  const result = await ingestAssetMovements(client, c, { assetId });
  await checkpoint(client, c, "REBUILT", result);
  return { removed, ingested: result.ingested, failed: result.failed };
}

export const ORDER_DESC = `e.effective_at DESC, ${RANK_SQL} DESC, e.recorded_at DESC, e.id DESC`;
