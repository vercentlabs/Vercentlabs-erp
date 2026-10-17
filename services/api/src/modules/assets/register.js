// The asset register (F231-F238): settings, categories, locations, the asset master with identity/tag
// codes and creation from a procurement/accounting source. Capitalization is asset-capitalization/'s.
import { AssetError, has, loadSettings, need, nonNegative, oneOf, uuid } from "./common.js";

const METHODS = ["straight_line", "none"];
const CONVENTIONS = ["full_month", "mid_month", "next_month"];
const STATUSES = ["draft", "available", "assigned", "in_maintenance", "retired", "pending_disposal", "lost", "disposed"];
const ANY_OPERATIONAL = ["assets.manage", "assets.create", "assets.assign", "assets.transfer", "assets.maintain", "assets.inspect", "assets.depreciate", "assets.dispose", "assets.capitalize", "assets.reports.view", "assets.audit.view", "assets.accounting.handoff", "assets.settings.manage"];
const VALUE_VIEWERS = ["assets.reports.view", "assets.depreciate", "assets.capitalize", "assets.accounting.handoff", "assets.audit.view", "assets.dispose"];
const VALUE_FIELDS = ["acquisition_cost", "capitalized_cost", "residual_value", "accumulated_depreciation", "net_book_value", "impairment_accumulated", "revaluation_surplus"];

// A person holding only assets.view is a custodian: they see the assets assigned to them, nothing else.
export const broadScope = (c) => c.roleSlugs?.includes("organization_owner") || ANY_OPERATIONAL.some((p) => c.permissions?.includes(p));
export const canSeeValue = (c) => c.roleSlugs?.includes("organization_owner") || VALUE_VIEWERS.some((p) => c.permissions?.includes(p));
const VALUE_INPUT_FIELDS = ["acquisitionCost", "residualValue"];
// Field write protection: the cost and residual value are hidden from callers
// without an asset value permission (maskAsset), so they may not submit them.
function assertValueFieldsWritable(c, input) {
  if (canSeeValue(c) || !VALUE_INPUT_FIELDS.some((field) => input?.[field] !== undefined)) return;
  throw new AssetError(403, "You do not have permission to change one or more of these fields.", "FIELD_ACCESS_DENIED");
}

export function maskAsset(c, row) {
  if (canSeeValue(c)) return row;
  const out = { ...row };
  for (const f of VALUE_FIELDS) out[f] = null;
  return out;
}

// ------------------------------------------------------------------ settings
export async function getAssetSettings(client, c) {
  need(c, "assets.view");
  return loadSettings(client, c);
}
export async function saveAssetSettings(client, c, input) {
  need(c, "assets.settings.manage");
  const cur = await loadSettings(client, c);
  const bool = (k, col) => (input[k] === undefined ? cur[col] : Boolean(input[k]));
  const method = input.defaultDepreciationMethod ? oneOf(input.defaultDepreciationMethod, METHODS, "Depreciation method") : cur.default_depreciation_method;
  const convention = input.depreciationConvention ? oneOf(input.depreciationConvention, CONVENTIONS, "Convention") : cur.depreciation_convention;
  const res = await client.query(
    `INSERT INTO tenant.asset_settings(organization_id,require_capitalization_approval,require_disposal_approval,prohibit_self_approval,default_depreciation_method,post_to_accounting,require_transfer_approval,require_value_adjustment_approval,depreciation_convention,warranty_alert_days,maintenance_lead_days,calibration_alert_days)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (organization_id) DO UPDATE SET require_capitalization_approval=EXCLUDED.require_capitalization_approval,require_disposal_approval=EXCLUDED.require_disposal_approval,prohibit_self_approval=EXCLUDED.prohibit_self_approval,default_depreciation_method=EXCLUDED.default_depreciation_method,post_to_accounting=EXCLUDED.post_to_accounting,require_transfer_approval=EXCLUDED.require_transfer_approval,require_value_adjustment_approval=EXCLUDED.require_value_adjustment_approval,depreciation_convention=EXCLUDED.depreciation_convention,warranty_alert_days=EXCLUDED.warranty_alert_days,maintenance_lead_days=EXCLUDED.maintenance_lead_days,calibration_alert_days=EXCLUDED.calibration_alert_days,updated_at=now()
     RETURNING *`,
    [c.organizationId, bool("requireCapitalizationApproval", "require_capitalization_approval"), bool("requireDisposalApproval", "require_disposal_approval"), bool("prohibitSelfApproval", "prohibit_self_approval"), method, bool("postToAccounting", "post_to_accounting"), bool("requireTransferApproval", "require_transfer_approval"), bool("requireValueAdjustmentApproval", "require_value_adjustment_approval"), convention,
      nonNegative(input.warrantyAlertDays, "Warranty alert days", cur.warranty_alert_days), nonNegative(input.maintenanceLeadDays, "Maintenance lead days", cur.maintenance_lead_days), nonNegative(input.calibrationAlertDays, "Calibration alert days", cur.calibration_alert_days)],
  );
  // The maintenance and disposal approval thresholds and the safety restriction policy (0158, 0159).
  const more = await client.query(`UPDATE tenant.asset_settings SET maintenance_approval_threshold = $2, disposal_management_threshold = $3, maintenance_restrict_on_safety = $4 WHERE organization_id = $1 RETURNING *`,
    [c.organizationId, String(nonNegative(input.maintenanceApprovalThreshold, "Maintenance approval threshold", res.rows[0].maintenance_approval_threshold ?? 10000)),
      String(nonNegative(input.disposalManagementThreshold, "Disposal management threshold", res.rows[0].disposal_management_threshold ?? 100000)),
      input.maintenanceRestrictOnSafety === undefined ? res.rows[0].maintenance_restrict_on_safety !== false : Boolean(input.maintenanceRestrictOnSafety)]);
  return more.rows[0] ?? res.rows[0];
}

