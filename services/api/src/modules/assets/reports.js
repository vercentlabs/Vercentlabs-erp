// Asset reporting (F267): the dashboard and a set of reports that reconcile to source facts. Value figures
// need assets.reports.view; the audit trail needs assets.audit.view; nothing here reads across companies.
import { AssetError, dateOrNull, fromCents, loadSettings, need, qx, toCents, uuidOrNull } from "./common.js";
import { broadScope, canSeeValue } from "./register.js";

const range = (f) => ({ from: dateOrNull(f.from, "From"), to: dateOrNull(f.to, "To") });

export async function getAssetDesk(client, c) {
  need(c, "assets.view");
  const values = [c.organizationId, c.companyId];
  const settings = await loadSettings(client, c);
  const status = await client.query(`SELECT status,count(*)::int AS n FROM tenant.assets WHERE organization_id=$1 AND company_id=$2 GROUP BY status`, values);
  const counts = Object.fromEntries(status.rows.map((r) => [r.status, r.n]));
  const one = async (sql, extra = []) => (await client.query(sql, [...values, ...extra])).rows[0];
  const out = {
    assetsByStatus: counts,
    totalAssets: status.rows.reduce((s, r) => s + (r.status === "disposed" ? 0 : r.n), 0),
    openWorkOrders: (await one(`SELECT count(*)::int AS n FROM tenant.asset_maintenance_orders WHERE organization_id=$1 AND company_id=$2 AND status IN ('planned','scheduled','in_progress','on_hold')`)).n,
    maintenanceOverdue: (await one(`SELECT count(*)::int AS n FROM tenant.asset_maintenance_plans WHERE organization_id=$1 AND company_id=$2 AND active=true AND next_due_date<current_date`)).n,
    warrantiesExpiring: (await one(`SELECT count(*)::int AS n FROM tenant.asset_warranties WHERE organization_id=$1 AND company_id=$2 AND end_date BETWEEN current_date AND current_date+$3::int`, [settings.warranty_alert_days])).n,
    calibrationsDue: (await one(`SELECT count(*)::int AS n FROM tenant.assets WHERE organization_id=$1 AND company_id=$2 AND status<>'disposed' AND calibration_due_date IS NOT NULL AND calibration_due_date<=current_date+$3::int`, [settings.calibration_alert_days])).n,
    openVerificationDiscrepancies: (await one(`SELECT count(*)::int AS n FROM tenant.asset_verification_lines l JOIN tenant.asset_verification_campaigns k ON k.id=l.campaign_id WHERE l.organization_id=$1 AND l.company_id=$2 AND l.resolution_status='open' AND k.status='in_progress'`)).n,
    pendingApprovals: (await one(`SELECT ((SELECT count(*) FROM tenant.asset_transfers WHERE organization_id=$1 AND company_id=$2 AND status='submitted')+(SELECT count(*) FROM tenant.asset_disposals WHERE organization_id=$1 AND company_id=$2 AND status='pending_approval')+(SELECT count(*) FROM tenant.asset_value_adjustments WHERE organization_id=$1 AND company_id=$2 AND status='pending_approval')+(SELECT count(*) FROM tenant.asset_depreciation_runs WHERE organization_id=$1 AND company_id=$2 AND status IN ('calculated','approved')))::int AS n`)).n,
  };
  if (canSeeValue(c)) {
    const v = await one(`SELECT COALESCE(sum(net_book_value),0)::text AS nbv,COALESCE(sum(capitalized_cost),0)::text AS cost,COALESCE(sum(accumulated_depreciation),0)::text AS dep FROM tenant.assets WHERE organization_id=$1 AND company_id=$2 AND status NOT IN ('draft','disposed')`);
    out.totalNetBookValue = v.nbv;
    out.totalCost = v.cost;
    out.totalAccumulatedDepreciation = v.dep;
  }
  return out;
}

