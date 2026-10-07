// The asset register (F231-F238): settings, categories, locations, the asset master with identity/tag
// codes, creation from a procurement/accounting source, and capitalisation. Value maths lives
// in value.js and the Accounting handoff in accounting-bridge.js.
import {
  AssetError, dateOrNull, dateRequired, fromCents, has, hashOf, loadAsset, loadSettings, need, nextNumber, nonNegative, oneOf, positive, qx, recordAssetEvent, requiredText,
  text, textOrNull, toCents, today, uuid, uuidOrNull,
} from "./common.js";
import { postAssetJournal } from "./accounting-bridge.js";
import { generateSchedule } from "./value.js";

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
  return res.rows[0];
}

// ------------------------------------------------------------------ categories
async function checkAccounts(client, c, ids) {
  const present = ids.filter(Boolean);
  if (!present.length) return;
  const res = await client.query(`SELECT id FROM tenant.accounting_accounts WHERE organization_id=$1 AND id=ANY($2::uuid[]) AND is_group=false AND status='active'`, [c.organizationId, present]);
  if (res.rows.length !== new Set(present).size) throw new AssetError(409, "Every category account must be an active posting account of the organization's ledger.", "ASSET_ACCOUNT_INVALID");
}

export async function listAssetCategories(client, c, filters = {}) {
  need(c, "assets.view");
  const values = [c.organizationId];
  let where = "";
  if (filters.active !== undefined && filters.active !== "") { values.push(String(filters.active) === "true"); where += ` AND cat.active=$${values.length}`; }
  const res = await qx(client, `SELECT cat.*,(SELECT count(*)::int FROM tenant.assets a WHERE a.category_id=cat.id AND a.status<>'disposed') AS asset_count FROM tenant.asset_categories cat WHERE cat.organization_id=$1${where} ORDER BY cat.code`, values);
  return res.rows;
}

// An edit posts only the fields that changed; fill the rest from the stored row so the save validates as a whole.
function fillFromRow(input, row, map) {
  const out = { ...input };
  for (const [camel, snake] of Object.entries(map)) if (out[camel] === undefined && row[snake] !== undefined && row[snake] !== null) out[camel] = row[snake];
  return out;
}
const CATEGORY_MAP = { code: "code", name: "name", description: "description", capitalizationThreshold: "capitalization_threshold", usefulLifeMonths: "useful_life_months", depreciationMethod: "depreciation_method", residualValuePercent: "residual_value_percent", decliningRate: "declining_rate", depreciationConvention: "depreciation_convention", parentCategoryId: "parent_category_id", requiresCalibration: "requires_calibration", tagPrefix: "tag_prefix", active: "active", assetAccountId: "asset_account_id", accumulatedDepreciationAccountId: "accumulated_depreciation_account_id", depreciationExpenseAccountId: "depreciation_expense_account_id", gainLossAccountId: "gain_loss_account_id", clearingAccountId: "clearing_account_id", revaluationReserveAccountId: "revaluation_reserve_account_id", impairmentLossAccountId: "impairment_loss_account_id", proceedsAccountId: "proceeds_account_id" };
const LOCATION_MAP = { code: "code", name: "name", locationType: "location_type", parentId: "parent_id", address: "address", active: "active" };

export async function saveAssetCategory(client, c, rawInput) {
  need(c, "assets.settings.manage");
  let input = rawInput;
  if (uuidOrNull(rawInput.id, "Category")) {
    const row = (await client.query(`SELECT * FROM tenant.asset_categories WHERE organization_id=$1 AND id=$2`, [c.organizationId, rawInput.id])).rows[0];
    if (!row) throw new AssetError(404, "Category was not found.", "ASSET_NOT_FOUND");
    input = fillFromRow(rawInput, row, CATEGORY_MAP);
  }
  return saveCategoryRecord(client, c, input);
}

