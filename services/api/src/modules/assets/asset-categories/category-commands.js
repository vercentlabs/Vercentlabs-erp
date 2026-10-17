// Assets — Asset Categories, the commands. Creating a category generates its code; its name is unique within the Company. Changing its
// operational rules or its Finance references makes a new policy version (assets already registered keep theirs); every change is logged.
// A category in use is deactivated, never deleted; an asset's category is corrected through a reclassification — applied directly when it
// touches nothing financial, or held for Finance's review when the asset is capitalized and the change reaches its accounting.
import { has, nextNumber, recordAssetEvent, text, uuid } from "../common.js";
import { createNotification } from "../../../core/platform/notifications/index.js";
import {
  CATEGORY, COLUMN, FINANCE, OPERATIONAL, TEMPLATES, categoryError, categoryRequirements, mayCreate, mayDeactivate, mayEdit, normalizedName,
} from "./category-rules.js";

const keyOf = (input) => text(input?.idempotencyKey, 200) || null;
const ENUMS = {
  assetType: ["TANGIBLE", "INTANGIBLE"], capitalizationGuidance: ["CAPITALIZE", "TRACK_ONLY", "REVIEW"], serialNumberPolicy: ["REQUIRED", "OPTIONAL", "NOT_APPLICABLE"],
  assetTagPolicy: ["REQUIRED", "OPTIONAL"], custodianPolicy: ["ALLOWED", "REQUIRED", "NOT_APPLICABLE"], ownershipApplicability: ["ANY", "OWNED_ONLY", "EXTERNAL_ONLY"],
  suggestedCondition: ["NEW", "GOOD", "FAIR", "DAMAGED", "UNSERVICEABLE"], depreciationMethod: ["straight_line", "declining_balance", "units_of_production", "none"],
  depreciationConvention: ["full_month", "mid_month", "next_month"],
};
const BOOLS = ["locationRequired", "warrantyApplicable", "maintenanceApplicable", "verificationApplicable", "scrapEvidenceRequired"];
const ACCOUNTS = ["assetAccountId", "accumulatedDepreciationAccountId", "depreciationExpenseAccountId", "gainLossAccountId", "disposalLossAccountId", "proceedsAccountId", "cwipAccountId"];

