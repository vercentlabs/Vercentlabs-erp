// Assets — Asset Movement History, the few commands it has: a correction of when a movement happened (requested with evidence, decided
// by someone else, appended as a superseding event — the original stays), reconciliation against the authoritative location and custody
// records, and resolving what reconciliation found. Nothing here moves an asset or changes its custodian.
import { has, nextNumber, text, uuid } from "../common.js";
import { companyWide, MV, mvError, ORDER_SQL, requireMv } from "./mv-rules.js";
import { ingestAssetMovements, ORDER_DESC, syncAssetMovements, syncCompanyMovements } from "./mv-ingest.js";
import { correctable } from "./mv-read.js";

const iso = (v) => (v instanceof Date ? v.toISOString() : v ?? null);
const timeOf = (v) => { const d = new Date(String(v ?? "")); return v && !Number.isNaN(d.getTime()) ? d : null; };
const SOURCE_HREF = { asset_transfer: (id) => `/assets/transfers/${id}`, asset_assignment: (id) => `/assets/assignments/${id}` };

// input: { field: 'OCCURRED_AT', correctedValue, reason, evidence } — only when it happened can be corrected here; which asset, where or to
// whom is corrected in the owning workflow (a transfer exception, a custody return, a location discrepancy), so those are refused with a pointer.
export async function requestMovementCorrection(client, c, eventId, input = {}) {
  requireMv(c, MV.correct);
  let id;
  try { id = uuid(eventId, "Movement"); } catch { throw mvError(404, "ASSET_MOVEMENT_NOT_FOUND"); }
  const e = (await client.query(`SELECT * FROM tenant.asset_movement_events WHERE organization_id = $1 AND id = $2`, [c.organizationId, id])).rows[0];
  if (!e) throw mvError(404, "ASSET_MOVEMENT_NOT_FOUND");
  const field = input.field ?? "OCCURRED_AT";
  if (field !== "OCCURRED_AT" || !correctable(e)) {
    throw mvError(409, "ASSET_MOVEMENT_CORRECTION_SOURCE_REQUIRED", undefined, { documentType: e.document_type, documentId: e.document_id, number: e.document_number,
      href: SOURCE_HREF[e.document_type]?.(e.document_id) ?? `/assets/register/${e.asset_id}?tab=custody` });
  }
  const corrected = timeOf(input.correctedValue);
  if (!corrected) throw mvError(400, "ASSET_MOVEMENT_INVALID", "Enter when it actually happened.");
  if (corrected.getTime() > Date.now() + 60 * 1000) throw mvError(400, "ASSET_MOVEMENT_INVALID", "A movement cannot be corrected to a time in the future.");
  if (corrected.getTime() === new Date(e.occurred_at).getTime()) throw mvError(400, "ASSET_MOVEMENT_INVALID", "That is already the recorded time.");
  const reason = text(input.reason, 1000);
  const evidence = text(input.evidence, 1000);
  if (reason.length < 5) throw mvError(400, "ASSET_MOVEMENT_INVALID", "Give the reason for the correction.");
  if (evidence.length < 3) throw mvError(400, "ASSET_MOVEMENT_INVALID", "Name the evidence (a courier record, a signed note, a document).");
  if ((await client.query(`SELECT 1 FROM tenant.asset_movement_corrections WHERE event_id = $1 AND status = 'REQUESTED'`, [e.id])).rows[0]) {
    throw mvError(409, "ASSET_MOVEMENT_INVALID", "A correction of this movement is already waiting for a decision.");
  }
  const number = await nextNumber(client, c, "asset_movement_correction", "MVC");
  const row = (await client.query(`INSERT INTO tenant.asset_movement_corrections (organization_id, correction_number, event_id, asset_id, field, original_value, corrected_value, reason, evidence, requested_by)
      VALUES ($1,$2,$3,$4,'OCCURRED_AT',$5,$6,$7,$8,$9) RETURNING *`, [c.organizationId, number, e.id, e.asset_id, e.occurred_at, corrected.toISOString(), reason, evidence, c.userId])).rows[0];
  return { correctionId: row.id, number, status: row.status, originalValue: iso(row.original_value), correctedValue: iso(row.corrected_value) };
}

