// Assets — Asset Status, the reads: one asset's four dimensions (lifecycle, effective availability with its reason, condition, Finance's
// classification), its active hold or missing report, the actions open to the person in its state; the status history (lifecycle,
// availability, condition, holds and reports); the exceptions that need someone; and the status reports.
import { has, qx, uuid } from "../common.js";
import { CAPITALIZATION, LIFECYCLE, TRANSITIONS, seesRegister } from "../asset-register/register-rules.js";
import { ACTION_LABEL, CONDITION_LABEL, EFFECTIVE_AVAILABILITY, HOLD_REASON, INCIDENT_STATUS, STATUS, seesStatusHistory, statusError } from "./status-rules.js";

const NAME = (alias) => `COALESCE(NULLIF(${alias}.full_name, ''), ${alias}.email)`;
async function assetFor(client, c, assetId) {
  const { loadAssetRow } = await import("../asset-register/register-commands.js");
  return loadAssetRow(client, c, assetId);
}
// The actions this person can take on the asset now, each with its label — the screen offers nothing else.
export function allowedStatusActions(c, row, { hold, incident } = {}) {
  if (row.archived_at || row.lifecycle_status === "DISPOSED") return [];
  const out = Object.entries(TRANSITIONS).filter(([, rule]) => rule.from.includes(row.lifecycle_status) && has(c, rule.permission)).map(([key]) => key)
    .filter((key) => key !== "confirm-lost" || incident);
  if (["REGISTERED", "ACTIVE", "ON_HOLD"].includes(row.lifecycle_status) && !incident && (has(c, STATUS.reportMissing) || has(c, STATUS.confirmLost))) out.push("report-missing");
  if (incident && has(c, STATUS.confirmLost)) out.push("close-missing");
  if (has(c, STATUS.condition) || (row.current_user_id === c.userId && has(c, STATUS.reportMissing))) out.push("record-condition");
  void hold;
  return out;
}
// The effective availability and why: the lifecycle first, then maintenance, transfer, custody, condition.
function availabilityReason(row, effective, { hold, incident, work }) {
  if (effective === "NOT_AVAILABLE") {
    if (row.lifecycle_status === "ON_HOLD") return hold ? `On hold — ${HOLD_REASON[hold.reason_code]?.toLowerCase()}: ${hold.description}` : "On hold.";
    if (["DRAFT", "REGISTERED"].includes(row.lifecycle_status)) return "Not yet commissioned.";
    if (row.lifecycle_status === "LOST") return "Confirmed lost.";
    if (row.lifecycle_status === "RETIRED") return "Retired from use.";
    if (row.lifecycle_status === "DISPOSED") return "Disposed.";
    if (row.condition === "UNSERVICEABLE") return "Recorded as unserviceable: not issued until an authorized decision.";
    return "Restricted.";
  }
  if (effective === "UNDER_MAINTENANCE") return `Unavailable for ordinary assignment until maintenance is completed${work?.maintenance ? ` (${work.maintenance.work_order_number})` : ""}. Its custodian is kept.`;
  if (effective === "IN_TRANSFER") return `Transfer ${work?.transfer?.transfer_number ?? ""} is in progress.`.replace("  ", " ");
  if (incident) return `Reported missing on ${String(incident.reported_at).slice(0, 10)}; under investigation.`;
  return null;
}
export async function getAssetStatus(client, c, assetId) {
  const row = await assetFor(client, c, assetId);
  const effective = (await client.query(`SELECT tenant.asset_effective_availability(a) AS v FROM tenant.assets a WHERE a.id = $1`, [row.id])).rows[0].v;
  const hold = (await client.query(`SELECT h.*, ${NAME("o")} AS owner_name, ${NAME("r")} AS reporter_name FROM tenant.asset_holds h LEFT JOIN public.users o ON o.id = h.resolution_owner_id
      LEFT JOIN public.users r ON r.id = h.reported_by WHERE h.asset_id = $1 AND h.status = 'ACTIVE'`, [row.id])).rows[0] ?? null;
  const incident = (await client.query(`SELECT i.*, ${NAME("r")} AS reporter_name FROM tenant.asset_missing_incidents i LEFT JOIN public.users r ON r.id = i.reported_by WHERE i.asset_id = $1 AND i.status = 'OPEN'`, [row.id])).rows[0] ?? null;
  const work = {
    transfer: (await client.query(`SELECT o.transfer_number FROM tenant.asset_transfer_lines l JOIN tenant.asset_transfer_orders o ON o.id = l.transfer_id WHERE l.asset_id = $1 AND l.line_status IN ('PENDING', 'APPROVED', 'DISPATCHED', 'RECEIVED', 'RECEIPT_EXCEPTION', 'RETURN_IN_PROGRESS') LIMIT 1`, [row.id])).rows[0] ?? null,
    maintenance: (await client.query(`SELECT work_order_number FROM (SELECT work_order_number FROM tenant.asset_maintenance_orders WHERE asset_id = $1 AND status = 'in_progress' UNION ALL SELECT work_order_number FROM tenant.asset_maintenance_work_orders WHERE asset_id = $1 AND status IN ('IN_PROGRESS', 'WAITING_FOR_PARTS', 'WAITING_FOR_VENDOR', 'WORK_COMPLETED', 'PENDING_VERIFICATION')) m LIMIT 1`, [row.id])).rows[0] ?? null,
  };
  const proposed = (await client.query(`SELECT e.new_condition, e.reason, e.created_at, ${NAME("u")} AS by FROM tenant.asset_condition_events e LEFT JOIN public.users u ON u.id = e.observed_by
      WHERE e.asset_id = $1 AND e.status = 'PROPOSED' AND e.created_at > COALESCE((SELECT max(x.created_at) FROM tenant.asset_condition_events x WHERE x.asset_id = e.asset_id AND x.status = 'APPLIED'), '-infinity')
      ORDER BY e.created_at DESC LIMIT 1`, [row.id])).rows[0] ?? null;
  const financials = has(c, "assets.view_financials") || has(c, "assets.capitalize");
  const capitalized = row.capitalization_class === "CAPITALIZED";
  return {
    assetId: row.id, code: row.asset_number, version: row.row_version,
    lifecycle: row.lifecycle_status, lifecycleLabel: LIFECYCLE[row.lifecycle_status], statusChangedAt: row.status_changed_at ?? null,
    availability: effective, availabilityLabel: EFFECTIVE_AVAILABILITY[effective], availabilityReason: availabilityReason(row, effective, { hold, incident, work }),
    condition: row.condition ?? "UNKNOWN", conditionLabel: CONDITION_LABEL[row.condition ?? "UNKNOWN"], conditionObservedAt: row.condition_observed_at ?? null,
    proposedCondition: proposed ? { condition: proposed.new_condition, label: CONDITION_LABEL[proposed.new_condition], reason: proposed.reason, by: proposed.by, at: proposed.created_at } : null,
    finance: { classification: row.capitalization_class, label: CAPITALIZATION[row.capitalization_class], depreciating: capitalized && row.depreciation_method !== "none" && Number(row.net_book_value) > 0,
      fullyDepreciated: capitalized && financials ? Number(row.net_book_value) === 0 : undefined,
      note: capitalized ? "Finance owns capitalization, depreciation and any write-off; a status change never posts." : row.capitalization_class === "PENDING" ? "Finance has not yet confirmed capitalization." : null },
    commissionedAt: row.commissioned_at ?? null, availableForUseDate: row.placed_in_service_date ?? null, retiredAt: row.retired_at ?? null, archived: Boolean(row.archived_at),
    hold: hold ? { id: hold.id, number: `HLD-${hold.hold_number}`, reasonCode: hold.reason_code, reason: HOLD_REASON[hold.reason_code], description: hold.description, from: hold.previous_lifecycle,
      fromLabel: LIFECYCLE[hold.previous_lifecycle], owner: hold.owner_name, ownerId: hold.resolution_owner_id, reportedBy: hold.reporter_name, since: hold.started_at } : null,
    missing: incident ? { id: incident.id, number: `MIS-${incident.incident_number}`, description: incident.description, reportedBy: incident.reporter_name, reportedAt: incident.reported_at,
      source: incident.source, missingSince: incident.missing_since } : null,
    openWork: { transfer: work.transfer?.transfer_number ?? null, maintenance: work.maintenance?.work_order_number ?? null },
    actions: allowedStatusActions(c, row, { hold, incident }),
    can: { history: seesStatusHistory(c), bulk: has(c, STATUS.bulk), recoverWithFinance: has(c, "assets.capitalize") },
  };
}

