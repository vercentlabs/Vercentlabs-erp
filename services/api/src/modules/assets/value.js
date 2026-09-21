// Asset value (F242-F251): deterministic straight-line, declining-balance and units-of-production
// depreciation in integer minor units, the schedule, approved-and-posted depreciation runs, usage
// readings, and revaluation/impairment. Nothing here rewrites posted history: a correction is a
// reversal or a new adjustment that regenerates only the not-yet-posted schedule lines.
import { AssetError, dateRequired, fromCents, loadAsset, loadSettings, need, nextNumber, nonNegative, oneOf, positive, qx, recordAssetEvent, requiredText, textOrNull, toCents, today, uuid } from "./common.js";
import { postAssetJournal, reverseAssetJournal } from "./accounting-bridge.js";

const monthStart = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
const monthEnd = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
const addMonths = (d, n) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
const iso = (d) => d.toISOString().slice(0, 10);
const asDate = (s) => new Date(`${String(s).slice(0, 10)}T00:00:00Z`);

// Weights per period: full months are 1; a mid-month convention takes half a month at each end.
function periodWeights(months, convention) {
  if (convention === "mid_month") return [0.5, ...Array(Math.max(0, months - 1)).fill(1), 0.5];
  return Array(months).fill(1);
}

// Pure schedule maths, exported for direct testing. openingCents/salvageCents are integers.
export function buildDepreciationLines({ method, openingCents, salvageCents, months, start, convention = "full_month", annualRatePercent = 0 }) {
  if (method === "none" || method === "units_of_production" || months < 1) return [];
  const startMonth = convention === "next_month" ? addMonths(monthStart(start), 1) : monthStart(start);
  const weights = periodWeights(months, convention);
  const depreciable = openingCents - salvageCents;
  if (depreciable <= 0n) return [];
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const lines = [];
  let open = openingCents;
  let taken = 0n;
  for (let i = 0; i < weights.length; i += 1) {
    const last = i === weights.length - 1;
    let amount;
    if (last) amount = depreciable - taken;
    else if (method === "straight_line") amount = (depreciable * BigInt(Math.round(weights[i] * 1000))) / BigInt(Math.round(totalWeight * 1000));
    else {
      const rate = annualRatePercent > 0 ? annualRatePercent / 100 : 2 / (months / 12);
      const monthly = rate / 12;
      amount = BigInt(Math.round(Number(open) * monthly * weights[i]));
      if (amount > open - salvageCents) amount = open - salvageCents;
    }
    if (amount < 0n) amount = 0n;
    const ps = addMonths(startMonth, i);
    lines.push({ periodStart: iso(ps), periodEnd: iso(monthEnd(ps)), opening: open, amount, closing: open - amount });
    open -= amount;
    taken += amount;
  }
  return lines;
}

async function insertLines(client, c, asset, lines, method) {
  for (const l of lines) {
    await client.query(
      `INSERT INTO tenant.asset_depreciation_schedules(organization_id,company_id,asset_id,period_start,period_end,opening_book_value,depreciation_amount,closing_book_value,status,method)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,'planned',$9) ON CONFLICT (asset_id,period_end) DO NOTHING`,
      [c.organizationId, c.companyId, asset.id, l.periodStart, l.periodEnd, fromCents(l.opening), fromCents(l.amount), fromCents(l.closing), method]);
  }
}

// F248: the schedule created at capitalisation.
export async function generateSchedule(client, c, asset, category, settings) {
  const method = asset.depreciation_method;
  if (method === "none" || method === "units_of_production") return [];
  const convention = category.depreciation_convention || settings.depreciation_convention || "full_month";
  const lines = buildDepreciationLines({ method, openingCents: toCents(asset.capitalized_cost), salvageCents: toCents(asset.residual_value), months: asset.useful_life_months, start: asDate(asset.depreciation_start_date), convention, annualRatePercent: Number(category.declining_rate || 0) });
  await insertLines(client, c, asset, lines, method);
  return lines;
}