// The corrected time must keep the asset's story in order: after the movement before it and before the one after it (of the same kind),
// and within its own transfer or handover steps. A correction that would reorder history is flagged for review, not applied.
async function conflictOf(client, e, corrected) {
  const neighbours = async (flag) => {
    const rows = (await client.query(`SELECT e.id, e.effective_at FROM tenant.asset_movement_events e WHERE e.asset_id = $1 AND e.id <> $2 AND e.superseded_by_event_id IS NULL AND ${flag}
        ORDER BY ${ORDER_SQL}`, [e.asset_id, e.id])).rows;
    const at = new Date(e.effective_at).getTime();
    const before = rows.filter((r) => new Date(r.effective_at).getTime() <= at).pop();
    const after = rows.find((r) => new Date(r.effective_at).getTime() > at);
    return { before, after };
  };
  const checks = [];
  if (e.changes_location) checks.push(await neighbours("e.changes_location"));
  if (e.changes_custody) checks.push(await neighbours("e.changes_custody"));
  // Within its own transfer or handover, only the physical steps bound it (paperwork is often entered after the fact).
  if (e.group_id) checks.push(await neighbours(`e.group_id = '${e.group_id}' AND (e.changes_location OR e.changes_custody OR e.event_type IN ('TRANSFER_DISPATCHED', 'TEMPORARY_MOVEMENT'))`));
  for (const { before, after } of checks) {
    if (before && corrected.getTime() < new Date(before.effective_at).getTime()) return { with: before.id, side: "before" };
    if (after && corrected.getTime() > new Date(after.effective_at).getTime()) return { with: after.id, side: "after" };
  }
  return null;
}

// input: { decision: 'APPLY' | 'REJECT', note? } — never by the person who asked.
export async function decideMovementCorrection(client, c, correctionId, input = {}) {
  requireMv(c, MV.reconcile);
  let id;
  try { id = uuid(correctionId, "Correction"); } catch { throw mvError(404, "ASSET_MOVEMENT_NOT_FOUND"); }
  const r = (await client.query(`SELECT * FROM tenant.asset_movement_corrections WHERE organization_id = $1 AND id = $2 FOR UPDATE`, [c.organizationId, id])).rows[0];
  if (!r) throw mvError(404, "ASSET_MOVEMENT_NOT_FOUND");
  if (r.status !== "REQUESTED") return { correctionId: r.id, number: r.correction_number, status: r.status, replayed: true };
  if (r.requested_by === c.userId) throw mvError(403, "ASSET_MOVEMENT_ACCESS_DENIED", "Someone other than the requester decides a correction.");
  const note = text(input.note, 1000) || null;
  if (input.decision === "REJECT") {
    await client.query(`UPDATE tenant.asset_movement_corrections SET status = 'REJECTED', decided_by = $2, decided_at = clock_timestamp(), decision_note = $3 WHERE id = $1`, [r.id, c.userId, note]);
    return { correctionId: r.id, number: r.correction_number, status: "REJECTED" };
  }
  if (input.decision !== "APPLY") throw mvError(400, "ASSET_MOVEMENT_INVALID", "Choose apply or reject.");
  const e = (await client.query(`SELECT * FROM tenant.asset_movement_events WHERE id = $1`, [r.event_id])).rows[0];
  if (e.superseded_by_event_id) throw mvError(409, "ASSET_MOVEMENT_CONFLICT", "This movement was already corrected; review the latest correction.");
  const conflict = await conflictOf(client, e, new Date(r.corrected_value));
  if (conflict) {
    const issue = (await client.query(`INSERT INTO tenant.asset_movement_reconciliation_issues (organization_id, asset_id, issue_type, expected, observed, related, reviewer_user_id)
        VALUES ($1,$2,'HISTORICAL_CONFLICT',$3,$4,$5,$6)
        ON CONFLICT (asset_id, issue_type) WHERE status = 'OPEN' DO UPDATE SET last_detected_at = clock_timestamp(), observed = EXCLUDED.observed, related = EXCLUDED.related RETURNING id`,
      [c.organizationId, e.asset_id, JSON.stringify({ correctionNumber: r.correction_number, correctedValue: iso(r.corrected_value) }),
        JSON.stringify({ conflictsWith: conflict.with, side: conflict.side }), JSON.stringify([e.id, conflict.with]), c.userId])).rows[0];
    return { correctionId: r.id, number: r.correction_number, status: "REQUESTED", applied: false, conflict: true, issueId: issue.id,
      message: "The corrected time would reorder this asset's later movements. It is flagged for review and was not applied." };
  }
  await client.query(`UPDATE tenant.asset_movement_corrections SET status = 'APPLIED', decided_by = $2, decided_at = clock_timestamp(), decision_note = $3 WHERE id = $1`, [r.id, c.userId, note]);
  await ingestAssetMovements(client, c, { assetId: e.asset_id });
  const made = (await client.query(`SELECT id FROM tenant.asset_movement_events WHERE source_type = 'CORRECTION' AND source_id = $1`, [r.id])).rows[0];
  await client.query(`UPDATE tenant.asset_movement_corrections SET applied_event_id = $2 WHERE id = $1`, [r.id, made.id]);
  return { correctionId: r.id, number: r.correction_number, status: "APPLIED", applied: true, eventId: made.id };
}

