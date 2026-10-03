// Asset value: deterministic straight-line depreciation in integer minor units, the schedule, and
// approved-and-posted depreciation runs. Nothing here rewrites posted history: a correction is a reversal.
import { AssetError, dateRequired, fromCents, loadSettings, need, nextNumber, qx, recordAssetEvent, requiredText, toCents, uuid } from "./common.js";
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
export function buildDepreciationLines({ method, openingCents, salvageCents, months, start, convention = "full_month" }) {
  if (method !== "straight_line" || months < 1) return [];
  const startMonth = convention === "next_month" ? addMonths(monthStart(start), 1) : monthStart(start);
  const weights = periodWeights(months, convention);
  const depreciable = openingCents - salvageCents;
  if (depreciable <= 0n) return [];
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const lines = [];
  let open = openingCents;
  let taken = 0n;
  for (let i = 0; i < weights.length; i += 1) {
    let amount = i === weights.length - 1 ? depreciable - taken : (depreciable * BigInt(Math.round(weights[i] * 1000))) / BigInt(Math.round(totalWeight * 1000));
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
      `INSERT INTO tenant.asset_depreciation_schedules(organization_id,asset_id,period_start,period_end,opening_book_value,depreciation_amount,closing_book_value,status,method)
       VALUES($1,$2,$3,$4,$5,$6,$7,'planned',$8) ON CONFLICT (asset_id,period_end) DO NOTHING`,
      [c.organizationId, asset.id, l.periodStart, l.periodEnd, fromCents(l.opening), fromCents(l.amount), fromCents(l.closing), method]);
  }
}

// F248: the schedule created at capitalisation.
export async function generateSchedule(client, c, asset, category, settings) {
  const method = asset.depreciation_method;
  if (method !== "straight_line") return [];
  const convention = category.depreciation_convention || settings.depreciation_convention || "full_month";
  const lines = buildDepreciationLines({ method, openingCents: toCents(asset.capitalized_cost), salvageCents: toCents(asset.residual_value), months: asset.useful_life_months, start: asDate(asset.depreciation_start_date), convention });
  await insertLines(client, c, asset, lines, method);
  return lines;
}

export async function listDepreciationSchedule(client, c, filters = {}) {
  need(c, "assets.view");
  need(c, "assets.reports.view");
  const values = [c.organizationId];
  let where = "";
  if (filters.assetId) { values.push(uuid(filters.assetId, "Asset")); where += ` AND s.asset_id=$${values.length}`; }
  if (filters.status) { values.push(String(filters.status)); where += ` AND s.status=$${values.length}`; }
  const res = await qx(client, `SELECT s.*,a.asset_number,a.name AS asset_name FROM tenant.asset_depreciation_schedules s JOIN tenant.assets a ON a.id=s.asset_id WHERE s.organization_id=$1${where} ORDER BY s.period_end,a.asset_number LIMIT 500`, values);
  return res.rows;
}

// ------------------------------------------------------------------ F249: runs
export async function listDepreciationRuns(client, c) {
  need(c, "assets.view");
  need(c, "assets.reports.view");
  const res = await qx(client, `SELECT * FROM tenant.asset_depreciation_runs WHERE organization_id=$1 ORDER BY period_end DESC,created_at DESC LIMIT 200`, [c.organizationId]);
  return res.rows;
}

export async function getDepreciationRun(client, c, runId) {
  need(c, "assets.reports.view");
  const run = await qx(client, `SELECT * FROM tenant.asset_depreciation_runs WHERE organization_id=$1 AND id=$2`, [c.organizationId, uuid(runId, "Run")]);
  if (!run.rows[0]) throw new AssetError(404, "Depreciation run was not found.", "ASSET_NOT_FOUND");
  const lines = await qx(client, `SELECT s.*,a.asset_number,a.name AS asset_name FROM tenant.asset_depreciation_schedules s JOIN tenant.assets a ON a.id=s.asset_id WHERE s.organization_id=$1 AND s.run_id=$2 ORDER BY a.asset_number,s.period_end`, [c.organizationId, run.rows[0].id]);
  return { run: run.rows[0], lines: lines.rows };
}