async function saveCategoryRecord(client, c, input) {
  const id = uuidOrNull(input.id, "Category");
  const acct = ["assetAccountId", "accumulatedDepreciationAccountId", "depreciationExpenseAccountId", "gainLossAccountId", "clearingAccountId", "revaluationReserveAccountId", "impairmentLossAccountId", "proceedsAccountId"].map((k) => uuidOrNull(input[k], k));
  await checkAccounts(client, c, acct);
  const method = oneOf(input.depreciationMethod || "straight_line", METHODS, "Depreciation method");
  const convention = input.depreciationConvention ? oneOf(input.depreciationConvention, CONVENTIONS, "Convention") : null;
  const life = Math.round(positive(input.usefulLifeMonths ?? 60, "Useful life (months)"));
  const residual = nonNegative(input.residualValuePercent, "Residual value %");
  const rate = nonNegative(input.decliningRate, "Declining rate");
  if (residual > 100 || rate > 100) throw new AssetError(400, "A percentage cannot exceed 100.", "ASSET_NUMBER_INVALID");
  const parent = uuidOrNull(input.parentCategoryId, "Parent category");
  if (parent && parent === id) throw new AssetError(400, "A category cannot be its own parent.", "ASSET_CATEGORY_CYCLE");
  const vals = [c.organizationId, requiredText(input.code, "Code", 40).toUpperCase(), requiredText(input.name, "Name", 200), textOrNull(input.description, 1000), String(nonNegative(input.capitalizationThreshold, "Capitalization threshold")), life, method, String(residual), ...acct, input.active === undefined ? true : Boolean(input.active), String(rate), convention, parent, input.requiresCalibration === true, textOrNull(input.tagPrefix, 12)?.toUpperCase() ?? null];
  if (id) {
    const res = await client.query(
      `UPDATE tenant.asset_categories SET code=$2,name=$3,description=$4,capitalization_threshold=$5,useful_life_months=$6,depreciation_method=$7,residual_value_percent=$8,asset_account_id=$9,accumulated_depreciation_account_id=$10,depreciation_expense_account_id=$11,gain_loss_account_id=$12,clearing_account_id=$13,revaluation_reserve_account_id=$14,impairment_loss_account_id=$15,proceeds_account_id=$16,active=$17,declining_rate=$18,depreciation_convention=$19,parent_category_id=$20,requires_calibration=$21,tag_prefix=$22,updated_at=now()
       WHERE organization_id=$1 AND id=$23 RETURNING *`, [...vals, id]);
    if (!res.rows[0]) throw new AssetError(404, "Category was not found.", "ASSET_NOT_FOUND");
    return res.rows[0];
  }
  const res = await client.query(
    `INSERT INTO tenant.asset_categories(organization_id,code,name,description,capitalization_threshold,useful_life_months,depreciation_method,residual_value_percent,asset_account_id,accumulated_depreciation_account_id,depreciation_expense_account_id,gain_loss_account_id,clearing_account_id,revaluation_reserve_account_id,impairment_loss_account_id,proceeds_account_id,active,declining_rate,depreciation_convention,parent_category_id,requires_calibration,tag_prefix,created_by)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23) RETURNING *`, [...vals, c.userId]);
  return res.rows[0];
}

// ------------------------------------------------------------------ locations
export async function listAssetLocations(client, c) {
  need(c, "assets.view");
  const res = await client.query(
    `SELECT loc.*,parent.name AS parent_name,(SELECT count(*)::int FROM tenant.assets a WHERE a.location_id=loc.id AND a.status<>'disposed') AS asset_count
     FROM tenant.asset_locations loc LEFT JOIN tenant.asset_locations parent ON parent.id=loc.parent_id
     WHERE loc.organization_id=$1 ORDER BY loc.code`, [c.organizationId]);
  return res.rows;
}

