// Production Costing — the shared core: permissions, errors, the company's costing settings, the labor and overhead rates in force (a
// product's own before the company-wide one), the planned-cost estimate of an order, the actual consumed-material cost from posted
// consumption, and the cost history. Inventory's valuation is the material cost; Finance's ledger is the record — nothing here keeps another.
import { createHash } from "node:crypto";

import { D, MO, STATUS_LABEL, ZERO, add, div, has, max, moError, money, mul, q, sub, text, uuid } from "../orders/mo-core.js";

export const COST = Object.freeze({
  view: "manufacturing.cost.view", viewDetail: "manufacturing.cost.view_detail", estimate: "manufacturing.cost.estimate", rateManage: "manufacturing.cost.rate_manage",
  apply: "manufacturing.cost.apply", reconcile: "manufacturing.cost.reconcile", adjustRequest: "manufacturing.cost.adjust_request", adjustApprove: "manufacturing.cost.adjust_approve",
  finalize: "manufacturing.cost.finalize", export: "manufacturing.cost.export", rateApprove: "manufacturing.cost.rate_approve",
});
export const COMPONENT_LABEL = Object.freeze({ LABOR: "Direct labor", OVERHEAD: "Manufacturing overhead" });
export const BASIS_LABEL = Object.freeze({ PER_GOOD_UNIT: "Per accepted unit", PER_BATCH: "Per production batch", PCT_OF_MATERIAL: "Percent of consumed material cost" });
export const APPLIED_ACCOUNT = Object.freeze({ LABOR: "manufacturing_labor_applied", OVERHEAD: "manufacturing_overhead_applied" });

const MESSAGES = Object.freeze({
  MFG_COST_MO_NOT_FOUND: "Manufacturing Order could not be found.",
  MFG_COST_BOM_INVALID: "The approved manufacturing recipe is unavailable.",
  MFG_COST_ESTIMATE_UNAVAILABLE: "Planned production cost could not be calculated.",
  MFG_COST_MATERIAL_VALUATION_MISSING: "Material cost is not available from Inventory.",
  MFG_COST_POLICY_MISSING: "Complete the manufacturing costing settings.",
  MFG_COST_RATE_INVALID: "A labor or overhead rate is missing or invalid.",
  MFG_COST_ALLOCATION_EXCEEDS: "More cost is being allocated than is eligible.",
  MFG_COST_FGR_NOT_READY: "Finished-goods costing is incomplete.",
  MFG_COST_WIP_IMBALANCE: "Manufacturing WIP and posted accounting do not match.",
  MFG_COST_SCRAP_UNRESOLVED: "Scrap or rejected-output costs require disposition.",
  MFG_COST_PERIOD_CLOSED: "This transaction belongs to a closed financial period.",
  MFG_COST_SOURCE_CHANGED: "Cost information changed. Recalculate before continuing.",
  MFG_COST_ALREADY_FINALIZED: "This Manufacturing Order's costing has been finalized.",
  MFG_COST_OUTCOME_UNKNOWN: "The previous posting is being checked. Do not submit it again.",
  MFG_COST_PERMISSION_DENIED: "You do not have permission to perform this action.",
  MFG_COST_NOT_READY: "This order's costing cannot be finalized yet.",
  MFG_COST_REASON_REQUIRED: "Give a reason.",
  MFG_OH_RATE_MISSING: "No approved overhead rate is available.",
  MFG_OH_RATE_INVALID: "The overhead rate configuration is invalid.",
  MFG_OH_RATE_OVERLAP: "Another overhead rate covers this period.",
  MFG_OH_FINANCE_MAPPING_MISSING: "Overhead accounting mapping is incomplete.",
  MFG_OH_SOURCE_CHANGED: "Production activity changed. Refresh before applying overhead.",
  MFG_OH_PERMISSION_DENIED: "You do not have permission to perform this action.",
  MFG_OH_RECONCILIATION_REQUIRED: "Overhead differences require Finance review.",
});
export const costError = (status, code, message, details) => moError(status, code, message ?? MESSAGES[code], details);
export const canSeeCost = (c) => has(c, COST.view) || has(c, MO.costView);
export const needCostView = (c) => { if (!canSeeCost(c)) throw costError(403, "MFG_COST_PERMISSION_DENIED"); };
export const needCost = (c, permission) => { if (!has(c, permission)) throw costError(403, "MFG_COST_PERMISSION_DENIED"); };