async function registerReport(client, c, f) {
  need(c, "assets.reports.view");
  const res = await qx(client, `SELECT cat.code AS category,a.asset_number,a.name,a.status,a.capitalization_date,a.capitalized_cost,a.accumulated_depreciation,a.impairment_accumulated,a.net_book_value FROM tenant.assets a JOIN tenant.asset_categories cat ON cat.id=a.category_id WHERE a.organization_id=$1 AND a.company_id=$2 AND a.status NOT IN ('draft','disposed') ORDER BY cat.code,a.asset_number`, [c.organizationId, c.companyId]);
  const totals = res.rows.reduce((t, r) => ({ cost: t.cost + toCents(r.capitalized_cost), dep: t.dep + toCents(r.accumulated_depreciation), nbv: t.nbv + toCents(r.net_book_value) }), { cost: 0n, dep: 0n, nbv: 0n });
  void f;
  return { totalCost: fromCents(totals.cost), totalAccumulatedDepreciation: fromCents(totals.dep), totalNetBookValue: fromCents(totals.nbv), assets: res.rows };
}

async function depreciationReport(client, c, f) {
  need(c, "assets.reports.view");
  const { from, to } = range(f);
  const values = [c.organizationId, c.companyId];
  let where = "";
  if (from) { values.push(from); where += ` AND s.period_end>=$${values.length}`; }
  if (to) { values.push(to); where += ` AND s.period_end<=$${values.length}`; }
  const byCategory = await qx(client, `SELECT cat.code AS category,s.status,count(*)::int AS lines,sum(s.depreciation_amount)::text AS amount FROM tenant.asset_depreciation_schedules s JOIN tenant.assets a ON a.id=s.asset_id JOIN tenant.asset_categories cat ON cat.id=a.category_id WHERE s.organization_id=$1 AND s.company_id=$2${where} GROUP BY cat.code,s.status ORDER BY cat.code,s.status`, values);
  const byPeriod = await qx(client, `SELECT s.period_end,sum(s.depreciation_amount)::text AS amount,bool_and(s.status='posted') AS all_posted FROM tenant.asset_depreciation_schedules s WHERE s.organization_id=$1 AND s.company_id=$2${where} GROUP BY s.period_end ORDER BY s.period_end`, values);
  return { byCategory: byCategory.rows, byPeriod: byPeriod.rows };
}

async function maintenanceCostReport(client, c, f) {
  need(c, "assets.reports.view");
  const { from, to } = range(f);
  const values = [c.organizationId, c.companyId];
  let where = "";
  if (from) { values.push(from); where += ` AND o.actual_end_at::date>=$${values.length}`; }
  if (to) { values.push(to); where += ` AND o.actual_end_at::date<=$${values.length}`; }
  const byAsset = await qx(client, `SELECT a.asset_number,a.name,count(*)::int AS orders,sum(o.labor_cost)::text AS labour,sum(o.parts_cost)::text AS parts,sum(o.external_cost)::text AS external,sum(o.labor_cost+o.parts_cost+o.external_cost)::text AS total,sum(o.downtime_hours)::text AS downtime_hours FROM tenant.asset_maintenance_orders o JOIN tenant.assets a ON a.id=o.asset_id WHERE o.organization_id=$1 AND o.company_id=$2 AND o.status='completed'${where} GROUP BY a.asset_number,a.name ORDER BY sum(o.labor_cost+o.parts_cost+o.external_cost) DESC`, values);
  const byType = await qx(client, `SELECT o.maintenance_type,count(*)::int AS orders,sum(o.labor_cost+o.parts_cost+o.external_cost)::text AS total FROM tenant.asset_maintenance_orders o WHERE o.organization_id=$1 AND o.company_id=$2 AND o.status='completed'${where} GROUP BY o.maintenance_type ORDER BY o.maintenance_type`, values);
  return { byAsset: byAsset.rows, byType: byType.rows };
}