export async function createDepreciationRun(client, c, input) {
  need(c, "assets.depreciate");
  const cutoff = dateRequired(input.periodEnd, "Period end");
  const live = await client.query(`SELECT id FROM tenant.asset_depreciation_runs WHERE organization_id=$1 AND period_end=$2 AND status<>'reversed'`, [c.organizationId, cutoff]);
  if (live.rows[0]) throw new AssetError(409, "A depreciation run already exists for that period.", "ASSET_RUN_EXISTS");
  const eligible = await qx(client,
    `SELECT s.id,s.depreciation_amount FROM tenant.asset_depreciation_schedules s JOIN tenant.assets a ON a.id=s.asset_id
     WHERE s.organization_id=$1 AND s.status='planned' AND s.run_id IS NULL AND s.period_end<=$2 AND s.depreciation_amount>0
       AND a.status IN ('available','assigned','in_maintenance','pending_disposal') FOR UPDATE OF s`, [c.organizationId, cutoff]);
  if (!eligible.rows.length) throw new AssetError(409, "There is no depreciation to run up to that date.", "ASSET_RUN_EMPTY");
  const total = eligible.rows.reduce((s, r) => s + toCents(r.depreciation_amount), 0n);
  const number = await nextNumber(client, c, "asset_depreciation_run", "DEP");
  const run = (await qx(client, `INSERT INTO tenant.asset_depreciation_runs(organization_id,run_number,period_start,period_end,status,total_depreciation,asset_count,created_by) VALUES($1,$2,$3,$3,'calculated',$4,$5,$6) RETURNING *`,
    [c.organizationId, number, cutoff, fromCents(total), new Set(eligible.rows.map((r) => r.id)).size, c.userId])).rows[0];
  await client.query(`UPDATE tenant.asset_depreciation_schedules SET run_id=$1,status='ready' WHERE id=ANY($2::uuid[])`, [run.id, eligible.rows.map((r) => r.id)]);
  await client.query(`UPDATE tenant.asset_depreciation_runs SET asset_count=(SELECT count(DISTINCT asset_id) FROM tenant.asset_depreciation_schedules WHERE run_id=$1) WHERE id=$1`, [run.id]);
  return run;
}

export async function approveDepreciationRun(client, c, runId) {
  need(c, "assets.accounting.handoff");
  const run = (await qx(client, `SELECT * FROM tenant.asset_depreciation_runs WHERE organization_id=$1 AND id=$2 FOR UPDATE`, [c.organizationId, uuid(runId, "Run")])).rows[0];
  if (!run) throw new AssetError(404, "Depreciation run was not found.", "ASSET_NOT_FOUND");
  if (run.status !== "calculated") throw new AssetError(409, "Only a calculated run can be approved.", "ASSET_STATE_INVALID");
  const settings = await loadSettings(client, c);
  if (settings.prohibit_self_approval && run.created_by === c.userId) throw new AssetError(409, "The person who prepared a run cannot approve it.", "SELF_APPROVAL_BLOCKED");
  return (await qx(client, `UPDATE tenant.asset_depreciation_runs SET status='approved',approved_by=$2,approved_at=now() WHERE id=$1 RETURNING *`, [run.id, c.userId])).rows[0];
}

export async function postDepreciationRun(client, c, runId) {
  need(c, "assets.accounting.handoff");
  const run = (await qx(client, `SELECT * FROM tenant.asset_depreciation_runs WHERE organization_id=$1 AND id=$2 FOR UPDATE`, [c.organizationId, uuid(runId, "Run")])).rows[0];
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
  const run = (await qx(client, `SELECT * FROM tenant.asset_depreciation_runs WHERE organization_id=$1 AND id=$2 FOR UPDATE`, [c.organizationId, uuid(runId, "Run")])).rows[0];
  if (!run) throw new AssetError(404, "Depreciation run was not found.", "ASSET_NOT_FOUND");
  if (run.status !== "posted") throw new AssetError(409, "Only a posted run can be reversed.", "ASSET_STATE_INVALID");
  const later = await client.query(`SELECT 1 FROM tenant.asset_depreciation_runs WHERE organization_id=$1 AND status='posted' AND period_end>$2`, [c.organizationId, run.period_end]);
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