export async function loadCostOrder(client, c, orderId, { lock = false } = {}) {
  const row = (await client.query(`SELECT * FROM tenant.manufacturing_orders WHERE organization_id = $1 AND id = $2${lock ? " FOR UPDATE" : ""}`, [c.organizationId, uuid(orderId, "Manufacturing order")])).rows[0];
  if (!row) throw costError(404, "MFG_COST_MO_NOT_FOUND");
  return row;
}
export async function costSettings(client, c) {
  const row = (await client.query(`SELECT mc_labor_enabled, mc_overhead_enabled, mo_variance_self_approval_allowed FROM tenant.manufacturing_settings WHERE organization_id = $1`, [c.organizationId])).rows[0] ?? {};
  return { LABOR: Boolean(row.mc_labor_enabled), OVERHEAD: Boolean(row.mc_overhead_enabled), selfApproval: Boolean(row.mo_variance_self_approval_allowed) };
}
// The rates in force for a product on a day: labor (the product's own, else the company's) and, per overhead category, the product's own rate
// replacing the company default of the same category — never stacking. A per-unit rate whose unit is not the product's base unit does not
// apply (it is reported, never converted silently).
export async function ratesFor(client, c, itemId, onDate = null) {
  const day = onDate ?? (await client.query(`SELECT to_char(current_date, 'YYYY-MM-DD') AS d`)).rows[0].d;
  const item = (await client.query(`SELECT uom_id FROM tenant.items WHERE id = $1`, [itemId])).rows[0];
  const rows = (await client.query(
    `SELECT rate.*, category.code AS category_code, category.name AS category_name FROM tenant.manufacturing_cost_rates rate
       LEFT JOIN tenant.manufacturing_overhead_categories category ON category.id = rate.category_id
      WHERE rate.organization_id = $1 AND rate.status = 'ACTIVE' AND rate.effective_from <= $3::date AND (rate.effective_until IS NULL OR rate.effective_until >= $3::date)
        AND (rate.finished_item_id = $2 OR rate.finished_item_id IS NULL) AND (category.id IS NULL OR category.status = 'ACTIVE')
      ORDER BY (rate.finished_item_id IS NULL), rate.effective_from DESC, rate.approved_at DESC`, [c.organizationId, itemId, day])).rows;
  const invalid = [];
  const pick = (candidates) => {
    for (const row of candidates) {
      if (row.basis === "PER_GOOD_UNIT" && row.uom_id && item?.uom_id && row.uom_id !== item.uom_id) { invalid.push(row); continue; }
      return row;
    }
    return null;
  };
  const labor = pick(rows.filter((row) => row.component === "LABOR"));
  const categories = [...new Set(rows.filter((row) => row.component === "OVERHEAD").map((row) => row.category_id))];
  const overhead = categories.map((categoryId) => pick(rows.filter((row) => row.component === "OVERHEAD" && row.category_id === categoryId))).filter(Boolean);
  return { LABOR: labor, OVERHEAD: overhead, invalid, day };
}
// A component that is enabled must have a rate; one that is not enabled is "not enabled" — never a measured zero.
export function rateProblems(settings, rates) {
  const problems = [];
  if (settings.LABOR && !rates.LABOR) problems.push("Direct labor is enabled but no approved rate is in force for this product.");
  if (settings.OVERHEAD && !rates.OVERHEAD.length) problems.push("Manufacturing overhead is enabled but no approved overhead rate is in force for this product.");
  for (const row of rates.invalid ?? []) problems.push(`${row.name} (${row.rate_code}) is per a different unit than the product's.`);
  return problems;
}
export const rateView = (row) => (row ? { id: row.rate_id ?? row.id, code: row.rate_code, name: row.name ?? row.category_name ?? null, component: row.component, category: row.category_name ?? null,
  basis: row.basis, basisLabel: BASIS_LABEL[row.basis], rate: q(D(row.rate)), version: row.rate_version ?? row.version, productSpecific: row.product_specific ?? Boolean(row.finished_item_id) } : null);

// The rates an order was released under (frozen). An order released before rates were frozen gets them frozen now, marked late.
export async function frozenRatesOf(client, c, order) {
  return (await client.query(`SELECT * FROM tenant.manufacturing_order_cost_rates WHERE organization_id = $1 AND manufacturing_order_id = $2 ORDER BY component, category_name`, [c.organizationId, order.id])).rows;
}
export async function freezeOrderRates(client, c, order, { late = false } = {}) {
  const existing = await frozenRatesOf(client, c, order);
  if (existing.length) return existing;
  const settings = await costSettings(client, c);
  const rates = await ratesFor(client, c, order.finished_item_id);
  const chosen = [...(settings.LABOR && rates.LABOR ? [rates.LABOR] : []), ...(settings.OVERHEAD ? rates.OVERHEAD : [])];
  for (const rate of chosen) {
    await client.query(
      `INSERT INTO tenant.manufacturing_order_cost_rates (organization_id, manufacturing_order_id, rate_id, rate_code, rate_version, component, category_id, category_name, basis, rate, product_specific, frozen_late)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT DO NOTHING`,
      [c.organizationId, order.id, rate.id, rate.rate_code, rate.version, rate.component, rate.category_id ?? null, rate.category_name ?? null, rate.basis, q(D(rate.rate)), Boolean(rate.finished_item_id), late]);
  }
  return frozenRatesOf(client, c, order);
}