// After a value adjustment: drop the not-yet-posted lines and rebuild them over the remaining life from the
// current carrying value. Posted lines are never touched.
async function regenerateSchedule(client, c, assetId) {
  const asset = await loadAsset(client, c, assetId, { lock: true });
  if (["none", "units_of_production"].includes(asset.depreciation_method)) return;
  const category = (await client.query(`SELECT * FROM tenant.asset_categories WHERE id=$1`, [asset.category_id])).rows[0];
  const settings = await loadSettings(client, c);
  await client.query(`DELETE FROM tenant.asset_depreciation_schedules WHERE asset_id=$1 AND status IN ('planned','ready') AND run_id IS NULL`, [asset.id]);
  const posted = await qx(client, `SELECT count(*)::int AS n,max(period_end) AS last_end FROM tenant.asset_depreciation_schedules WHERE asset_id=$1 AND status='posted'`, [asset.id]);
  const remaining = Math.max(1, asset.useful_life_months - posted.rows[0].n);
  const from = posted.rows[0].last_end ? addMonths(monthStart(asDate(posted.rows[0].last_end)), 1) : asDate(asset.depreciation_start_date);
  const nbv = toCents(asset.net_book_value);
  const salvage = toCents(asset.residual_value) < nbv ? toCents(asset.residual_value) : nbv;
  const lines = buildDepreciationLines({ method: asset.depreciation_method, openingCents: nbv, salvageCents: salvage, months: remaining, start: from, convention: "full_month", annualRatePercent: Number(category.declining_rate || 0) });
  await insertLines(client, c, asset, lines, asset.depreciation_method);
}

export async function listDepreciationSchedule(client, c, filters = {}) {
  need(c, "assets.view");
  need(c, "assets.reports.view");
  const values = [c.organizationId, c.companyId];
  let where = "";
  if (filters.assetId) { values.push(uuid(filters.assetId, "Asset")); where += ` AND s.asset_id=$${values.length}`; }
  if (filters.status) { values.push(String(filters.status)); where += ` AND s.status=$${values.length}`; }
  const res = await qx(client, `SELECT s.*,a.asset_number,a.name AS asset_name FROM tenant.asset_depreciation_schedules s JOIN tenant.assets a ON a.id=s.asset_id WHERE s.organization_id=$1 AND s.company_id=$2${where} ORDER BY s.period_end,a.asset_number LIMIT 500`, values);
  return res.rows;
}

// F247: metered usage drives the units-of-production charge for the period.
export async function recordAssetUsage(client, c, assetId, input) {
  if (!(c.roleSlugs?.includes("organization_owner") || c.permissions?.includes("assets.maintain") || c.permissions?.includes("assets.depreciate"))) need(c, "assets.depreciate");
  const a = await loadAsset(client, c, assetId, { lock: true });
  if (a.depreciation_method !== "units_of_production") throw new AssetError(409, "Usage is recorded only for units-of-production assets.", "ASSET_STATE_INVALID");
  if (!["available", "assigned", "in_maintenance"].includes(a.status)) throw new AssetError(409, "Usage can only be recorded for a capitalized, in-service asset.", "ASSET_STATE_INVALID");
  const units = positive(input.units, "Units");
  const periodEnd = dateRequired(input.periodEnd, "Period end");
  const total = Number(a.total_units);
  const others = await client.query(`SELECT COALESCE(sum(units),0)::float AS used FROM tenant.asset_usage_readings WHERE asset_id=$1 AND period_end<>$2`, [a.id, periodEnd]);
  if (Number(others.rows[0].used) + units > total) throw new AssetError(409, "Recorded usage would exceed the asset's total expected units.", "ASSET_USAGE_EXCEEDS_TOTAL");
  const existing = await client.query(`SELECT status FROM tenant.asset_depreciation_schedules WHERE asset_id=$1 AND period_end=$2`, [a.id, periodEnd]);
  if (existing.rows[0] && existing.rows[0].status !== "planned") throw new AssetError(409, "Depreciation for that period is already in a run; it cannot be restated.", "ASSET_PERIOD_LOCKED");
  await client.query(`INSERT INTO tenant.asset_usage_readings(organization_id,company_id,asset_id,period_end,units,recorded_by) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT (asset_id,period_end) DO UPDATE SET units=EXCLUDED.units,recorded_by=EXCLUDED.recorded_by`, [c.organizationId, c.companyId, a.id, periodEnd, String(units), c.userId]);
  const base = toCents(a.capitalized_cost) - toCents(a.residual_value);
  const postedSoFar = (await client.query(`SELECT COALESCE(sum(depreciation_amount),0)::text AS d FROM tenant.asset_depreciation_schedules WHERE asset_id=$1 AND status='posted'`, [a.id])).rows[0].d;
  let amount = (base * BigInt(Math.round(units * 1000000))) / BigInt(Math.round(total * 1000000));
  const remainingBase = base - toCents(postedSoFar);
  if (amount > remainingBase) amount = remainingBase;
  const periodStart = iso(monthStart(asDate(periodEnd)));
  const opening = toCents(a.net_book_value);
  await client.query(`DELETE FROM tenant.asset_depreciation_schedules WHERE asset_id=$1 AND period_end=$2 AND status='planned'`, [a.id, periodEnd]);
  await client.query(`INSERT INTO tenant.asset_depreciation_schedules(organization_id,company_id,asset_id,period_start,period_end,opening_book_value,depreciation_amount,closing_book_value,status,method,units) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'planned','units_of_production',$9)`,
    [c.organizationId, c.companyId, a.id, periodStart, periodEnd, fromCents(opening), fromCents(amount), fromCents(opening - amount), String(units)]);
  await client.query(`UPDATE tenant.assets SET units_used=(SELECT COALESCE(sum(units),0) FROM tenant.asset_usage_readings WHERE asset_id=$1),updated_at=now() WHERE id=$1`, [a.id]);
  await recordAssetEvent(client, c, a.id, "asset.usage_recorded", { periodEnd, units, depreciation: fromCents(amount) });
  return { periodEnd, units, depreciationAmount: fromCents(amount) };
}

