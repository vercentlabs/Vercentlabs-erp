// Production Costing — the reads: an order's costing (the frozen planned baseline and later estimates; actual material — consumed, still in
// production custody, scrapped — and applied labor and overhead; what finished goods capitalised, receipt by receipt; what scrap and
// completion took out; work in progress now and in Finance; variances against the plan and against equivalent production; the cost per
// accepted unit; batches; applications, adjustments and history), the receipt valuation preview, the costing exceptions and the reports.
// Everything comes from the posted records; nothing here is a separate ledger.
import { costOf } from "../receipts/fgr-core.js";
import { loadMaterials, lineFigures, wipBalance } from "../orders/mo-core.js";
import { getMoMaterialVariances } from "../variance/variance-read.js";
import {
  BASIS_LABEL, COMPONENT_LABEL, COST, D, STATUS_LABEL, ZERO, add, canSeeCost, consumedCost, conversionFor, costError, costSettings, div, estimateFor, has, loadCostOrder, max, money, mul,
  frozenRatesOf, needCostView, plannedBatches, q, rateView, ratesFor, sub, uuid,
} from "./cost-core.js";
import { finalizationProblems, overheadPeriodFigures, pendingApplications, reconcileWip } from "./cost-service.js";

const names = async (client, ids) => {
  const list = [...new Set(ids.filter(Boolean))];
  if (!list.length) return new Map();
  return new Map((await client.query(`SELECT id, COALESCE(NULLIF(full_name, ''), email) AS name FROM public.users WHERE id = ANY($1::uuid[])`, [list])).rows.map((row) => [row.id, row.name]));
};
const m = (value) => (value === null || value === undefined ? null : money(D(value)));
const ACTION_LABEL = Object.freeze({ BASELINE_ESTIMATED: "Planned cost frozen at release", REESTIMATED: "Re-estimated", COST_APPLIED: "Labor / overhead applied", ADJUSTMENT_REQUESTED: "Adjustment requested",
  ADJUSTMENT_REJECTED: "Adjustment rejected", ADJUSTMENT_POSTED: "Adjustment posted", RECONCILED: "Reconciled with Finance", RECONCILIATION_EXCEPTION: "Reconciliation difference", COSTING_FINALIZED: "Costing finalized",
  COST_REVERSED: "Over-applied cost taken back", BATCH_SETUP_CONFIRMED: "Batch setup confirmed" });
// The signed amount of pending pieces: what applying would add (APPLY) less what an approved reversal would take back.
const pieceSum = (pieces, direction) => (pieces ?? []).filter((piece) => !direction || piece.direction === direction)
  .reduce((sum, piece) => (piece.direction === "REVERSE" ? sub(sum, piece.amount) : add(sum, piece.amount)), ZERO);
const signed = (row) => (row.direction === "REVERSE" ? sub(ZERO, D(row.amount)) : D(row.amount));

// The costing state (never the order's lifecycle).
function stateOf(order, figures, reconciliation, openAdjustments) {
  if (order.cost_finalized_at) return "FINALIZED";
  if (openAdjustments) return "ADJUSTMENT_REQUIRED";
  if (reconciliation.status !== "BALANCED") return "RECONCILIATION_REQUIRED";
  if (["DRAFT", "AWAITING_APPROVAL"].includes(order.status) || (figures.materialIssued === ZERO && figures.applied === ZERO)) return "ESTIMATED";
  if (["COMPLETED", "CANCELLED"].includes(order.status)) return "RECONCILED";
  return figures.capitalised > ZERO ? "PARTIALLY_CAPITALIZED" : "ACCUMULATING";
}