// ------------------------------------------------------------------ history
export async function getAssetStatusHistory(client, c, assetId) {
  const row = await assetFor(client, c, assetId);
  if (!seesStatusHistory(c) && !seesRegister(c)) throw statusError(403, "ASSET_STATUS_PERMISSION_DENIED");
  const events = (await client.query(`SELECT e.*, ${NAME("u")} AS actor FROM tenant.asset_lifecycle_events e LEFT JOIN public.users u ON u.id = e.initiated_by WHERE e.asset_id = $1 ORDER BY e.occurred_at DESC, e.id`, [row.id])).rows;
  const conditions = (await client.query(`SELECT e.*, ${NAME("u")} AS actor FROM tenant.asset_condition_events e LEFT JOIN public.users u ON u.id = e.observed_by WHERE e.asset_id = $1 ORDER BY e.created_at DESC`, [row.id])).rows;
  const holds = (await client.query(`SELECT h.*, ${NAME("o")} AS owner_name, ${NAME("r")} AS released_by_name FROM tenant.asset_holds h LEFT JOIN public.users o ON o.id = h.resolution_owner_id
      LEFT JOIN public.users r ON r.id = h.released_by WHERE h.asset_id = $1 ORDER BY h.started_at DESC`, [row.id])).rows;
  const incidents = (await client.query(`SELECT i.*, ${NAME("r")} AS reporter_name, ${NAME("d")} AS decided_by_name FROM tenant.asset_missing_incidents i LEFT JOIN public.users r ON r.id = i.reported_by
      LEFT JOIN public.users d ON d.id = i.decided_by WHERE i.asset_id = $1 ORDER BY i.reported_at DESC`, [row.id])).rows;
  const AVAIL = { AVAILABLE: "Available", ASSIGNED: "Assigned", MAINTENANCE: "Under maintenance", RESTRICTED: "Restricted" };
  return {
    lifecycle: events.filter((e) => e.event_kind === "LIFECYCLE").map((e) => ({ id: e.id, from: e.previous_status, fromLabel: e.previous_status ? LIFECYCLE[e.previous_status] : null, to: e.new_status, toLabel: LIFECYCLE[e.new_status],
      action: e.action, actionLabel: ACTION_LABEL[e.action] ?? e.action, reason: e.reason, by: e.actor, at: e.occurred_at, effectiveDate: e.effective_date })),
    availability: events.filter((e) => e.event_kind === "AVAILABILITY").map((e) => ({ id: e.id, from: AVAIL[e.previous_status] ?? e.previous_status, to: AVAIL[e.new_status] ?? e.new_status, action: ACTION_LABEL[e.action] ?? e.action, by: e.actor, at: e.occurred_at })),
    conditions: conditions.map((e) => ({ id: e.id, from: CONDITION_LABEL[e.previous_condition ?? "UNKNOWN"], to: CONDITION_LABEL[e.new_condition ?? "UNKNOWN"], observedOn: e.observed_on, source: e.source, status: e.status, reason: e.reason, by: e.actor, at: e.created_at })),
    holds: holds.map((h) => ({ id: h.id, number: `HLD-${h.hold_number}`, reason: HOLD_REASON[h.reason_code], description: h.description, from: LIFECYCLE[h.previous_lifecycle], status: h.status, owner: h.owner_name,
      since: h.started_at, releasedAt: h.released_at, releasedBy: h.released_by_name, releaseReason: h.release_reason })),
    incidents: incidents.map((i) => ({ id: i.id, number: `MIS-${i.incident_number}`, status: i.status, statusLabel: INCIDENT_STATUS[i.status], description: i.description, reportedBy: i.reporter_name, reportedAt: i.reported_at,
      decidedBy: i.decided_by_name, decidedAt: i.decided_at, note: i.decision_note, recoveredAt: i.recovered_at })),
  };
}