// ------------------------------------------------------------------ F249: runs
export async function listDepreciationRuns(client, c) {
  need(c, "assets.view");
  need(c, "assets.reports.view");
  const res = await qx(client, `SELECT * FROM tenant.asset_depreciation_runs WHERE organization_id=$1 AND company_id=$2 ORDER BY period_end DESC,created_at DESC LIMIT 200`, [c.organizationId, c.companyId]);
  return res.rows;
}

export async function getDepreciationRun(client, c, runId) {
  need(c, "assets.reports.view");
  const run = await qx(client, `SELECT * FROM tenant.asset_depreciation_runs WHERE organization_id=$1 AND company_id=$2 AND id=$3`, [c.organizationId, c.companyId, uuid(runId, "Run")]);
  if (!run.rows[0]) throw new AssetError(404, "Depreciation run was not found.", "ASSET_NOT_FOUND");
  const lines = await qx(client, `SELECT s.*,a.asset_number,a.name AS asset_name FROM tenant.asset_depreciation_schedules s JOIN tenant.assets a ON a.id=s.asset_id WHERE s.organization_id=$1 AND s.run_id=$2 ORDER BY a.asset_number,s.period_end`, [c.organizationId, run.rows[0].id]);
  return { run: run.rows[0], lines: lines.rows };
}

export async function createDepreciationRun(client, c, input) {
  need(c, "assets.depreciate");
  const cutoff = dateRequired(input.periodEnd, "Period end");
  const live = await client.query(`SELECT id FROM tenant.asset_depreciation_runs WHERE organization_id=$1 AND company_id=$2 AND period_end=$3 AND status<>'reversed'`, [c.organizationId, c.companyId, cutoff]);
  if (live.rows[0]) throw new AssetError(409, "A depreciation run already exists for that period.", "ASSET_RUN_EXISTS");
  const eligible = await qx(client,
    `SELECT s.id,s.depreciation_amount FROM tenant.asset_depreciation_schedules s JOIN tenant.assets a ON a.id=s.asset_id
     WHERE s.organization_id=$1 AND s.company_id=$2 AND s.status='planned' AND s.run_id IS NULL AND s.period_end<=$3 AND s.depreciation_amount>0
       AND a.status IN ('available','assigned','in_maintenance','pending_disposal') FOR UPDATE OF s`, [c.organizationId, c.companyId, cutoff]);
  if (!eligible.rows.length) throw new AssetError(409, "There is no depreciation to run up to that date.", "ASSET_RUN_EMPTY");
  const total = eligible.rows.reduce((s, r) => s + toCents(r.depreciation_amount), 0n);
  const number = await nextNumber(client, c, "asset_depreciation_run", "DEP");
  const run = (await qx(client, `INSERT INTO tenant.asset_depreciation_runs(organization_id,company_id,run_number,period_start,period_end,status,total_depreciation,asset_count,created_by) VALUES($1,$2,$3,$4,$4,'calculated',$5,$6,$7) RETURNING *`,
    [c.organizationId, c.companyId, number, cutoff, fromCents(total), new Set(eligible.rows.map((r) => r.id)).size, c.userId])).rows[0];
  await client.query(`UPDATE tenant.asset_depreciation_schedules SET run_id=$1,status='ready' WHERE id=ANY($2::uuid[])`, [run.id, eligible.rows.map((r) => r.id)]);
  await client.query(`UPDATE tenant.asset_depreciation_runs SET asset_count=(SELECT count(DISTINCT asset_id) FROM tenant.asset_depreciation_schedules WHERE run_id=$1) WHERE id=$1`, [run.id]);
  return run;
}