// ------------------------------------------------------------------ one order
export async function getManufacturingOrderCosting(client, c, orderId) {
  needCostView(c);
  const order = await loadCostOrder(client, c, orderId);
  const detail = has(c, COST.viewDetail) || has(c, "manufacturing.mo.cost_view");
  const materials = await loadMaterials(client, c, order.id);
  const settings = await costSettings(client, c);
  const frozen = ["DRAFT", "AWAITING_APPROVAL"].includes(order.status) ? [] : await frozenRatesOf(client, c, order);
  const resolved = frozen.length ? null : await ratesFor(client, c, order.finished_item_id);
  const laborRate = frozen.length ? frozen.find((row) => row.component === "LABOR") ?? null : resolved.LABOR;
  const overheadRates = frozen.length ? frozen.filter((row) => row.component === "OVERHEAD") : resolved.OVERHEAD;
  const estimates = (await client.query(`SELECT * FROM tenant.manufacturing_cost_estimates WHERE organization_id = $1 AND manufacturing_order_id = $2 ORDER BY version`, [c.organizationId, order.id])).rows;
  const baseline = estimates.find((row) => row.kind === "RELEASE_BASELINE") ?? null;
  const live = baseline ? null : await estimateFor(client, c, order, materials);
  const consumed = await consumedCost(client, c, order.id);
  // Material: issued at Inventory's issue cost, less returns; used (consumption), scrapped, and what is still in production custody.
  const lineRows = materials.map((material) => {
    const figures = lineFigures(material);
    const netCost = sub(D(material.issued_cost), D(material.returned_cost ?? 0));
    const netQuantity = figures.netIssued;
    const average = netQuantity > ZERO ? div(netCost, netQuantity) : null;
    const used = consumed.byLine.get(material.id) ?? (figures.consumed === ZERO ? ZERO : null);
    const custodyValue = average === null ? ZERO : D(money(mul(average, figures.custody)));
    return { material, figures, netCost, average, used, custodyValue };
  });
  const scrap = (await client.query(
    `SELECT scrap.scrap_type, scrap.disposition, scrap.loss_class, sum(line.total_cost) AS cost, count(DISTINCT scrap.id)::int AS notes FROM tenant.manufacturing_scrap_lines line
       JOIN tenant.manufacturing_scraps scrap ON scrap.id = line.scrap_id WHERE scrap.organization_id = $1 AND scrap.manufacturing_order_id = $2 AND scrap.status = 'POSTED' AND scrap.correction_status <> 'REVERSED'
      GROUP BY 1, 2, 3`, [c.organizationId, order.id])).rows;
  const receipts = (await client.query(
    `SELECT receipt.*, note.receipt_number AS note_number, note.id AS note_id FROM tenant.manufacturing_goods_receipts receipt LEFT JOIN tenant.manufacturing_finished_goods_receipts note ON note.id = receipt.finished_goods_receipt_id
      WHERE receipt.organization_id = $1 AND receipt.manufacturing_order_id = $2 ORDER BY receipt.received_at`, [c.organizationId, order.id])).rows;
  const reversals = (await client.query(
    `SELECT correction.receipt_id, sum(correction.total_cost) AS cost FROM tenant.manufacturing_finished_goods_receipt_corrections correction JOIN tenant.manufacturing_finished_goods_receipts note ON note.id = correction.receipt_id
      WHERE note.organization_id = $1 AND note.manufacturing_order_id = $2 AND correction.status = 'APPROVED' GROUP BY 1`, [c.organizationId, order.id])).rows;
  const applications = (await client.query(`SELECT application.*, batch.batch_reference, category.name AS category_name FROM tenant.manufacturing_cost_applications application
      LEFT JOIN tenant.manufacturing_overhead_categories category ON category.id = application.category_id
      LEFT JOIN tenant.manufacturing_production_batches batch ON batch.id = application.production_batch_id WHERE application.organization_id = $1 AND application.manufacturing_order_id = $2 ORDER BY application.created_at`,
    [c.organizationId, order.id])).rows;
  const adjustments = (await client.query(`SELECT * FROM tenant.manufacturing_cost_adjustments WHERE organization_id = $1 AND manufacturing_order_id = $2 ORDER BY requested_at DESC`, [c.organizationId, order.id])).rows;
  const events = (await client.query(`SELECT * FROM tenant.manufacturing_cost_events WHERE organization_id = $1 AND manufacturing_order_id = $2 ORDER BY occurred_at DESC LIMIT 200`, [c.organizationId, order.id])).rows;
  const people = await names(client, [...events.map((row) => row.actor_user_id), ...adjustments.flatMap((row) => [row.requested_by, row.decided_by]), ...applications.map((row) => row.applied_by)]);
  const reconciliation = await reconcileWip(client, c, order);
  const pending = ["COMPLETED", "CANCELLED"].includes(order.status) ? [] : await pendingApplications(client, c, order);
  const variance = await getMoMaterialVariances(client, { ...c, permissions: [...new Set([...(c.permissions ?? []), "manufacturing.variance.view", "manufacturing.variance.cost_view"])] }, order.id);

  const labor = D(order.wip_applied_labor_cost ?? 0);
  const overhead = D(order.wip_applied_overhead_cost ?? 0);
  const materialIssued = D(order.wip_material_cost);
  const capitalised = D(order.wip_capitalised_cost);
  const conversionCapitalised = D(order.wip_conversion_capitalised_cost ?? 0);
  const scrapOut = D(order.wip_scrap_cost ?? 0);
  const closed = D(order.wip_variance_cost);
  const adjusted = D(order.wip_adjusted_cost ?? 0);
  const custody = lineRows.reduce((sum, row) => add(sum, row.custodyValue), ZERO);
  const usedMaterial = consumed.total;
  const scrapMaterial = scrap.filter((row) => row.scrap_type === "ISSUED_MATERIAL").reduce((sum, row) => add(sum, D(row.cost ?? 0)), ZERO);
  const abnormal = scrap.filter((row) => row.loss_class === "ABNORMAL" || row.disposition === "RECOVERABLE").reduce((sum, row) => add(sum, D(row.cost ?? 0)), ZERO);
  const wip = wipBalance(order);
  const figures = { materialIssued, applied: add(labor, overhead), capitalised };
  const openAdjustments = adjustments.filter((row) => row.status === "REQUESTED").length;
  const accepted = D(order.accepted_quantity);
  const received = sub(D(order.received_quantity), ZERO);
  // Actual eligible cost: material actually used (consumed and scrapped as normal loss) plus applied labor and overhead; abnormal loss and
  // recoverable scrap left work in progress and are not product cost.
  const incurred = usedMaterial === null ? null : add(add(usedMaterial, add(labor, overhead)), sub(scrapMaterial, abnormal > scrapMaterial ? scrapMaterial : abnormal));
  const perGood = incurred === null || accepted === ZERO ? null : div(incurred, accepted);
  const receivedValue = receipts.reduce((sum, row) => add(sum, D(row.total_cost)), ZERO);
  const perReceived = received > ZERO ? div(sub(capitalised, ZERO), received) : null;
  // The plan: the frozen baseline (or, before release, the estimate now) — and the same plan for the output actually produced.
  const plannedTotal = baseline ? (baseline.total_cost === null ? null : D(baseline.total_cost)) : live?.total ?? null;
  const plannedMaterial = baseline ? (baseline.material_cost === null ? null : D(baseline.material_cost)) : live?.material ?? null;
  const plannedLabor = baseline ? (baseline.labor_cost === null ? null : D(baseline.labor_cost)) : live?.labor ?? null;
  const plannedOverhead = baseline ? (baseline.overhead_cost === null ? null : D(baseline.overhead_cost)) : live?.overhead ?? null;
  const planned = D(order.planned_base_quantity);
  const plannedUnit = plannedTotal === null || planned === ZERO ? null : div(plannedTotal, planned);
  const expectedMaterial = variance ? (variance.totals.expectedCost === null ? null : D(variance.totals.expectedCost)) : null;
  const batchesReported = Number((await client.query(`SELECT count(DISTINCT production_batch_id)::int AS n FROM tenant.manufacturing_production_entries WHERE organization_id = $1 AND manufacturing_order_id = $2
      AND status = 'REPORTED' AND production_batch_id IS NOT NULL`, [c.organizationId, order.id])).rows[0].n);
  // Expected conversion for the output produced, at the order's (frozen) rates.
  const expectedOf = (rate) => (rate ? conversionFor({ basis: rate.basis, rate: rate.rate }, { units: accepted, batches: batchesReported, materialCost: usedMaterial }) : null);
  const expectedLabor = expectedOf(laborRate);
  const expectedOverhead = overheadRates.length ? overheadRates.reduce((sum, rate) => (expectedOf(rate) === null ? sum : add(sum, expectedOf(rate))), ZERO) : null;
  // Overhead (and labor) per frozen rate: applied so far (net of reversals), still due, or over-applied awaiting an approved reversal.
  const batches = (await client.query(
    `SELECT batch.id, batch.batch_reference, batch.status, batch.setup_confirmed_at, (SELECT count(*)::int FROM tenant.manufacturing_production_entries entry WHERE entry.production_batch_id = batch.id AND entry.status = 'REPORTED') AS reported
       FROM tenant.manufacturing_production_batches batch WHERE batch.organization_id = $1 AND batch.manufacturing_order_id = $2 ORDER BY batch.started_at`, [c.organizationId, order.id])).rows;
  const rateLines = frozen.map((rate) => {
    const appliedNet = applications.filter((row) => row.order_rate_id === rate.id).reduce((sum, row) => add(sum, signed(row)), ZERO);
    const pieces = pending.find((row) => row.orderRate?.id === rate.id)?.pieces ?? [];
    const due = pieceSum(pieces, "APPLY");
    const over = sub(ZERO, pieceSum(pieces, "REVERSE"));
    return { ...rateView(rate), frozenAt: rate.frozen_at, frozenLate: rate.frozen_late, applied: money(appliedNet), due: money(due), overApplied: money(over), calculated: money(sub(add(appliedNet, due), over)),
      batchesCharged: rate.basis === "PER_BATCH" ? applications.filter((row) => row.order_rate_id === rate.id && row.direction === "APPLY").length : null };
  });
  const expectedTotal = expectedMaterial === null ? null : add(add(expectedMaterial, expectedLabor ?? ZERO), expectedOverhead ?? ZERO);
  const usage = variance?.totals.usageCost === null || variance?.totals.usageCost === undefined ? null : D(variance.totals.usageCost);
  const materialVariance = usedMaterial === null || expectedMaterial === null ? null : sub(add(usedMaterial, scrapMaterial), expectedMaterial);
  const show = (value) => (value === null || value === undefined ? null : money(value));
  const state = stateOf(order, figures, reconciliation, openAdjustments);
  return {
    orderId: order.id, orderNumber: order.mo_number, orderStatus: order.status, orderStatusLabel: STATUS_LABEL[order.status], currency: baseline?.currency_code ?? "INR",
    costingStatus: state, policy: { model: "ISSUE_BASED_WIP", modelLabel: "Material is work in progress from issue (at Inventory's issue cost); returns, scrap, receipts and completion take it out.",
      receiptAllocation: "Material per unit of the recipe at its average issue cost, plus applied labor and overhead per equivalent accepted unit",
      labor: settings.LABOR ? rateView(laborRate) ?? { missing: true } : null, overhead: settings.OVERHEAD ? overheadRates.map(rateView) : null,
      overheadMissing: settings.OVERHEAD && !overheadRates.length, ratesFrozen: frozen.length > 0, frozenLate: frozen.some((row) => row.frozen_late),
      invalidRates: (resolved?.invalid ?? []).map((row) => `${row.name} (${row.rate_code})`), laborEnabled: settings.LABOR, overheadEnabled: settings.OVERHEAD },
    rates: rateLines,
    batches: batches.map((row) => ({ id: row.id, reference: row.batch_reference, status: row.status, setupConfirmedAt: row.setup_confirmed_at, reported: row.reported,
      eligible: Boolean(row.setup_confirmed_at) || row.reported > 0, mayConfirm: !row.setup_confirmed_at && ["IN_PROGRESS", "ON_HOLD"].includes(order.status)
        && (has(c, "manufacturing.production.edit_draft") || has(c, "manufacturing.mo.record_production")) })),
    quantities: { planned: q(planned), reported: q(D(order.reported_quantity)), accepted: q(accepted), rejected: q(D(order.rejected_quantity)), received: q(D(order.received_quantity)) },
    planned: { source: baseline ? `Baseline v${baseline.version}, ${new Date(baseline.created_at).toISOString().slice(0, 10)}` : "Estimate now (no baseline: the order is not released)",
      material: show(plannedMaterial), labor: show(plannedLabor), overhead: show(plannedOverhead), total: show(plannedTotal), unit: plannedUnit === null ? null : q(plannedUnit, 2),
      complete: baseline ? baseline.complete : (live?.missing.length ?? 0) === 0, missing: baseline ? baseline.missing : live?.missing ?? [] },
    estimates: estimates.map((row) => ({ id: row.id, version: row.version, kind: row.kind, total: m(row.total_cost), material: m(row.material_cost), labor: m(row.labor_cost), overhead: m(row.overhead_cost),
      unit: row.unit_cost === null ? null : q(D(row.unit_cost), 2), complete: row.complete, at: row.created_at })),
    actual: { materialIssued: show(materialIssued), materialUsed: show(usedMaterial), materialInCustody: show(custody), materialScrapped: show(scrapMaterial), labor: settings.LABOR || labor > ZERO ? show(labor) : null,
      overhead: settings.OVERHEAD || overhead > ZERO ? show(overhead) : null, incurred: show(incurred), valuationComplete: usedMaterial !== null },
    dispositions: { capitalised: show(capitalised), conversionCapitalised: show(conversionCapitalised), scrapOut: show(scrapOut), abnormalLoss: show(abnormal), closedToVariance: show(closed), adjusted: show(adjusted),
      wip: show(wip), wipMaterialInCustody: show(custody), wipConsumedNotCapitalised: show(max(sub(wip, custody), ZERO)) },
    rollForward: { opening: "0.00", added: show(add(materialIssued, add(labor, overhead))), toFinishedGoods: show(capitalised), scrapAndLoss: show(scrapOut), toVariance: show(add(closed, adjusted)), closing: show(wip) },
    unit: { plannedPerUnit: plannedUnit === null ? null : q(plannedUnit, 2), actualPerAccepted: perGood === null ? null : q(perGood, 2), capitalisedPerReceived: perReceived === null ? null : q(perReceived, 2),
      note: accepted === ZERO ? "No accepted output yet: the cost per unit is not known." : null },
    variances: {
      againstPlan: plannedTotal === null || incurred === null ? null : { planned: show(plannedTotal), actual: show(incurred), variance: show(sub(incurred, plannedTotal)),
        pct: plannedTotal > ZERO ? q(div(mul(sub(incurred, plannedTotal), 100n * 1_000_000n), plannedTotal), 2) : null,
        note: D(order.accepted_quantity) < planned && order.status !== "COMPLETED" ? "The order is still producing: compare against equivalent production, not the whole plan." : null },
      againstEquivalent: expectedTotal === null || incurred === null ? null : { expected: show(expectedTotal), actual: show(incurred), variance: show(sub(incurred, expectedTotal)) },
      material: { expected: show(expectedMaterial), actual: usedMaterial === null ? null : show(add(usedMaterial, scrapMaterial)), total: show(materialVariance), usage: show(usage),
        price: materialVariance === null || usage === null ? null : show(sub(materialVariance, usage)), scrap: show(scrapMaterial), note: "Usage and price overlap the total: they explain it, they do not add to it." },
      labor: settings.LABOR || labor > ZERO ? { expected: show(expectedLabor), applied: show(labor), variance: expectedLabor === null ? null : show(sub(labor, expectedLabor)) } : null,
      overhead: settings.OVERHEAD || overhead > ZERO ? { expected: show(expectedOverhead), applied: show(overhead), variance: expectedOverhead === null ? null : show(sub(overhead, expectedOverhead)) } : null,
      yield: { rejected: q(D(order.rejected_quantity)), cost: plannedUnit === null ? null : show(mul(plannedUnit, D(order.rejected_quantity))), note: "Rejected units at the planned unit cost — already part of the material used, never charged again." },
    },
    materials: lineRows.map((row) => ({ materialId: row.material.id, code: row.material.item_code, name: row.material.item_name, uom: row.material.uom_code, kind: row.material.kind ?? null,
      issued: q(row.figures.netIssued), consumed: q(row.figures.consumed), scrapped: q(row.figures.scrapped), returned: q(D(row.material.returned_quantity)), inCustody: q(row.figures.custody),
      averageCost: detail && row.average !== null ? q(row.average, 4) : null, issuedCost: show(row.netCost), usedCost: row.used === null ? null : show(row.used), custodyCost: show(row.custodyValue),
      estimatedUnitCost: detail && row.material.estimated_unit_cost !== null ? q(D(row.material.estimated_unit_cost), 4) : null, estimatedCost: m(row.material.estimated_cost) })),
    receipts: receipts.map((row) => ({ id: row.note_id ?? row.id, number: row.note_number ?? row.receipt_number, quantity: q(D(row.quantity)), unitCost: q(D(row.unit_cost), 2), total: m(row.total_cost),
      material: row.cost_basis?.material ?? m(row.total_cost), conversion: row.cost_basis?.conversion ?? "0.00", journalEntryId: row.journal_entry_id, at: row.received_at,
      reversed: m(reversals.find((entry) => entry.receipt_id === row.finished_goods_receipt_id)?.cost ?? null) })),
    receivedValue: show(receivedValue),
    applications: applications.map((row) => ({ id: row.id, component: row.component, componentLabel: COMPONENT_LABEL[row.component], category: row.category_name ?? null, basis: row.basis, basisLabel: BASIS_LABEL[row.basis],
      direction: row.direction, reason: row.reason, rate: detail ? q(D(row.rate)) : null, rateVersion: row.rate_version, batch: row.batch_reference ?? null, quantity: q(D(row.basis_quantity)), amount: m(row.amount),
      journalEntryId: row.journal_entry_id, by: people.get(row.applied_by) ?? "System", at: row.created_at })),
    pending: pending.map((row) => ({ component: row.component, componentLabel: COMPONENT_LABEL[row.component], category: row.orderRate?.category_name ?? null, missingRate: Boolean(row.missing),
      missingValuation: Boolean(row.missingValuation), amount: show(pieceSum(row.pieces, "APPLY")), reverse: show(sub(ZERO, pieceSum(row.pieces, "REVERSE"))), pieces: row.pieces?.length ?? 0 })),
    scrap: scrap.map((row) => ({ type: row.scrap_type, disposition: row.disposition, lossClass: row.loss_class, notes: row.notes, cost: m(row.cost) })),
    adjustments: adjustments.map((row) => ({ id: row.id, number: row.adjustment_number, direction: row.direction, amount: m(row.amount), reason: row.reason, status: row.status,
      requestedBy: people.get(row.requested_by) ?? null, requestedAt: row.requested_at, decidedBy: people.get(row.decided_by) ?? null, decidedAt: row.decided_at, note: row.decision_note,
      journalEntryId: row.journal_entry_id, mayDecide: row.status === "REQUESTED" && has(c, COST.adjustApprove) && row.requested_by !== c.userId })),
    reconciliation,
    finalization: { finalizedAt: order.cost_finalized_at, problems: order.cost_finalized_at ? [] : await finalizationProblems(client, c, order) },
    history: events.map((row) => ({ action: row.action, label: ACTION_LABEL[row.action] ?? row.action, amount: m(row.amount), summary: row.summary, actor: people.get(row.actor_user_id) ?? "System", at: row.occurred_at })),
    can: {
      apply: has(c, COST.apply) && ["IN_PROGRESS", "ON_HOLD", "COMPLETION_PENDING"].includes(order.status) && pending.some((row) => row.pieces?.some((piece) => piece.direction === "APPLY")),
      reverse: has(c, COST.apply) && has(c, COST.adjustApprove) && ["IN_PROGRESS", "ON_HOLD", "COMPLETION_PENDING"].includes(order.status) && pending.some((row) => row.pieces?.some((piece) => piece.direction === "REVERSE")),
      estimate: has(c, COST.estimate) && !["DRAFT", "AWAITING_APPROVAL", "CANCELLED"].includes(order.status), reconcile: has(c, COST.reconcile),
      adjust: has(c, COST.adjustRequest) && !order.cost_finalized_at && !["DRAFT", "AWAITING_APPROVAL"].includes(order.status), finalize: has(c, COST.finalize) && !order.cost_finalized_at,
      viewDetail: detail, export: has(c, COST.export),
    },
  };
}