async function downtimeReport(client, c, f) {
  need(c, "assets.view");
  const { from, to } = range(f);
  const values = [c.organizationId, c.companyId];
  let where = "";
  if (from) { values.push(from); where += ` AND d.started_at::date>=$${values.length}`; }
  if (to) { values.push(to); where += ` AND d.started_at::date<=$${values.length}`; }
  const rows = await qx(client, `SELECT a.asset_number,a.name,d.category,count(*)::int AS events,ROUND(sum(EXTRACT(EPOCH FROM (COALESCE(d.ended_at,now())-d.started_at))/3600),2)::text AS hours FROM tenant.asset_downtime d JOIN tenant.assets a ON a.id=d.asset_id WHERE d.organization_id=$1 AND d.company_id=$2${where} GROUP BY a.asset_number,a.name,d.category ORDER BY 5 DESC NULLS LAST`, values);
  return { rows: rows.rows };
}

async function warrantyReport(client, c) {
  need(c, "assets.view");
  const settings = await loadSettings(client, c);
  const rows = await qx(client, `SELECT a.asset_number,a.name,w.warranty_type,w.provider_name,w.end_date,(w.end_date-current_date) AS days_remaining,CASE WHEN w.end_date<current_date THEN 'expired' WHEN w.end_date<=current_date+$3::int THEN 'expiring' ELSE 'active' END AS warranty_status FROM tenant.asset_warranties w JOIN tenant.assets a ON a.id=w.asset_id WHERE w.organization_id=$1 AND w.company_id=$2 ORDER BY w.end_date`, [c.organizationId, c.companyId, settings.warranty_alert_days]);
  return { rows: rows.rows };
}

async function calibrationReport(client, c) {
  need(c, "assets.view");
  const settings = await loadSettings(client, c);
  const rows = await qx(client, `SELECT a.asset_number,a.name,a.calibration_due_date,(a.calibration_due_date-current_date) AS days_remaining,CASE WHEN a.calibration_due_date<current_date THEN 'overdue' WHEN a.calibration_due_date<=current_date+$3::int THEN 'due_soon' ELSE 'valid' END AS calibration_status FROM tenant.assets a WHERE a.organization_id=$1 AND a.company_id=$2 AND a.status<>'disposed' AND a.calibration_due_date IS NOT NULL ORDER BY a.calibration_due_date`, [c.organizationId, c.companyId, settings.calibration_alert_days]);
  return { rows: rows.rows };
}

async function disposalReport(client, c, f) {
  need(c, "assets.reports.view");
  const { from, to } = range(f);
  const values = [c.organizationId, c.companyId];
  let where = "";
  if (from) { values.push(from); where += ` AND d.disposal_date>=$${values.length}`; }
  if (to) { values.push(to); where += ` AND d.disposal_date<=$${values.length}`; }
  const rows = await qx(client, `SELECT d.disposal_number,a.asset_number,a.name,d.disposal_method,d.disposal_date,d.original_cost,d.accumulated_depreciation,d.net_book_value,d.proceeds_amount,d.disposal_cost,d.gain_loss_amount FROM tenant.asset_disposals d JOIN tenant.assets a ON a.id=d.asset_id WHERE d.organization_id=$1 AND d.company_id=$2 AND d.status='completed'${where} ORDER BY d.disposal_date`, values);
  const net = rows.rows.reduce((s, r) => s + toCents(r.gain_loss_amount), 0n);
  return { rows: rows.rows, netGainLoss: fromCents(net) };
}

