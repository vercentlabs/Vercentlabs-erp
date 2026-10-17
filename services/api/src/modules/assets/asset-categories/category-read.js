// Assets — Asset Categories, the reads: the directory with each category's asset counts (total, active, retired, tracked-only, capitalized),
// one category's detail (basic information, operational rules, Finance references for those allowed, its assets, versions and change
// history), the starter templates with which are already in use, the reports and the export.
import { has, qx, uuid } from "../common.js";
import {
  ASSET_TYPES, CATEGORY, COLUMN, CUSTODIAN_POLICY, FINANCE, GUIDANCE, OWNERSHIP_APPLICABILITY, SERIAL_POLICY, TAG_POLICY, TEMPLATES, categoryError, mayCreate, mayDeactivate, mayEdit,
  normalizedName, seesFinance,
} from "./category-rules.js";

const COUNTS = `(SELECT count(*)::int FROM tenant.assets a WHERE a.category_id = category.id AND a.archived_at IS NULL) AS total,
  (SELECT count(*)::int FROM tenant.assets a WHERE a.category_id = category.id AND a.archived_at IS NULL AND a.lifecycle_status = 'ACTIVE') AS active,
  (SELECT count(*)::int FROM tenant.assets a WHERE a.category_id = category.id AND a.lifecycle_status IN ('RETIRED', 'DISPOSED', 'LOST')) AS ended,
  (SELECT count(*)::int FROM tenant.assets a WHERE a.category_id = category.id AND a.archived_at IS NULL AND a.capitalization_class = 'TRACKED_ONLY') AS tracked,
  (SELECT count(*)::int FROM tenant.assets a WHERE a.category_id = category.id AND a.archived_at IS NULL AND a.capitalization_class = 'CAPITALIZED') AS capitalized`;