export async function saveAssetLocation(client, c, rawInput) {
  need(c, "assets.manage");
  let input = rawInput;
  if (uuidOrNull(rawInput.id, "Location")) {
    const row = (await client.query(`SELECT * FROM tenant.asset_locations WHERE organization_id=$1 AND id=$2`, [c.organizationId, rawInput.id])).rows[0];
    if (!row) throw new AssetError(404, "Location was not found.", "ASSET_NOT_FOUND");
    input = fillFromRow(rawInput, row, LOCATION_MAP);
  }
  const id = uuidOrNull(input.id, "Location");
  const parent = uuidOrNull(input.parentId, "Parent location");
  if (parent) {
    if (parent === id) throw new AssetError(400, "A location cannot be its own parent.", "ASSET_LOCATION_CYCLE");
    let cursor = parent;
    for (let depth = 0; cursor && depth < 20; depth += 1) {
      const row = (await client.query(`SELECT id,parent_id FROM tenant.asset_locations WHERE organization_id=$1 AND id=$2`, [c.organizationId, cursor])).rows[0];
      if (!row) throw new AssetError(409, "The parent location does not exist.", "ASSET_LOCATION_INVALID");
      if (id && row.parent_id === id) throw new AssetError(400, "That parent would create a loop in the location tree.", "ASSET_LOCATION_CYCLE");
      cursor = row.parent_id;
    }
  }
  const type = oneOf(input.locationType || "site", ["site", "building", "floor", "room", "yard", "vehicle", "other"], "Location type");
  const vals = [c.organizationId, requiredText(input.code, "Code", 40).toUpperCase(), requiredText(input.name, "Name", 200), type, parent, textOrNull(input.address, 500), input.active === undefined ? true : Boolean(input.active)];
  if (id) {
    const res = await client.query(`UPDATE tenant.asset_locations SET code=$2,name=$3,location_type=$4,parent_id=$5,address=$6,active=$7,updated_at=now() WHERE organization_id=$1 AND id=$8 RETURNING *`, [...vals, id]);
    if (!res.rows[0]) throw new AssetError(404, "Location was not found.", "ASSET_NOT_FOUND");
    return res.rows[0];
  }
  const res = await client.query(`INSERT INTO tenant.asset_locations(organization_id,code,name,location_type,parent_id,address,active,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [...vals, c.userId]);
  return res.rows[0];
}

// ------------------------------------------------------------------ the asset master
const LIST_SQL = `SELECT a.*,cat.code AS category_code,cat.name AS category_name,loc.name AS location_name,loc.code AS location_code,
    usr.full_name AS custodian_name,dept.name AS department_name
  FROM tenant.assets a JOIN tenant.asset_categories cat ON cat.id=a.category_id
  LEFT JOIN tenant.asset_locations loc ON loc.id=a.location_id
  LEFT JOIN public.users usr ON usr.id=a.current_user_id
  LEFT JOIN public.departments dept ON dept.id=a.current_department_id`;

export async function listAssetRegister(client, c, filters = {}) {
  need(c, "assets.view");
  const values = [c.organizationId];
  const where = [];
  const add = (column, v) => { values.push(v); where.push(`${column}=$${values.length}`); };
  if (!broadScope(c)) add("a.current_user_id", c.userId);
  if (filters.status && filters.status !== "all") add("a.status", oneOf(filters.status, STATUSES, "Status"));
  if (filters.categoryId) add("a.category_id", uuid(filters.categoryId, "Category"));
  if (filters.locationId) add("a.location_id", uuid(filters.locationId, "Location"));
  if (filters.departmentId) add("a.current_department_id", uuid(filters.departmentId, "Department"));
  if (filters.custodianId) add("a.current_user_id", uuid(filters.custodianId, "Custodian"));
  if (filters.criticality) add("a.criticality", text(filters.criticality, 20));
  if (filters.search) {
    values.push(`%${text(filters.search, 100)}%`);
    const n = values.length;
    where.push(`(a.asset_number ILIKE $${n} OR a.name ILIKE $${n} OR a.serial_number ILIKE $${n} OR a.tag_code ILIKE $${n})`);
  }
  const res = await qx(client, `${LIST_SQL} WHERE a.organization_id=$1${where.map((w) => ` AND ${w}`).join("")} ORDER BY a.asset_number LIMIT 500`, values);
  return res.rows.map((r) => maskAsset(c, r));
}

export async function resolveAssetByTag(client, c, tag) {
  need(c, "assets.view");
  const t = requiredText(tag, "Tag", 200);
  const res = await qx(client, `${LIST_SQL} WHERE a.organization_id=$1 AND (a.tag_code=$2 OR a.asset_number=$2 OR a.serial_number=$2) LIMIT 2`, [c.organizationId, t]);
  if (!res.rows[0]) throw new AssetError(404, "No asset matches that tag, number or serial.", "ASSET_NOT_FOUND");
  if (res.rows.length > 1) throw new AssetError(409, "That value matches more than one asset; scan the tag code instead.", "ASSET_TAG_AMBIGUOUS");
  if (!broadScope(c) && res.rows[0].current_user_id !== c.userId) throw new AssetError(404, "No asset matches that tag, number or serial.", "ASSET_NOT_FOUND");
  return maskAsset(c, res.rows[0]);
}

// A scan/QR payload for printing on a label: stable identity, never any value.
export async function getAssetTagPayload(client, c, assetId) {
  need(c, "assets.view");
  const a = await loadAsset(client, c, assetId);
  return { assetId: a.id, tagCode: a.tag_code, assetNumber: a.asset_number, name: a.name, qr: `asset:${a.organization_id}:${a.tag_code}` };
}

export async function getAssetProfile(client, c, assetId) {
  need(c, "assets.view");
  const id = uuid(assetId, "Asset");
  const head = await qx(client, `${LIST_SQL} WHERE a.organization_id=$1 AND a.id=$2`, [c.organizationId, id]);
  if (!head.rows[0]) throw new AssetError(404, "Asset was not found.", "ASSET_NOT_FOUND");
  if (!broadScope(c) && head.rows[0].current_user_id !== c.userId) throw new AssetError(404, "Asset was not found.", "ASSET_NOT_FOUND");
  const q = async (table, order, extra = "") => (await qx(client, `SELECT * FROM tenant.${table} WHERE organization_id=$1 AND asset_id=$2${extra} ORDER BY ${order} LIMIT 200`, [c.organizationId, id])).rows;
  const profile = { asset: maskAsset(c, head.rows[0]) };
  profile.children = (await qx(client, `SELECT id,asset_number,name,status FROM tenant.assets WHERE organization_id=$1 AND parent_asset_id=$2 ORDER BY asset_number`, [c.organizationId, id])).rows;
  profile.assignments = await q("asset_assignments", "assigned_from DESC");
  profile.movements = await q("asset_movements", "effective_date DESC,created_at DESC");
  profile.maintenanceOrders = await q("asset_maintenance_orders", "created_at DESC");
  profile.maintenancePlans = await q("asset_maintenance_plans", "created_at DESC");
  profile.downtime = await q("asset_downtime", "started_at DESC");
  profile.events = await q("asset_events", "occurred_at DESC");
  const financial = canSeeValue(c);
  profile.schedule = financial ? await q("asset_depreciation_schedules", "period_end") : [];
  return profile;
}

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

export async function registerAsset(client, c, input, source = null) {
  need(c, "assets.create");
  if (!source) assertValueFieldsWritable(c, input);
  const category = await loadCategory(client, c, input.categoryId);
  const settings = await loadSettings(client, c);
  const method = oneOf(input.depreciationMethod || category.depreciation_method || settings.default_depreciation_method, METHODS, "Depreciation method");
  const cost = nonNegative(input.acquisitionCost, "Acquisition cost");
  const life = Math.round(positive(input.usefulLifeMonths ?? category.useful_life_months, "Useful life (months)"));
  const residual = input.residualValue !== undefined && input.residualValue !== "" ? nonNegative(input.residualValue, "Residual value") : Number(fromCents((toCents(cost) * toCents(category.residual_value_percent)) / 10000n));
  if (residual > cost) throw new AssetError(400, "Residual value cannot exceed the acquisition cost.", "ASSET_NUMBER_INVALID");
  const parentId = uuidOrNull(input.parentAssetId, "Parent asset");
  await assertParent(client, c, parentId, null);
  const locationId = uuidOrNull(input.locationId, "Location");
  if (locationId) {
    const loc = await client.query(`SELECT 1 FROM tenant.asset_locations WHERE organization_id=$1 AND id=$2 AND active=true`, [c.organizationId, locationId]);
    if (!loc.rows[0]) throw new AssetError(409, "The location does not exist or is inactive.", "ASSET_LOCATION_INVALID");
  }
  const number = input.assetNumber ? requiredText(input.assetNumber, "Asset number", 60) : await nextNumber(client, c, "asset", category.tag_prefix || "AST");
  const tag = input.tagCode ? requiredText(input.tagCode, "Tag code", 80) : number;
  const currency = (await client.query(`SELECT base_currency FROM public.organizations WHERE id=$1`, [c.organizationId])).rows[0]?.base_currency || "INR";
  const wStart = dateOrNull(input.warrantyStartDate, "Warranty start");
  const wEnd = dateOrNull(input.warrantyEndDate, "Warranty end");
  if (wStart && wEnd && wEnd < wStart) throw new AssetError(400, "Warranty end cannot be before its start.", "ASSET_DATE_INVALID");
  let res;
  try {
    res = await qx(client,
      `INSERT INTO tenant.assets(organization_id,asset_number,name,description,category_id,item_id,serial_number,manufacturer,model,acquisition_date,acquisition_cost,capitalized_cost,residual_value,net_book_value,currency_code,useful_life_months,depreciation_method,status,warranty_start_date,warranty_end_date,content_hash,created_by,
         tag_code,location_id,parent_asset_id,supplier_id,ownership,criticality,condition_rating,total_units,current_department_id,current_cost_center_id,current_user_id,source_document_type,source_document_id,source_line_id,purchase_order_id,vendor_bill_id,notes)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,0,$12,0,$13,$14,$15,'draft',$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36) RETURNING *`,
      [c.organizationId, number, requiredText(input.name, "Name", 300), textOrNull(input.description, 2000), category.id, uuidOrNull(input.itemId, "Item"), textOrNull(input.serialNumber, 120), textOrNull(input.manufacturer, 200), textOrNull(input.model, 200), dateOrNull(input.acquisitionDate, "Acquisition date"), String(cost), String(residual), currency, life, method, wStart, wEnd, hashOf(input), c.userId,
        tag, locationId, parentId, uuidOrNull(input.supplierId, "Supplier"), oneOf(input.ownership || "owned", ["owned", "leased", "loaned"], "Ownership"), oneOf(input.criticality || "medium", ["low", "medium", "high", "critical"], "Criticality"), oneOf(input.conditionRating || "good", ["excellent", "good", "fair", "poor", "critical"], "Condition"), input.totalUnits ? String(positive(input.totalUnits, "Total units")) : null, uuidOrNull(input.departmentId, "Department"), uuidOrNull(input.costCenterId, "Cost centre"), uuidOrNull(input.custodianUserId, "Custodian"),
        source?.type ?? null, source?.documentId ?? null, source?.lineId ?? null, uuidOrNull(input.purchaseOrderId, "Purchase order"), source?.type === "vendor_bill_line" ? source.documentId : null, textOrNull(input.notes, 2000)]);
  } catch (error) {
    if (error.code === "23505") throw new AssetError(409, "An asset with that number, serial number or tag code already exists.", "ASSET_DUPLICATE");
    throw error;
  }
  const asset = res.rows[0];
  await recordAssetEvent(client, c, asset.id, "asset.created", { assetNumber: number, source: source?.type ?? "manual" });
  return maskAsset(c, asset);
}

export async function updateAssetRecord(client, c, assetId, input) {
  need(c, "assets.manage");
  assertValueFieldsWritable(c, input);
  const a = await loadAsset(client, c, assetId, { lock: true });
  if (a.status === "disposed") throw new AssetError(409, "A disposed asset can no longer be edited.", "ASSET_STATE_INVALID");
  const sets = [];
  const vals = [c.organizationId, a.id];
  const set = (col, v) => { vals.push(v); sets.push(`${col}=$${vals.length}`); };
  if (input.name !== undefined) set("name", requiredText(input.name, "Name", 300));
  if (input.description !== undefined) set("description", textOrNull(input.description, 2000));
  if (input.manufacturer !== undefined) set("manufacturer", textOrNull(input.manufacturer, 200));
  if (input.model !== undefined) set("model", textOrNull(input.model, 200));
  if (input.serialNumber !== undefined) set("serial_number", textOrNull(input.serialNumber, 120));
  if (input.notes !== undefined) set("notes", textOrNull(input.notes, 2000));
  if (input.criticality !== undefined) set("criticality", oneOf(input.criticality, ["low", "medium", "high", "critical"], "Criticality"));
  if (input.conditionRating !== undefined) set("condition_rating", oneOf(input.conditionRating, ["excellent", "good", "fair", "poor", "critical"], "Condition"));
  if (input.ownership !== undefined) set("ownership", oneOf(input.ownership, ["owned", "leased", "loaned"], "Ownership"));
  if (input.supplierId !== undefined) set("supplier_id", uuidOrNull(input.supplierId, "Supplier"));
  if (input.tagCode !== undefined) set("tag_code", requiredText(input.tagCode, "Tag code", 80));
  if (input.parentAssetId !== undefined) { const p = uuidOrNull(input.parentAssetId, "Parent asset"); await assertParent(client, c, p, a.id); set("parent_asset_id", p); }
  if (input.warrantyStartDate !== undefined) set("warranty_start_date", dateOrNull(input.warrantyStartDate, "Warranty start"));
  if (input.warrantyEndDate !== undefined) set("warranty_end_date", dateOrNull(input.warrantyEndDate, "Warranty end"));
  const financial = ["categoryId", "acquisitionCost", "residualValue", "usefulLifeMonths", "depreciationMethod", "acquisitionDate", "totalUnits"].some((k) => input[k] !== undefined);
  if (financial) {
    if (a.status !== "draft") throw new AssetError(409, "Cost, life, method and category can only change before capitalization; use a value adjustment afterwards.", "ASSET_FINANCIALS_LOCKED");
    if (input.categoryId !== undefined) set("category_id", (await loadCategory(client, c, input.categoryId)).id);
    if (input.acquisitionCost !== undefined) set("acquisition_cost", String(nonNegative(input.acquisitionCost, "Acquisition cost")));
    if (input.residualValue !== undefined) set("residual_value", String(nonNegative(input.residualValue, "Residual value")));
    if (input.usefulLifeMonths !== undefined) set("useful_life_months", Math.round(positive(input.usefulLifeMonths, "Useful life")));
    if (input.depreciationMethod !== undefined) set("depreciation_method", oneOf(input.depreciationMethod, METHODS, "Method"));
    if (input.acquisitionDate !== undefined) set("acquisition_date", dateOrNull(input.acquisitionDate, "Acquisition date"));
    if (input.totalUnits !== undefined) set("total_units", input.totalUnits ? String(positive(input.totalUnits, "Total units")) : null);
  }
  if (!sets.length) return maskAsset(c, a);
  let res;
  try {
    res = await qx(client, `UPDATE tenant.assets SET ${sets.join(",")},updated_at=now() WHERE organization_id=$1 AND id=$2 RETURNING *`, vals);
  } catch (error) {
    if (error.code === "23505") throw new AssetError(409, "That serial number or tag code is already used by another asset.", "ASSET_DUPLICATE");
    if (error.code === "23514") throw new AssetError(400, "A value is out of range (residual cannot exceed cost).", "ASSET_NUMBER_INVALID");
    throw error;
  }
  await recordAssetEvent(client, c, a.id, "asset.updated", { fields: sets.length });
  return maskAsset(c, res.rows[0]);
}

// ------------------------------------------------------------------ F238: creation from a source document
// One asset per source line, once: a repeat request returns the asset that already exists.
export async function createAssetFromSource(client, c, input) {
  need(c, "assets.create");
  const type = oneOf(input.sourceType, ["vendor_bill_line", "purchase_order"], "Source type");
  const sourceId = uuid(input.sourceId, "Source");
  if (type === "vendor_bill_line") {
    const existing = await qx(client, `SELECT * FROM tenant.assets WHERE organization_id=$1 AND source_line_id=$2`, [c.organizationId, sourceId]);
    if (existing.rows[0]) return { asset: maskAsset(c, existing.rows[0]), reused: true };
    const line = await client.query(
      `SELECT line.id,line.description,line.net_amount,line.quantity,bill.id AS bill_id,bill.party_id,bill.bill_date,bill.status
       FROM tenant.accounting_vendor_bill_lines line JOIN tenant.accounting_vendor_bills bill ON bill.id=line.vendor_bill_id
       WHERE line.organization_id=$1 AND line.id=$2`, [c.organizationId, sourceId]);
    const l = line.rows[0];
    if (!l) throw new AssetError(404, "The vendor bill line was not found.", "ASSET_SOURCE_NOT_FOUND");
    if (!["posted", "partially_paid", "paid", "overdue", "disputed"].includes(l.status)) throw new AssetError(409, "The vendor bill must be posted before an asset can be created from it.", "ASSET_SOURCE_NOT_POSTED");
    const asset = await registerAsset(client, c, { ...input, name: input.name || l.description, acquisitionCost: input.acquisitionCost ?? l.net_amount, acquisitionDate: input.acquisitionDate || String(l.bill_date instanceof Date ? l.bill_date.toISOString().slice(0, 10) : l.bill_date).slice(0, 10), supplierId: input.supplierId || l.party_id }, { type: "vendor_bill_line", documentId: l.bill_id, lineId: l.id });
    return { asset, reused: false };
  }
  const po = await client.query(`SELECT id,status FROM tenant.purchase_orders WHERE organization_id=$1 AND id=$2`, [c.organizationId, sourceId]);
  if (!po.rows[0]) throw new AssetError(404, "The purchase order was not found.", "ASSET_SOURCE_NOT_FOUND");
  const asset = await registerAsset(client, c, { ...input, purchaseOrderId: sourceId }, { type: "purchase_order", documentId: sourceId, lineId: null });
  return { asset, reused: false };
}

// ------------------------------------------------------------------ F237: capitalisation
export async function capitalizeAssetRecord(client, c, assetId, input = {}) {
  need(c, "assets.capitalize");
  const a = await loadAsset(client, c, assetId, { lock: true });
  if (a.status !== "draft") throw new AssetError(409, "Only a draft asset can be capitalized.", "ASSET_STATE_INVALID");
  const settings = await loadSettings(client, c);
  if (settings.require_capitalization_approval && settings.prohibit_self_approval && a.created_by === c.userId) throw new AssetError(409, "The person who registered an asset cannot capitalize it.", "SELF_APPROVAL_BLOCKED");
  const category = (await client.query(`SELECT * FROM tenant.asset_categories WHERE id=$1`, [a.category_id])).rows[0];
  const cost = toCents(input.capitalizedCost ?? a.acquisition_cost);
  if (cost <= 0n) throw new AssetError(400, "A capitalized cost must be greater than zero.", "ASSET_NUMBER_INVALID");
  if (cost < toCents(category.capitalization_threshold)) throw new AssetError(409, `The cost is below the category capitalization threshold (${category.capitalization_threshold}); expense it instead.`, "ASSET_BELOW_THRESHOLD");
  if (toCents(a.residual_value) > cost) throw new AssetError(400, "Residual value cannot exceed the capitalized cost.", "ASSET_NUMBER_INVALID");
  const capDate = dateRequired(input.capitalizationDate || a.acquisition_date || today(), "Capitalization date");
  const inService = dateRequired(input.placedInServiceDate || capDate, "In-service date");
  if (inService < capDate) throw new AssetError(400, "The in-service date cannot be before the capitalization date.", "ASSET_DATE_INVALID");

  let accounting = { status: "not_required", journalEntryId: null };
  if (settings.post_to_accounting) {
    let offset = category.clearing_account_id;
    if (a.source_document_type === "vendor_bill_line" && a.source_line_id) {
      const src = await client.query(`SELECT expense_account_id FROM tenant.accounting_vendor_bill_lines WHERE organization_id=$1 AND id=$2`, [c.organizationId, a.source_line_id]);
      offset = src.rows[0]?.expense_account_id || offset;
    }
    accounting = await postAssetJournal(client, c, {
      date: capDate, reference: a.asset_number, description: `Capitalization of ${a.asset_number} - ${a.name}`, sourceType: "asset_capitalization", sourceId: a.id, sourceNumber: a.asset_number,
      lines: [{ accountId: category.asset_account_id, debitCents: cost, description: a.name }, { accountId: offset, creditCents: cost, description: `Capitalized ${a.asset_number}` }],
    });
  }
  const res = await qx(client,
    `UPDATE tenant.assets SET status='available',capitalization_date=$3,placed_in_service_date=$4,depreciation_start_date=$4,capitalized_cost=$5,net_book_value=$5,capitalized_by=$6,capitalized_at=now(),accounting_status=$7,capitalization_journal_id=$8,updated_at=now()
     WHERE organization_id=$1 AND id=$2 RETURNING *`,
    [c.organizationId, a.id, capDate, inService, fromCents(cost), c.userId, accounting.status, accounting.journalEntryId]);
  const asset = res.rows[0];
  await generateSchedule(client, c, asset, category, settings);
  await recordAssetEvent(client, c, a.id, "asset.capitalized", { capitalizedCost: fromCents(cost), accounting: accounting.status, journalEntryId: accounting.journalEntryId });
  return maskAsset(c, asset);
}

// Posted vendor bill lines that have not yet become an asset: the worklist behind "create from procurement".
export async function listAssetSourceLines(client, c) {
  need(c, "assets.view");
  need(c, "assets.create");
  const res = await qx(client,
    `SELECT line.id,line.description,line.net_amount,bill.bill_number,bill.bill_date,party.display_name AS supplier_name
     FROM tenant.accounting_vendor_bill_lines line JOIN tenant.accounting_vendor_bills bill ON bill.id=line.vendor_bill_id
     LEFT JOIN tenant.business_parties party ON party.id=bill.party_id
     WHERE line.organization_id=$1 AND bill.status IN ('posted','partially_paid','paid','overdue','disputed')
       AND bill.bill_type='bill' AND NOT EXISTS (SELECT 1 FROM tenant.assets a WHERE a.source_line_id=line.id)
     ORDER BY bill.bill_date DESC,bill.bill_number LIMIT 300`, [c.organizationId]);
  return res.rows;
}

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