// What a receipt of `quantity` (base units) would carry now — material and applied conversion — and what would still be applied first.
export async function previewReceiptCost(client, c, orderId, quantity) {
  needCostView(c);
  const order = await loadCostOrder(client, c, orderId);
  const base = D(String(quantity ?? "0"));
  if (base <= ZERO) throw costError(400, "MFG_COST_FGR_NOT_READY", "Enter the quantity to receive.");
  const cost = await costOf(client, c, order, base);
  const pending = await pendingApplications(client, c, order);
  return { orderId: order.id, quantity: q(base), status: cost.status, message: cost.message, material: cost.material === undefined ? null : money(cost.material),
    conversion: cost.conversion === undefined ? null : money(cost.conversion), total: cost.total === null ? null : money(cost.total), unitCost: cost.unitCost === null ? null : q(cost.unitCost, 2),
    wipBefore: money(cost.wipBefore), pendingApplication: money(pending.reduce((sum, row) => add(sum, pieceSum(row.pieces, "APPLY")), ZERO)),
    note: "Labor and overhead still due are applied when the receipt posts, and it then carries its share." };
}

// ------------------------------------------------------------------ exceptions and reports
// Orders whose costing needs someone: Finance disagreeing, postings to recover, material without a valuation, labor or overhead enabled
// without a rate (or due and not applied), adjustments waiting, completed orders not finalized.
export async function getCostingExceptions(client, c) {
  needCostView(c);
  const orders = (await client.query(`SELECT * FROM tenant.manufacturing_orders WHERE organization_id = $1 AND status IN ('RELEASED', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETION_PENDING', 'COMPLETED')
      AND cost_finalized_at IS NULL AND (wip_material_cost <> 0 OR status <> 'RELEASED') ORDER BY updated_at DESC LIMIT 200`, [c.organizationId])).rows;
  const out = [];
  for (const order of orders) {
    const reconciliation = await reconcileWip(client, c, order);
    const push = (kind, message) => out.push({ kind, orderId: order.id, orderNumber: order.mo_number, orderStatusLabel: STATUS_LABEL[order.status], wip: money(wipBalance(order)), message });
    if (reconciliation.status === "IMBALANCE") push("WIP_IMBALANCE", `Finance holds ₹${reconciliation.finance} against ₹${reconciliation.book} on the order.`);
    if (reconciliation.pendingRecovery) push("RECOVERY", `${reconciliation.pendingRecovery} posting(s) need recovery.`);
    const consumed = await consumedCost(client, c, order.id);
    if (consumed.total === null) push("VALUATION_MISSING", "Some consumption has no Inventory valuation.");
    if (!["COMPLETED"].includes(order.status)) {
      const pending = await pendingApplications(client, c, order);
      for (const row of pending) {
        const label = `${COMPONENT_LABEL[row.component]}${row.orderRate?.category_name ? ` · ${row.orderRate.category_name}` : ""}`;
        if (row.missing) push("RATE_MISSING", `${COMPONENT_LABEL[row.component]} is enabled but has no approved rate in force.`);
        if (row.pieces?.some((piece) => piece.direction === "APPLY")) push("COST_NOT_APPLIED", `${label}: ₹${money(pieceSum(row.pieces, "APPLY"))} due and not yet applied.`);
        if (row.pieces?.some((piece) => piece.direction === "REVERSE")) push("REVERSAL_PENDING", `${label}: ₹${money(sub(ZERO, pieceSum(row.pieces, "REVERSE")))} over-applied after a correction — a reversal needs approval.`);
      }
    }
    if ((await frozenRatesOf(client, c, order)).some((row) => row.frozen_late)) push("RATES_FROZEN_LATE", "Its rates were frozen after release (the rates in force when costs were first applied).");
    const open = Number((await client.query(`SELECT count(*) AS n FROM tenant.manufacturing_cost_adjustments WHERE organization_id = $1 AND manufacturing_order_id = $2 AND status = 'REQUESTED'`, [c.organizationId, order.id])).rows[0].n);
    if (open) push("ADJUSTMENT_PENDING", `${open} cost adjustment(s) wait for a decision.`);
    if (order.status === "COMPLETED") push("NOT_FINALIZED", (await finalizationProblems(client, c, order)).map((row) => row.message).join(" ") || "Completed; the costing can be finalized.");
  }
  // Rates that cannot apply (a per-unit rate per a different unit than its product's).
  const invalid = (await client.query(`SELECT rate.rate_code, rate.name, item.code AS item_code FROM tenant.manufacturing_cost_rates rate JOIN tenant.items item ON item.id = rate.finished_item_id
      WHERE rate.organization_id = $1 AND rate.status = 'ACTIVE' AND rate.basis = 'PER_GOOD_UNIT' AND rate.uom_id IS NOT NULL AND rate.uom_id <> item.uom_id`, [c.organizationId])).rows;
  for (const row of invalid) out.push({ kind: "RATE_INVALID", orderId: null, orderNumber: row.rate_code, orderStatusLabel: null, wip: null, message: `${row.name} for ${row.item_code} is per a different unit than the product's.` });
  // Overhead periods whose actual pool and applied overhead differ and Finance has not reviewed (the last three months).
  for (let back = 1; back <= 3; back += 1) {
    const period = (await client.query(`SELECT to_char(date_trunc('month', current_date) - make_interval(months => $1), 'YYYY-MM') AS p`, [back - 1])).rows[0].p;
    for (const row of await overheadPeriodFigures(client, c, period)) {
      if (row.difference === null || (row.difference >= -10_000n && row.difference <= 10_000n) || row.last?.status === "RECONCILED") continue;
      out.push({ kind: "OVERHEAD_UNRECONCILED", orderId: null, orderNumber: period, orderStatusLabel: null, wip: null,
        message: `${row.category.name}: actual ₹${money(row.actual)} against applied ₹${money(row.applied)} — difference ₹${money(row.difference)} awaits Finance review.` });
    }
  }
  return out;
}