// ------------------------------------------------------------------ exceptions and reports
// What needs someone: long holds, open missing reports, lost or retired assets still in Finance's books, commissioning backlogs, reported
// damage not yet reviewed, and records whose custody contradicts their status.
export async function getAssetStatusExceptions(client, c) {
  if (!seesRegister(c)) throw statusError(403, "ASSET_STATUS_PERMISSION_DENIED");
  const q = async (sql) => (await qx(client, sql, [c.organizationId])).rows;
  const out = [];
  const push = (kind, label, r, issue) => out.push({ kind, label, asset: `${r.asset_number} · ${r.name}`, issue, href: `/assets/register/${r.id}` });
  for (const r of await q(`SELECT a.id, a.asset_number, a.name, h.started_at, h.reason_code FROM tenant.asset_holds h JOIN tenant.assets a ON a.id = h.asset_id WHERE h.organization_id = $1 AND h.status = 'ACTIVE' AND h.started_at < now() - interval '30 days'`)) {
    push("LONG_HOLD", "Long-standing hold", r, `On hold since ${String(r.started_at).slice(0, 10)} (${HOLD_REASON[r.reason_code]?.toLowerCase()}).`);
  }
  for (const r of await q(`SELECT a.id, a.asset_number, a.name, i.reported_at FROM tenant.asset_missing_incidents i JOIN tenant.assets a ON a.id = i.asset_id WHERE i.organization_id = $1 AND i.status = 'OPEN'`)) {
    push("MISSING_OPEN", "Missing report to investigate", r, `Reported missing on ${String(r.reported_at).slice(0, 10)}.`);
  }
  for (const r of await q(`SELECT id, asset_number, name, lifecycle_status FROM tenant.assets WHERE organization_id = $1 AND lifecycle_status IN ('LOST', 'RETIRED') AND capitalization_class = 'CAPITALIZED' AND archived_at IS NULL`)) {
    push("FINANCE_REVIEW", "Finance review", r, `${LIFECYCLE[r.lifecycle_status]} but still capitalized: Finance decides write-off or disposal.`);
  }
  for (const r of await q(`SELECT id, asset_number, name FROM tenant.assets WHERE organization_id = $1 AND lifecycle_status = 'ACTIVE' AND capitalization_class = 'PENDING' AND archived_at IS NULL`)) {
    push("CAPITALIZATION_PENDING", "Commissioned, Finance to confirm", r, "In use; Finance has not yet confirmed capitalization.");
  }
  for (const r of await q(`SELECT id, asset_number, name, status_changed_at FROM tenant.assets WHERE organization_id = $1 AND lifecycle_status = 'REGISTERED' AND archived_at IS NULL AND status_changed_at < now() - interval '30 days'`)) {
    push("COMMISSIONING_BACKLOG", "Waiting to be commissioned", r, `Registered since ${String(r.status_changed_at).slice(0, 10)}.`);
  }
  for (const r of await q(`SELECT DISTINCT ON (a.id) a.id, a.asset_number, a.name, e.new_condition FROM tenant.asset_condition_events e JOIN tenant.assets a ON a.id = e.asset_id WHERE e.organization_id = $1 AND e.status = 'PROPOSED'
      AND e.created_at > COALESCE((SELECT max(x.created_at) FROM tenant.asset_condition_events x WHERE x.asset_id = e.asset_id AND x.status = 'APPLIED'), '-infinity') ORDER BY a.id, e.created_at DESC`)) {
    push("CONDITION_REPORTED", "Reported condition to review", r, `Reported as ${CONDITION_LABEL[r.new_condition]?.toLowerCase()}.`);
  }
  for (const r of await q(`SELECT a.id, a.asset_number, a.name, a.lifecycle_status FROM tenant.assets a WHERE a.organization_id = $1 AND a.archived_at IS NULL AND (
      (a.lifecycle_status IN ('RETIRED', 'DISPOSED') AND a.current_user_id IS NOT NULL)
      OR (a.lifecycle_status IN ('LOST', 'DISPOSED') AND EXISTS (SELECT 1 FROM tenant.asset_transfer_lines t WHERE t.asset_id = a.id AND t.line_status IN ('PENDING', 'APPROVED', 'DISPATCHED', 'RECEIVED', 'RECEIPT_EXCEPTION', 'RETURN_IN_PROGRESS')))
      OR (a.lifecycle_status = 'ON_HOLD' AND NOT EXISTS (SELECT 1 FROM tenant.asset_holds h WHERE h.asset_id = a.id AND h.status = 'ACTIVE'))
      OR (a.lifecycle_status = 'ACTIVE' AND a.location_id IS NULL))`)) {
    push("STATUS_CONFLICT", "Status conflict", r, r.lifecycle_status === "ACTIVE" ? "Active with no location recorded." : `${LIFECYCLE[r.lifecycle_status]} but custody or a transfer says otherwise.`);
  }
  return out;
}
export const STATUS_REPORTS = Object.freeze(["by-availability", "by-condition", "on-hold", "lost", "retired", "status-history", "ready-for-commissioning", "finance-review", "long-holds", "status-conflicts",
  "missing-reports"]);