export async function approveDepreciationRun(client, c, runId) {
  need(c, "assets.accounting.handoff");
  const run = (await qx(client, `SELECT * FROM tenant.asset_depreciation_runs WHERE organization_id=$1 AND company_id=$2 AND id=$3 FOR UPDATE`, [c.organizationId, c.companyId, uuid(runId, "Run")])).rows[0];
  if (!run) throw new AssetError(404, "Depreciation run was not found.", "ASSET_NOT_FOUND");
  if (run.status !== "calculated") throw new AssetError(409, "Only a calculated run can be approved.", "ASSET_STATE_INVALID");
  const settings = await loadSettings(client, c);
  if (settings.prohibit_self_approval && run.created_by === c.userId) throw new AssetError(409, "The person who prepared a run cannot approve it.", "SELF_APPROVAL_BLOCKED");
  return (await qx(client, `UPDATE tenant.asset_depreciation_runs SET status='approved',approved_by=$2,approved_at=now() WHERE id=$1 RETURNING *`, [run.id, c.userId])).rows[0];
}

export async function postDepreciationRun(client, c, runId) {
  need(c, "assets.accounting.handoff");
  const run = (await qx(client, `SELECT * FROM tenant.asset_depreciation_runs WHERE organization_id=$1 AND company_id=$2 AND id=$3 FOR UPDATE`, [c.organizationId, c.companyId, uuid(runId, "Run")])).rows[0];
  if (!run) throw new AssetError(404, "Depreciation run was not found.", "ASSET_NOT_FOUND");
  if (run.status === "posted") return run;
  if (run.status !== "approved") throw new AssetError(409, "A run must be approved before it is posted.", "ASSET_STATE_INVALID");
  const settings = await loadSettings(client, c);
  const lines = await client.query(`SELECT s.id,s.asset_id,s.depreciation_amount,a.category_id FROM tenant.asset_depreciation_schedules s JOIN tenant.assets a ON a.id=s.asset_id WHERE s.run_id=$1 FOR UPDATE OF s,a`, [run.id]);
  const byCategory = new Map();
  for (const l of lines.rows) byCategory.set(l.category_id, (byCategory.get(l.category_id) || 0n) + toCents(l.depreciation_amount));
  let accounting = { status: "not_required", journalEntryId: null };
  if (settings.post_to_accounting) {
    const cats = await client.query(`SELECT id,code,depreciation_expense_account_id,accumulated_depreciation_account_id FROM tenant.asset_categories WHERE id=ANY($1::uuid[])`, [[...byCategory.keys()]]);
    const journalLines = [];
    for (const cat of cats.rows) {
      const amount = byCategory.get(cat.id);
      journalLines.push({ accountId: cat.depreciation_expense_account_id, debitCents: amount, description: `Depreciation ${cat.code}` }, { accountId: cat.accumulated_depreciation_account_id, creditCents: amount, description: `Accumulated depreciation ${cat.code}` });
    }
    accounting = await postAssetJournal(client, c, { date: String(run.period_end instanceof Date ? run.period_end.toISOString().slice(0, 10) : run.period_end).slice(0, 10), reference: run.run_number, description: `Depreciation run ${run.run_number}`, sourceType: "asset_depreciation_run", sourceId: run.id, sourceNumber: run.run_number, lines: journalLines });
  }
  for (const l of lines.rows) {
    await client.query(`UPDATE tenant.assets SET accumulated_depreciation=accumulated_depreciation+$2::numeric,net_book_value=capitalized_cost-(accumulated_depreciation+$2::numeric)-impairment_accumulated,updated_at=now() WHERE id=$1`, [l.asset_id, l.depreciation_amount]);
    await recordAssetEvent(client, c, l.asset_id, "asset.depreciated", { runId: run.id, amount: l.depreciation_amount });
  }
  await client.query(`UPDATE tenant.asset_depreciation_schedules SET status='posted',posted_at=now(),accounting_journal_id=$2 WHERE run_id=$1`, [run.id, accounting.journalEntryId]);
  return (await qx(client, `UPDATE tenant.asset_depreciation_runs SET status='posted',posted_by=$2,posted_at=now(),accounting_journal_id=$3,accounting_status=$4 WHERE id=$1 RETURNING *`, [run.id, c.userId, accounting.journalEntryId, accounting.status])).rows[0];
}