async function loadCategory(client, c, id, { lock = false } = {}) {
  let categoryId;
  try { categoryId = uuid(id, "Category"); } catch { throw categoryError(404, "ASSET_CATEGORY_NOT_FOUND"); }
  const row = (await client.query(`SELECT * FROM tenant.asset_categories WHERE organization_id = $1 AND id = $2${lock ? " FOR UPDATE" : ""}`, [c.organizationId, categoryId])).rows[0];
  if (!row) throw categoryError(404, "ASSET_CATEGORY_NOT_FOUND");
  return row;
}
export { loadCategory };
// Input field → column value, validated; only the given keys.
async function clean(client, c, input, keys) {
  const out = {};
  for (const k of keys) {
    if (input[k] === undefined) continue;
    const v = input[k];
    if (k === "name") { const name = text(v, 120).replace(/\s+/g, " "); if (name.length < 2) throw categoryError(400, "ASSET_CATEGORY_NAME_REQUIRED"); out.name = name; continue; }
    if (k === "description") { out.description = text(v, 1000) || null; continue; }
    if (ENUMS[k]) {
      if ((v === null || v === "") && ["suggestedCondition"].includes(k)) { out[COLUMN[k]] = null; continue; }
      if (!ENUMS[k].includes(String(v))) throw categoryError(400, k === "assetType" ? "ASSET_CATEGORY_INVALID_TYPE" : "ASSET_CATEGORY_POLICY_INVALID", undefined, { field: k });
      out[COLUMN[k]] = String(v); continue;
    }
    if (BOOLS.includes(k)) { out[COLUMN[k]] = Boolean(v); continue; }
    if (k === "defaultDepartmentId") {
      if (!v) { out.default_department_id = null; continue; }
      const dept = (await client.query(`SELECT id FROM public.departments WHERE organization_id = $1 AND id = $2`, [c.organizationId, uuid(v, "Department")])).rows[0];
      if (!dept) throw categoryError(400, "ASSET_CATEGORY_POLICY_INVALID", "Select a valid department.", { field: k });
      out.default_department_id = dept.id; continue;
    }
    if (ACCOUNTS.includes(k)) {
      if (!v) { out[COLUMN[k]] = null; continue; }
      const account = (await client.query(`SELECT id FROM tenant.accounting_accounts WHERE organization_id = $1 AND id = $2 AND status = 'active' AND NOT is_group`, [c.organizationId, uuid(v, "Account")])).rows[0];
      if (!account) throw categoryError(400, "ASSET_CATEGORY_FINANCE_POLICY_INVALID", "Select an active, postable account.", { field: k });
      out[COLUMN[k]] = account.id; continue;
    }
    if (["usefulLifeMonths"].includes(k)) { const n = Number(v); if (!Number.isInteger(n) || n < 1 || n > 1200) throw categoryError(400, "ASSET_CATEGORY_FINANCE_POLICY_INVALID", "Enter the useful life in whole months.", { field: k }); out[COLUMN[k]] = n; continue; }
    if (["residualValuePercent", "decliningRate"].includes(k)) { if (v === null || v === "") { out[COLUMN[k]] = null; continue; } const n = Number(v); if (!(n >= 0 && n <= 100)) throw categoryError(400, "ASSET_CATEGORY_FINANCE_POLICY_INVALID", "Enter a percentage from 0 to 100.", { field: k }); out[COLUMN[k]] = n; continue; }
    if (k === "capitalizationThreshold") { if (v === null || v === "") { out.capitalization_threshold = null; continue; } const n = Number(v); if (!(n >= 0)) throw categoryError(400, "ASSET_CATEGORY_FINANCE_POLICY_INVALID", "Enter the threshold as 0 or more.", { field: k }); out.capitalization_threshold = n.toFixed(2); continue; }
    if (k === "financePolicyEffectiveFrom") { if (!v) { out.finance_policy_effective_from = null; continue; } if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v))) throw categoryError(400, "ASSET_CATEGORY_FINANCE_POLICY_INVALID", "Enter the effective date as YYYY-MM-DD.", { field: k }); out.finance_policy_effective_from = String(v); continue; }
    if (["accountingClass", "taxDepreciationReference"].includes(k)) { out[COLUMN[k]] = text(v, 200) || null; continue; }
  }
  if (out.serial_number_policy) out.serial_required = out.serial_number_policy === "REQUIRED";
  return out;
}
async function assertUniqueName(client, c, name, exceptId = null) {
  const dup = (await client.query(`SELECT code, name FROM tenant.asset_categories WHERE organization_id = $1 AND deleted_at IS NULL AND lower(regexp_replace(btrim(name), '\\s+', ' ', 'g')) = $2 AND id IS DISTINCT FROM $3 LIMIT 1`,
    [c.organizationId, normalizedName(name), exceptId])).rows[0];
  if (dup) throw categoryError(409, "ASSET_CATEGORY_DUPLICATE", `${dup.name} (${dup.code}) already exists.`, { code: dup.code });
}
const snapshot = (row) => ({
  operational: Object.fromEntries(OPERATIONAL.map((k) => [k, row[COLUMN[k]] ?? null])),
  finance: Object.fromEntries(FINANCE.map((k) => [k, row[COLUMN[k]] === undefined || row[COLUMN[k]] === null ? null : String(row[COLUMN[k]])])),
});
async function newVersion(client, c, row, reason) {
  const s = snapshot(row);
  await client.query(`INSERT INTO tenant.asset_category_policy_versions (organization_id, category_id, version, effective_from, operational, finance, reason, created_by)
      VALUES ($1,$2,$3,COALESCE($4::date, current_date),$5,$6,$7,$8)`, [c.organizationId, row.id, row.policy_version, row.finance_policy_effective_from ?? null, JSON.stringify(s.operational), JSON.stringify(s.finance), reason ?? null, c.userId]);
}
async function logEvent(client, c, categoryId, action, changes = {}, extra = {}) {
  await client.query(`INSERT INTO tenant.asset_category_events (organization_id, category_id, action, changes, policy_version, reason, actor_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [c.organizationId, categoryId, action, JSON.stringify(changes), extra.version ?? null, extra.reason ?? null, c.userId]);
}
async function update(client, c, row, cols) {
  const keys = Object.keys(cols);
  const sets = keys.map((k, i) => `${k} = $${i + 3}`);
  return (await client.query(`UPDATE tenant.asset_categories SET ${sets.join(", ")}, row_version = row_version + 1, updated_by = $${keys.length + 3}, updated_at = now()
      WHERE organization_id = $1 AND id = $2 RETURNING *`, [c.organizationId, row.id, ...keys.map((k) => cols[k]), c.userId])).rows[0];
}
const versionCheck = (row, expected) => { if (expected !== undefined && expected !== null && Number(expected) !== Number(row.row_version)) throw categoryError(409, "ASSET_CATEGORY_VERSION_CONFLICT", undefined, { current: row.row_version }); };

// ------------------------------------------------------------------ create
// input: { name, description?, assetType, capitalizationGuidance?, operational rules…, Finance references… (Finance only), idempotencyKey? }
export async function createAssetCategory(client, c, input = {}, options = {}) {
  if (!mayCreate(c)) throw categoryError(403, "ASSET_CATEGORY_PERMISSION_DENIED");
  const key = keyOf(input);
  if (key) {
    const done = (await client.query(`SELECT id, code FROM tenant.asset_categories WHERE organization_id = $1 AND create_key = $2`, [c.organizationId, key])).rows[0];
    if (done) return { categoryId: done.id, code: done.code, replayed: true };
  }
  if (!input.assetType) throw categoryError(400, "ASSET_CATEGORY_INVALID_TYPE");
  const financeGiven = FINANCE.filter((k) => input[k] !== undefined && input[k] !== null && input[k] !== "");
  if (financeGiven.length && !has(c, CATEGORY.manageFinance)) throw categoryError(403, "ASSET_CATEGORY_PERMISSION_DENIED", "Only Finance sets a category's financial references.", { fields: financeGiven });
  const cols = await clean(client, c, input, ["name", "description", ...OPERATIONAL, ...(financeGiven.length ? FINANCE : [])]);
  if (!cols.name) throw categoryError(400, "ASSET_CATEGORY_NAME_REQUIRED");
  await assertUniqueName(client, c, cols.name);
  const code = await nextNumber(client, c, "asset_category", "ACAT");
  const all = { capitalization_guidance: "REVIEW", useful_life_months: 60, depreciation_method: cols.capitalization_guidance === "TRACK_ONLY" ? "none" : "straight_line", ...cols };
  const names = Object.keys(all);
  const row = (await client.query(`INSERT INTO tenant.asset_categories (organization_id, code, created_by, create_key, template_key, active, tag_prefix, ${names.join(", ")})
      VALUES ($1,$2,$3,$4,$5,true,'AST',${names.map((_, i) => `$${i + 6}`).join(",")}) RETURNING *`, [c.organizationId, code, c.userId, key, options.templateKey ?? null, ...names.map((k) => all[k])])).rows[0];
  await newVersion(client, c, row, options.templateKey ? "Starter template" : "Created");
  await logEvent(client, c, row.id, "CREATED", { name: row.name, template: options.templateKey ?? null }, { version: 1 });
  return { categoryId: row.id, code, version: row.row_version };
}
// The starter templates the Company picks; one already added (by name) is not added twice.
export async function addStarterCategories(client, c, input = {}) {
  if (!mayCreate(c)) throw categoryError(403, "ASSET_CATEGORY_PERMISSION_DENIED");
  const keys = Array.isArray(input.templates) ? input.templates.map(String) : [];
  const chosen = TEMPLATES.filter(([k]) => keys.includes(k));
  if (!chosen.length) throw categoryError(400, "ASSET_CATEGORY_POLICY_INVALID", "Choose at least one template.");
  const added = [];
  const skipped = [];
  for (const [templateKey, name, type, guidance, serial, tag, location, custodian, warranty, maintenance, description] of chosen) {
    const exists = (await client.query(`SELECT code FROM tenant.asset_categories WHERE organization_id = $1 AND deleted_at IS NULL AND lower(regexp_replace(btrim(name), '\\s+', ' ', 'g')) = $2`, [c.organizationId, normalizedName(name)])).rows[0];
    if (exists) { skipped.push({ template: templateKey, name, code: exists.code }); continue; }
    const made = await createAssetCategory(client, c, { name, description, assetType: type, capitalizationGuidance: guidance, serialNumberPolicy: serial, assetTagPolicy: tag, locationRequired: location,
      custodianPolicy: custodian, warrantyApplicable: warranty, maintenanceApplicable: maintenance, verificationApplicable: true, suggestedCondition: "NEW" }, { templateKey });
    added.push({ template: templateKey, name, code: made.code, categoryId: made.categoryId });
  }
  return { added, skipped };
}

// ------------------------------------------------------------------ edit
// input: { expectedVersion?, name?, description?, operational rules…, reason? } — a change to the rules makes a new policy version.
export async function updateAssetCategory(client, c, categoryId, input = {}) {
  if (!mayEdit(c)) throw categoryError(403, "ASSET_CATEGORY_PERMISSION_DENIED");
  const row = await loadCategory(client, c, categoryId, { lock: true });
  versionCheck(row, input.expectedVersion);
  const financeGiven = FINANCE.filter((k) => input[k] !== undefined);
  if (financeGiven.length) throw categoryError(403, "ASSET_CATEGORY_PERMISSION_DENIED", "Financial references change through the financial policy.", { fields: financeGiven });
  const cols = await clean(client, c, input, ["name", "description", ...OPERATIONAL]);
  if (cols.name) await assertUniqueName(client, c, cols.name, row.id);
  const changed = Object.keys(cols).filter((k) => String(cols[k] ?? "") !== String(row[k] ?? ""));
  if (!changed.length) return { categoryId: row.id, version: row.row_version, policyVersion: row.policy_version, changed: [] };
  const rulesChanged = changed.some((k) => !["name", "description", "serial_required"].includes(k));
  const pick = Object.fromEntries(changed.map((k) => [k, cols[k]]));
  if (rulesChanged) pick.policy_version = row.policy_version + 1;
  const updated = await update(client, c, row, pick);
  if (rulesChanged) await newVersion(client, c, updated, text(input.reason, 500) || "Operational rules changed");
  await logEvent(client, c, row.id, "UPDATED", Object.fromEntries(changed.filter((k) => k !== "policy_version").map((k) => [k, { from: row[k] ?? null, to: cols[k] ?? null }])),
    { version: updated.policy_version, reason: text(input.reason, 500) || null });
  return { categoryId: row.id, version: updated.row_version, policyVersion: updated.policy_version, changed };
}
// input: { expectedVersion?, Finance references…, reason } — Finance only; a new policy version; existing assets keep theirs.
export async function setCategoryFinancialPolicy(client, c, categoryId, input = {}) {
  if (!has(c, CATEGORY.manageFinance)) throw categoryError(403, "ASSET_CATEGORY_PERMISSION_DENIED");
  const row = await loadCategory(client, c, categoryId, { lock: true });
  versionCheck(row, input.expectedVersion);
  const reason = text(input.reason, 500);
  if (reason.length < 3) throw categoryError(400, "ASSET_CATEGORY_FINANCE_POLICY_INVALID", "Give the reason for the policy change.", { field: "reason" });
  const cols = await clean(client, c, input, FINANCE);
  const changed = Object.keys(cols).filter((k) => String(cols[k] ?? "") !== String(row[k] ?? ""));
  if (!changed.length) return { categoryId: row.id, version: row.row_version, policyVersion: row.policy_version, changed: [] };
  const updated = await update(client, c, row, { ...Object.fromEntries(changed.map((k) => [k, cols[k]])), policy_version: row.policy_version + 1 });
  await newVersion(client, c, updated, reason);
  await logEvent(client, c, row.id, "FINANCE_POLICY_CHANGED", Object.fromEntries(changed.map((k) => [k, { from: row[k] === null || row[k] === undefined ? null : String(row[k]), to: cols[k] }])),
    { version: updated.policy_version, reason });
  // A material policy change is announced to whoever created the category (asset administration), never to every user.
  if (row.created_by && row.created_by !== c.userId) {
    await createNotification(client, { organizationId: c.organizationId, userId: row.created_by, category: "asset_register", title: `${row.name}: financial policy v${updated.policy_version}`,
      message: `${reason}. Assets already registered keep their policy.`, href: `/assets/categories/${row.id}`, entityType: null, entityId: null });
  }
  return { categoryId: row.id, version: updated.row_version, policyVersion: updated.policy_version, changed };
}

// ------------------------------------------------------------------ lifecycle
export async function deactivateAssetCategory(client, c, categoryId, input = {}) {
  if (!mayDeactivate(c)) throw categoryError(403, "ASSET_CATEGORY_PERMISSION_DENIED");
  const row = await loadCategory(client, c, categoryId, { lock: true });
  versionCheck(row, input.expectedVersion);
  if (!row.active) return { categoryId: row.id, active: false, replayed: true };
  const inUse = Number((await client.query(`SELECT count(*)::int AS n FROM tenant.assets WHERE category_id = $1 AND archived_at IS NULL`, [row.id])).rows[0].n);
  const updated = await update(client, c, row, { active: false });
  await logEvent(client, c, row.id, "DEACTIVATED", { assetsInUse: inUse }, { reason: text(input.reason, 500) || null });
  return { categoryId: row.id, active: false, assetsInUse: inUse, version: updated.row_version, warning: inUse ? `${inUse} asset(s) keep this category; new assets cannot use it.` : null };
}
// Reactivation re-checks the Finance references (an account since deactivated makes the policy invalid).
export async function reactivateAssetCategory(client, c, categoryId, input = {}) {
  if (!mayDeactivate(c)) throw categoryError(403, "ASSET_CATEGORY_PERMISSION_DENIED");
  const row = await loadCategory(client, c, categoryId, { lock: true });
  versionCheck(row, input.expectedVersion);
  if (row.active) return { categoryId: row.id, active: true, replayed: true };
  const invalid = [];
  for (const k of ACCOUNTS) {
    const id = row[COLUMN[k]];
    if (!id) continue;
    const ok = (await client.query(`SELECT 1 FROM tenant.accounting_accounts WHERE id = $1 AND status = 'active'`, [id])).rows[0];
    if (!ok) invalid.push(k);
  }
  if (invalid.length) throw categoryError(409, "ASSET_CATEGORY_FINANCE_POLICY_INVALID", "Some of its Finance accounts are no longer active; Finance updates the policy first.", { fields: invalid });
  const updated = await update(client, c, row, { active: true });
  await logEvent(client, c, row.id, "REACTIVATED", {}, { reason: text(input.reason, 500) || null });
  return { categoryId: row.id, active: true, version: updated.row_version };
}
// Only a category no asset has ever used is removed. History is append-only, so it is marked deleted — hidden everywhere, its code never
// reused — rather than physically erased; the database refuses to delete a category any asset uses.
export async function deleteAssetCategory(client, c, categoryId) {
  if (!mayDeactivate(c)) throw categoryError(403, "ASSET_CATEGORY_PERMISSION_DENIED");
  const row = await loadCategory(client, c, categoryId, { lock: true });
  if (row.deleted_at) return { categoryId: row.id, deleted: true, replayed: true };
  const used = (await client.query(`SELECT 1 FROM tenant.assets WHERE category_id = $1 LIMIT 1`, [row.id])).rows[0]
    || (await client.query(`SELECT 1 FROM tenant.asset_reclassifications WHERE from_category_id = $1 OR to_category_id = $1 LIMIT 1`, [row.id])).rows[0];
  if (used) throw categoryError(409, "ASSET_CATEGORY_IN_USE");
  await update(client, c, row, { active: false, deleted_at: new Date().toISOString() });
  await logEvent(client, c, row.id, "DELETED", { code: row.code, name: row.name });
  return { categoryId: row.id, deleted: true };
}

// ------------------------------------------------------------------ reclassification
async function impactOf(client, c, asset, from, to) {
  const capitalized = asset.capitalization_class === "CAPITALIZED";
  const financeDiff = ["accounting_class", "depreciation_method", "useful_life_months", "asset_account_id", "accumulated_depreciation_account_id", "depreciation_expense_account_id", "tax_depreciation_reference"]
    .filter((k) => String(from[k] ?? "") !== String(to[k] ?? ""));
  const operational = [];
  if (from.serial_number_policy !== to.serial_number_policy) operational.push(`Serial number: ${from.serial_number_policy.toLowerCase()} → ${to.serial_number_policy.toLowerCase()}`);
  if (from.asset_tag_policy !== to.asset_tag_policy) operational.push(`Asset tag: ${from.asset_tag_policy.toLowerCase()} → ${to.asset_tag_policy.toLowerCase()}`);
  if (from.custodian_policy !== to.custodian_policy) operational.push(`Custody: ${from.custodian_policy.toLowerCase().replace(/_/g, " ")} → ${to.custodian_policy.toLowerCase().replace(/_/g, " ")}`);
  if (from.maintenance_applicable !== to.maintenance_applicable) operational.push(`Maintenance: ${to.maintenance_applicable ? "now applies" : "no longer applies"}`);
  if (from.warranty_applicable !== to.warranty_applicable) operational.push(`Warranty tracking: ${to.warranty_applicable ? "now applies" : "no longer applies"}`);
  if (from.location_required !== to.location_required) operational.push(`Location: ${to.location_required ? "required" : "optional"}`);
  const missing = categoryRequirements(to, asset, ["ACTIVE", "ON_HOLD"].includes(asset.lifecycle_status) ? "activate" : "register");
  const documents = Number((await client.query(`SELECT count(*)::int AS n FROM public.attachments WHERE organization_id = $1 AND entity_type = 'assets.asset' AND entity_id = $2 AND is_current`, [c.organizationId, String(asset.id)]).catch(() => ({ rows: [{ n: 0 }] }))).rows[0].n);
  return { from: { id: from.id, code: from.code, name: from.name }, to: { id: to.id, code: to.code, name: to.name }, operational, missing,
    finance: { capitalized, differences: financeDiff, reviewRequired: capitalized && financeDiff.length > 0,
      note: capitalized ? "The asset is capitalized: its posted depreciation and acquisition records are not changed; Finance decides any separate adjustment." : "Not capitalized: no accounting effect." },
    documentsToReview: documents };
}
export async function previewAssetReclassification(client, c, assetId, input = {}) {
  if (!has(c, CATEGORY.reclassify)) throw categoryError(403, "ASSET_CATEGORY_PERMISSION_DENIED");
  const { loadAssetRow } = await import("../asset-register/register-commands.js");
  const asset = await loadAssetRow(client, c, assetId);
  const from = await loadCategory(client, c, asset.category_id);
  const to = await loadCategory(client, c, input.toCategoryId);
  if (!to.active) throw categoryError(409, "ASSET_CATEGORY_INACTIVE");
  if (to.id === from.id) throw categoryError(400, "ASSET_CATEGORY_POLICY_INVALID", "Choose a different category.");
  return impactOf(client, c, asset, from, to);
}
// input: { toCategoryId, reason, idempotencyKey? }
export async function reclassifyAsset(client, c, assetId, input = {}) {
  if (!has(c, CATEGORY.reclassify)) throw categoryError(403, "ASSET_CATEGORY_PERMISSION_DENIED");
  const key = keyOf(input);
  if (key) {
    const done = (await client.query(`SELECT id, status FROM tenant.asset_reclassifications WHERE organization_id = $1 AND idempotency_key = $2`, [c.organizationId, key])).rows[0];
    if (done) return { reclassificationId: done.id, status: done.status, replayed: true };
  }
  const { loadAssetRow } = await import("../asset-register/register-commands.js");
  const asset = await loadAssetRow(client, c, assetId, { lock: true });
  if (asset.lifecycle_status === "DISPOSED") throw categoryError(409, "ASSET_ALREADY_DISPOSED", "This asset has already been disposed of.");
  const reason = text(input.reason, 1000);
  if (reason.length < 3) throw categoryError(400, "ASSET_CATEGORY_POLICY_INVALID", "Give the reason for the correction.", { field: "reason" });
  const from = await loadCategory(client, c, asset.category_id);
  const to = await loadCategory(client, c, input.toCategoryId);
  if (!to.active) throw categoryError(409, "ASSET_CATEGORY_INACTIVE");
  if (to.id === from.id) throw categoryError(400, "ASSET_CATEGORY_POLICY_INVALID", "Choose a different category.");
  const pending = (await client.query(`SELECT 1 FROM tenant.asset_reclassifications WHERE asset_id = $1 AND status = 'PENDING_FINANCE'`, [asset.id])).rows[0];
  if (pending) throw categoryError(409, "ASSET_CATEGORY_RECLASSIFICATION_REVIEW", "A reclassification of this asset is already waiting for Finance.");
  const impact = await impactOf(client, c, asset, from, to);
  if (impact.missing.length && asset.lifecycle_status !== "DRAFT") throw categoryError(409, "ASSET_CATEGORY_REQUIRED_FIELD_MISSING", `The new category needs ${impact.missing.join("; ")}.`, { missing: impact.missing });
  const status = impact.finance.reviewRequired ? "PENDING_FINANCE" : "APPLIED";
  const row = (await client.query(`INSERT INTO tenant.asset_reclassifications (organization_id, asset_id, from_category_id, to_category_id, reason, impact, status, requested_by, idempotency_key)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, reclassification_number`, [c.organizationId, asset.id, from.id, to.id, reason, JSON.stringify(impact), status, c.userId, key])).rows[0];
  if (status === "APPLIED") await applyReclassification(client, c, asset, from, to, row.id, reason);
  else {
    await recordAssetEvent(client, c, asset.id, "asset.reclassification_requested", { reclassificationId: row.id, from: from.name, to: to.name, reason });
    const finance = (await client.query(`SELECT DISTINCT assignment.user_id FROM user_role_assignments assignment JOIN role_permissions grant_row ON grant_row.role_id = assignment.role_id
        WHERE assignment.organization_id = $1 AND assignment.status = 'active' AND grant_row.permission_key = $2`, [c.organizationId, CATEGORY.manageFinance]).catch(() => ({ rows: [] }))).rows;
    for (const { user_id: userId } of finance) {
      if (userId === c.userId) continue;
      await createNotification(client, { organizationId: c.organizationId, userId, category: "asset_register", title: `${asset.asset_number}: category change needs Finance`,
        message: `${from.name} → ${to.name}: ${reason}`, href: `/assets/register/${asset.id}?tab=overview`, entityType: "assets.asset", entityId: asset.id });
    }
  }
  return { reclassificationId: row.id, number: `RCL-${row.reclassification_number}`, status, impact };
}
async function applyReclassification(client, c, asset, from, to, reclassificationId, reason) {
  await client.query(`UPDATE tenant.assets SET category_id = $3, category_policy_version = $4 WHERE organization_id = $1 AND id = $2`, [c.organizationId, asset.id, to.id, to.policy_version]);
  await recordAssetEvent(client, c, asset.id, "asset.reclassified", { reclassificationId, from: { id: from.id, name: from.name, version: asset.category_policy_version }, to: { id: to.id, name: to.name, version: to.policy_version }, reason,
    note: "Posted depreciation and acquisition records are unchanged." });
}
// input: { decision: APPROVE | REJECT, note?, financeAdjustmentReference? } — Finance's decision on a reclassification that reaches accounting.
export async function decideAssetReclassification(client, c, reclassificationId, input = {}) {
  if (!has(c, CATEGORY.manageFinance)) throw categoryError(403, "ASSET_CATEGORY_PERMISSION_DENIED");
  const row = (await client.query(`SELECT * FROM tenant.asset_reclassifications WHERE organization_id = $1 AND id = $2 FOR UPDATE`, [c.organizationId, uuid(reclassificationId, "Reclassification")])).rows[0];
  if (!row) throw categoryError(404, "ASSET_CATEGORY_NOT_FOUND", "That reclassification was not found.");
  if (row.status !== "PENDING_FINANCE") return { reclassificationId: row.id, status: row.status, replayed: true };
  const decision = String(input.decision ?? "").toUpperCase();
  if (!["APPROVE", "REJECT"].includes(decision)) throw categoryError(400, "ASSET_CATEGORY_POLICY_INVALID", "Approve or reject.");
  const note = text(input.note, 1000) || null;
  if (decision === "REJECT" && !note) throw categoryError(400, "ASSET_CATEGORY_POLICY_INVALID", "Say why it is rejected.", { field: "note" });
  const { loadAssetRow } = await import("../asset-register/register-commands.js");
  const asset = await loadAssetRow(client, c, row.asset_id, { lock: true });
  const status = decision === "APPROVE" ? "APPLIED" : "REJECTED";
  await client.query(`UPDATE tenant.asset_reclassifications SET status = $2, decided_by = $3, decided_at = clock_timestamp(), decision_note = $4, finance_adjustment_reference = $5 WHERE id = $1`,
    [row.id, status, c.userId, note, text(input.financeAdjustmentReference, 200) || null]);
  if (status === "APPLIED") {
    if (asset.category_id !== row.from_category_id) throw categoryError(409, "ASSET_CATEGORY_VERSION_CONFLICT", "The asset's category changed since the request.");
    await applyReclassification(client, c, asset, await loadCategory(client, c, row.from_category_id), await loadCategory(client, c, row.to_category_id), row.id, row.reason);
  } else await recordAssetEvent(client, c, asset.id, "asset.reclassification_rejected", { reclassificationId: row.id, note });
  if (row.requested_by !== c.userId) {
    await createNotification(client, { organizationId: c.organizationId, userId: row.requested_by, category: "asset_register", title: `${asset.asset_number}: category change ${status === "APPLIED" ? "approved" : "rejected"}`,
      message: note ?? "Finance approved the change.", href: `/assets/register/${asset.id}`, entityType: "assets.asset", entityId: asset.id });
  }
  return { reclassificationId: row.id, status };
}