export async function getAssetStatusReport(client, c, kind) {
  if (!STATUS_REPORTS.includes(kind)) throw statusError(400, "ASSET_STATUS_INVALID_TRANSITION", "Unknown report.");
  if (!seesRegister(c)) throw statusError(403, "ASSET_STATUS_PERMISSION_DENIED");
  const q = async (sql) => (await qx(client, sql, [c.organizationId])).rows;
  const link = (r) => `/assets/register/${r.id}`;
  switch (kind) {
    case "by-availability": return (await q(`SELECT tenant.asset_effective_availability(a) AS v, count(*)::int AS n FROM tenant.assets a WHERE a.organization_id = $1 AND a.archived_at IS NULL GROUP BY 1 ORDER BY 2 DESC`))
      .map((r) => ({ availability: EFFECTIVE_AVAILABILITY[r.v], assets: r.n }));
    case "by-condition": return (await q(`SELECT COALESCE(condition, 'UNKNOWN') AS v, count(*)::int AS n FROM tenant.assets WHERE organization_id = $1 AND archived_at IS NULL AND lifecycle_status <> 'DISPOSED' GROUP BY 1 ORDER BY 2 DESC`))
      .map((r) => ({ condition: CONDITION_LABEL[r.v], assets: r.n }));
    case "on-hold": case "long-holds": return (await q(`SELECT a.id, a.asset_number, a.name, h.reason_code, h.description, h.started_at, h.previous_lifecycle, ${NAME("o")} AS owner FROM tenant.asset_holds h
        JOIN tenant.assets a ON a.id = h.asset_id LEFT JOIN public.users o ON o.id = h.resolution_owner_id WHERE h.organization_id = $1 AND h.status = 'ACTIVE' ${kind === "long-holds" ? "AND h.started_at < now() - interval '30 days'" : ""} ORDER BY h.started_at`))
      .map((r) => ({ asset: `${r.asset_number} · ${r.name}`, reason: HOLD_REASON[r.reason_code], details: r.description, since: String(r.started_at).slice(0, 10), returnsTo: LIFECYCLE[r.previous_lifecycle], owner: r.owner, href: link(r) }));
    case "lost": return (await q(`SELECT a.id, a.asset_number, a.name, a.capitalization_class, i.decided_at, i.decision_note FROM tenant.assets a LEFT JOIN tenant.asset_missing_incidents i ON i.id = a.lost_incident_id
        WHERE a.organization_id = $1 AND a.lifecycle_status = 'LOST' ORDER BY a.asset_number`)).map((r) => ({ asset: `${r.asset_number} · ${r.name}`, confirmed: r.decided_at ? String(r.decided_at).slice(0, 10) : "—",
      investigation: r.decision_note ?? "—", finance: CAPITALIZATION[r.capitalization_class], href: link(r) }));
    case "retired": return (await q(`SELECT id, asset_number, name, retired_at, capitalization_class FROM tenant.assets WHERE organization_id = $1 AND lifecycle_status = 'RETIRED' ORDER BY retired_at DESC NULLS LAST`))
      .map((r) => ({ asset: `${r.asset_number} · ${r.name}`, retired: r.retired_at ? String(r.retired_at).slice(0, 10) : "—", finance: CAPITALIZATION[r.capitalization_class], nextStep: "Dispose through the Disposal workflow, or reinstate", href: link(r) }));
    case "status-history": return (await q(`SELECT e.*, a.asset_number, a.name, a.id AS aid, ${NAME("u")} AS actor FROM tenant.asset_lifecycle_events e JOIN tenant.assets a ON a.id = e.asset_id LEFT JOIN public.users u ON u.id = e.initiated_by
        WHERE e.organization_id = $1 AND e.event_kind = 'LIFECYCLE' ORDER BY e.occurred_at DESC LIMIT 1000`)).map((r) => ({ asset: `${r.asset_number} · ${r.name}`, change: `${r.previous_status ? LIFECYCLE[r.previous_status] : "—"} → ${LIFECYCLE[r.new_status]}`,
      action: ACTION_LABEL[r.action] ?? r.action, reason: r.reason ?? "—", by: r.actor ?? "—", at: r.occurred_at, href: `/assets/register/${r.aid}` }));
    case "ready-for-commissioning": return (await q(`SELECT id, asset_number, name, location_id, status_changed_at FROM tenant.assets WHERE organization_id = $1 AND lifecycle_status = 'REGISTERED' AND archived_at IS NULL ORDER BY status_changed_at`))
      .map((r) => ({ asset: `${r.asset_number} · ${r.name}`, registered: r.status_changed_at ? String(r.status_changed_at).slice(0, 10) : "—", location: r.location_id ? "Set" : "Missing", href: link(r) }));
    case "finance-review": return (await getAssetStatusExceptions(client, c)).filter((e) => ["FINANCE_REVIEW", "CAPITALIZATION_PENDING"].includes(e.kind));
    case "status-conflicts": return (await getAssetStatusExceptions(client, c)).filter((e) => e.kind === "STATUS_CONFLICT");
    case "missing-reports": return (await q(`SELECT a.id, a.asset_number, a.name, i.incident_number, i.status, i.reported_at, i.description, ${NAME("r")} AS reporter FROM tenant.asset_missing_incidents i JOIN tenant.assets a ON a.id = i.asset_id
        LEFT JOIN public.users r ON r.id = i.reported_by WHERE i.organization_id = $1 ORDER BY i.reported_at DESC LIMIT 500`)).map((r) => ({ report: `MIS-${r.incident_number}`, asset: `${r.asset_number} · ${r.name}`,
      status: INCIDENT_STATUS[r.status], reported: String(r.reported_at).slice(0, 10), by: r.reporter, details: r.description, href: link(r) }));
    default: return [];
  }
}
// Counts for the overview.
export async function getAssetStatusCounts(client, c) {
  const one = async (sql) => Number((await client.query(sql, [c.organizationId])).rows[0].n);
  return {
    onHold: await one(`SELECT count(*) AS n FROM tenant.assets WHERE organization_id = $1 AND lifecycle_status = 'ON_HOLD' AND archived_at IS NULL`),
    missingReports: await one(`SELECT count(*) AS n FROM tenant.asset_missing_incidents WHERE organization_id = $1 AND status = 'OPEN'`),
    lost: await one(`SELECT count(*) AS n FROM tenant.assets WHERE organization_id = $1 AND lifecycle_status = 'LOST' AND archived_at IS NULL`),
    exceptions: seesRegister(c) ? (await getAssetStatusExceptions(client, c)).length : 0,
  };
}
export const assetIdOf = (value) => uuid(value, "Asset");