// ------------------------------------------------------------------ the asset master
const LIST_SQL = `SELECT a.*,cat.code AS category_code,cat.name AS category_name,loc.name AS location_name,loc.code AS location_code,
    usr.full_name AS custodian_name,dept.name AS department_name
  FROM tenant.assets a JOIN tenant.asset_categories cat ON cat.id=a.category_id
  LEFT JOIN tenant.asset_locations loc ON loc.id=a.location_id
  LEFT JOIN public.users usr ON usr.id=a.current_user_id
  LEFT JOIN public.departments dept ON dept.id=a.current_department_id`;

async function loadCategory(client, c, id) {
  const res = await client.query(`SELECT * FROM tenant.asset_categories WHERE organization_id=$1 AND id=$2 AND active=true`, [c.organizationId, uuid(id, "Category")]);
  if (!res.rows[0]) throw new AssetError(409, "An active asset category is required.", "ASSET_CATEGORY_INVALID");
  return res.rows[0];
}

async function assertParent(client, c, parentId, selfId) {
  if (!parentId) return;
  let cursor = parentId;
  for (let depth = 0; cursor && depth < 20; depth += 1) {
    if (cursor === selfId) throw new AssetError(400, "That parent would make the asset its own ancestor.", "ASSET_PARENT_CYCLE");
    const row = (await client.query(`SELECT parent_asset_id FROM tenant.assets WHERE organization_id=$1 AND id=$2`, [c.organizationId, cursor])).rows[0];
    if (!row) throw new AssetError(409, "The parent asset does not exist.", "ASSET_PARENT_INVALID");
    cursor = row.parent_asset_id;
  }
}

// Capitalization is Purchase and Capitalization's (asset-capitalization/): requested, approved by Finance and posted once.
export async function listAssetOptions(client, c) {
  need(c, "assets.view");
  const q = async (sql, params = [c.organizationId]) => (await client.query(sql, params)).rows;
  return {
    categories: await q(`SELECT id,code,name FROM tenant.asset_categories WHERE organization_id=$1 AND active=true ORDER BY code`),
    locations: await q(`SELECT id,code,name FROM tenant.asset_locations WHERE organization_id=$1 AND active=true ORDER BY code`),
    assets: await q(`SELECT id,asset_number AS code,name FROM tenant.assets WHERE organization_id=$1 AND status<>'disposed' ORDER BY asset_number LIMIT 500`),
    users: await q(`SELECT u.id,u.email AS code,u.full_name AS name FROM public.users u JOIN public.organization_memberships m ON m.user_id=u.id WHERE m.organization_id=$1 AND m.status='active' ORDER BY u.full_name LIMIT 500`),
    departments: await q(`SELECT id,code,name FROM public.departments WHERE organization_id=$1 ORDER BY name`),
    costCenters: await q(`SELECT id,code,name FROM public.cost_centers WHERE organization_id=$1 ORDER BY name`),
    customers: await q(`SELECT id,code,display_name AS name FROM tenant.business_parties WHERE organization_id=$1 AND party_type IN ('customer','both') AND status='active' ORDER BY display_name LIMIT 500`),
    suppliers: await q(`SELECT id,code,display_name AS name FROM tenant.business_parties WHERE organization_id=$1 AND party_type IN ('supplier','both') AND status='active' ORDER BY display_name LIMIT 500`),
    accounts: await q(`SELECT a.id,a.code,a.name FROM tenant.accounting_accounts a JOIN tenant.accounting_ledgers l ON l.id=a.ledger_id WHERE a.organization_id=$1 AND l.ledger_type='primary' AND a.is_group=false AND a.status='active' ORDER BY a.code`),
    campaigns: await q(`SELECT id,campaign_number AS code,name FROM tenant.asset_verification_campaigns WHERE organization_id=$1 AND status IN ('draft','in_progress') ORDER BY created_at DESC`),
    warranties: await q(`SELECT w.id,COALESCE(w.provider_name,'Warranty') AS code,a.asset_number AS name FROM tenant.asset_warranties w JOIN tenant.assets a ON a.id=w.asset_id WHERE w.organization_id=$1 ORDER BY w.end_date DESC LIMIT 200`),
  };
}

export { has };