export async function reverseDepreciationRun(client, c, runId, reason) {
  need(c, "assets.accounting.handoff");
  const why = requiredText(reason, "Reason", 500);
  const run = (await qx(client, `SELECT * FROM tenant.asset_depreciation_runs WHERE organization_id=$1 AND company_id=$2 AND id=$3 FOR UPDATE`, [c.organizationId, c.companyId, uuid(runId, "Run")])).rows[0];
  if (!run) throw new AssetError(404, "Depreciation run was not found.", "ASSET_NOT_FOUND");
  if (run.status !== "posted") throw new AssetError(409, "Only a posted run can be reversed.", "ASSET_STATE_INVALID");
  const later = await client.query(`SELECT 1 FROM tenant.asset_depreciation_runs WHERE organization_id=$1 AND company_id=$2 AND status='posted' AND period_end>$3`, [c.organizationId, c.companyId, run.period_end]);
  if (later.rows[0]) throw new AssetError(409, "A later depreciation run is posted; reverse the latest run first.", "ASSET_RUN_ORDER");
  await reverseAssetJournal(client, c, run.accounting_journal_id, why);
  const lines = await client.query(`SELECT s.id,s.asset_id,s.depreciation_amount FROM tenant.asset_depreciation_schedules s WHERE s.run_id=$1 FOR UPDATE`, [run.id]);
  for (const l of lines.rows) {
    await client.query(`UPDATE tenant.assets SET accumulated_depreciation=accumulated_depreciation-$2::numeric,net_book_value=capitalized_cost-(accumulated_depreciation-$2::numeric)-impairment_accumulated,updated_at=now() WHERE id=$1`, [l.asset_id, l.depreciation_amount]);
    await recordAssetEvent(client, c, l.asset_id, "asset.depreciation_reversed", { runId: run.id, amount: l.depreciation_amount, reason: why });
  }
  await client.query(`UPDATE tenant.asset_depreciation_schedules SET status='planned',run_id=NULL,posted_at=NULL,accounting_journal_id=NULL WHERE run_id=$1`, [run.id]);
  return (await qx(client, `UPDATE tenant.asset_depreciation_runs SET status='reversed',reversed_by=$2,reversed_at=now(),accounting_status='reversed' WHERE id=$1 RETURNING *`, [run.id, c.userId])).rows[0];
}

// ------------------------------------------------------------------ F250/F251: adjustments
export async function listValueAdjustments(client, c, filters = {}) {
  need(c, "assets.view");
  need(c, "assets.reports.view");
  const values = [c.organizationId, c.companyId];
  let where = "";
  if (filters.status) { values.push(String(filters.status)); where += ` AND adj.status=$${values.length}`; }
  if (filters.assetId) { values.push(uuid(filters.assetId, "Asset")); where += ` AND adj.asset_id=$${values.length}`; }
  if (filters.adjustmentType === "revaluation") where += ` AND adj.adjustment_type='revaluation'`;
  if (filters.adjustmentType === "impairment") where += ` AND adj.adjustment_type IN ('impairment','impairment_reversal')`;
  const res = await qx(client, `SELECT adj.*,a.asset_number,a.name AS asset_name FROM tenant.asset_value_adjustments adj JOIN tenant.assets a ON a.id=adj.asset_id WHERE adj.organization_id=$1 AND adj.company_id=$2${where} ORDER BY adj.created_at DESC LIMIT 200`, values);
  return res.rows;
}