// How many production batches the plan implies (the revision's batch size), at least one.
export async function plannedBatches(client, c, order) {
  if (!order.bom_revision_id) return 1;
  const revision = (await client.query(`SELECT batch_size FROM tenant.manufacturing_bom_revisions WHERE id = $1`, [order.bom_revision_id])).rows[0];
  if (!revision?.batch_size || D(revision.batch_size) <= ZERO) return 1;
  return Math.max(1, Math.ceil(Number(D(order.planned_base_quantity)) / Number(D(revision.batch_size))));
}
// Labor or overhead for a quantity of output: per unit × units, per batch × batches, percent × material cost.
export function conversionFor(rate, { units, batches, materialCost }) {
  if (!rate) return null;
  const value = D(rate.rate);
  if (rate.basis === "PER_GOOD_UNIT") return mul(value, units);
  if (rate.basis === "PER_BATCH") return mul(value, BigInt(batches) * 1_000_000n);
  return materialCost === null ? null : div(mul(materialCost, value), 100n * 1_000_000n);
}

// The planned cost of an order from its materials (estimated at their valuation rate when it was released) and its rates — the frozen ones
// once released, those in force otherwise. Overhead is summed across its categories, one rate each.
export async function estimateFor(client, c, order, materials) {
  const settings = await costSettings(client, c);
  const frozen = ["DRAFT", "AWAITING_APPROVAL"].includes(order.status) ? [] : await frozenRatesOf(client, c, order);
  let labor = null;
  let overheadRates = [];
  if (frozen.length || !["DRAFT", "AWAITING_APPROVAL"].includes(order.status)) {
    labor = frozen.find((row) => row.component === "LABOR") ?? null;
    overheadRates = frozen.filter((row) => row.component === "OVERHEAD");
  } else {
    const resolved = await ratesFor(client, c, order.finished_item_id);
    labor = settings.LABOR ? resolved.LABOR : null;
    overheadRates = settings.OVERHEAD ? resolved.OVERHEAD : [];
  }
  const missing = materials.filter((row) => row.estimated_cost === null || row.estimated_cost === undefined).map((row) => row.item_code);
  const material = missing.length ? null : materials.reduce((sum, row) => add(sum, D(row.estimated_cost)), ZERO);
  const planned = D(order.planned_base_quantity);
  const batches = await plannedBatches(client, c, order);
  const amountOf = (rate) => conversionFor(rate, { units: planned, batches, materialCost: material });
  const laborCost = labor ? amountOf(labor) : null;
  const overheadLines = overheadRates.map((rate) => ({ rate, amount: amountOf(rate) }));
  const overhead = overheadLines.length ? overheadLines.reduce((sum, line) => (line.amount === null ? sum : add(sum, line.amount)), ZERO) : null;
  const total = material === null ? null : add(add(material, laborCost ?? ZERO), overhead ?? ZERO);
  const policy = { labor: labor ? rateView(labor) : null, overhead: overheadLines.map((line) => ({ ...rateView(line.rate), planned: line.amount === null ? null : money(line.amount) })),
    laborEnabled: settings.LABOR, overheadEnabled: settings.OVERHEAD, plannedBatches: batches,
    materialValuation: "Inventory's own valuation at issue (estimate: the rate when the order was released)", receiptAllocation: "EQUIVALENT_ACCEPTED_UNITS" };
  return {
    planned, batches, material, labor: laborCost, overhead, total, unit: total === null || planned === ZERO ? null : div(total, planned), missing, policy,
    policyHash: createHash("sha256").update(JSON.stringify(policy)).digest("hex").slice(0, 16), settings,
    lines: materials.map((row) => ({ materialId: row.id, code: row.item_code, quantity: q(D(row.planned_quantity)), unitCost: row.estimated_unit_cost === null ? null : q(D(row.estimated_unit_cost)),
      cost: row.estimated_cost === null ? null : money(D(row.estimated_cost)) })),
  };
}

// Consumed material cost of an order (posted consumption net of corrections, at the issue cost it carried), per material line and total.
export async function consumedCost(client, c, orderId) {
  const rows = (await client.query(
    `SELECT line.material_id, sum(CASE WHEN line.total_cost IS NULL THEN NULL ELSE line.total_cost * (line.base_quantity - line.corrected_quantity) / line.base_quantity END) AS cost,
            bool_or(line.total_cost IS NULL) AS missing
       FROM tenant.manufacturing_material_consumption_lines line JOIN tenant.manufacturing_material_consumptions note ON note.id = line.consumption_id
      WHERE note.organization_id = $1 AND note.manufacturing_order_id = $2 AND note.status = 'POSTED' GROUP BY line.material_id`, [c.organizationId, orderId])).rows;
  const byLine = new Map(rows.map((row) => [row.material_id, row.missing ? null : D(money(D(row.cost ?? 0)))]));
  const missing = rows.some((row) => row.missing);
  return { byLine, total: missing ? null : rows.reduce((sum, row) => add(sum, D(money(D(row.cost ?? 0)))), ZERO) };
}

export async function costEvent(client, c, orderId, action, { amount = null, summary = null, details = {} } = {}) {
  await client.query(`INSERT INTO tenant.manufacturing_cost_events (organization_id, manufacturing_order_id, action, amount, summary, details, actor_user_id) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)`,
    [c.organizationId, orderId, action, amount === null ? null : money(amount), summary ? String(summary).slice(0, 1000) : null, JSON.stringify(details), c.userId ?? null]);
}

export { D, MO, STATUS_LABEL, ZERO, add, div, has, max, money, mul, q, sub, text, uuid };