// F266: the register against the general ledger, category by category.
async function reconciliationReport(client, c) {
  need(c, "assets.reports.view");
  const cats = await qx(client, `SELECT cat.id,cat.code,cat.asset_account_id,cat.accumulated_depreciation_account_id,
      COALESCE((SELECT sum(capitalized_cost) FROM tenant.assets a WHERE a.category_id=cat.id AND a.status NOT IN ('draft','disposed')),0)::text AS register_cost,
      COALESCE((SELECT sum(accumulated_depreciation+impairment_accumulated) FROM tenant.assets a WHERE a.category_id=cat.id AND a.status NOT IN ('draft','disposed')),0)::text AS register_accumulated
    FROM tenant.asset_categories cat WHERE cat.organization_id=$1 AND cat.company_id=$2 ORDER BY cat.code`, [c.organizationId, c.companyId]);
  const rows = [];
  for (const cat of cats.rows) {
    const bal = async (accountId) => {
      if (!accountId) return null;
      const r = await client.query(`SELECT COALESCE(sum(l.base_debit_amount-l.base_credit_amount),0)::text AS b FROM tenant.accounting_journal_lines l JOIN tenant.accounting_journal_entries e ON e.id=l.journal_entry_id WHERE l.organization_id=$1 AND e.company_id=$2 AND l.account_id=$3 AND e.status='posted' AND e.source_module='assets'`, [c.organizationId, c.companyId, accountId]);
      return r.rows[0].b;
    };
    const glCost = await bal(cat.asset_account_id);
    const glAcc = await bal(cat.accumulated_depreciation_account_id);
    rows.push({ category: cat.code, registerCost: cat.register_cost, glCost, costDifference: glCost === null ? null : fromCents(toCents(cat.register_cost) - toCents(glCost)), registerAccumulated: cat.register_accumulated, glAccumulated: glAcc === null ? null : fromCents(-toCents(glAcc)), accumulatedDifference: glAcc === null ? null : fromCents(toCents(cat.register_accumulated) + toCents(glAcc)) });
  }
  return { rows, note: "GL figures include only entries posted by Assets; assets brought in by other routes are outside this comparison." };
}

async function auditReport(client, c, f) {
  need(c, "assets.audit.view");
  const { from, to } = range(f);
  const values = [c.organizationId, c.companyId];
  let where = "";
  const assetId = uuidOrNull(f.assetId, "Asset");
  if (assetId) { values.push(assetId); where += ` AND ev.asset_id=$${values.length}`; }
  if (from) { values.push(from); where += ` AND ev.occurred_at::date>=$${values.length}`; }
  if (to) { values.push(to); where += ` AND ev.occurred_at::date<=$${values.length}`; }
  const rows = await qx(client, `SELECT ev.occurred_at,ev.event_type,a.asset_number,ev.payload,usr.full_name AS actor FROM tenant.asset_events ev JOIN tenant.assets a ON a.id=ev.asset_id LEFT JOIN public.users usr ON usr.id=ev.actor_user_id WHERE ev.organization_id=$1 AND ev.company_id=$2${where} ORDER BY ev.occurred_at DESC LIMIT 500`, values);
  return { rows: rows.rows };
}

async function categorySummary(client, c) {
  need(c, "assets.view");
  if (!broadScope(c)) throw new AssetError(403, "You do not have permission to perform this asset operation.", "ASSET_FORBIDDEN");
  const withValue = canSeeValue(c);
  const rows = await qx(client, `SELECT cat.code AS category,cat.name,count(a.id)::int AS assets,${withValue ? "COALESCE(sum(a.net_book_value),0)::text" : "NULL::text"} AS net_book_value FROM tenant.asset_categories cat LEFT JOIN tenant.assets a ON a.category_id=cat.id AND a.status NOT IN ('draft','disposed') WHERE cat.organization_id=$1 AND cat.company_id=$2 GROUP BY cat.code,cat.name ORDER BY cat.code`, [c.organizationId, c.companyId]);
  return { rows: rows.rows };
}

const REPORTS = { register: registerReport, depreciation: depreciationReport, "maintenance-cost": maintenanceCostReport, downtime: downtimeReport, "warranty-expiry": warrantyReport, "calibration-due": calibrationReport, disposals: disposalReport, reconciliation: reconciliationReport, "audit-trail": auditReport, "category-summary": categorySummary };

export async function getAssetReport(client, c, key, filters = {}) {
  const fn = REPORTS[key];
  if (!fn) throw new AssetError(404, "Asset report was not found.", "ASSET_NOT_FOUND");
  return fn(client, c, filters);
}