export async function requestValueAdjustment(client, c, assetId, input) {
  need(c, "assets.depreciate");
  const a = await loadAsset(client, c, assetId, { lock: true });
  if (!["available", "assigned", "in_maintenance"].includes(a.status)) throw new AssetError(409, "Only a capitalized, in-service asset can be revalued or impaired.", "ASSET_STATE_INVALID");
  const type = oneOf(input.adjustmentType, ["revaluation", "impairment", "impairment_reversal"], "Adjustment type");
  const effective = dateRequired(input.effectiveDate || today(), "Effective date");
  if (effective < String(a.capitalization_date).slice(0, 10)) throw new AssetError(400, "The effective date cannot precede capitalization.", "ASSET_DATE_INVALID");
  const pending = await client.query(`SELECT 1 FROM tenant.asset_value_adjustments WHERE asset_id=$1 AND status='pending_approval'`, [a.id]);
  if (pending.rows[0]) throw new AssetError(409, "This asset already has an adjustment awaiting approval.", "ASSET_ADJUSTMENT_PENDING");
  const previous = toCents(a.net_book_value);
  const next = toCents(nonNegative(input.newNetBookValue, "New net book value"));
  if (input.newNetBookValue === undefined || input.newNetBookValue === "") throw new AssetError(400, "New net book value is required.", "ASSET_FIELD_REQUIRED");
  if (type === "impairment" && next >= previous) throw new AssetError(400, "An impairment must reduce the net book value.", "ASSET_NUMBER_INVALID");
  if (type === "impairment_reversal") {
    if (next <= previous) throw new AssetError(400, "An impairment reversal must increase the net book value.", "ASSET_NUMBER_INVALID");
    if (next - previous > toCents(a.impairment_accumulated)) throw new AssetError(409, "A reversal cannot exceed the impairment previously recognised.", "ASSET_REVERSAL_EXCEEDS_IMPAIRMENT");
  }
  if (type === "revaluation" && next === previous) throw new AssetError(400, "The revalued amount equals the current net book value.", "ASSET_NUMBER_INVALID");
  const settings = await loadSettings(client, c);
  const number = await nextNumber(client, c, "asset_value_adjustment", "ADJ");
  const adj = (await qx(client,
    `INSERT INTO tenant.asset_value_adjustments(organization_id,company_id,asset_id,adjustment_number,adjustment_type,effective_date,previous_net_book_value,new_net_book_value,adjustment_amount,reason,evidence,requested_by)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [c.organizationId, c.companyId, a.id, number, type, effective, fromCents(previous), fromCents(next), fromCents(next - previous), requiredText(input.reason, "Reason", 1000), textOrNull(input.evidence, 2000), c.userId])).rows[0];
  await recordAssetEvent(client, c, a.id, `asset.${type}_requested`, { adjustmentId: adj.id });
  if (!settings.require_value_adjustment_approval) return approveValueAdjustment(client, { ...c, permissions: [...(c.permissions || []), "assets.accounting.handoff"] }, adj.id);
  return adj;
}

export async function approveValueAdjustment(client, c, adjustmentId) {
  need(c, "assets.accounting.handoff");
  const adj = (await qx(client, `SELECT * FROM tenant.asset_value_adjustments WHERE organization_id=$1 AND company_id=$2 AND id=$3 FOR UPDATE`, [c.organizationId, c.companyId, uuid(adjustmentId, "Adjustment")])).rows[0];
  if (!adj) throw new AssetError(404, "Adjustment was not found.", "ASSET_NOT_FOUND");
  if (adj.status !== "pending_approval") throw new AssetError(409, "Only a pending adjustment can be approved.", "ASSET_STATE_INVALID");
  const settings = await loadSettings(client, c);
  if (settings.require_value_adjustment_approval && settings.prohibit_self_approval && adj.requested_by === c.userId) throw new AssetError(409, "The requester cannot approve their own adjustment.", "SELF_APPROVAL_BLOCKED");
  const a = await loadAsset(client, c, adj.asset_id, { lock: true });
  if (toCents(a.net_book_value) !== toCents(adj.previous_net_book_value)) throw new AssetError(409, "The asset's value changed after this adjustment was requested; request it again.", "ASSET_ADJUSTMENT_STALE");
  const cat = (await client.query(`SELECT * FROM tenant.asset_categories WHERE id=$1`, [a.category_id])).rows[0];
  const diff = toCents(adj.adjustment_amount);
  const abs = diff < 0n ? -diff : diff;
  const type = adj.adjustment_type;
  let lines;
  let cost = toCents(a.capitalized_cost);
  let impairment = toCents(a.impairment_accumulated);
  let surplus = toCents(a.revaluation_surplus);
  if (type === "revaluation" && diff > 0n) {
    lines = [{ accountId: cat.asset_account_id, debitCents: abs, description: "Revaluation increase" }, { accountId: cat.revaluation_reserve_account_id, creditCents: abs, description: "Revaluation reserve" }];
    cost += abs;
    surplus += abs;
  } else if (type === "impairment_reversal") {
    lines = [{ accountId: cat.accumulated_depreciation_account_id, debitCents: abs, description: "Impairment reversal" }, { accountId: cat.impairment_loss_account_id, creditCents: abs, description: "Impairment reversal gain" }];
    impairment -= abs;
  } else {
    const fromReserve = type === "revaluation" ? (surplus < abs ? surplus : abs) : 0n;
    const loss = abs - fromReserve;
    lines = [];
    if (fromReserve > 0n) lines.push({ accountId: cat.revaluation_reserve_account_id, debitCents: fromReserve, description: "Revaluation reserve used" });
    if (loss > 0n) lines.push({ accountId: cat.impairment_loss_account_id, debitCents: loss, description: type === "impairment" ? "Impairment loss" : "Revaluation loss" });
    lines.push({ accountId: cat.accumulated_depreciation_account_id, creditCents: abs, description: "Carrying value reduction" });
    surplus -= fromReserve;
    impairment += abs;
  }
  let accounting = { status: "not_required", journalEntryId: null };
  if (settings.post_to_accounting) accounting = await postAssetJournal(client, c, { date: String(adj.effective_date).slice(0, 10), reference: adj.adjustment_number, description: `${type.replace("_", " ")} ${adj.adjustment_number}`, sourceType: "asset_value_adjustment", sourceId: adj.id, sourceNumber: adj.adjustment_number, lines });
  const nbv = cost - toCents(a.accumulated_depreciation) - impairment;
  await client.query(`UPDATE tenant.assets SET capitalized_cost=$2,impairment_accumulated=$3,revaluation_surplus=$4,net_book_value=$5,updated_at=now() WHERE id=$1`, [a.id, fromCents(cost), fromCents(impairment), fromCents(surplus), fromCents(nbv)]);
  await regenerateSchedule(client, c, a.id);
  await recordAssetEvent(client, c, a.id, `asset.${type}_posted`, { adjustmentId: adj.id, amount: adj.adjustment_amount, accounting: accounting.status });
  return (await qx(client, `UPDATE tenant.asset_value_adjustments SET status='posted',approved_by=$2,approved_at=now(),accounting_status=$3,accounting_journal_id=$4 WHERE id=$1 RETURNING *`, [adj.id, c.userId, accounting.status, accounting.journalEntryId])).rows[0];
}

export async function rejectValueAdjustment(client, c, adjustmentId, reason) {
  need(c, "assets.accounting.handoff");
  const res = await qx(client, `UPDATE tenant.asset_value_adjustments SET status='rejected',approved_by=$4,approved_at=now(),rejected_reason=$5 WHERE organization_id=$1 AND company_id=$2 AND id=$3 AND status='pending_approval' RETURNING *`, [c.organizationId, c.companyId, uuid(adjustmentId, "Adjustment"), c.userId, requiredText(reason, "Reason", 500)]);
  if (!res.rows[0]) throw new AssetError(409, "Only a pending adjustment can be rejected.", "ASSET_STATE_INVALID");
  return res.rows[0];
}

export async function cancelValueAdjustment(client, c, adjustmentId) {
  need(c, "assets.depreciate");
  const res = await qx(client, `UPDATE tenant.asset_value_adjustments SET status='cancelled' WHERE organization_id=$1 AND company_id=$2 AND id=$3 AND status='pending_approval' AND requested_by=$4 RETURNING *`, [c.organizationId, c.companyId, uuid(adjustmentId, "Adjustment"), c.userId]);
  if (!res.rows[0]) throw new AssetError(409, "Only your own pending adjustment can be cancelled.", "ASSET_STATE_INVALID");
  return res.rows[0];
}