function shape(c, row) {
  const finance = seesFinance(c);
  return {
    id: row.id, code: row.code, name: row.name, description: row.description, assetType: row.asset_type, assetTypeLabel: ASSET_TYPES[row.asset_type] ?? row.asset_type,
    capitalizationGuidance: row.capitalization_guidance, capitalizationGuidanceLabel: GUIDANCE[row.capitalization_guidance], serialNumberPolicy: row.serial_number_policy,
    serialNumberPolicyLabel: SERIAL_POLICY[row.serial_number_policy], assetTagPolicy: row.asset_tag_policy, assetTagPolicyLabel: TAG_POLICY[row.asset_tag_policy], locationRequired: row.location_required,
    custodianPolicy: row.custodian_policy, custodianPolicyLabel: CUSTODIAN_POLICY[row.custodian_policy], warrantyApplicable: row.warranty_applicable, maintenanceApplicable: row.maintenance_applicable,
    verificationApplicable: row.verification_applicable, scrapEvidenceRequired: row.scrap_evidence_required === true, suggestedCondition: row.suggested_condition, defaultDepartmentId: row.default_department_id, ownershipApplicability: row.ownership_applicability,
    ownershipApplicabilityLabel: OWNERSHIP_APPLICABILITY[row.ownership_applicability], active: row.active, policyVersion: row.policy_version, version: row.row_version, template: row.template_key,
    createdAt: row.created_at, updatedAt: row.updated_at,
    counts: row.total === undefined ? undefined : { total: row.total, active: row.active, ended: row.ended, tracked: row.tracked, capitalized: row.capitalized },
    ...(finance ? { finance: Object.fromEntries(FINANCE.map((k) => [k, row[COLUMN[k]] === null || row[COLUMN[k]] === undefined ? null : String(row[COLUMN[k]])])) } : {}),
    financePolicyComplete: Boolean(row.depreciation_method && row.useful_life_months && row.asset_account_id && row.accumulated_depreciation_account_id && row.depreciation_expense_account_id),
  };
}
// filters: { search?, status? (active|inactive|all), assetType?, sort? (name|code|assets), direction? }
export async function getAssetCategories(client, c, filters = {}) {
  if (!has(c, CATEGORY.view)) throw categoryError(403, "ASSET_CATEGORY_PERMISSION_DENIED");
  const values = [c.organizationId];
  const where = ["category.organization_id = $1", "category.deleted_at IS NULL"];
  const status = String(filters.status ?? "all");
  if (status === "active") where.push("category.active");
  if (status === "inactive") where.push("NOT category.active");
  if (filters.assetType) { values.push(String(filters.assetType)); where.push(`category.asset_type = $${values.length}`); }
  if (filters.search) { values.push(`%${String(filters.search).slice(0, 100).replace(/[%_]/g, "\\$&")}%`); where.push(`(category.name ILIKE $${values.length} OR category.code ILIKE $${values.length} OR category.description ILIKE $${values.length})`); }
  const sort = { name: "lower(category.name)", code: "category.code", assets: "total" }[filters.sort] ?? "lower(category.name)";
  const rows = (await qx(client, `SELECT category.*, ${COUNTS} FROM tenant.asset_categories category WHERE ${where.join(" AND ")}
      ORDER BY category.active DESC, ${sort} ${String(filters.direction).toLowerCase() === "desc" ? "DESC" : "ASC"}`, values)).rows;
  return { rows: rows.map((row) => shape(c, row)), can: { create: mayCreate(c), edit: mayEdit(c), deactivate: mayDeactivate(c), finance: has(c, CATEGORY.manageFinance), seeFinance: seesFinance(c),
    export: has(c, CATEGORY.export), history: has(c, CATEGORY.history) || mayEdit(c) } };
}
// The categories offered when registering an asset: active only, with the rules the form applies.
export async function getSelectableCategories(client, c) {
  if (!has(c, CATEGORY.view)) throw categoryError(403, "ASSET_CATEGORY_PERMISSION_DENIED");
  return (await client.query(`SELECT * FROM tenant.asset_categories WHERE organization_id = $1 AND active AND deleted_at IS NULL ORDER BY lower(name)`, [c.organizationId])).rows.map((row) => {
    const s = shape({ ...c, permissions: [] }, row);
    delete s.finance;
    return s;
  });
}
export async function getAssetCategory(client, c, categoryId) {
  if (!has(c, CATEGORY.view)) throw categoryError(403, "ASSET_CATEGORY_PERMISSION_DENIED");
  let id;
  try { id = uuid(categoryId, "Category"); } catch { throw categoryError(404, "ASSET_CATEGORY_NOT_FOUND"); }
  const row = (await qx(client, `SELECT category.*, ${COUNTS}, dept.name AS default_department_name FROM tenant.asset_categories category LEFT JOIN public.departments dept ON dept.id = category.default_department_id
      WHERE category.organization_id = $1 AND category.id = $2 AND category.deleted_at IS NULL`, [c.organizationId, id])).rows[0];
  if (!row) throw categoryError(404, "ASSET_CATEGORY_NOT_FOUND");
  const out = shape(c, row);
  out.defaultDepartment = row.default_department_name ?? null;
  out.can = { edit: mayEdit(c), deactivate: mayDeactivate(c), finance: has(c, CATEGORY.manageFinance), seeFinance: seesFinance(c), history: has(c, CATEGORY.history) || mayEdit(c),
    delete: mayDeactivate(c) && row.total === 0 && row.ended === 0 };
  // Finance picks the GL references from the Company's active, postable accounts.
  if (has(c, CATEGORY.manageFinance)) {
    out.accountOptions = (await client.query(`SELECT id, code, name FROM tenant.accounting_accounts WHERE organization_id = $1 AND status = 'active' AND NOT is_group ORDER BY code LIMIT 2000`, [c.organizationId])).rows;
  }
  return out;
}
export async function getAssetCategoryHistory(client, c, categoryId) {
  if (!has(c, CATEGORY.history) && !mayEdit(c)) throw categoryError(403, "ASSET_CATEGORY_PERMISSION_DENIED");
  const id = uuid(categoryId, "Category");
  const events = (await client.query(`SELECT e.*, COALESCE(NULLIF(u.full_name, ''), u.email) AS actor FROM tenant.asset_category_events e LEFT JOIN public.users u ON u.id = e.actor_user_id
      WHERE e.organization_id = $1 AND e.category_id = $2 ORDER BY e.occurred_at DESC`, [c.organizationId, id])).rows;
  const versions = (await qx(client, `SELECT v.*, COALESCE(NULLIF(u.full_name, ''), u.email) AS actor FROM tenant.asset_category_policy_versions v LEFT JOIN public.users u ON u.id = v.created_by
      WHERE v.organization_id = $1 AND v.category_id = $2 ORDER BY v.version DESC`, [c.organizationId, id])).rows;
  const finance = seesFinance(c);
  return {
    events: events.map((e) => ({ id: e.id, action: e.action, changes: finance ? e.changes : Object.fromEntries(Object.entries(e.changes ?? {}).filter(([k]) => !Object.values(COLUMN).slice(FINANCE.length * -1).includes(k) && !FINANCE.map((f) => COLUMN[f]).includes(k))),
      version: e.policy_version, reason: e.reason, by: e.actor, at: e.occurred_at })),
    versions: versions.map((v) => ({ version: v.version, effectiveFrom: v.effective_from, operational: v.operational, finance: finance ? v.finance : null, reason: v.reason, by: v.actor, at: v.created_at })),
  };
}
export async function getAssetCategoryAssets(client, c, categoryId) {
  if (!has(c, CATEGORY.view)) throw categoryError(403, "ASSET_CATEGORY_PERMISSION_DENIED");
  const { getAssetRegister } = await import("../asset-register/register-read.js");
  return getAssetRegister(client, c, { categoryId: uuid(categoryId, "Category"), pageSize: 200 });
}
// Which starter templates exist, and which the Company already has (by name).
export async function getCategoryTemplates(client, c) {
  if (!has(c, CATEGORY.view)) throw categoryError(403, "ASSET_CATEGORY_PERMISSION_DENIED");
  const names = new Map((await client.query(`SELECT code, name FROM tenant.asset_categories WHERE organization_id = $1 AND deleted_at IS NULL`, [c.organizationId])).rows.map((r) => [normalizedName(r.name), r.code]));
  return TEMPLATES.map(([key, name, type, guidance, serial, , , , , , description]) => ({ key, name, description, assetType: type, assetTypeLabel: ASSET_TYPES[type], guidance: GUIDANCE[guidance],
    serial: SERIAL_POLICY[serial], existing: names.get(normalizedName(name)) ?? null }));
}
// An asset's category corrections (assetId), or the Company's waiting for Finance (status PENDING_FINANCE): old and new, reason, impact, decision.
export async function getAssetReclassifications(client, c, filters = {}) {
  if (!has(c, CATEGORY.reclassify) && !has(c, CATEGORY.manageFinance) && !has(c, CATEGORY.history) && !has(c, CATEGORY.view)) throw categoryError(403, "ASSET_CATEGORY_PERMISSION_DENIED");
  const values = [c.organizationId];
  const where = ["r.organization_id = $1"];
  if (filters.assetId) { values.push(uuid(filters.assetId, "Asset")); where.push(`r.asset_id = $${values.length}`); }
  else if (!has(c, CATEGORY.manageFinance) && !has(c, CATEGORY.reclassify)) throw categoryError(403, "ASSET_CATEGORY_PERMISSION_DENIED");
  if (filters.status) { values.push(String(filters.status)); where.push(`r.status = $${values.length}`); }
  const rows = (await qx(client, `SELECT r.*, a.asset_number, a.name AS asset_name, f.name AS from_name, t.name AS to_name, COALESCE(NULLIF(req.full_name, ''), req.email) AS requested_by_name,
      COALESCE(NULLIF(dec.full_name, ''), dec.email) AS decided_by_name FROM tenant.asset_reclassifications r JOIN tenant.assets a ON a.id = r.asset_id
      JOIN tenant.asset_categories f ON f.id = r.from_category_id JOIN tenant.asset_categories t ON t.id = r.to_category_id
      LEFT JOIN public.users req ON req.id = r.requested_by LEFT JOIN public.users dec ON dec.id = r.decided_by
      WHERE ${where.join(" AND ")} ORDER BY r.requested_at DESC LIMIT 500`, values)).rows;
  return { rows: rows.map((r) => ({ id: r.id, number: `RCL-${r.reclassification_number}`, assetId: r.asset_id, asset: `${r.asset_number} · ${r.asset_name}`, from: r.from_name, to: r.to_name, status: r.status,
    reason: r.reason, impact: r.impact, requestedBy: r.requested_by_name, requestedAt: r.requested_at, decidedBy: r.decided_by_name, decidedAt: r.decided_at, decisionNote: r.decision_note,
    financeAdjustmentReference: r.finance_adjustment_reference, href: `/assets/register/${r.asset_id}` })), can: { decide: has(c, CATEGORY.manageFinance) } };
}

