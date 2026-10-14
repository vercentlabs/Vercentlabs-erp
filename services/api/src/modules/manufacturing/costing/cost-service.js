// Production Costing — the commands: the planned-cost estimate frozen at release (re-estimates are new versions), labor and overhead applied to
// work in progress at the rates in force — each piece once (accepted units up to the accepted output, each real production batch once, each
// slice of consumed material cost once) and posted to work in progress against its applied account; the pending application a receipt
// makes before it values finished goods; controlled cost adjustments requested and approved by someone else; reconciliation of the
// order's work in progress with Finance; and the order's costing finalized once that is zero and reconciled.
import { randomUUID } from "node:crypto";

import { loadMaterials, nextNumber, postJournal, wipBalance } from "../orders/mo-core.js";
import {
  APPLIED_ACCOUNT, COMPONENT_LABEL, COST, D, MO, ZERO, add, consumedCost, costError, costEvent, costSettings, estimateFor, freezeOrderRates, frozenRatesOf, has, loadCostOrder, max, money, mul,
  needCost, needCostView, q, rateProblems, ratesFor, sub, text, uuid, div,
} from "./cost-core.js";

// ------------------------------------------------------------------ estimates
// kind RELEASE_BASELINE (once, at release) or REESTIMATE (a new version; the baseline stays).
export async function snapshotCostEstimate(client, c, order, { kind = "RELEASE_BASELINE" } = {}) {
  if (kind === "RELEASE_BASELINE") {
    const existing = (await client.query(`SELECT id FROM tenant.manufacturing_cost_estimates WHERE organization_id = $1 AND manufacturing_order_id = $2 AND kind = 'RELEASE_BASELINE'`,
      [c.organizationId, order.id])).rows[0];
    if (existing) return existing.id;
  }
  if (kind === "RELEASE_BASELINE") await freezeOrderRates(client, c, order);
  const estimate = await estimateFor(client, c, order, await loadMaterials(client, c, order.id));
  const version = Number((await client.query(`SELECT COALESCE(max(version), 0) AS n FROM tenant.manufacturing_cost_estimates WHERE manufacturing_order_id = $1`, [order.id])).rows[0].n) + 1;
  const currency = (await client.query(`SELECT base_currency FROM public.organizations WHERE id = $1`, [c.organizationId])).rows[0]?.base_currency?.trim() || "INR";
  const id = randomUUID();
  await client.query(
    `INSERT INTO tenant.manufacturing_cost_estimates (id, organization_id, manufacturing_order_id, version, kind, bom_revision_id, bom_snapshot_id, planned_output_quantity, planned_batches, material_cost,
       labor_cost, overhead_cost, total_cost, unit_cost, lines, policy, policy_hash, currency_code, complete, missing, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16::jsonb,$17,$18,$19,$20::jsonb,$21)`,
    [id, c.organizationId, order.id, version, kind, order.bom_revision_id ?? null, order.bom_snapshot_id ?? null, q(estimate.planned), estimate.batches,
      estimate.material === null ? null : money(estimate.material), estimate.labor === null ? null : money(estimate.labor), estimate.overhead === null ? null : money(estimate.overhead),
      estimate.total === null ? null : money(estimate.total), estimate.unit === null ? null : q(estimate.unit), JSON.stringify(estimate.lines), JSON.stringify(estimate.policy), estimate.policyHash,
      currency, estimate.missing.length === 0, JSON.stringify(estimate.missing), c.userId ?? null]);
  await costEvent(client, c, order.id, kind === "RELEASE_BASELINE" ? "BASELINE_ESTIMATED" : "REESTIMATED", { amount: estimate.total,
    summary: `Version ${version}: ${estimate.total === null ? `incomplete (${estimate.missing.join(", ")})` : `₹${money(estimate.total)}`}` });
  return id;
}
export async function reestimateManufacturingCost(client, c, orderId) {
  needCost(c, COST.estimate);
  const order = await loadCostOrder(client, c, orderId, { lock: true });
  if (["DRAFT", "AWAITING_APPROVAL", "CANCELLED"].includes(order.status)) throw costError(409, "MFG_COST_ESTIMATE_UNAVAILABLE", "An order is estimated once it is released.");
  const id = await snapshotCostEstimate(client, c, order, { kind: order.status === "RELEASED" && !(await hasBaseline(client, c, order.id)) ? "RELEASE_BASELINE" : "REESTIMATE" });
  return { orderId: order.id, estimateId: id };
}
const hasBaseline = async (client, c, orderId) => Boolean((await client.query(`SELECT 1 FROM tenant.manufacturing_cost_estimates WHERE organization_id = $1 AND manufacturing_order_id = $2 AND kind = 'RELEASE_BASELINE'`,
  [c.organizationId, orderId])).rows[0]);
// Release checks: an enabled labor or overhead component needs its rate before the order goes ahead.
export async function releaseCostProblems(client, c, order) {
  return rateProblems(await costSettings(client, c), await ratesFor(client, c, order.finished_item_id));
}
// At release: the rates in force are frozen for the order (its baseline uses them).
export { freezeOrderRates };