// The overhead reconciliation for a month: per category, the actual pool, what was applied, the difference and the last review.
export async function getOverheadReconciliation(client, c, period) {
  needCostView(c);
  const rows = await overheadPeriodFigures(client, c, period);
  const people = await names(client, rows.map((row) => row.last?.reconciled_by));
  const total = (pick) => money(rows.reduce((sum, row) => (pick(row) === null ? sum : add(sum, pick(row))), ZERO));
  return { period, rows: rows.map((row) => ({ categoryId: row.category.id, code: row.category.code, category: row.category.name, poolAccounts: row.category.cost_pool_account_ids?.length ?? 0,
    actual: row.actual === null ? null : money(row.actual), applied: money(row.applied), difference: row.difference === null ? null : money(row.difference),
    status: row.actual === null ? "POOL_NOT_MAPPED" : row.last?.status ?? (row.difference >= -10_000n && row.difference <= 10_000n ? "BALANCED" : "REVIEW_REQUIRED"),
    lastReview: row.last ? { status: row.last.status, note: row.last.note, financeReference: row.last.finance_reference, by: people.get(row.last.reconciled_by) ?? null, at: row.last.reconciled_at } : null })),
    totals: { actual: total((row) => row.actual), applied: total((row) => row.applied), difference: total((row) => row.difference) },
    note: "Applied overhead is posted to Manufacturing overhead applied; the actual cost sits in the category's expense accounts. A difference is Finance's to review and settle.",
    can: { reconcile: has(c, COST.reconcile) } };
}

