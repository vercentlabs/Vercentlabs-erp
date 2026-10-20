// Quality disposition: the authorized decision on inspected goods, shared by every kind of inspection. The inspection says what the
// evidence shows; the disposition decides what happens to an exact quantity of its population, and Inventory carries it out.
//
//   ACCEPT              the undecided quantity is cleared for release.
//   PARTIAL_ACCEPT      an exact split: accepted, rejected, conditionally accepted, sent to reinspection.
//   REJECT              the quantity stays blocked for its next step (RETURN_TO_SUPPLIER and SCRAP name that step).
//   CONDITIONAL_ACCEPT  release under an approved deviation (its conditions) — someone who may waive approves it.
//   REINSPECT           a linked reinspection of an exact quantity, under the original standard or an authorized newer one.
//   HOLD_FOR_REVIEW     a note on the record: nothing is decided, the quantity stays restricted.
// One unit is never both accepted and rejected: quantities never exceed what is still undecided. A failed lot is never accepted outright
// (that is a conditional acceptance), a critical failure is accepted only with the waive permission, and the inspector doesn't decide their
// own inspection when the company prohibits it. The control point's requirement then allows the release of exactly what was accepted —
// Inventory's release checks it again — and a release or a supplier rejection case is carried out here only for someone allowed to do it in
// Procurement / Inventory (otherwise it waits for them).
import { nextDocumentNumber } from "../../../core/platform/numbering/index.js";
import { recordEvent } from "../common.js";
import { createInspection, loadQualitySettings } from "../inspections.js";
import { ensureMirrorPlan } from "../specifications/qs-resolver.js";
import { loadIncoming } from "./in-commands.js";
import { EPS, IN, has, inError, need, permsOf, round6, text, textOrNull, uuid, uuidOrNull } from "./in-rules.js";

const DECISIONS = ["ACCEPT", "PARTIAL_ACCEPT", "REJECT", "REINSPECT", "CONDITIONAL_ACCEPT", "RETURN_TO_SUPPLIER", "SCRAP", "HOLD_FOR_REVIEW", "REWORK"];
const q = (value) => {
  if (value === undefined || value === null || value === "") return 0;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw inError(400, "QUALITY_INCOMING_QUANTITY_MISMATCH", "Quantities are zero or more.");
  return round6(n);
};

export async function inspectionTotals(client, inspectionId) {
  const row = (await client.query(`SELECT COALESCE(sum(accept_quantity), 0) AS accept, COALESCE(sum(conditional_quantity), 0) AS conditional, COALESCE(sum(reject_quantity), 0) AS reject,
      COALESCE(sum(reinspect_quantity), 0) AS reinspect, COALESCE(sum(rework_quantity), 0) AS rework FROM tenant.quality_dispositions WHERE inspection_id = $1`, [inspectionId])).rows[0];
  const t = { accept: Number(row.accept), conditional: Number(row.conditional), reject: Number(row.reject), reinspect: Number(row.reinspect), rework: Number(row.rework) };
  return { ...t, decided: round6(t.accept + t.conditional + t.reject + t.reinspect + t.rework) };
}
async function rootOf(client, row) {
  let current = row;
  for (let i = 0; i < 20 && current.reinspection_of_id; i += 1)
    current = (await client.query(`SELECT * FROM tenant.quality_inspections WHERE id = $1`, [current.reinspection_of_id])).rows[0];
  return current;
}