// ------------------------------------------------------------------ applying labor and overhead
// Keys carry the rate's application count: computed under the order's lock, a piece is unique to the state it was computed from.
// What each frozen rate would apply now: pieces to APPLY (more output, another real batch, more consumed material) or to REVERSE (output
// corrected below what was applied) — { orderRate, component, pieces: [{ direction, batchId?, quantity, amount, key }] }.
const consumedTotal = async (client, c, order) => (await consumedCost(client, c, order.id)).total;
export async function pendingApplications(client, c, order) {
  const settings = await costSettings(client, c);
  if (!settings.LABOR && !settings.OVERHEAD) return [];
  let frozen = await frozenRatesOf(client, c, order);
  // An order released before rates were frozen takes the rates in force now, marked late (and visible as such).
  if (!frozen.length && !["DRAFT", "AWAITING_APPROVAL"].includes(order.status)) {
    const resolved = await ratesFor(client, c, order.finished_item_id);
    if ((settings.LABOR && !resolved.LABOR) || (settings.OVERHEAD && !resolved.OVERHEAD.length)) {
      return [{ component: settings.LABOR && !resolved.LABOR ? "LABOR" : "OVERHEAD", missing: true, pieces: [] }];
    }
    frozen = await freezeOrderRates(client, c, order, { late: true });
  }
  const applied = (await client.query(`SELECT order_rate_id, direction, production_batch_id, basis_quantity FROM tenant.manufacturing_cost_applications WHERE organization_id = $1 AND manufacturing_order_id = $2`,
    [c.organizationId, order.id])).rows;
  const out = [];
  for (const rate of frozen) {
    if (!settings[rate.component]) continue;
    const mine = applied.filter((row) => row.order_rate_id === rate.id);
    const net = mine.reduce((sum, row) => (row.direction === "APPLY" ? add(sum, D(row.basis_quantity)) : sub(sum, D(row.basis_quantity))), ZERO);
    const pieces = [];
    const value = D(rate.rate);
    if (rate.basis === "PER_GOOD_UNIT") {
      const accepted = D(order.accepted_quantity);
      const delta = sub(accepted, net);
      if (delta > ZERO) pieces.push({ direction: "APPLY", quantity: delta, amount: D(money(mul(delta, value))), key: `mca:${rate.id}:u${q(accepted)}:n${mine.length}` });
      if (delta < ZERO) pieces.push({ direction: "REVERSE", quantity: sub(ZERO, delta), amount: D(money(mul(sub(ZERO, delta), value))), key: `mcr:${rate.id}:u${q(accepted)}:n${mine.length}` });
    } else if (rate.basis === "PER_BATCH") {
      // A real batch: its setup confirmed, or output reported in it. An empty draft batch earns nothing.
      const batches = (await client.query(
        `SELECT batch.id FROM tenant.manufacturing_production_batches batch WHERE batch.organization_id = $1 AND batch.manufacturing_order_id = $2
            AND (batch.setup_confirmed_at IS NOT NULL OR EXISTS (SELECT 1 FROM tenant.manufacturing_production_entries entry WHERE entry.production_batch_id = batch.id AND entry.status = 'REPORTED'))
          ORDER BY batch.started_at`, [c.organizationId, order.id])).rows.map((row) => row.id);
      const done = new Set(mine.filter((row) => row.direction === "APPLY" && row.production_batch_id).map((row) => row.production_batch_id));
      for (const batchId of batches.filter((id) => !done.has(id))) pieces.push({ direction: "APPLY", batchId, quantity: 1_000_000n, amount: D(money(value)), key: `mca:${rate.id}:b${batchId}` });
    } else {
      const consumed = await consumedTotal(client, c, order);
      if (consumed === null) { out.push({ orderRate: rate, component: rate.component, missingValuation: true, pieces: [] }); continue; }
      const delta = sub(consumed, net);
      const amountOf = (base) => D(money(div(mul(base, value), 100n * 1_000_000n)));
      if (delta > ZERO) pieces.push({ direction: "APPLY", quantity: delta, amount: amountOf(delta), key: `mca:${rate.id}:m${money(consumed)}:n${mine.length}` });
      if (delta < ZERO) pieces.push({ direction: "REVERSE", quantity: sub(ZERO, delta), amount: amountOf(sub(ZERO, delta)), key: `mcr:${rate.id}:m${money(consumed)}:n${mine.length}` });
    }
    out.push({ orderRate: rate, component: rate.component, pieces });
  }
  return out;
}
// The accounts an application posts to must be mapped before anything posts.
async function requireMappings(client, c, components) {
  const keys = ["wip", ...components.map((component) => APPLIED_ACCOUNT[component])];
  const found = new Set((await client.query(`SELECT DISTINCT mapping_key FROM tenant.accounting_account_mappings WHERE organization_id = $1 AND status = 'active' AND mapping_key = ANY($2::text[])`,
    [c.organizationId, keys])).rows.map((row) => row.mapping_key));
  const missing = keys.filter((key) => !found.has(key));
  if (missing.length) throw costError(409, "MFG_OH_FINANCE_MAPPING_MISSING", `Map ${missing.join(", ")} in Finance before applying production cost.`);
}
// input: { expectedMoVersion?, includeReversals?, reason? }. Under the order's lock, each piece once, posted to work in progress against its
// applied account (a reversal the other way, approved, never below what finished goods already capitalised).
export async function applyManufacturingCosts(client, c, orderId, input = {}, { system = false } = {}) {
  if (!system) needCost(c, COST.apply);
  const order = await loadCostOrder(client, c, orderId, { lock: true });
  if (input.expectedMoVersion !== undefined && input.expectedMoVersion !== null && Number(input.expectedMoVersion) !== Number(order.version)) throw costError(409, "MFG_OH_SOURCE_CHANGED");
  if (!["IN_PROGRESS", "ON_HOLD", "COMPLETION_PENDING"].includes(order.status)) {
    throw costError(409, order.status === "COMPLETED" ? "MFG_COST_ALREADY_FINALIZED" : "MFG_COST_NOT_READY", `${order.mo_number} is ${order.status.toLowerCase().replace(/_/g, " ")}: costs are applied while it produces.`);
  }
  const pending = await pendingApplications(client, c, order);
  const missing = pending.filter((row) => row.missing);
  if (missing.length) throw costError(409, "MFG_OH_RATE_MISSING", "An enabled cost component has no approved rate in force for this product.");
  if (pending.some((row) => row.missingValuation)) throw costError(409, "MFG_COST_MATERIAL_VALUATION_MISSING", "Overhead on material cost needs every consumption valued by Inventory.");
  const reversing = Boolean(input.includeReversals);
  if (reversing) {
    needCost(c, COST.adjustApprove);
    if (String(input.reason ?? "").trim().length < 3) throw costError(400, "MFG_COST_REASON_REQUIRED", "Say why the over-applied cost is taken back.");
  }
  const work = pending.flatMap((entry) => entry.pieces.filter((piece) => piece.direction === "APPLY" || reversing).map((piece) => ({ entry, piece })));
  if (work.length) await requireMappings(client, c, [...new Set(work.map((row) => row.entry.component))]);
  const applied = [];
  for (const { entry, piece } of work) {
    const done = (await client.query(`SELECT id FROM tenant.manufacturing_cost_applications WHERE organization_id = $1 AND posting_key = $2`, [c.organizationId, piece.key])).rows[0];
    if (done) continue;
    const rate = entry.orderRate;
    const reverse = piece.direction === "REVERSE";
    if (reverse) {
      const current = await loadCostOrder(client, c, order.id, { lock: true });
      const remaining = sub(add(D(current.wip_applied_labor_cost), D(current.wip_applied_overhead_cost)), D(current.wip_conversion_capitalised_cost));
      if (piece.amount > remaining) throw costError(409, "MFG_COST_ALLOCATION_EXCEEDS", "Finished goods already carry this cost: correct it through a cost adjustment.");
    }
    const id = randomUUID();
    const label = `${COMPONENT_LABEL[rate.component]}${rate.category_name ? ` · ${rate.category_name}` : ""}`;
    const lines = reverse
      ? [{ mappingKey: APPLIED_ACCOUNT[rate.component], label: `${label} applied`, debit: piece.amount }, { mappingKey: "wip", label: "Work in progress", credit: piece.amount }]
      : [{ mappingKey: "wip", label: "Work in progress", debit: piece.amount }, { mappingKey: APPLIED_ACCOUNT[rate.component], label: `${label} applied`, credit: piece.amount }];
    const journal = piece.amount > ZERO ? await postJournal(client, c, { event: "manufacturing_cost_application", sourceType: "manufacturing_cost_application", sourceId: id, sourceNumber: order.mo_number,
      reference: `${order.mo_number} · ${label}`, description: `${label} ${reverse ? "taken back from" : "applied to"} ${order.mo_number}`, lines }) : null;
    await client.query(
      `INSERT INTO tenant.manufacturing_cost_applications (id, organization_id, manufacturing_order_id, order_rate_id, component, category_id, basis, direction, rate_id, rate_version, rate,
         production_batch_id, basis_quantity, amount, posting_key, journal_entry_id, finance_status, reason, applied_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
      [id, c.organizationId, order.id, rate.id, rate.component, rate.category_id ?? null, rate.basis, piece.direction, rate.rate_id, rate.rate_version, q(D(rate.rate)), piece.batchId ?? null,
        q(piece.quantity), money(piece.amount), piece.key, journal, journal ? "POSTED" : "NOT_REQUIRED", reverse ? String(input.reason).trim().slice(0, 500) : null, c.userId ?? null]);
    const column = rate.component === "LABOR" ? "wip_applied_labor_cost" : "wip_applied_overhead_cost";
    await client.query(`UPDATE tenant.manufacturing_orders SET ${column} = ${column} ${reverse ? "-" : "+"} $3, version = version + 1 WHERE organization_id = $1 AND id = $2`, [c.organizationId, order.id, money(piece.amount)]);
    const what = rate.basis === "PER_BATCH" ? "one production batch" : rate.basis === "PER_GOOD_UNIT" ? `${q(piece.quantity)} accepted unit(s)` : `₹${money(piece.quantity)} of consumed material`;
    await costEvent(client, c, order.id, reverse ? "COST_REVERSED" : "COST_APPLIED", { amount: piece.amount,
      summary: `${label}: ${what} at ${q(D(rate.rate))}${rate.basis === "PCT_OF_MATERIAL" ? "%" : ""} (${rate.rate_code} v${rate.rate_version})${reverse ? ` — ${String(input.reason).trim()}` : ""}`,
      details: { applicationId: id, journal } });
    applied.push({ id, component: rate.component, category: rate.category_name ?? null, direction: piece.direction, amount: money(piece.amount) });
  }
  const sum = (direction) => applied.filter((row) => row.direction === direction).reduce((total, row) => add(total, D(row.amount)), ZERO);
  return { orderId: order.id, applied, total: money(sub(sum("APPLY"), sum("REVERSE"))) };
}
// The preview: what applying now would post, per frozen rate, and its accounting effect — nothing is written.
export async function previewManufacturingCosts(client, c, orderId) {
  needCostView(c);
  const order = await loadCostOrder(client, c, orderId);
  const pending = ["DRAFT", "AWAITING_APPROVAL", "COMPLETED", "CANCELLED"].includes(order.status) ? [] : await pendingApplications(client, c, order);
  const lines = pending.flatMap((entry) => entry.pieces.map((piece) => ({ component: entry.component, category: entry.orderRate?.category_name ?? null, rateCode: entry.orderRate?.rate_code ?? null,
    basis: entry.orderRate?.basis ?? null, direction: piece.direction, batchId: piece.batchId ?? null, quantity: q(piece.quantity), amount: money(piece.amount) })));
  const apply = lines.filter((row) => row.direction === "APPLY").reduce((sum, row) => add(sum, D(row.amount)), ZERO);
  const reverse = lines.filter((row) => row.direction === "REVERSE").reduce((sum, row) => add(sum, D(row.amount)), ZERO);
  return { orderId: order.id, orderVersion: order.version, lines, apply: money(apply), reverse: money(reverse), effect: `Work in progress +₹${money(apply)}${reverse > ZERO ? `, −₹${money(reverse)} once a reversal is approved` : ""}`,
    missingRate: pending.some((row) => row.missing), missingValuation: pending.some((row) => row.missingValuation) };
}
// Before a receipt values finished goods (and at completion): what is due is applied first, by the system.
export async function applyCostsBeforeReceipt(client, c, order) {
  const settings = await costSettings(client, c);
  if (!settings.LABOR && !settings.OVERHEAD) return;
  await applyManufacturingCosts(client, c, order.id, {}, { system: true });
}
// A batch's setup confirmed: from now on it earns its fixed batch overhead (once), even before output is reported.
export async function confirmBatchSetup(client, c, batchId) {
  if (!has(c, "manufacturing.production.edit_draft") && !has(c, MO.record)) throw costError(403, "MFG_COST_PERMISSION_DENIED");
  const batch = (await client.query(`SELECT * FROM tenant.manufacturing_production_batches WHERE organization_id = $1 AND id = $2 FOR UPDATE`, [c.organizationId, uuid(batchId, "Batch")])).rows[0];
  if (!batch) throw costError(404, "MFG_COST_MO_NOT_FOUND", "That production batch was not found.");
  if (batch.setup_confirmed_at) return { batchId: batch.id, replayed: true };
  const order = await loadCostOrder(client, c, batch.manufacturing_order_id);
  if (!["IN_PROGRESS", "ON_HOLD"].includes(order.status)) throw costError(409, "MFG_COST_NOT_READY", `${order.mo_number} is not producing.`);
  await client.query(`UPDATE tenant.manufacturing_production_batches SET setup_confirmed_at = clock_timestamp(), setup_confirmed_by = $3 WHERE organization_id = $1 AND id = $2`, [c.organizationId, batch.id, c.userId ?? null]);
  await costEvent(client, c, order.id, "BATCH_SETUP_CONFIRMED", { summary: `${batch.batch_reference}: setup confirmed — its batch overhead is now due` });
  return { batchId: batch.id };
}

// ------------------------------------------------------------------ rates: draft → approval → in force → retired
const BASES = new Set(["PER_GOOD_UNIT", "PER_BATCH", "PCT_OF_MATERIAL"]);
async function rateFields(client, c, input, current = {}) {
  const component = String(input.component ?? current.component ?? "").toUpperCase();
  if (!["LABOR", "OVERHEAD"].includes(component)) throw costError(400, "MFG_OH_RATE_INVALID", "Choose labor or overhead.");
  const basis = String(input.basis ?? current.basis ?? "").toUpperCase();
  if (!BASES.has(basis)) throw costError(400, "MFG_OH_RATE_INVALID", "Choose how the rate is applied.");
  let categoryId = input.categoryId === undefined ? current.category_id ?? null : input.categoryId || null;
  if (component === "OVERHEAD") {
    await ensureOverheadCategories(client, c);
    if (!categoryId && input.category) categoryId = (await client.query(`SELECT id FROM tenant.manufacturing_overhead_categories WHERE organization_id = $1 AND code = $2`, [c.organizationId, String(input.category).toUpperCase()])).rows[0]?.id ?? null;
    if (!categoryId) throw costError(400, "MFG_OH_RATE_INVALID", "Choose the overhead category.");
    if (!(await client.query(`SELECT 1 FROM tenant.manufacturing_overhead_categories WHERE organization_id = $1 AND id = $2 AND status = 'ACTIVE'`, [c.organizationId, uuid(categoryId, "Category")])).rows[0]) {
      throw costError(400, "MFG_OH_RATE_INVALID", "That overhead category was not found.");
    }
  } else categoryId = null;
  const rate = String(input.rate ?? current.rate ?? "").trim();
  if (!/^\d+(\.\d+)?$/.test(rate) || (basis === "PCT_OF_MATERIAL" && Number(rate) > 1000)) throw costError(400, "MFG_OH_RATE_INVALID");
  const zeroReason = String(input.zeroReason ?? current.zero_reason ?? "").trim() || null;
  if (Number(rate) === 0 && (!zeroReason || zeroReason.length < 3)) throw costError(400, "MFG_OH_RATE_INVALID", "A zero rate is set deliberately: say why.");
  const itemId = input.finishedItemId === undefined ? current.finished_item_id ?? null : input.finishedItemId ? uuid(input.finishedItemId, "Product") : null;
  let uomId = input.uomId === undefined ? current.uom_id ?? null : input.uomId || null;
  if (itemId) {
    const item = (await client.query(`SELECT uom_id FROM tenant.items WHERE organization_id = $1 AND id = $2`, [c.organizationId, itemId])).rows[0];
    if (!item) throw costError(400, "MFG_OH_RATE_INVALID", "That product was not found.");
    if (basis === "PER_GOOD_UNIT") {
      if (uomId && uomId !== item.uom_id) throw costError(400, "MFG_OH_RATE_INVALID", "A per-unit rate is per the product's base unit.");
      uomId = item.uom_id;
    }
  }
  if (basis === "PER_GOOD_UNIT" && !uomId && itemId) throw costError(400, "MFG_OH_RATE_INVALID", "Name the unit the rate is per.");
  if (basis !== "PER_GOOD_UNIT") uomId = null;
  const day = (value, fallback) => (value === undefined ? fallback : value ? String(value).slice(0, 10) : null);
  const from = day(input.effectiveFrom, current.effective_from ? isoDate(current.effective_from) : null) ?? (await client.query(`SELECT to_char(current_date, 'YYYY-MM-DD') AS d`)).rows[0].d;
  const until = day(input.effectiveUntil, current.effective_until ? isoDate(current.effective_until) : null);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || (until && (!/^\d{4}-\d{2}-\d{2}$/.test(until) || until < from))) throw costError(400, "MFG_OH_RATE_INVALID", "Check the dates: the rate ends on or after it starts.");
  const categoryName = categoryId ? (await client.query(`SELECT name FROM tenant.manufacturing_overhead_categories WHERE id = $1`, [categoryId])).rows[0].name : null;
  const name = String(input.name ?? current.name ?? "").trim() || (component === "LABOR" ? "Direct labor" : categoryName);
  return { component, basis, categoryId, rate, zeroReason, itemId, uomId, from, until, name, notes: input.notes === undefined ? current.notes ?? null : String(input.notes ?? "").trim() || null };
}
const isoDate = (value) => (value instanceof Date ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}` : String(value).slice(0, 10));
// Another rate in force for the same component, category and product whose dates overlap. Approvals of one slot are serialized, so two
// overlapping rates approved at once never both come into force.
async function overlapOf(client, c, fields, exceptId) {
  await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`mcr:${c.organizationId}:${fields.component}:${fields.categoryId ?? "-"}:${fields.itemId ?? "-"}`]);
  return (await client.query(
    `SELECT id, rate_code, status, effective_from, effective_until FROM tenant.manufacturing_cost_rates WHERE organization_id = $1 AND id <> $2 AND component = $3
        AND category_id IS NOT DISTINCT FROM $4 AND finished_item_id IS NOT DISTINCT FROM $5 AND status = 'ACTIVE'
        AND effective_from <= COALESCE($7::date, 'infinity'::date) AND COALESCE(effective_until, 'infinity'::date) >= $6::date FOR UPDATE`,
    [c.organizationId, exceptId ?? "00000000-0000-0000-0000-000000000000", fields.component, fields.categoryId, fields.itemId, fields.from, fields.until])).rows;
}
// input: { component, category | categoryId, basis, rate, finishedItemId?, uomId?, effectiveFrom?, effectiveUntil?, name?, zeroReason?, notes? } — a draft.
export async function createCostRateDraft(client, c, input = {}) {
  needCost(c, COST.rateManage);
  const fields = await rateFields(client, c, input);
  const id = randomUUID();
  const number = await nextNumber(client, c, "manufacturing_cost_rate");
  await client.query(`INSERT INTO tenant.manufacturing_cost_rates (id, organization_id, rate_code, name, component, category_id, basis, rate, zero_reason, finished_item_id, uom_id, effective_from,
      effective_until, notes, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [id, c.organizationId, number, fields.name, fields.component, fields.categoryId, fields.basis, fields.rate, fields.zeroReason, fields.itemId, fields.uomId, fields.from, fields.until, fields.notes, c.userId ?? null]);
  return { rateId: id, rateCode: number, status: "DRAFT" };
}
export async function updateCostRateDraft(client, c, rateId, input = {}) {
  needCost(c, COST.rateManage);
  const row = (await client.query(`SELECT * FROM tenant.manufacturing_cost_rates WHERE organization_id = $1 AND id = $2 FOR UPDATE`, [c.organizationId, uuid(rateId, "Rate")])).rows[0];
  if (!row) throw costError(404, "MFG_OH_RATE_MISSING", "That rate was not found.");
  if (row.status !== "DRAFT") throw costError(409, "MFG_OH_RATE_INVALID", "Only a draft rate is edited; an approved rate is replaced by a new one.");
  if (input.expectedVersion !== undefined && Number(input.expectedVersion) !== row.row_version) throw costError(409, "MFG_OH_SOURCE_CHANGED", "The rate changed. Refresh it.");
  const fields = await rateFields(client, c, input, row);
  await client.query(`UPDATE tenant.manufacturing_cost_rates SET name = $3, component = $4, category_id = $5, basis = $6, rate = $7, zero_reason = $8, finished_item_id = $9, uom_id = $10, effective_from = $11,
      effective_until = $12, notes = $13, row_version = row_version + 1 WHERE organization_id = $1 AND id = $2`,
    [c.organizationId, row.id, fields.name, fields.component, fields.categoryId, fields.basis, fields.rate, fields.zeroReason, fields.itemId, fields.uomId, fields.from, fields.until, fields.notes]);
  return { rateId: row.id };
}
export async function submitCostRate(client, c, rateId) {
  needCost(c, COST.rateManage);
  const row = (await client.query(`SELECT * FROM tenant.manufacturing_cost_rates WHERE organization_id = $1 AND id = $2 FOR UPDATE`, [c.organizationId, uuid(rateId, "Rate")])).rows[0];
  if (!row) throw costError(404, "MFG_OH_RATE_MISSING", "That rate was not found.");
  if (row.status === "PENDING_APPROVAL") return { rateId: row.id, replayed: true };
  if (row.status !== "DRAFT") throw costError(409, "MFG_OH_RATE_INVALID", "Only a draft rate is submitted.");
  await client.query(`UPDATE tenant.manufacturing_cost_rates SET status = 'PENDING_APPROVAL', submitted_by = $3, submitted_at = clock_timestamp(), row_version = row_version + 1 WHERE organization_id = $1 AND id = $2`,
    [c.organizationId, row.id, c.userId ?? null]);
  return { rateId: row.id, status: "PENDING_APPROVAL" };
}
// input: { decision: APPROVE | REJECT, note?, replacePrevious? (default true) } — by someone other than who set it. Approving a rate that takes
// over from the one in force ends that one the day before (replacePrevious); any other overlap is refused.
export async function decideCostRate(client, c, rateId, input = {}) {
  needCost(c, COST.rateApprove);
  const row = (await client.query(`SELECT * FROM tenant.manufacturing_cost_rates WHERE organization_id = $1 AND id = $2 FOR UPDATE`, [c.organizationId, uuid(rateId, "Rate")])).rows[0];
  if (!row) throw costError(404, "MFG_OH_RATE_MISSING", "That rate was not found.");
  if (row.status !== "PENDING_APPROVAL") throw costError(409, "MFG_OH_RATE_INVALID", "That rate is not waiting for approval.");
  const settings = await costSettings(client, c);
  if ([row.created_by, row.submitted_by].includes(c.userId) && !settings.selfApproval) throw costError(403, "MFG_OH_PERMISSION_DENIED", "Someone other than the person who set the rate approves it.");
  const decision = String(input.decision ?? "").toUpperCase();
  const note = String(input.note ?? "").trim() || null;
  if (decision === "REJECT") {
    if (!note || note.length < 3) throw costError(400, "MFG_COST_REASON_REQUIRED", "Say why.");
    await client.query(`UPDATE tenant.manufacturing_cost_rates SET status = 'DRAFT', decision_note = $3, submitted_by = NULL, submitted_at = NULL, row_version = row_version + 1 WHERE organization_id = $1 AND id = $2`,
      [c.organizationId, row.id, note]);
    return { rateId: row.id, status: "DRAFT" };
  }
  if (decision !== "APPROVE") throw costError(400, "MFG_COST_REASON_REQUIRED", "Approve or reject.");
  const fields = { component: row.component, categoryId: row.category_id, itemId: row.finished_item_id, from: isoDate(row.effective_from), until: row.effective_until ? isoDate(row.effective_until) : null };
  const overlaps = await overlapOf(client, c, fields, row.id);
  const replace = input.replacePrevious !== false;
  for (const other of overlaps) {
    const otherFrom = isoDate(other.effective_from);
    if (replace && other.status === "ACTIVE" && !other.effective_until && otherFrom < fields.from) {
      const dayBefore = (await client.query(`SELECT to_char($1::date - 1, 'YYYY-MM-DD') AS d`, [fields.from])).rows[0].d;
      await client.query(`UPDATE tenant.manufacturing_cost_rates SET effective_until = $3 WHERE organization_id = $1 AND id = $2`, [c.organizationId, other.id, dayBefore]);
      continue;
    }
    throw costError(409, "MFG_OH_RATE_OVERLAP", `${other.rate_code} already covers part of this period.`);
  }
  const version = Number((await client.query(`SELECT COALESCE(max(version), 0) AS n FROM tenant.manufacturing_cost_rates WHERE organization_id = $1 AND component = $2 AND category_id IS NOT DISTINCT FROM $3
      AND finished_item_id IS NOT DISTINCT FROM $4 AND status IN ('ACTIVE', 'RETIRED')`, [c.organizationId, row.component, row.category_id, row.finished_item_id])).rows[0].n) + 1;
  await client.query(`UPDATE tenant.manufacturing_cost_rates SET status = 'ACTIVE', version = $3, approved_by = $4, approved_at = clock_timestamp(), decision_note = $5, row_version = row_version + 1
      WHERE organization_id = $1 AND id = $2`, [c.organizationId, row.id, version, c.userId ?? null, note]);
  return { rateId: row.id, status: "ACTIVE", version };
}
// Create and submit in one step (the approval stays someone else's).
export async function setCostRate(client, c, input = {}) {
  const created = await createCostRateDraft(client, c, input);
  await submitCostRate(client, c, created.rateId);
  return { ...created, status: "PENDING_APPROVAL" };
}
export async function retireCostRate(client, c, rateId) {
  needCost(c, COST.rateManage);
  const row = (await client.query(`UPDATE tenant.manufacturing_cost_rates SET status = 'RETIRED', retired_by = $3, retired_at = clock_timestamp() WHERE organization_id = $1 AND id = $2 AND status IN ('ACTIVE', 'DRAFT', 'PENDING_APPROVAL') RETURNING id`,
    [c.organizationId, uuid(rateId, "Rate"), c.userId ?? null])).rows[0];
  if (!row) throw costError(404, "MFG_OH_RATE_MISSING", "That rate is not in force.");
  return { retired: true };
}
// input: { laborEnabled?, overheadEnabled? }
export async function setCostingSettings(client, c, input = {}) {
  needCost(c, COST.rateManage);
  const current = await costSettings(client, c);
  const labor = input.laborEnabled === undefined ? current.LABOR : Boolean(input.laborEnabled);
  const overhead = input.overheadEnabled === undefined ? current.OVERHEAD : Boolean(input.overheadEnabled);
  await client.query(`INSERT INTO tenant.manufacturing_settings (organization_id, mc_labor_enabled, mc_overhead_enabled) VALUES ($1,$2,$3)
      ON CONFLICT (organization_id) DO UPDATE SET mc_labor_enabled = $2, mc_overhead_enabled = $3, updated_at = now()`, [c.organizationId, labor, overhead]);
  return { laborEnabled: labor, overheadEnabled: overhead };
}

// ------------------------------------------------------------------ overhead categories and the period reconciliation
const STANDARD_CATEGORIES = [["FACTORY_ELECTRICITY", "Factory electricity", "PER_GOOD_UNIT"], ["FACTORY_UTILITIES", "Factory utilities", "PER_GOOD_UNIT"], ["FACTORY_RENT", "Factory rent", "PER_GOOD_UNIT"],
  ["EQUIPMENT_MAINTENANCE", "Equipment maintenance", "PER_GOOD_UNIT"], ["INDIRECT_LABOR", "Indirect factory labor", "PER_GOOD_UNIT"], ["EQUIPMENT_DEPRECIATION", "Equipment depreciation", "PER_GOOD_UNIT"],
  ["BATCH_SETUP", "Batch setup", "PER_BATCH"], ["OTHER", "Other manufacturing overhead", "PER_GOOD_UNIT"]];
export async function ensureOverheadCategories(client, c) {
  for (const [code, name, basis] of STANDARD_CATEGORIES) {
    await client.query(`INSERT INTO tenant.manufacturing_overhead_categories (organization_id, code, name, default_basis) VALUES ($1,$2,$3,$4) ON CONFLICT (organization_id, code) DO NOTHING`,
      [c.organizationId, code, name, basis]);
  }
}
// input: { id?, code?, name, description?, defaultBasis?, costPoolAccountIds?, costPoolNote?, status? } — the accounts must be expense accounts
// of the company: they are the category's actual cost pool.
export async function saveOverheadCategory(client, c, input = {}) {
  needCost(c, COST.rateManage);
  const name = String(input.name ?? "").trim();
  if (name.length < 2) throw costError(400, "MFG_OH_RATE_INVALID", "Give the category a name.");
  const basis = String(input.defaultBasis ?? "PER_GOOD_UNIT").toUpperCase();
  if (!["PER_GOOD_UNIT", "PER_BATCH"].includes(basis)) throw costError(400, "MFG_OH_RATE_INVALID", "Choose per unit or per batch.");
  const accounts = Array.isArray(input.costPoolAccountIds) ? [...new Set(input.costPoolAccountIds.map((id) => uuid(id, "Account")))] : null;
  if (accounts?.length) {
    const ok = Number((await client.query(`SELECT count(*) AS n FROM tenant.accounting_accounts WHERE organization_id = $1 AND id = ANY($2::uuid[]) AND account_class = 'expense' AND NOT is_group`,
      [c.organizationId, accounts])).rows[0].n);
    if (ok !== accounts.length) throw costError(400, "MFG_OH_FINANCE_MAPPING_MISSING", "A category's cost pool is made of the company's expense accounts.");
    const shared = (await client.query(`SELECT name FROM tenant.manufacturing_overhead_categories WHERE organization_id = $1 AND id IS DISTINCT FROM $2 AND cost_pool_account_ids && $3::uuid[] AND status = 'ACTIVE'`,
      [c.organizationId, input.id ?? null, accounts])).rows;
    if (shared.length) throw costError(409, "MFG_OH_RATE_OVERLAP", `${shared[0].name} already uses one of these accounts: the same expense is not pooled twice.`);
  }
  const status = String(input.status ?? "ACTIVE").toUpperCase();
  if (input.id) {
    const row = (await client.query(`UPDATE tenant.manufacturing_overhead_categories SET name = $3, description = $4, default_basis = $5, cost_pool_account_ids = COALESCE($6::uuid[], cost_pool_account_ids),
        cost_pool_note = $7, status = $8, updated_at = now() WHERE organization_id = $1 AND id = $2 RETURNING id`,
      [c.organizationId, uuid(input.id, "Category"), name, String(input.description ?? "").trim() || null, basis, accounts, String(input.costPoolNote ?? "").trim() || null, status])).rows[0];
    if (!row) throw costError(404, "MFG_OH_RATE_INVALID", "That category was not found.");
    return { categoryId: row.id };
  }
  const code = String(input.code ?? name).toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40);
  if (!/^[A-Z][A-Z0-9_]{1,39}$/.test(code)) throw costError(400, "MFG_OH_RATE_INVALID", "Give the category a code of letters and digits.");
  const row = (await client.query(`INSERT INTO tenant.manufacturing_overhead_categories (organization_id, code, name, description, default_basis, cost_pool_account_ids, cost_pool_note, created_by)
      VALUES ($1,$2,$3,$4,$5,COALESCE($6::uuid[], '{}'),$7,$8) ON CONFLICT (organization_id, code) DO NOTHING RETURNING id`,
    [c.organizationId, code, name, String(input.description ?? "").trim() || null, basis, accounts, String(input.costPoolNote ?? "").trim() || null, c.userId ?? null])).rows[0];
  if (!row) throw costError(409, "MFG_OH_RATE_OVERLAP", "A category with that code exists.");
  return { categoryId: row.id };
}
// A period's overhead, per category: the actual pool (posted to its expense accounts in the month) against what was applied to orders.
export async function overheadPeriodFigures(client, c, period) {
  if (!/^\d{4}-\d{2}$/.test(String(period ?? ""))) throw costError(400, "MFG_OH_RATE_INVALID", "Choose a month (YYYY-MM).");
  await ensureOverheadCategories(client, c);
  const categories = (await client.query(`SELECT * FROM tenant.manufacturing_overhead_categories WHERE organization_id = $1 ORDER BY name`, [c.organizationId])).rows;
  const rows = [];
  for (const category of categories) {
    const actual = category.cost_pool_account_ids?.length ? D(money(D((await client.query(
      `SELECT COALESCE(sum(line.base_debit_amount - line.base_credit_amount), 0) AS n FROM tenant.accounting_journal_lines line JOIN tenant.accounting_journal_entries entry ON entry.id = line.journal_entry_id
        WHERE entry.organization_id = $1 AND entry.status = 'posted' AND line.account_id = ANY($2::uuid[]) AND to_char(entry.accounting_date, 'YYYY-MM') = $3`,
      [c.organizationId, category.cost_pool_account_ids, period])).rows[0].n))) : null;
    const applied = D(money(D((await client.query(
      `SELECT COALESCE(sum(CASE WHEN direction = 'APPLY' THEN amount ELSE -amount END), 0) AS n FROM tenant.manufacturing_cost_applications
        WHERE organization_id = $1 AND component = 'OVERHEAD' AND category_id = $2 AND to_char(created_at, 'YYYY-MM') = $3`, [c.organizationId, category.id, period])).rows[0].n)));
    const last = (await client.query(`SELECT * FROM tenant.manufacturing_overhead_reconciliations WHERE organization_id = $1 AND period = $2 AND category_id = $3 ORDER BY reconciled_at DESC LIMIT 1`,
      [c.organizationId, period, category.id])).rows[0] ?? null;
    if (actual === null && applied === ZERO && !last) continue;
    const difference = actual === null ? null : sub(actual, applied);
    rows.push({ category, actual, applied, difference, last });
  }
  return rows;
}
// input: { period, categoryId, note, financeReference? } — Finance's review of a period's difference (any correcting journal is Finance's own).
export async function reconcileOverheadPeriod(client, c, input = {}) {
  needCost(c, COST.reconcile);
  const rows = await overheadPeriodFigures(client, c, input.period);
  const row = rows.find((entry) => entry.category.id === input.categoryId);
  if (!row) throw costError(404, "MFG_OH_RECONCILIATION_REQUIRED", "Nothing to reconcile for that category in that month.");
  if (row.actual === null) throw costError(409, "MFG_OH_FINANCE_MAPPING_MISSING", `Name ${row.category.name}'s expense accounts (its cost pool) first.`);
  const note = String(input.note ?? "").trim();
  if (note.length < 3) throw costError(400, "MFG_COST_REASON_REQUIRED", "Say what was found.");
  const balanced = row.difference >= -10_000n && row.difference <= 10_000n;
  const id = randomUUID();
  await client.query(`INSERT INTO tenant.manufacturing_overhead_reconciliations (id, organization_id, period, category_id, actual_pool, applied, difference, status, note, finance_reference, reconciled_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [id, c.organizationId, input.period, row.category.id, money(row.actual), money(row.applied), money(row.difference),
    balanced || String(input.financeReference ?? "").trim() ? "RECONCILED" : "EXCEPTION", note, String(input.financeReference ?? "").trim() || null, c.userId ?? null]);
  return { reconciliationId: id, status: balanced || String(input.financeReference ?? "").trim() ? "RECONCILED" : "EXCEPTION" };
}

// ------------------------------------------------------------------ reconciliation
// The order's work in progress in Finance (every posting of its own documents to the work-in-progress account) against its book figures.
export async function reconcileWip(client, c, order) {
  const ids = (await client.query(
    `SELECT id FROM tenant.manufacturing_material_issues WHERE organization_id = $1 AND manufacturing_order_id = $2
     UNION ALL SELECT reversal.id FROM tenant.manufacturing_material_issue_reversals reversal JOIN tenant.manufacturing_material_issues issue ON issue.id = reversal.material_issue_id
       WHERE issue.organization_id = $1 AND issue.manufacturing_order_id = $2
     UNION ALL SELECT id FROM tenant.manufacturing_order_material_movements WHERE organization_id = $1 AND manufacturing_order_id = $2
     UNION ALL SELECT id FROM tenant.manufacturing_scraps WHERE organization_id = $1 AND manufacturing_order_id = $2
     UNION ALL SELECT correction.id FROM tenant.manufacturing_scrap_corrections correction JOIN tenant.manufacturing_scraps scrap ON scrap.id = correction.scrap_id WHERE scrap.organization_id = $1 AND scrap.manufacturing_order_id = $2
     UNION ALL SELECT id FROM tenant.manufacturing_finished_goods_receipts WHERE organization_id = $1 AND manufacturing_order_id = $2
     UNION ALL SELECT correction.id FROM tenant.manufacturing_finished_goods_receipt_corrections correction JOIN tenant.manufacturing_finished_goods_receipts receipt ON receipt.id = correction.receipt_id
       WHERE receipt.organization_id = $1 AND receipt.manufacturing_order_id = $2
     UNION ALL SELECT id FROM tenant.manufacturing_cost_applications WHERE organization_id = $1 AND manufacturing_order_id = $2
     UNION ALL SELECT id FROM tenant.manufacturing_cost_adjustments WHERE organization_id = $1 AND manufacturing_order_id = $2
     UNION ALL SELECT $2::uuid`, [c.organizationId, order.id])).rows.map((row) => row.id);
  const gl = (await client.query(
    `SELECT COALESCE(sum(line.base_debit_amount - line.base_credit_amount), 0) AS balance, count(DISTINCT entry.id)::int AS entries
       FROM tenant.accounting_journal_lines line JOIN tenant.accounting_journal_entries entry ON entry.id = line.journal_entry_id
      WHERE entry.organization_id = $1 AND entry.status = 'posted' AND entry.source_id = ANY($2::uuid[])
        AND line.account_id IN (SELECT account_id FROM tenant.accounting_account_mappings WHERE organization_id = $1 AND mapping_key = 'wip' AND status = 'active')`,
    [c.organizationId, ids])).rows[0];
  const book = wipBalance(order);
  const finance = D(money(D(gl.balance)));
  const difference = sub(finance, D(money(book)));
  const failing = Number((await client.query(
    `SELECT (SELECT count(*) FROM tenant.manufacturing_material_issues WHERE organization_id = $1 AND manufacturing_order_id = $2 AND status IN ('RECOVERY_REQUIRED', 'POSTING'))
          + (SELECT count(*) FROM tenant.manufacturing_finished_goods_receipts WHERE organization_id = $1 AND manufacturing_order_id = $2 AND status IN ('RECOVERY_REQUIRED', 'POSTING'))
          + (SELECT count(*) FROM tenant.manufacturing_scraps WHERE organization_id = $1 AND manufacturing_order_id = $2 AND status IN ('RECOVERY_REQUIRED', 'POSTING'))
          + (SELECT count(*) FROM tenant.manufacturing_material_consumptions WHERE organization_id = $1 AND manufacturing_order_id = $2 AND status IN ('RECOVERY_REQUIRED', 'POSTING')) AS n`,
    [c.organizationId, order.id])).rows[0].n);
  const balanced = difference >= -10_000n && difference <= 10_000n;
  return { book: money(book), finance: money(finance), difference: money(difference), entries: gl.entries, balanced, pendingRecovery: failing,
    status: failing ? "RECOVERY_REQUIRED" : balanced ? "BALANCED" : "IMBALANCE" };
}
// The record of a reconciliation someone ran (input: { note? }).
export async function recordReconciliation(client, c, orderId, input = {}) {
  needCost(c, COST.reconcile);
  const order = await loadCostOrder(client, c, orderId);
  const result = await reconcileWip(client, c, order);
  await costEvent(client, c, order.id, result.balanced ? "RECONCILED" : "RECONCILIATION_EXCEPTION", { amount: D(result.difference),
    summary: `Book ₹${result.book} · Finance ₹${result.finance}${result.balanced ? "" : ` · difference ₹${result.difference}`}${text(input.note, 500) ? ` — ${text(input.note, 500)}` : ""}` });
  return { orderId: order.id, ...result };
}

// ------------------------------------------------------------------ adjustments
// input: { direction: WIP_TO_VARIANCE | VARIANCE_TO_WIP, amount, reason, evidence?, idempotencyKey? }
export async function requestCostAdjustment(client, c, orderId, input = {}) {
  needCost(c, COST.adjustRequest);
  const key = text(input.idempotencyKey, 200) || null;
  if (key) {
    const done = (await client.query(`SELECT id FROM tenant.manufacturing_cost_adjustments WHERE organization_id = $1 AND idempotency_key = $2`, [c.organizationId, key])).rows[0];
    if (done) return { adjustmentId: done.id, replayed: true };
  }
  const order = await loadCostOrder(client, c, orderId, { lock: true });
  if (order.cost_finalized_at) throw costError(409, "MFG_COST_ALREADY_FINALIZED");
  if (["DRAFT", "AWAITING_APPROVAL"].includes(order.status)) throw costError(409, "MFG_COST_NOT_READY", "Nothing is costed on this order yet.");
  if (["COMPLETED", "CANCELLED"].includes(order.status)) throw costError(409, "MFG_COST_ALREADY_FINALIZED", `${order.mo_number} is ${order.status.toLowerCase()}: its work in progress was closed; correct it through Finance.`);
  const direction = String(input.direction ?? "").toUpperCase();
  if (!["WIP_TO_VARIANCE", "VARIANCE_TO_WIP"].includes(direction)) throw costError(400, "MFG_COST_REASON_REQUIRED", "Choose which way the adjustment goes.");
  const amount = String(input.amount ?? "").trim();
  if (!/^\d+(\.\d{1,2})?$/.test(amount) || !(Number(amount) > 0)) throw costError(400, "MFG_COST_ALLOCATION_EXCEEDS", "Enter an amount greater than zero.");
  if (direction === "WIP_TO_VARIANCE" && D(amount) > wipBalance(order)) throw costError(409, "MFG_COST_ALLOCATION_EXCEEDS", `Work in progress holds ₹${money(wipBalance(order))}.`);
  const reason = text(input.reason, 1000);
  if (reason.length < 3) throw costError(400, "MFG_COST_REASON_REQUIRED", "Say why the cost is adjusted.");
  const id = randomUUID();
  const number = await nextNumber(client, c, "manufacturing_cost_adjustment");
  await client.query(`INSERT INTO tenant.manufacturing_cost_adjustments (id, organization_id, adjustment_number, manufacturing_order_id, direction, amount, reason, evidence, requested_by, requested_version, idempotency_key)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [id, c.organizationId, number, order.id, direction, amount, reason, text(input.evidence, 1000) || null, c.userId ?? null, order.version, key]);
  await costEvent(client, c, order.id, "ADJUSTMENT_REQUESTED", { amount: D(amount), summary: `${number}: ${direction === "WIP_TO_VARIANCE" ? "write off to variance" : "bring back to work in progress"} — ${reason}` });
  return { adjustmentId: id, adjustmentNumber: number };
}
// input: { decision: APPROVE | REJECT, note? } — by someone other than the requester; an approval posts once.
export async function decideCostAdjustment(client, c, adjustmentId, input = {}) {
  needCost(c, COST.adjustApprove);
  const row = (await client.query(`SELECT * FROM tenant.manufacturing_cost_adjustments WHERE organization_id = $1 AND id = $2 FOR UPDATE`, [c.organizationId, uuid(adjustmentId, "Adjustment")])).rows[0];
  if (!row) throw costError(404, "MFG_COST_MO_NOT_FOUND", "That adjustment was not found.");
  if (row.status !== "REQUESTED") throw costError(409, "MFG_COST_ALREADY_FINALIZED", "That adjustment is decided already.");
  const settings = await costSettings(client, c);
  if (row.requested_by === c.userId && !settings.selfApproval) throw costError(403, "MFG_COST_PERMISSION_DENIED", "Someone other than the person who asked approves a cost adjustment.");
  const order = await loadCostOrder(client, c, row.manufacturing_order_id, { lock: true });
  const decision = String(input.decision ?? "").toUpperCase();
  const note = text(input.note, 1000) || null;
  if (decision === "REJECT") {
    if (!note || note.length < 3) throw costError(400, "MFG_COST_REASON_REQUIRED", "Say why.");
    await client.query(`UPDATE tenant.manufacturing_cost_adjustments SET status = 'REJECTED', decided_by = $3, decided_at = clock_timestamp(), decision_note = $4 WHERE organization_id = $1 AND id = $2`,
      [c.organizationId, row.id, c.userId ?? null, note]);
    await costEvent(client, c, order.id, "ADJUSTMENT_REJECTED", { amount: D(row.amount), summary: `${row.adjustment_number}: ${note}` });
    return { adjustmentId: row.id, status: "REJECTED" };
  }
  if (decision !== "APPROVE") throw costError(400, "MFG_COST_REASON_REQUIRED", "Approve or reject.");
  if (order.cost_finalized_at || ["COMPLETED", "CANCELLED"].includes(order.status)) throw costError(409, "MFG_COST_ALREADY_FINALIZED");
  const amount = D(row.amount);
  if (row.direction === "WIP_TO_VARIANCE" && amount > wipBalance(order)) throw costError(409, "MFG_COST_SOURCE_CHANGED", `Work in progress now holds ₹${money(wipBalance(order))}: the request no longer fits.`);
  const toVariance = row.direction === "WIP_TO_VARIANCE";
  const key = `mcadj:${row.id}`;
  const journal = await postJournal(client, c, { event: "manufacturing_cost_adjustment", sourceType: "manufacturing_cost_adjustment", sourceId: row.id, sourceNumber: row.adjustment_number,
    reference: `${row.adjustment_number} · ${order.mo_number}`, description: `Cost adjustment of ${order.mo_number}: ${row.reason}`,
    lines: toVariance ? [{ mappingKey: "manufacturing_variance", label: "Manufacturing variance", debit: amount }, { mappingKey: "wip", label: "Work in progress", credit: amount }]
      : [{ mappingKey: "wip", label: "Work in progress", debit: amount }, { mappingKey: "manufacturing_variance", label: "Manufacturing variance", credit: amount }] });
  await client.query(`UPDATE tenant.manufacturing_cost_adjustments SET status = 'APPROVED', decided_by = $3, decided_at = clock_timestamp(), decision_note = $4, journal_entry_id = $5, posting_key = $6
      WHERE organization_id = $1 AND id = $2`, [c.organizationId, row.id, c.userId ?? null, note, journal, key]);
  await client.query(`UPDATE tenant.manufacturing_orders SET wip_adjusted_cost = wip_adjusted_cost + $3, version = version + 1 WHERE organization_id = $1 AND id = $2`,
    [c.organizationId, order.id, money(toVariance ? amount : sub(ZERO, amount))]);
  await costEvent(client, c, order.id, "ADJUSTMENT_POSTED", { amount, summary: `${row.adjustment_number}: ₹${money(amount)} ${toVariance ? "written off to variance" : "brought back to work in progress"}`, details: { journal } });
  return { adjustmentId: row.id, status: "APPROVED", journalEntryId: journal };
}

// ------------------------------------------------------------------ finalization
// An order's costing closes once it is completed (or cancelled with nothing left), its work in progress is zero, Finance agrees and no
// adjustment waits. input: { note? }
export async function finalizeManufacturingCosting(client, c, orderId, input = {}, { system = false } = {}) {
  if (!system) needCost(c, COST.finalize);
  const order = await loadCostOrder(client, c, orderId, { lock: true });
  if (order.cost_finalized_at) return { orderId: order.id, finalizedAt: order.cost_finalized_at, replayed: true };
  const problems = await finalizationProblems(client, c, order);
  if (problems.length) {
    if (system) return { orderId: order.id, finalized: false, problems };
    throw costError(409, problems[0].code, problems[0].message, { problems });
  }
  await client.query(`UPDATE tenant.manufacturing_orders SET cost_finalized_at = clock_timestamp(), cost_finalized_by = $3 WHERE organization_id = $1 AND id = $2`, [c.organizationId, order.id, c.userId ?? null]);
  await costEvent(client, c, order.id, "COSTING_FINALIZED", { summary: text(input.note, 500) || "Work in progress is zero and agrees with Finance" });
  return { orderId: order.id, finalized: true };
}
export async function finalizationProblems(client, c, order) {
  const problems = [];
  if (!["COMPLETED", "CANCELLED"].includes(order.status)) problems.push({ code: "MFG_COST_NOT_READY", message: `${order.mo_number} is ${order.status.toLowerCase().replace(/_/g, " ")}: its costing closes when it completes.` });
  const wip = wipBalance(order);
  if (wip > 10_000n || wip < -10_000n) problems.push({ code: "MFG_COST_WIP_IMBALANCE", message: `₹${money(wip)} is still in work in progress.` });
  const reconciliation = await reconcileWip(client, c, order);
  if (!reconciliation.balanced) problems.push({ code: "MFG_COST_WIP_IMBALANCE", message: `Finance holds ₹${reconciliation.finance} for this order against ₹${reconciliation.book} on the order.` });
  if (reconciliation.pendingRecovery) problems.push({ code: "MFG_COST_OUTCOME_UNKNOWN", message: `${reconciliation.pendingRecovery} posting(s) need recovery first.` });
  const open = Number((await client.query(`SELECT count(*) AS n FROM tenant.manufacturing_cost_adjustments WHERE organization_id = $1 AND manufacturing_order_id = $2 AND status = 'REQUESTED'`,
    [c.organizationId, order.id])).rows[0].n);
  if (open) problems.push({ code: "MFG_COST_SOURCE_CHANGED", message: `${open} cost adjustment(s) wait for a decision.` });
  return problems;
}

export { has, max };