// ------------------------------------------------------------------ reports and export
export const CATEGORY_REPORTS = Object.freeze(["by-category", "value-by-category", "capitalized-vs-tracked", "by-location", "missing-finance-policy", "inactive-in-use", "reclassified",
  "acquisition-by-category", "applicability", "missing-required-fields"]);
export async function getAssetCategoryReport(client, c, kind = "by-category") {
  if (!CATEGORY_REPORTS.includes(kind)) throw categoryError(400, "ASSET_CATEGORY_POLICY_INVALID", "Unknown report.");
  if (!has(c, CATEGORY.view)) throw categoryError(403, "ASSET_CATEGORY_PERMISSION_DENIED");
  if (["value-by-category", "missing-finance-policy"].includes(kind) && !seesFinance(c) && !has(c, "assets.view_financials")) throw categoryError(403, "ASSET_CATEGORY_PERMISSION_DENIED");
  const q = async (sql) => (await qx(client, sql, [c.organizationId])).rows;
  switch (kind) {
    case "by-category": return (await getAssetCategories(client, c, {})).rows.map((r) => ({ code: r.code, name: r.name, type: r.assetTypeLabel, total: r.counts.total, active: r.counts.active, ended: r.counts.ended,
      tracked: r.counts.tracked, capitalized: r.counts.capitalized, status: r.active ? "Active" : "Inactive" }));
    case "value-by-category": return (await q(`SELECT category.code, category.name, count(a.id)::int AS capitalized, COALESCE(sum(a.capitalized_cost), 0) AS cost, COALESCE(sum(a.net_book_value), 0) AS carrying,
        to_char(current_date, 'YYYY-MM-DD') AS as_of FROM tenant.asset_categories category LEFT JOIN tenant.assets a ON a.category_id = category.id AND a.capitalization_class = 'CAPITALIZED' AND a.archived_at IS NULL
        WHERE category.organization_id = $1 AND category.deleted_at IS NULL GROUP BY category.id ORDER BY category.name`)).map((r) => ({ ...r, cost: String(r.cost), carrying: String(r.carrying) }));
    case "capitalized-vs-tracked": return q(`SELECT category.code, category.name, count(*) FILTER (WHERE a.capitalization_class = 'CAPITALIZED')::int AS capitalized,
        count(*) FILTER (WHERE a.capitalization_class = 'PENDING')::int AS pending_finance, count(*) FILTER (WHERE a.capitalization_class = 'TRACKED_ONLY')::int AS tracked_only
        FROM tenant.asset_categories category LEFT JOIN tenant.assets a ON a.category_id = category.id AND a.archived_at IS NULL WHERE category.organization_id = $1 AND category.deleted_at IS NULL GROUP BY category.id ORDER BY category.name`);
    case "by-location": return q(`SELECT category.name AS category, COALESCE(loc.name, 'No location') AS location, count(*)::int AS assets FROM tenant.assets a JOIN tenant.asset_categories category ON category.id = a.category_id
        LEFT JOIN tenant.asset_locations loc ON loc.id = a.location_id WHERE a.organization_id = $1 AND a.archived_at IS NULL GROUP BY 1, 2 ORDER BY 1, 3 DESC`);
    case "missing-finance-policy": return (await getAssetCategories(client, c, { status: "active" })).rows.filter((r) => r.capitalizationGuidance !== "TRACK_ONLY" && !r.financePolicyComplete)
      .map((r) => ({ code: r.code, name: r.name, guidance: r.capitalizationGuidanceLabel, assets: r.counts.total }));
    case "inactive-in-use": return (await getAssetCategories(client, c, { status: "inactive" })).rows.filter((r) => r.counts.total > 0).map((r) => ({ code: r.code, name: r.name, assets: r.counts.total, active: r.counts.active }));
    case "reclassified": return (await q(`SELECT r.reclassification_number, r.status, r.reason, r.requested_at, a.asset_number, a.name, f.name AS from_name, t.name AS to_name, a.id AS asset_id
        FROM tenant.asset_reclassifications r JOIN tenant.assets a ON a.id = r.asset_id JOIN tenant.asset_categories f ON f.id = r.from_category_id JOIN tenant.asset_categories t ON t.id = r.to_category_id
        WHERE r.organization_id = $1 ORDER BY r.requested_at DESC LIMIT 500`)).map((r) => ({ number: `RCL-${r.reclassification_number}`, asset: `${r.asset_number} · ${r.name}`, from: r.from_name, to: r.to_name, status: r.status,
      reason: r.reason, at: r.requested_at, href: `/assets/register/${r.asset_id}` }));
    case "acquisition-by-category": return q(`SELECT category.name AS category, to_char(date_trunc('month', COALESCE(a.acquisition_date, a.created_at::date)), 'YYYY-MM') AS month, count(*)::int AS assets
        FROM tenant.assets a JOIN tenant.asset_categories category ON category.id = a.category_id WHERE a.organization_id = $1 GROUP BY 1, 2 ORDER BY 2 DESC, 1 LIMIT 500`);
    case "applicability": return (await getAssetCategories(client, c, { status: "active" })).rows.map((r) => ({ code: r.code, name: r.name, serial: r.serialNumberPolicyLabel, tag: r.assetTagPolicyLabel,
      location: r.locationRequired ? "Required" : "Optional", custody: r.custodianPolicyLabel, warranty: r.warrantyApplicable ? "Yes" : "No", maintenance: r.maintenanceApplicable ? "Yes" : "No", verification: r.verificationApplicable ? "Yes" : "No" }));
    case "missing-required-fields": return (await q(`SELECT a.id, a.asset_number, a.name, category.name AS category,
        (category.serial_number_policy = 'REQUIRED' AND a.serial_number IS NULL) AS no_serial, (category.asset_tag_policy = 'REQUIRED' AND a.tag_code IS NULL) AS no_tag,
        (category.location_required AND a.location_id IS NULL) AS no_location, (category.custodian_policy = 'REQUIRED' AND a.lifecycle_status = 'ACTIVE' AND a.current_user_id IS NULL) AS no_custodian
        FROM tenant.assets a JOIN tenant.asset_categories category ON category.id = a.category_id WHERE a.organization_id = $1 AND a.archived_at IS NULL AND a.lifecycle_status NOT IN ('DISPOSED')`))
      .filter((r) => r.no_serial || r.no_tag || r.no_location || r.no_custodian)
      .map((r) => ({ asset: `${r.asset_number} · ${r.name}`, category: r.category, missing: [r.no_serial && "serial", r.no_tag && "tag", r.no_location && "location", r.no_custodian && "custodian"].filter(Boolean).join(", "), href: `/assets/register/${r.id}` }));
    default: return [];
  }
}
const csvCell = (value) => { const s = value === null || value === undefined ? "" : String(value); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export async function exportAssetCategories(client, c) {
  if (!has(c, CATEGORY.export)) throw categoryError(403, "ASSET_CATEGORY_PERMISSION_DENIED");
  const { rows } = await getAssetCategories(client, c, {});
  const finance = seesFinance(c);
  const header = ["Code", "Name", "Type", "Capitalization guidance", "Serial", "Tag", "Location required", "Custody", "Warranty", "Maintenance", "Verification", "Status", "Assets", "Active", "Tracked only", "Capitalized",
    ...(finance ? ["Depreciation method", "Useful life (months)", "Tax depreciation reference", "Accounting class"] : [])];
  const lines = rows.map((r) => [r.code, r.name, r.assetTypeLabel, r.capitalizationGuidanceLabel, r.serialNumberPolicyLabel, r.assetTagPolicyLabel, r.locationRequired ? "Yes" : "No", r.custodianPolicyLabel,
    r.warrantyApplicable ? "Yes" : "No", r.maintenanceApplicable ? "Yes" : "No", r.verificationApplicable ? "Yes" : "No", r.active ? "Active" : "Inactive", r.counts.total, r.counts.active, r.counts.tracked, r.counts.capitalized,
    ...(finance ? [r.finance.depreciationMethod, r.finance.usefulLifeMonths, r.finance.taxDepreciationReference, r.finance.accountingClass] : [])]);
  return { fileName: "asset-categories.csv", csv: [header, ...lines].map((line) => line.map(csvCell).join(",")).join("\r\n") };
}