// Compares the projection with the authoritative records — the registered location and the active custody period — and records what
// differs; an issue that no longer appears is closed. A missing projection event is reported, never invented.
export async function reconcileAssetMovementHistory(client, c, input = {}) {
  requireMv(c, MV.reconcile);
  const assetId = input.assetId ? uuid(input.assetId, "Asset") : null;
  if (assetId) await syncAssetMovements(client, c, assetId); else await syncCompanyMovements(client, c);
  const found = (await client.query(`WITH a AS (SELECT a.id, a.location_id FROM tenant.assets a WHERE a.organization_id = $1 AND ($2::uuid IS NULL OR a.id = $2)),
      pl AS (SELECT DISTINCT ON (e.asset_id) e.asset_id, e.to_location_id, e.id FROM tenant.asset_movement_events e WHERE e.organization_id = $1 AND e.changes_location AND e.superseded_by_event_id IS NULL
             AND ($2::uuid IS NULL OR e.asset_id = $2) ORDER BY e.asset_id, ${ORDER_DESC}),
      pc AS (SELECT DISTINCT ON (e.asset_id) e.asset_id, e.to_custodian_type, e.to_custodian_id, e.id FROM tenant.asset_movement_events e WHERE e.organization_id = $1 AND e.changes_custody
             AND e.superseded_by_event_id IS NULL AND ($2::uuid IS NULL OR e.asset_id = $2) ORDER BY e.asset_id, ${ORDER_DESC}),
      ac AS (SELECT k.asset_id, k.custodian_type, COALESCE(k.user_id, k.department_id, k.store_location_id) AS cid FROM tenant.asset_custody_assignments k WHERE k.status = 'ACTIVE'),
      base AS (SELECT DISTINCT e.asset_id FROM tenant.asset_movement_events e WHERE e.organization_id = $1 AND e.event_type IN ('OPENING_BASELINE', 'INITIAL_PLACEMENT'))
    SELECT a.id AS asset_id, 'LOCATION_MISMATCH' AS issue, jsonb_build_object('locationId', a.location_id) AS expected, jsonb_build_object('locationId', pl.to_location_id) AS observed, jsonb_build_array(pl.id) AS related
      FROM a LEFT JOIN pl ON pl.asset_id = a.id WHERE a.location_id IS NOT NULL AND a.location_id IS DISTINCT FROM pl.to_location_id AND (pl.asset_id IS NOT NULL OR EXISTS (SELECT 1 FROM base WHERE base.asset_id = a.id))
    UNION ALL
    SELECT a.id, 'CUSTODY_MISMATCH', jsonb_build_object('type', ac.custodian_type, 'id', ac.cid), jsonb_build_object('type', pc.to_custodian_type, 'id', pc.to_custodian_id), jsonb_build_array(pc.id)
      FROM a LEFT JOIN ac ON ac.asset_id = a.id LEFT JOIN pc ON pc.asset_id = a.id
      WHERE (ac.asset_id IS NOT NULL OR pc.asset_id IS NOT NULL) AND (ac.custodian_type IS DISTINCT FROM pc.to_custodian_type OR ac.cid IS DISTINCT FROM pc.to_custodian_id)
    UNION ALL
    SELECT a.id, 'MISSING_BASELINE', jsonb_build_object('baseline', true), '{}'::jsonb, '[]'::jsonb FROM a WHERE a.location_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM base WHERE base.asset_id = a.id)`,
  [c.organizationId, assetId])).rows;
  let opened = 0;
  for (const f of found) {
    const r = await client.query(`INSERT INTO tenant.asset_movement_reconciliation_issues (organization_id, asset_id, issue_type, expected, observed, related) VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (asset_id, issue_type) WHERE status = 'OPEN' DO UPDATE SET last_detected_at = clock_timestamp(), expected = EXCLUDED.expected, observed = EXCLUDED.observed, related = EXCLUDED.related
        RETURNING (xmax = 0) AS inserted`, [c.organizationId, f.asset_id, f.issue, JSON.stringify(f.expected), JSON.stringify(f.observed), JSON.stringify(f.related)]);
    if (r.rows[0]?.inserted) opened += 1;
  }
  const keys = found.map((f) => `${f.asset_id}:${f.issue}`);
  const closed = (await client.query(`UPDATE tenant.asset_movement_reconciliation_issues SET status = 'RESOLVED', resolved_at = clock_timestamp(), resolved_by = $3,
      resolution = 'No longer found by reconciliation.' WHERE organization_id = $1 AND status = 'OPEN' AND issue_type <> 'HISTORICAL_CONFLICT' AND ($2::uuid IS NULL OR asset_id = $2)
      AND NOT ((asset_id::text || ':' || issue_type) = ANY($4::text[]))`, [c.organizationId, assetId, c.userId, keys])).rowCount;
  return { checked: assetId ? 1 : Number((await client.query(`SELECT count(*)::int AS n FROM tenant.assets WHERE organization_id = $1`, [c.organizationId])).rows[0].n), found: found.length, opened, closed };
}

// input: { resolution } — the reviewer's explanation (for example, the source workflow was corrected, or the conflicting correction rejected).
export async function resolveMovementIssue(client, c, issueId, input = {}) {
  requireMv(c, MV.reconcile);
  if (!companyWide(c)) throw mvError(403, "ASSET_MOVEMENT_ACCESS_DENIED");
  const resolution = text(input.resolution, 1000);
  if (resolution.length < 5) throw mvError(400, "ASSET_MOVEMENT_INVALID", "Explain how it was resolved.");
  const r = (await client.query(`UPDATE tenant.asset_movement_reconciliation_issues SET status = 'RESOLVED', resolved_at = clock_timestamp(), resolved_by = $3, resolution = $4
      WHERE organization_id = $1 AND id = $2 AND status = 'OPEN' RETURNING id`, [c.organizationId, uuid(issueId, "Issue"), c.userId, resolution])).rows[0];
  if (!r) throw mvError(404, "ASSET_MOVEMENT_NOT_FOUND");
  return { issueId: r.id, status: "RESOLVED", reviewerCanAct: has(c, MV.reconcile) };
}
