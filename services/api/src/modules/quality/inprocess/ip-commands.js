// Quality — In-Process Inspection: the commands of its own (the rest is the shared engine in ../incoming).
//   request        an authorized manual / exception inspection of exact reported output (a suspected tool misalignment): bound to the
//                  specification in force for the product's in-process stage, once per request; it does not restrict production by itself.
//   confirmRework  production confirms the rework a disposition asked for, so the linked reinspection can start (the reference names the
//                  rework instruction or order). Quality never changes production quantities here.
import { recordEvent } from "../common.js";
import { createInspection } from "../inspections.js";
import { ensureMirrorPlan } from "../specifications/qs-resolver.js";
import { FP, IP, has, inError, need, text, uuid } from "../incoming/in-rules.js";
import { insertContext } from "./ip-engine.js";

const dayOf = (v) => (v instanceof Date ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}` : String(v).slice(0, 10));

// input: { productionEntryId, quantity?, operationLabel?, reason, priority?, idempotencyKey? }
export const requestInProcessInspection = (client, c, input = {}) => requestProductionInspection(client, c, input, { final: false });
// A final inspection requested by hand: of finished output still awaiting inspection (it does not restrict stock already accepted or received).
export const requestFinalInspection = (client, c, input = {}) => requestProductionInspection(client, c, input, { final: true });
async function requestProductionInspection(client, c, input, { final }) {
  need(c, final ? FP.create : IP.create);
  const key = text(input.idempotencyKey, 200) || null;
  if (key) {
    const prior = (await client.query(`SELECT id FROM tenant.quality_inspections WHERE organization_id = $1 AND idempotency_key = $2`, [c.organizationId, `ipmanual:${key}`])).rows[0];
    if (prior) return { id: prior.id, replayed: true };
  }
  const entry = (await client.query(`SELECT * FROM tenant.manufacturing_production_entries WHERE organization_id = $1 AND id = $2`, [c.organizationId, uuid(input.productionEntryId, "Production entry")])).rows[0];
  if (!entry) throw inError(400, "QUALITY_IPQC_PRODUCTION_INVALID", "Select reported output of a Production Order.");
  if (entry.status !== "REPORTED") throw inError(409, "QUALITY_IPQC_WIP_INVALID", `${entry.entry_number} is not reported output.`);
  const order = (await client.query(`SELECT * FROM tenant.manufacturing_orders WHERE organization_id = $1 AND id = $2`, [c.organizationId, entry.manufacturing_order_id])).rows[0];
  if (!["IN_PROGRESS", "ON_HOLD", "COMPLETED"].includes(order.status)) throw inError(409, "QUALITY_IPQC_PRODUCTION_INVALID", `${order.mo_number} is not in production.`);
  const reason = text(input.reason, 1000);
  if (!reason) throw inError(400, "QUALITY_INCOMING_REASON_REQUIRED", "Say why the inspection is requested.");
  const quantity = input.quantity === undefined || input.quantity === null || input.quantity === "" ? Number(entry.reported_quantity) : Number(input.quantity);
  if (!(quantity > 0) || quantity > Number(entry.reported_quantity) + 1e-9) throw inError(400, "QUALITY_IPQC_WIP_INVALID", `Inspect between 1 and the ${Number(entry.reported_quantity)} units ${entry.entry_number} reported.`);
  const batch = entry.production_batch_id ? (await client.query(`SELECT * FROM tenant.manufacturing_production_batches WHERE id = $1`, [entry.production_batch_id])).rows[0] : null;
  const { specificationForSource } = await import("../specifications/qs-resolver.js");
  const found = await specificationForSource(client, c, { stage: final ? "FINAL" : "IN_PROCESS", itemId: order.finished_item_id, supplierId: null, warehouseId: order.manufacturing_warehouse_id,
    date: dayOf(entry.produced_at ?? new Date()), quantity: String(quantity), sourceType: "production_entry", sourceId: entry.id, sourceLineId: entry.id, sourceLabel: `${order.mo_number} ${entry.entry_number}` });
  if (found.status !== "RESOLVED") throw inError(409, final ? "QUALITY_FINAL_SPEC_MISSING" : "QUALITY_IPQC_SPEC_MISSING");
  const planId = found.planId ?? await ensureMirrorPlan(client, c, found.versionId);
  const created = await createInspection(client, { ...c, permissions: [...(c.permissions ?? []), "quality.inspect"] }, {
    planId, inspectionType: final ? "final" : "in_process", sourceType: "production_entry", sourceId: entry.id, itemId: order.finished_item_id, warehouseId: order.manufacturing_warehouse_id,
    lotQuantity: String(quantity), priority: input.priority, specResolution: { ...found.resolution, manual: true, reason },
    population: { controlled: String(quantity), manual: true, entry: entry.entry_number, run: batch?.batch_reference ?? null },
  }, { boundVersionId: found.versionId, allowPendingSample: true });
  await insertContext(client, c, created.id, { order, batch, entry, checkpoint: { type: "MANUAL", sequence: null, key: `ipmanual:${key ?? created.id}` },
    operation: text(input.operationLabel, 120) || null, quantity });
  if (key) await client.query(`UPDATE tenant.quality_inspections SET idempotency_key = $2 WHERE id = $1`, [created.id, `ipmanual:${key}`]);
  await recordEvent(client, c, "inspection", created.id, "quality.inprocess.created_manually", { reason, entry: entry.entry_number });
  return { id: created.id };
}

// input: { reference, note? }
export async function confirmInProcessRework(client, c, inspectionId, input = {}) {
  if (!has(c, "manufacturing.production.post") && !has(c, "manufacturing.mo.record_production")) throw inError(403, "QUALITY_IPQC_PERMISSION_DENIED", "Production confirms the rework it carried out.");
  const ctx = (await client.query(`SELECT ctx.*, i.workflow_status, i.inspection_number, i.inspection_type FROM tenant.quality_inprocess_contexts ctx JOIN tenant.quality_inspections i ON i.id = ctx.inspection_id
      WHERE ctx.organization_id = $1 AND ctx.inspection_id = $2 FOR UPDATE OF ctx`, [c.organizationId, uuid(inspectionId, "Inspection")])).rows[0];
  if (!ctx) throw inError(404, "QUALITY_INCOMING_NOT_FOUND");
  if (!ctx.rework_required) throw inError(409, "QUALITY_INCOMING_STATE", "This inspection does not wait for a rework.");
  if (ctx.rework_completed_at) return { id: inspectionId, replayed: true };
  if (ctx.workflow_status === "CANCELLED") throw inError(409, "QUALITY_INCOMING_STATE");
  const reference = text(input.reference, 200);
  if (!reference) throw inError(400, "QUALITY_INCOMING_REASON_REQUIRED", "Name the rework carried out (instruction, order or note).");
  await client.query(`UPDATE tenant.quality_inprocess_contexts SET rework_reference = $2, rework_completed_at = clock_timestamp(), rework_completed_by = $3 WHERE inspection_id = $1`,
    [inspectionId, reference, c.userId ?? null]);
  await recordEvent(client, c, "inspection", inspectionId, "quality.inprocess.rework_confirmed", { reason: `${reference}${text(input.note, 500) ? ` — ${text(input.note, 500)}` : ""}` });
  const { notifyPermissionHolders } = await import("../../../core/platform/notifications/index.js");
  await notifyPermissionHolders(client, c, ctx.inspection_type === "final" ? FP.start : IP.start, { category: "quality_issue", title: `Reinspection ${ctx.inspection_number} can start`, message: `Rework done: ${reference}`,
    href: `/quality/${ctx.checkpoint_type === "FINAL_OUTPUT" || ctx.inspection_type === "final" ? "final" : "in-process"}/${inspectionId}`, entityType: "quality_inspection", entityId: inspectionId }).catch(() => null);
  return { id: inspectionId };
}