export const COSTING_REPORTS = Object.freeze(["by-mo", "planned-vs-actual", "unit-cost", "material-breakdown", "applied", "batches", "wip", "wip-aging", "scrap-rejection", "receipts",
  "short-closed", "sales-linked", "exceptions", "inventory-to-gl", "overhead-by-mo", "overhead-by-category", "overhead-by-product", "overhead-batches", "overhead-per-unit", "overhead-wip-fg",
  "overhead-actual-vs-applied", "overhead-rate-history"]);
export async function getProductionCostReport(client, c, kind = "by-mo", filters = {}) {
  needCostView(c);
  if (!COSTING_REPORTS.includes(kind)) throw costError(400, "MFG_COST_NOT_READY", "Choose a costing report.");
  if (kind === "exceptions") return getCostingExceptions(client, c);
  if (kind === "overhead-actual-vs-applied") {
    const period = /^\d{4}-\d{2}$/.test(String(filters.period ?? "")) ? filters.period : (await client.query(`SELECT to_char(current_date, 'YYYY-MM') AS p`)).rows[0].p;
    return (await getOverheadReconciliation(client, c, period)).rows.map((row) => ({ period, ...row, lastReview: row.lastReview?.status ?? null }));
  }
  if (kind === "overhead-rate-history") {
    const rows = (await client.query(`SELECT rate.*, to_char(rate.effective_from, 'YYYY-MM-DD') AS from_day, to_char(rate.effective_until, 'YYYY-MM-DD') AS until_day, category.name AS category_name, item.code AS item_code, item.name AS item_name FROM tenant.manufacturing_cost_rates rate
        LEFT JOIN tenant.manufacturing_overhead_categories category ON category.id = rate.category_id LEFT JOIN tenant.items item ON item.id = rate.finished_item_id
        WHERE rate.organization_id = $1 ORDER BY rate.component, category.name NULLS FIRST, item.code NULLS FIRST, rate.effective_from DESC`, [c.organizationId])).rows;
    const people = await names(client, rows.flatMap((row) => [row.created_by, row.approved_by]));
    return rows.map((row) => ({ code: row.rate_code, name: row.name, component: COMPONENT_LABEL[row.component], category: row.category_name, product: row.item_code ? `${row.item_code} · ${row.item_name}` : "Company default",
      basis: BASIS_LABEL[row.basis], rate: q(D(row.rate)), version: row.version, status: row.status, from: row.from_day, until: row.until_day, setBy: people.get(row.created_by) ?? null,
      approvedBy: people.get(row.approved_by) ?? null, zeroReason: row.zero_reason }));
  }
  const values = [c.organizationId];
  const where = ["mo.organization_id = $1", "mo.status NOT IN ('DRAFT', 'AWAITING_APPROVAL', 'CANCELLED')"];
  if (filters.from) { values.push(String(filters.from)); where.push(`COALESCE(mo.actual_start_at, mo.created_at) >= $${values.length}::date`); }
  if (filters.to) { values.push(String(filters.to)); where.push(`COALESCE(mo.actual_start_at, mo.created_at) < ($${values.length}::date + 1)`); }
  if (filters.orderId) { values.push(uuid(filters.orderId, "Manufacturing order")); where.push(`mo.id = $${values.length}`); }
  if (filters.itemId) { values.push(uuid(filters.itemId, "Item")); where.push(`mo.finished_item_id = $${values.length}`); }
  if (kind === "short-closed") where.push("mo.short_close_reason IS NOT NULL");
  if (kind === "wip" || kind === "wip-aging") where.push("mo.status <> 'COMPLETED'");
  const orders = (await client.query(`SELECT mo.*, item.code AS item_code, item.name AS item_name, uom.code AS uom FROM tenant.manufacturing_orders mo JOIN tenant.items item ON item.id = mo.finished_item_id
      LEFT JOIN tenant.units_of_measure uom ON uom.id = item.uom_id WHERE ${where.join(" AND ")} ORDER BY COALESCE(mo.actual_start_at, mo.created_at) DESC LIMIT 300`, values)).rows;
  const ids = orders.map((row) => row.id);
  const baselines = ids.length ? new Map((await client.query(`SELECT * FROM tenant.manufacturing_cost_estimates WHERE organization_id = $1 AND manufacturing_order_id = ANY($2::uuid[]) AND kind = 'RELEASE_BASELINE'`,
    [c.organizationId, ids])).rows.map((row) => [row.manufacturing_order_id, row])) : new Map();
  const head = (order) => ({ orderId: order.id, orderNumber: order.mo_number, statusLabel: STATUS_LABEL[order.status], product: `${order.item_code} · ${order.item_name}`, uom: order.uom });
  const consumedOf = async (order) => (await consumedCost(client, c, order.id)).total;
  const incurredOf = async (order) => {
    const used = await consumedOf(order);
    return used === null ? null : add(used, add(D(order.wip_applied_labor_cost ?? 0), D(order.wip_applied_overhead_cost ?? 0)));
  };
  switch (kind) {
    case "by-mo": case "planned-vs-actual": case "unit-cost": case "short-closed": {
      const rows = [];
      for (const order of orders) {
        const baseline = baselines.get(order.id);
        const incurred = await incurredOf(order);
        const planned = baseline?.total_cost === null || baseline?.total_cost === undefined ? null : D(baseline.total_cost);
        const accepted = D(order.accepted_quantity);
        rows.push({ ...head(order), planned: m(planned), incurred: incurred === null ? null : money(incurred), variance: planned === null || incurred === null ? null : money(sub(incurred, planned)),
          labor: money(D(order.wip_applied_labor_cost ?? 0)), overhead: money(D(order.wip_applied_overhead_cost ?? 0)), capitalised: money(D(order.wip_capitalised_cost)), wip: money(wipBalance(order)),
          plannedQuantity: q(D(order.planned_base_quantity)), accepted: q(accepted), plannedUnit: baseline?.unit_cost ? q(D(baseline.unit_cost), 2) : null,
          actualUnit: incurred === null || accepted === ZERO ? null : q(div(incurred, accepted), 2), shortCloseReason: order.short_close_reason ?? null, finalized: Boolean(order.cost_finalized_at) });
      }
      if (kind !== "unit-cost") return rows;
      // Average good-unit cost per product (never across products).
      const byProduct = new Map();
      for (const row of rows.filter((entry) => entry.incurred !== null && Number(entry.accepted) > 0)) {
        const entry = byProduct.get(row.product) ?? { product: row.product, uom: row.uom, orders: 0, accepted: ZERO, incurred: ZERO };
        entry.orders += 1; entry.accepted = add(entry.accepted, D(row.accepted)); entry.incurred = add(entry.incurred, D(row.incurred));
        byProduct.set(row.product, entry);
      }
      return [...byProduct.values()].map((entry) => ({ product: entry.product, uom: entry.uom, orders: entry.orders, accepted: q(entry.accepted), incurred: money(entry.incurred),
        averageUnit: q(div(entry.incurred, entry.accepted), 2) }));
    }
    case "material-breakdown": {
      const rows = [];
      for (const order of orders) {
        const consumed = await consumedCost(client, c, order.id);
        for (const material of await loadMaterials(client, c, order.id)) {
          rows.push({ ...head(order), code: material.item_code, name: material.item_name, materialUom: material.uom_code, consumed: q(D(material.consumed_quantity)),
            usedCost: consumed.byLine.has(material.id) ? (consumed.byLine.get(material.id) === null ? null : money(consumed.byLine.get(material.id))) : "0.00",
            estimatedCost: m(material.estimated_cost), issuedCost: money(sub(D(material.issued_cost), D(material.returned_cost ?? 0))) });
        }
      }
      return rows;
    }
    case "applied": {
      if (!ids.length) return [];
      const rows = (await client.query(`SELECT application.*, mo.mo_number, batch.batch_reference, category.name AS category_name FROM tenant.manufacturing_cost_applications application
          JOIN tenant.manufacturing_orders mo ON mo.id = application.manufacturing_order_id LEFT JOIN tenant.manufacturing_overhead_categories category ON category.id = application.category_id
          LEFT JOIN tenant.manufacturing_production_batches batch ON batch.id = application.production_batch_id WHERE application.organization_id = $1 AND application.manufacturing_order_id = ANY($2::uuid[])
          ORDER BY application.created_at DESC`, [c.organizationId, ids])).rows;
      return rows.map((row) => ({ orderId: row.manufacturing_order_id, orderNumber: row.mo_number, component: COMPONENT_LABEL[row.component], category: row.category_name, basis: BASIS_LABEL[row.basis],
        direction: row.direction, rate: q(D(row.rate)), rateVersion: row.rate_version, batch: row.batch_reference, quantity: q(D(row.basis_quantity)), amount: money(signed(row)), reason: row.reason, at: row.created_at }));
    }
    case "overhead-by-mo": case "overhead-per-unit": case "overhead-wip-fg": {
      // Overhead per order — what was applied (net), how much of the conversion finished goods carry (overhead's share), what is still in progress.
      return orders.filter((order) => D(order.wip_applied_overhead_cost ?? 0) !== ZERO || kind === "overhead-by-mo").map((order) => {
        const overhead = D(order.wip_applied_overhead_cost ?? 0);
        const conversion = add(D(order.wip_applied_labor_cost ?? 0), overhead);
        const inGoods = conversion === ZERO ? ZERO : div(mul(D(order.wip_conversion_capitalised_cost ?? 0), overhead), conversion);
        const accepted = D(order.accepted_quantity);
        return { ...head(order), overhead: money(overhead), accepted: q(accepted), perUnit: accepted === ZERO ? null : q(div(overhead, accepted), 2), inFinishedGoods: money(inGoods),
          inProgress: money(sub(overhead, D(money(inGoods)))), note: kind === "overhead-wip-fg" ? "Overhead's share of the conversion receipts capitalised, in proportion to labor and overhead applied." : undefined };
      });
    }
    case "overhead-by-category": case "overhead-by-product": case "overhead-batches": {
      if (!ids.length) return [];
      const rows = (await client.query(`SELECT application.*, category.name AS category_name, mo.mo_number, mo.finished_item_id, item.code AS item_code, item.name AS item_name, batch.batch_reference
          FROM tenant.manufacturing_cost_applications application JOIN tenant.manufacturing_orders mo ON mo.id = application.manufacturing_order_id JOIN tenant.items item ON item.id = mo.finished_item_id
          LEFT JOIN tenant.manufacturing_overhead_categories category ON category.id = application.category_id LEFT JOIN tenant.manufacturing_production_batches batch ON batch.id = application.production_batch_id
          WHERE application.organization_id = $1 AND application.component = 'OVERHEAD' AND application.manufacturing_order_id = ANY($2::uuid[]) ORDER BY application.created_at`, [c.organizationId, ids])).rows;
      if (kind === "overhead-batches") {
        return rows.filter((row) => row.production_batch_id).map((row) => ({ orderId: row.manufacturing_order_id, orderNumber: row.mo_number, batch: row.batch_reference, category: row.category_name,
          rate: q(D(row.rate)), amount: money(signed(row)), at: row.created_at }));
      }
      const groups = new Map();
      for (const row of rows) {
        const key = kind === "overhead-by-category" ? row.category_name ?? "—" : `${row.item_code} · ${row.item_name}`;
        const entry = groups.get(key) ?? { key, orders: new Set(), applied: ZERO, reversed: ZERO };
        entry.orders.add(row.manufacturing_order_id);
        if (row.direction === "REVERSE") entry.reversed = add(entry.reversed, D(row.amount)); else entry.applied = add(entry.applied, D(row.amount));
        groups.set(key, entry);
      }
      return [...groups.values()].map((entry) => ({ [kind === "overhead-by-category" ? "category" : "product"]: entry.key, orders: entry.orders.size, applied: money(entry.applied), reversed: money(entry.reversed),
        net: money(sub(entry.applied, entry.reversed)) }));
    }
    case "batches": {
      if (!ids.length) return [];
      const rows = (await client.query(
        `SELECT mo.id AS order_id, mo.mo_number, batch.id AS batch_id, batch.batch_reference,
                (SELECT COALESCE(sum(entry.reported_quantity), 0) FROM tenant.manufacturing_production_entries entry WHERE entry.production_batch_id = batch.id AND entry.status = 'REPORTED') AS reported,
                (SELECT COALESCE(sum(line.total_cost * (line.base_quantity - line.corrected_quantity) / line.base_quantity), 0) FROM tenant.manufacturing_material_consumption_lines line
                   JOIN tenant.manufacturing_material_consumptions note ON note.id = line.consumption_id JOIN tenant.manufacturing_production_entries entry ON entry.id = note.production_entry_id
                  WHERE entry.production_batch_id = batch.id AND note.status = 'POSTED') AS material,
                (SELECT COALESCE(sum(application.amount), 0) FROM tenant.manufacturing_cost_applications application WHERE application.production_batch_id = batch.id) AS batch_costs
           FROM tenant.manufacturing_production_batches batch JOIN tenant.manufacturing_orders mo ON mo.id = batch.manufacturing_order_id
          WHERE batch.organization_id = $1 AND mo.id = ANY($2::uuid[]) ORDER BY mo.mo_number DESC, batch.batch_reference`, [c.organizationId, ids])).rows;
      return rows.map((row) => ({ orderId: row.order_id, orderNumber: row.mo_number, batch: row.batch_reference, reported: q(D(row.reported)), materialTraced: money(D(row.material)),
        batchCosts: money(D(row.batch_costs)), note: "Material traced through consumption recorded against the batch's entries; unlinked consumption is shared at the order." }));
    }
    case "wip": case "wip-aging": {
      const rows = [];
      for (const order of orders) {
        const wip = wipBalance(order);
        if (wip === ZERO) continue;
        const last = (await client.query(`SELECT max(occurred_at) AS at FROM tenant.manufacturing_order_events WHERE manufacturing_order_id = $1`, [order.id])).rows[0].at;
        rows.push({ ...head(order), wip: money(wip), lastActivity: last, days: last ? Math.floor((Date.now() - new Date(last).getTime()) / 864e5) : null,
          started: order.actual_start_at ?? null });
      }
      return kind === "wip-aging" ? rows.sort((a, b) => (b.days ?? 0) - (a.days ?? 0)) : rows;
    }
    case "scrap-rejection": {
      const rows = [];
      for (const order of orders) {
        const scrap = (await client.query(`SELECT scrap.scrap_type, scrap.loss_class, scrap.disposition, sum(line.total_cost) AS cost FROM tenant.manufacturing_scrap_lines line JOIN tenant.manufacturing_scraps scrap ON scrap.id = line.scrap_id
            WHERE scrap.manufacturing_order_id = $1 AND scrap.status = 'POSTED' AND scrap.correction_status <> 'REVERSED' GROUP BY 1, 2, 3`, [order.id])).rows;
        for (const entry of scrap) rows.push({ ...head(order), type: entry.scrap_type, lossClass: entry.loss_class, disposition: entry.disposition, cost: m(entry.cost) });
        if (D(order.rejected_quantity) > ZERO) {
          const baseline = baselines.get(order.id);
          rows.push({ ...head(order), type: "REJECTED_OUTPUT_UNITS", lossClass: null, disposition: null, rejected: q(D(order.rejected_quantity)),
            cost: baseline?.unit_cost ? money(mul(D(baseline.unit_cost), D(order.rejected_quantity))) : null });
        }
      }
      return rows;
    }
    case "receipts": {
      if (!ids.length) return [];
      const rows = (await client.query(`SELECT receipt.*, mo.mo_number FROM tenant.manufacturing_goods_receipts receipt JOIN tenant.manufacturing_orders mo ON mo.id = receipt.manufacturing_order_id
          WHERE receipt.organization_id = $1 AND receipt.manufacturing_order_id = ANY($2::uuid[]) ORDER BY receipt.received_at DESC`, [c.organizationId, ids])).rows;
      return rows.map((row) => ({ orderId: row.manufacturing_order_id, orderNumber: row.mo_number, number: row.receipt_number, quantity: q(D(row.quantity)), unitCost: q(D(row.unit_cost), 2),
        total: money(D(row.total_cost)), material: row.cost_basis?.material ?? null, conversion: row.cost_basis?.conversion ?? null, at: row.received_at }));
    }
    case "sales-linked": {
      if (!ids.length) return [];
      const rows = (await client.query(
        `SELECT allocation.manufacturing_order_id, mo.mo_number, sales_order.sales_order_number, version.customer_snapshot->>'displayName' AS customer, allocation.allocated_quantity, allocation.received_quantity
           FROM tenant.manufacturing_demand_allocations allocation JOIN tenant.manufacturing_orders mo ON mo.id = allocation.manufacturing_order_id
           JOIN tenant.manufacturing_sales_demands demand ON demand.id = allocation.demand_id JOIN tenant.sales_orders sales_order ON sales_order.id = demand.sales_order_id
           LEFT JOIN tenant.sales_order_versions version ON version.id = sales_order.current_version_id
          WHERE allocation.organization_id = $1 AND allocation.manufacturing_order_id = ANY($2::uuid[]) AND allocation.status <> 'RELEASED'`, [c.organizationId, ids])).rows;
      const byId = new Map(orders.map((order) => [order.id, order]));
      return rows.map((row) => {
        const order = byId.get(row.manufacturing_order_id);
        const unit = D(order.received_quantity) > ZERO ? div(D(order.wip_capitalised_cost), D(order.received_quantity)) : null;
        return { orderId: row.manufacturing_order_id, orderNumber: row.mo_number, salesOrder: row.sales_order_number, customer: row.customer, allocated: q(D(row.allocated_quantity)),
          received: q(D(row.received_quantity)), unitCost: unit === null ? null : q(unit, 2), note: "Cost of goods sold is recognised by Sales from Inventory's valuation, not from this figure." };
      });
    }
    case "inventory-to-gl": {
      const rows = [];
      for (const order of orders) rows.push({ ...head(order), ...(await reconcileWip(client, c, order)) });
      return rows;
    }
    default: return [];
  }
}

export { canSeeCost, plannedBatches };