// input: { decision, acceptQuantity?, rejectQuantity?, conditionalQuantity?, reinspectQuantity?, holdQuantity?, rejectRoute?, reason, conditions?, evidenceReference?,
//          nonconformanceId? | nonconformance?: { severity, description, ownerUserId? }, reinspection?: { standard: ORIGINAL | CURRENT, reason }, applyToStock?, idempotencyKey? }
export async function authorizeDisposition(client, c, inspectionId, input = {}) {
  need(c, IN.dispose);
  const key = text(input.idempotencyKey, 200) || null;
  if (key) {
    const prior = (await client.query(`SELECT * FROM tenant.quality_dispositions WHERE organization_id = $1 AND idempotency_key = $2`, [c.organizationId, key])).rows[0];
    if (prior) return { id: prior.id, number: prior.disposition_number, replayed: true };
  }
  const row = await loadIncoming(client, c, inspectionId, { lock: true });
  if (row.workflow_status !== "COMPLETED") throw inError(409, "QUALITY_INCOMING_REVIEW_REQUIRED", "Decide on an inspection once its evidence is completed.");
  if (row.source_reversed) throw inError(409, "QUALITY_INCOMING_SOURCE_CHANGED", "The goods receipt was reversed: nothing is left to decide.");
  const decision = DECISIONS.includes(input.decision) ? input.decision : null;
  if (!decision) throw inError(400, "QUALITY_INCOMING_RESULT_INVALID", "Choose the decision.");
  const reason = text(input.reason, 2000);
  if (!reason) throw inError(400, "QUALITY_INCOMING_REASON_REQUIRED", "Give the reason for the decision.");
  const settings = await loadQualitySettings(client, c);
  const inspector = [row.submitted_by, row.assigned_inspector_id].includes(c.userId);
  if (settings.prohibit_self_release !== false && inspector && !c.roleSlugs?.includes("organization_owner"))
    throw inError(403, "QUALITY_INCOMING_SELF_DECISION", "The inspector doesn't decide on their own inspection.");

  const totals = await inspectionTotals(client, row.id);
  const population = Number(row.lot_quantity);
  const left = round6(population - totals.decided);
  let accept = 0; let reject = 0; let conditional = 0; let reinspect = 0; let hold = 0; let rework = 0;
  const production = row.inspection_type === "in_process" || row.inspection_type === "final";
  const preDispatch = row.inspection_type === "pre_dispatch";
  let route = null;
  switch (decision) {
    case "ACCEPT": accept = q(input.acceptQuantity) || left; break;
    case "REJECT": case "RETURN_TO_SUPPLIER": case "SCRAP": reject = q(input.rejectQuantity) || left; route = decision === "REJECT" ? (["RETURN_TO_SUPPLIER", "SCRAP"].includes(input.rejectRoute) ? input.rejectRoute : "HOLD") : decision; break;
    case "CONDITIONAL_ACCEPT": conditional = q(input.conditionalQuantity) || left; break;
    case "REINSPECT": reinspect = q(input.reinspectQuantity) || left; break;
    case "HOLD_FOR_REVIEW": hold = q(input.holdQuantity) || left; break;
    case "REWORK": rework = q(input.reworkQuantity) || left; break;
    default:
      accept = q(input.acceptQuantity); reject = q(input.rejectQuantity); conditional = q(input.conditionalQuantity); reinspect = q(input.reinspectQuantity); rework = q(input.reworkQuantity);
      if (accept <= EPS || accept + reject + conditional + reinspect + rework <= accept + EPS) throw inError(400, "QUALITY_INCOMING_QUANTITY_MISMATCH", "A partial acceptance accepts some and decides the rest another way.");
      route = reject > EPS ? (["RETURN_TO_SUPPLIER", "SCRAP"].includes(input.rejectRoute) ? input.rejectRoute : "HOLD") : null;
  }
  const consumed = round6(accept + reject + conditional + reinspect + rework);
  // Production output is reworked or scrapped, never returned to a supplier; supplier goods are returned, never reworked here.
  if (production && (decision === "RETURN_TO_SUPPLIER" || route === "RETURN_TO_SUPPLIER"))
    throw inError(400, "QUALITY_INCOMING_RESULT_INVALID", "Production output is not returned to a supplier: scrap it, rework it or keep it blocked.");
  // Goods rejected before dispatch stay in the warehouse on a quality hold: Inventory decides there whether they are scrapped, returned or released.
  if (preDispatch && (["RETURN_TO_SUPPLIER", "SCRAP"].includes(decision) || ["RETURN_TO_SUPPLIER", "SCRAP"].includes(route)))
    throw inError(400, "QUALITY_INCOMING_RESULT_INVALID", "Units rejected before dispatch stay on a quality hold in the warehouse: reject them (keep blocked), and Inventory decides their scrap or return on the hold.");
  if (preDispatch && rework > EPS) throw inError(400, "QUALITY_INCOMING_RESULT_INVALID", "Send the corrected units to reinspection instead (after repacking or relabelling).");
  if (!production && !preDispatch && rework > EPS) throw inError(400, "QUALITY_INCOMING_RESULT_INVALID", "Rework is decided on production output; return the goods to the supplier instead.");
  if (rework > EPS && reinspect > EPS) throw inError(400, "QUALITY_INCOMING_QUANTITY_MISMATCH", "Decide a reinspection and a rework separately.");
  if (rework > EPS && !text(input.reworkInstruction)) throw inError(400, "QUALITY_INCOMING_REASON_REQUIRED", "Say what the rework must correct.");
  if (left <= EPS) throw inError(409, "QUALITY_INCOMING_QUANTITY_MISMATCH", "Every unit of this inspection is already decided.");
  if (consumed > left + EPS || hold > left + EPS) throw inError(409, "QUALITY_INCOMING_QUANTITY_MISMATCH", `Only ${left} of ${population} is still undecided.`);
  if (decision !== "HOLD_FOR_REVIEW" && consumed <= EPS) throw inError(400, "QUALITY_INCOMING_QUANTITY_MISMATCH", "Enter the quantity the decision covers.");
  // A failed or critically failed lot is not simply accepted.
  if (decision === "ACCEPT" && row.proposed_outcome !== "PASS")
    throw inError(409, "QUALITY_INCOMING_CRITICAL_FAILURE", "The inspection failed: accept it under an approved deviation (conditional acceptance), or accept only what was segregated (partial acceptance).");
  if (row.critical_failure && accept > EPS && !has(c, IN.waive)) throw inError(403, "QUALITY_INCOMING_CRITICAL_FAILURE", "A critical check failed: accepting any of it needs the waive permission.");
  if (conditional > EPS) {
    need(c, IN.waive);
    if (!text(input.conditions)) throw inError(400, "QUALITY_INCOMING_REASON_REQUIRED", "State the conditions of the deviation.");
  }
  if (reinspect > EPS || rework > EPS) need(c, permsOf(row).reinspect);

  // A nonconformance: an existing one linked, or a new one opened from the findings (failed observations kept on it).
  let nonconformanceId = uuidOrNull(input.nonconformanceId, "Nonconformance");
  if (nonconformanceId && !(await client.query(`SELECT 1 FROM tenant.quality_nonconformances WHERE organization_id = $1 AND id = $2`, [c.organizationId, nonconformanceId])).rows[0])
    throw inError(400, "QUALITY_INCOMING_RESULT_INVALID", "That nonconformance was not found.");
  if (!nonconformanceId && input.nonconformance && typeof input.nonconformance === "object") {
    const { createNonconformance } = await import("../nonconformance.js");
    const failed = (await client.query(`SELECT id FROM tenant.quality_inspection_observations WHERE inspection_id = $1 AND is_current AND outcome = 'FAIL'`, [row.id])).rows.map((o) => o.id);
    const nc = await createNonconformance(client, c, { inspectionId: row.id, sourceType: row.source_type, sourceId: row.source_id, itemId: row.item_id, supplierId: row.supplier_id, batchId: row.batch_id,
      severity: input.nonconformance.severity ?? (row.critical_failure ? "critical" : "major"), category: "incoming_inspection",
      description: text(input.nonconformance.description, 4000) || `Inspection ${row.inspection_number}: ${reason}`, detectedQuantity: String(reject + reinspect + rework + hold),
      affectedQuantity: String(reject + reinspect + rework + hold || population), ownerUserId: input.nonconformance.ownerUserId });
    nonconformanceId = nc.id;
    if (failed.length) await client.query(`UPDATE tenant.quality_nonconformances SET observation_ids = $2 WHERE id = $1`, [nc.id, failed]);
  }

  // A reinspection of the exact quantity, under the original standard or the version in force now (the choice is kept).
  let reinspectionId = null;
  if (reinspect > EPS || rework > EPS) {
    const open = (await client.query(`SELECT inspection_number FROM tenant.quality_inspections WHERE reinspection_of_id = $1 AND workflow_status NOT IN ('COMPLETED', 'CANCELLED')`, [row.id])).rows[0];
    if (open) throw inError(409, "QUALITY_INCOMING_STATE", `Reinspection ${open.inspection_number} is still open.`);
    const standard = input.reinspection?.standard === "CURRENT" ? "CURRENT" : "ORIGINAL";
    let versionId = row.spec_version_id;
    if (standard === "CURRENT") {
      const current = (await client.query(`SELECT v2.id FROM tenant.quality_inspection_spec_versions v JOIN tenant.quality_inspection_spec_versions v2 ON v2.specification_id = v.specification_id
          WHERE v.id = $1 AND v2.status = 'ACTIVE' ORDER BY v2.version_number DESC LIMIT 1`, [row.spec_version_id])).rows[0];
      if (!current) throw inError(409, "QUALITY_INCOMING_SPEC_MISSING", "The specification has no active version now: reinspect under the original standard.");
      versionId = current.id;
    }
    const planId = versionId === row.spec_version_id ? row.plan_id : await ensureMirrorPlan(client, c, versionId);
    const created = await createInspection(client, { ...c, permissions: [...(c.permissions ?? []), "quality.inspect"] }, {
      planId, inspectionType: row.inspection_type, sourceType: row.source_type, sourceId: row.source_id, itemId: row.item_id, supplierId: row.supplier_id, warehouseId: row.warehouse_id,
      batchId: row.batch_id, lotQuantity: String(reinspect || rework), goodsReceiptLineId: row.goods_receipt_line_id, priority: row.priority,
      population: { controlled: String(reinspect || rework), reinspectionOf: row.inspection_number, afterRework: rework > EPS },
      specResolution: { method: rework > EPS ? "REWORK_REINSPECTION" : "REINSPECTION", of: row.inspection_number, standard },
    }, { boundVersionId: versionId, allowPendingSample: true, obligationId: null, qcpVersionId: row.qcp_version_id, reinspectionOfId: row.id,
      reinspectionReason: text(input.reinspection?.reason, 1000) || (rework > EPS ? `After rework: ${text(input.reworkInstruction, 500)}` : reason), standardDecision: standard });
    reinspectionId = created.id;
    if (preDispatch) {
      const { copyDispatchContext } = await import("../dispatch/pd-engine.js");
      await copyDispatchContext(client, c, row.id, reinspectionId);
    }
    if (production) {
      const { copyContextForReinspection } = await import("../inprocess/ip-engine.js");
      await copyContextForReinspection(client, c, row.id, reinspectionId, { rework: rework > EPS, instruction: rework > EPS ? text(input.reworkInstruction, 1000) : null });
    }
    // The reinspection carries the same requirement (one open inspection per requirement: the original is completed).
    if (row.obligation_id) await client.query(`UPDATE tenant.quality_inspections SET obligation_id = $2 WHERE id = $1`, [reinspectionId, row.obligation_id]);
    await recordEvent(client, c, "inspection", reinspectionId, "quality.incoming.reinspection_created", { of: row.id, quantity: reinspect || rework, standard, rework: rework > EPS });
  }

  const number = await nextDocumentNumber(client, c, { documentType: "quality_disposition", prefix: "QD" });
  const disposition = (await client.query(
    `INSERT INTO tenant.quality_dispositions (organization_id, disposition_number, inspection_id, obligation_id, decision, accept_quantity, conditional_quantity, reject_quantity, reinspect_quantity,
       hold_quantity, reject_route, reason, conditions, evidence_reference, nonconformance_id, reinspection_id, decided_by, idempotency_key, rework_quantity, rework_instruction)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) RETURNING *`,
    [c.organizationId, number, row.id, row.obligation_id, decision, accept, conditional, reject, reinspect, hold, route, reason, textOrNull(input.conditions, 2000),
      textOrNull(input.evidenceReference, 500), nonconformanceId, reinspectionId, c.userId ?? null, key, rework, rework > EPS ? textOrNull(input.reworkInstruction, 1000) : null])).rows[0];

  // The inspection, its root (what Procurement and the stock hold read) and the control point requirement.
  const after = await inspectionTotals(client, row.id);
  await client.query(`UPDATE tenant.quality_inspections SET disposition_status = $2, updated_at = now(), row_version = row_version + 1 WHERE id = $1`,
    [row.id, after.decided + EPS >= population ? "DECIDED" : after.decided > EPS ? "PARTIAL" : "NONE"]);
  const root = await rootOf(client, row);
  const family = (await client.query(`WITH RECURSIVE chain AS (SELECT id FROM tenant.quality_inspections WHERE id = $1
      UNION ALL SELECT i.id FROM tenant.quality_inspections i JOIN chain ON i.reinspection_of_id = chain.id) SELECT id FROM chain`, [root.id])).rows.map((r) => r.id);
  const sums = (await client.query(`SELECT COALESCE(sum(accept_quantity), 0) AS accept, COALESCE(sum(conditional_quantity), 0) AS conditional, COALESCE(sum(reject_quantity), 0) AS reject
      FROM tenant.quality_dispositions WHERE inspection_id = ANY($1::uuid[])`, [family])).rows[0];
  const accepted = round6(Number(sums.accept) + Number(sums.conditional));
  const rejected = round6(Number(sums.reject));
  const legacy = rejected > EPS ? "failed" : Number(sums.conditional) > EPS ? "conditionally_accepted" : accepted > EPS ? "passed" : root.status;
  await client.query(`UPDATE tenant.quality_inspections SET accepted_quantity = $2, rejected_quantity = $3, status = $4, updated_at = now() WHERE id = $1`, [root.id, accepted, rejected, legacy]);
  if (row.id !== root.id) await client.query(`UPDATE tenant.quality_inspections SET accepted_quantity = $2, rejected_quantity = $3, status = $4 WHERE id = $1`,
    [row.id, round6(after.accept + after.conditional), after.reject, after.reject > EPS ? "failed" : after.conditional > EPS ? "conditionally_accepted" : after.accept > EPS ? "passed" : row.status]);
  if (row.obligation_id) {
    const ob = (await client.query(`SELECT * FROM tenant.quality_inspection_obligations WHERE id = $1 FOR UPDATE`, [row.obligation_id])).rows[0];
    const complete = accepted + rejected + EPS >= Number(ob.controlled_quantity);
    await client.query(`UPDATE tenant.quality_inspection_obligations SET allowance_quantity = $2, accepted_quantity = $2, rejected_quantity = $3, status = $4, outcome_label = $5,
        resolved_at = CASE WHEN $6 THEN clock_timestamp() ELSE resolved_at END, resolved_by = CASE WHEN $6 THEN $7 ELSE resolved_by END, updated_at = clock_timestamp(), row_version = row_version + 1
      WHERE id = $1`, [ob.id, accepted, rejected, complete ? (rejected > EPS ? "FAILED" : "SATISFIED") : "PENDING",
        complete ? (rejected > EPS ? (accepted > EPS ? "Partly accepted" : "Rejected") : "Accepted") : `Decided ${round6(accepted + rejected)} of ${Number(ob.controlled_quantity)}`, complete, c.userId ?? null]);
  }
  if (row.source_id && row.item_id && !preDispatch) {
    const { noteInspectionOnHold } = await import("../../stock/quality-holds.js");
    await noteInspectionOnHold(client, c, { sourceDocumentId: row.source_id, itemId: row.item_id, result: rejected > EPS ? (accepted > EPS ? "partial_pass" : "fail") : "pass",
      inspectionNumber: row.inspection_number, accepted, rejected });
  }
  await recordEvent(client, c, "inspection", row.id, "quality.incoming.disposition", { number, decision, accept, conditional, reject, reinspect, rework, hold, route, reason });

  // Carried out now only for someone allowed in Procurement / Inventory; otherwise it waits for them.
  const effects = { released: null, rejectionId: null, waiting: [] };
  const receiptHeld = root.source_type === "procurement_receipt" ? (await client.query(`SELECT d.*, l.conversion_factor FROM tenant.goods_receipt_dispositions d
      JOIN tenant.goods_receipt_lines l ON l.id = d.goods_receipt_line_id WHERE d.organization_id = $1 AND d.quality_inspection_id = $2`, [c.organizationId, root.id])).rows[0] : null;
  if (reject > EPS && route && route !== "HOLD" && receiptHeld) {
    if (has(c, "procurement.rejections.quality")) {
      const { createRejectionFromQualityInspection } = await import("../../procurement/purchase-orders/rejections.js");
      const opened = await createRejectionFromQualityInspection(client, c, root.id, { description: `${number}: ${reason}`, expectedResolution: route === "SCRAP" ? "disposal" : "purchase_return" });
      effects.rejectionId = opened.id;
      await client.query(`UPDATE tenant.quality_dispositions SET rejection_id = $2 WHERE id = $1`, [disposition.id, opened.id]);
    } else effects.waiting.push("Procurement opens the rejection case");
  }
  if (accept + conditional > EPS && receiptHeld) {
    if (input.applyToStock && has(c, "procurement.receipts.release")) {
      const { releaseHeldGoods } = await import("../../procurement/purchase-orders/receipts.js");
      const quantity = round6((accept + conditional) / Number(receiptHeld.conversion_factor || 1));
      effects.released = await releaseHeldGoods(client, c, receiptHeld.id, { quantity: String(quantity), note: `${number}: ${decision.toLowerCase().replace(/_/g, " ")} — ${reason}` });
    } else effects.waiting.push("Inventory releases the accepted quantity");
  }
  // Production output: Manufacturing records the scrap as its own quality decision (only for someone allowed to finalize production quality,
  // otherwise it waits for them); what Quality cleared is accepted at the final inspection, up to the clearance.
  if (production) {
    const ctx = (await client.query(`SELECT production_entry_id FROM tenant.quality_inprocess_contexts WHERE inspection_id = $1`, [row.id])).rows[0];
    if (reject > EPS && route === "SCRAP" && ctx?.production_entry_id) {
      if (has(c, "manufacturing.qi.finalize")) {
        const { recordInProcessScrap } = await import("../../manufacturing/quality/qi-service.js");
        const made = await recordInProcessScrap(client, c, { entryId: ctx.production_entry_id, quantity: String(reject), reason, reference: number, idempotencyKey: `qd:${disposition.id}` });
        effects.manufacturingDecisionId = made.decisionId;
        await client.query(`UPDATE tenant.quality_dispositions SET manufacturing_decision_id = $2 WHERE id = $1`, [disposition.id, made.decisionId]);
      } else effects.waiting.push("Manufacturing records the scrap");
    }
    // A final inspection's acceptance is Manufacturing's acceptance of the output (then received as finished goods) — recorded at once for
    // someone allowed to finalize production quality; an in-process clearance only lets the output go on.
    if (accept + conditional > EPS && row.inspection_type === "final" && ctx?.production_entry_id) {
      if (has(c, "manufacturing.qi.finalize")) {
        // Only what every blocking requirement on the output allows: another required check still open keeps the rest waiting (its own
        // disposition accepts it later, up to the same common clearance).
        const { productionAllowance } = await import("../inprocess/ip-engine.js");
        const gate = await productionAllowance(client, c, ctx.production_entry_id);
        const acceptedSoFar = Number((await client.query(`SELECT COALESCE(sum(accepted_quantity), 0) AS q FROM tenant.manufacturing_quality_decisions WHERE organization_id = $1 AND production_entry_id = $2`,
          [c.organizationId, ctx.production_entry_id])).rows[0].q);
        const pendingOutput = Number((await client.query(`SELECT pending_remaining - COALESCE(quality_hold_quantity, 0) AS q FROM tenant.manufacturing_production_entries WHERE id = $1`, [ctx.production_entry_id])).rows[0].q);
        const room = round6(Math.min(gate ? gate.allowance - acceptedSoFar : accept + conditional, pendingOutput));
        const now = round6(Math.min(accept + conditional, room));
        if (now > EPS) {
          const { recordQualityAcceptance } = await import("../../manufacturing/quality/qi-service.js");
          const made = await recordQualityAcceptance(client, c, { entryId: ctx.production_entry_id, quantity: String(now), reason, reference: number, idempotencyKey: `qa:${disposition.id}` });
          effects.acceptedDecisionId = made.decisionId;
        }
        if (now < accept + conditional - EPS) effects.waiting.push("Another required check still holds the output: Manufacturing accepts the rest once it clears");
      } else effects.waiting.push("Manufacturing accepts the cleared quantity, then receives it as finished goods");
    } else if (accept + conditional > EPS) effects.waiting.push("Manufacturing accepts the cleared quantity at the final inspection");
    if (rework > EPS) effects.waiting.push("Production reworks the units, then confirms the rework for reinspection");
  }
  // A delivery line: it leaves only up to what Quality cleared; rejected units go onto an Inventory quality hold.
  if (preDispatch) {
    if (reject > EPS) {
      const { holdRejectedUnits } = await import("../dispatch/pd-engine.js");
      const held = await holdRejectedUnits(client, c, { inspection: row, disposition, quantity: reject, reason });
      effects.stockHoldId = held.holdId;
      if (held.waiting) effects.waiting.push(held.waiting);
      else await recordEvent(client, c, "inspection", row.id, "quality.dispatch.rejected_on_hold", { disposition: number, quantity: reject, holdId: held.holdId });
    }
    if (accept + conditional > EPS) effects.waiting.push("The delivery is dispatched up to the cleared quantity");
  }
  return { id: disposition.id, number, effects, reinspectionId, nonconformanceId };
}
