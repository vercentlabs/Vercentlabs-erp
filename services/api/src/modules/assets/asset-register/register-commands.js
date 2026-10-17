// Assets — Asset Register, the commands. One physical unit is one asset with a backend-generated code; its acquisition is an allocation
// against the exact purchase line it came from, never beyond that line (or its purchase order line) across every asset; its lifecycle moves
// only through the permitted actions; custody is set at registration and, once the asset is commissioned, changes only through the custody
// and transfer workflows. Nothing here posts an accounting entry, capitalizes an asset or computes depreciation — Finance does that.
import { has, loadSettings, nextNumber, qx, recordAssetEvent, text, uuid } from "../common.js";
import { createNotification } from "../../../core/platform/notifications/index.js";
import { categoryRequirements } from "../asset-categories/category-rules.js";
import { archiveFile, listFiles, readFileContent, storeFile } from "../../../core/platform/files/index.js";
import {
  ASSET, EDITABLE_DETAILS, EDITABLE_DRAFT, PRE_ACTIVE_CUSTODY, TRANSITIONS, assetError, requirePermission, seesRegister,
} from "./register-rules.js";
import { checkIdentifiers, cleanIdentifier, recordDuplicateException } from "../asset-identification/ident-checks.js";
import { normalizeIdentifier } from "../asset-identification/ident-rules.js";

export const ASSET_FILE_ENTITY = "assets.asset";
const DONE = { register: "registered", activate: "commissioned" };
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const keyOf = (input, field = "idempotencyKey") => text(input?.[field], 200) || null;
const dayOrNull = (value, field) => {
  if (value === undefined || value === null || value === "") return null;
  const d = String(value).slice(0, 10);
  if (!DAY.test(d) || Number.isNaN(Date.parse(`${d}T00:00:00Z`))) throw assetError(400, "ASSET_INPUT_INVALID", `Enter ${field} as a date (YYYY-MM-DD).`, { field });
  return d;
};
const oneOf = (value, allowed, field) => {
  if (value === undefined || value === null || value === "") return null;
  const v = String(value);
  if (!allowed.includes(v)) throw assetError(400, "ASSET_INPUT_INVALID", `Choose a valid ${field}.`, { field });
  return v;
};
const baseCurrency = async (client, c) => (await client.query(`SELECT upper(base_currency) AS c FROM public.organizations WHERE id = $1`, [c.organizationId])).rows[0]?.c ?? "INR";
const lock = (client, key) => client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`asset-register:${key}`]);

// ------------------------------------------------------------------ masters
async function categoryOf(client, c, id) {
  if (!id) throw assetError(400, "ASSET_CATEGORY_INVALID");
  let categoryId;
  try { categoryId = uuid(id, "Category"); } catch { throw assetError(400, "ASSET_CATEGORY_INVALID"); }
  const row = (await client.query(`SELECT * FROM tenant.asset_categories WHERE organization_id = $1 AND id = $2 AND deleted_at IS NULL`, [c.organizationId, categoryId])).rows[0];
  if (!row) throw assetError(400, "ASSET_CATEGORY_INVALID");
  if (!row.active) throw assetError(409, "ASSET_CATEGORY_INACTIVE", "This category cannot be used for new Assets.");
  return row;
}
async function locationOf(client, c, id) {
  if (!id) return null;
  let locationId;
  try { locationId = uuid(id, "Location"); } catch { throw assetError(400, "ASSET_LOCATION_INVALID"); }
  const row = (await client.query(`SELECT id, name FROM tenant.asset_locations WHERE organization_id = $1 AND id = $2 AND active`, [c.organizationId, locationId])).rows[0];
  if (!row) throw assetError(400, "ASSET_LOCATION_INVALID");
  return row;
}
async function departmentOf(client, c, id) {
  if (!id) return null;
  let departmentId;
  try { departmentId = uuid(id, "Department"); } catch { throw assetError(400, "ASSET_INPUT_INVALID", "Select a valid department."); }
  const row = (await client.query(`SELECT id, name FROM public.departments WHERE organization_id = $1 AND id = $2`, [c.organizationId, departmentId])).rows[0];
  if (!row) throw assetError(400, "ASSET_INPUT_INVALID", "Select a valid department.");
  return row;
}
// A custodian is an active member of the Company: an inactive or departed user cannot receive a new assignment.
async function custodianOf(client, c, id) {
  if (!id) return null;
  let userId;
  try { userId = uuid(id, "Custodian"); } catch { throw assetError(400, "ASSET_CUSTODIAN_INVALID"); }
  const row = (await client.query(`SELECT u.id, COALESCE(NULLIF(u.full_name, ''), u.email) AS name FROM public.users u JOIN public.organization_memberships m ON m.user_id = u.id
      WHERE m.organization_id = $1 AND u.id = $2 AND m.status = 'active' AND u.status = 'active'`, [c.organizationId, userId])).rows[0];
  if (!row) throw assetError(400, "ASSET_CUSTODIAN_INVALID");
  return row;
}
async function supplierOf(client, c, id) {
  if (!id) return null;
  const row = (await client.query(`SELECT id FROM tenant.business_parties WHERE organization_id = $1 AND id = $2 AND party_type IN ('supplier', 'both')`, [c.organizationId, uuid(id, "Supplier")])).rows[0];
  if (!row) throw assetError(400, "ASSET_INPUT_INVALID", "Select a valid supplier.");
  return row;
}
// Serial numbers and asset tags identify one physical unit each; two identical models with different serials are two assets. The checks
// (normalized matching, placeholders refused, a clear duplicate serial refused unless accepted with a reason) are Asset Identification's.
const assertIdentity = (client, c, input, exceptId = null) => checkIdentifiers(client, c, input, exceptId);
async function loadAssetRow(client, c, assetId, { lock: forUpdate = false } = {}) {
  let id;
  try { id = uuid(assetId, "Asset"); } catch { throw assetError(404, "ASSET_NOT_FOUND"); }
  const row = (await qx(client, `SELECT * FROM tenant.assets WHERE organization_id = $1 AND id = $2${forUpdate ? " FOR UPDATE" : ""}`, [c.organizationId, id])).rows[0];
  if (!row) throw assetError(404, "ASSET_NOT_FOUND");
  if (!seesRegister(c) && row.current_user_id !== c.userId) throw assetError(404, "ASSET_NOT_FOUND");
  return row;
}
export { loadAssetRow };
const versionCheck = (row, expected) => {
  if (expected !== undefined && expected !== null && Number(expected) !== Number(row.row_version)) throw assetError(409, "ASSET_VERSION_CONFLICT", undefined, { current: row.row_version });
};
async function notifyCustodian(client, c, asset, userId) {
  if (!userId || userId === c.userId) return;
  await createNotification(client, { organizationId: c.organizationId, userId, category: "asset_register", title: `${asset.asset_number} is in your care`,
    message: `${asset.name} has been assigned to you.`, href: `/assets/register/${asset.id}`, entityType: ASSET_FILE_ENTITY, entityId: asset.id });
}
async function movement(client, c, asset, { type, toUser, toDepartment, toLocation, reason }) {
  await client.query(`INSERT INTO tenant.asset_movements (organization_id, asset_id, movement_type, effective_date, from_user_id, to_user_id, from_department_id, to_department_id, from_location_id, to_location_id,
      reference_type, reason, actor_user_id, created_at) VALUES ($1,$2,$3,current_date,$4,$5,$6,$7,$8,$9,'asset_register',$10,$11,clock_timestamp())`,
  [c.organizationId, asset.id, type, asset.current_user_id ?? null, toUser ?? null, asset.current_department_id ?? null, toDepartment ?? null, asset.location_id ?? null, toLocation ?? null, reason ?? null, c.userId]);
}

// ------------------------------------------------------------------ create and edit
// input: { name, categoryId, description?, assetType?, ownership?, capitalizationClass?, acquisitionMethod?, manufacturer?, model?, serialNumber?, tagCode?,
//   purchaseDate?, receivedDate?, supplierId?, locationId?, departmentId?, custodianUserId?, condition?, warranty…?, notes?, acquisition?: { sourceType, sourceLineId?, reason?, openingCost? },
//   idempotencyKey? } — a draft; registration validates it.
export async function createAssetDraft(client, c, input = {}, options = {}) {
  requirePermission(c, ASSET.create);
  const key = keyOf(input);
  if (key) {
    const done = (await client.query(`SELECT id, asset_number FROM tenant.assets WHERE organization_id = $1 AND create_key = $2`, [c.organizationId, key])).rows[0];
    if (done) return { assetId: done.id, assetNumber: done.asset_number, replayed: true };
  }
  const name = text(input.name, 200);
  if (name.length < 2) throw assetError(400, "ASSET_NAME_REQUIRED", undefined, { field: "name" });
  const category = await categoryOf(client, c, input.categoryId);
  const fields = await cleanFields(client, c, input, EDITABLE_DRAFT, { category });
  if (input.departmentId === undefined && category.default_department_id) fields.current_department_id = category.default_department_id;
  // Equipment received into an asset store starts in the store's custody — never with whoever registered or bought it.
  if (!fields.current_user_id && fields.location_id) {
    const store = (await client.query(`SELECT id FROM tenant.asset_locations WHERE id = $1 AND is_asset_store AND active AND manager_user_id IS NOT NULL`, [fields.location_id])).rows[0];
    if (store) { fields.current_store_location_id = store.id; delete fields.current_department_id; }
  }
  const ident = await assertIdentity(client, c, { serialNumber: fields.serial_number, tagCode: fields.tag_code, manufacturer: fields.manufacturer, duplicateException: input.duplicateException });
  const number = await nextNumber(client, c, "asset", "AST");
  const currency = await baseCurrency(client, c);
  const tracked = (fields.capitalization_class ?? defaultClass(category)) === "TRACKED_ONLY";
  const row = (await qx(client, `INSERT INTO tenant.assets (organization_id, asset_number, name, category_id, currency_code, useful_life_months, depreciation_method, created_by, create_key, registration_batch_id,
        asset_type, capitalization_class, availability_status, condition, category_policy_version)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
  [c.organizationId, number, name, category.id, currency, category.useful_life_months ?? 60, tracked ? "none" : category.depreciation_method ?? "straight_line", c.userId, key, options.batchId ?? null,
    fields.asset_type ?? category.asset_type ?? "TANGIBLE", fields.capitalization_class ?? defaultClass(category), fields.current_user_id ? "ASSIGNED" : "AVAILABLE", fields.condition ?? category.suggested_condition ?? "NEW", category.policy_version ?? 1])).rows[0];
  delete fields.asset_type; delete fields.capitalization_class; delete fields.condition;
  const asset = await applyFields(client, c, row, fields);
  await recordAssetEvent(client, c, asset.id, "asset.created", { assetNumber: number, lifecycle: "DRAFT", batchId: options.batchId ?? null });
  await recordDuplicateException(client, c, asset, ident.exception, asset.serial_number);
  if (asset.current_user_id || asset.location_id) {
    await movement(client, c, { ...asset, current_user_id: null, current_department_id: null, location_id: null }, { type: "assignment", toUser: asset.current_user_id, toDepartment: asset.current_department_id, toLocation: asset.location_id, reason: "Initial assignment" });
    await notifyCustodian(client, c, asset, asset.current_user_id);
  }
  if (input.acquisition) await allocateAcquisition(client, c, asset.id, { ...input.acquisition, commandId: key ? `${key}:acq` : undefined }, { batchId: options.batchId, skipScope: true });
  return { assetId: asset.id, assetNumber: number, version: asset.row_version, warnings: ident.warnings };
}
// The category suggests the tracking; the person may override it (never to "capitalized" — Finance decides that).
const defaultClass = (category) => (category.capitalization_guidance === "TRACK_ONLY" || category.asset_type === "LOW_VALUE" ? "TRACKED_ONLY" : "PENDING");
// Input fields → columns, validated. Only the listed fields are accepted.
async function cleanFields(client, c, input, allowed, { category } = {}) {
  const out = {};
  const given = (k) => allowed.includes(k) && input[k] !== undefined;
  if (given("name")) { const v = text(input.name, 200); if (v.length < 2) throw assetError(400, "ASSET_NAME_REQUIRED"); out.name = v; }
  if (given("description")) out.description = text(input.description, 4000) || null;
  if (given("categoryId") && !category) out.category_id = (await categoryOf(client, c, input.categoryId)).id;
  if (given("assetType")) out.asset_type = oneOf(input.assetType, ["TANGIBLE", "INTANGIBLE", "UNDER_CONSTRUCTION", "LOW_VALUE", "EXTERNAL"], "asset type");
  if (given("ownership")) out.ownership = oneOf(input.ownership, ["owned", "leased", "loaned"], "ownership") ?? "owned";
  if (given("capitalizationClass")) {
    const v = oneOf(input.capitalizationClass, ["PENDING", "TRACKED_ONLY", "CAPITALIZED"], "tracking choice");
    // Only Finance confirms capitalization; the person registering chooses "fixed asset — Finance to confirm" or "tracked equipment".
    if (v === "CAPITALIZED") throw assetError(403, "ASSET_COST_REVIEW_REQUIRED", "Finance confirms capitalization; choose fixed asset (Finance to confirm) instead.");
    out.capitalization_class = v;
  }
  if (given("acquisitionMethod")) out.acquisition_method = oneOf(input.acquisitionMethod, ["PURCHASE", "OPENING_BALANCE", "CONTRIBUTION", "TRANSFER_IN", "OTHER"], "acquisition method");
  for (const [k, col, max] of [["manufacturer", "manufacturer", 120], ["model", "model", 120], ["warrantyProvider", "warranty_provider", 160], ["warrantyReference", "warranty_reference", 120],
    ["supportContact", "support_contact", 300], ["notes", "notes", 4000]]) if (given(k)) out[col] = text(input[k], max) || null;
  if (given("serialNumber")) out.serial_number = cleanIdentifier(input.serialNumber, "serial number", 120);
  if (given("tagCode")) out.tag_code = cleanIdentifier(input.tagCode, "asset tag", 60);
  if (given("purchaseDate")) out.acquisition_date = dayOrNull(input.purchaseDate, "the purchase date");
  if (given("receivedDate")) out.received_date = dayOrNull(input.receivedDate, "the receipt date");
  if (given("warrantyStartDate")) out.warranty_start_date = dayOrNull(input.warrantyStartDate, "the warranty start");
  if (given("warrantyEndDate")) out.warranty_end_date = dayOrNull(input.warrantyEndDate, "the warranty end");
  if (given("condition")) out.condition = oneOf(input.condition, ["NEW", "GOOD", "FAIR", "DAMAGED", "UNSERVICEABLE"], "condition");
  if (given("criticality")) out.criticality = oneOf(input.criticality, ["low", "medium", "high", "critical"], "criticality") ?? "medium";
  if (given("supplierId")) out.supplier_id = input.supplierId ? (await supplierOf(client, c, input.supplierId)).id : null;
  if (given("locationId")) out.location_id = input.locationId ? (await locationOf(client, c, input.locationId)).id : null;
  if (given("departmentId")) out.current_department_id = input.departmentId ? (await departmentOf(client, c, input.departmentId)).id : null;
  if (given("custodianUserId")) out.current_user_id = input.custodianUserId ? (await custodianOf(client, c, input.custodianUserId)).id : null;
  if (given("parentAssetId")) out.parent_asset_id = input.parentAssetId ? uuid(input.parentAssetId, "Parent asset") : null;
  if (out.warranty_start_date && out.warranty_end_date && out.warranty_end_date < out.warranty_start_date) throw assetError(400, "ASSET_INPUT_INVALID", "The warranty cannot end before it starts.");
  if (out.ownership === "loaned" && out.capitalization_class === "PENDING") out.capitalization_class = "TRACKED_ONLY";
  return out;
}
async function applyFields(client, c, row, fields) {
  const cols = Object.keys(fields);
  if (!cols.length) return row;
  const sets = cols.map((col, i) => `${col} = $${i + 3}`);
  return (await qx(client, `UPDATE tenant.assets SET ${sets.join(", ")} WHERE organization_id = $1 AND id = $2 RETURNING *`, [c.organizationId, row.id, ...cols.map((col) => fields[col])])).rows[0];
}
// input: { expectedVersion?, …fields } — a draft takes every registration field; a registered asset its non-financial details; location and
// custodian only until it is commissioned (afterwards the custody and transfer workflows change them, so history is never overwritten).
export async function updateAsset(client, c, assetId, input = {}) {
  const row = await loadAssetRow(client, c, assetId, { lock: true });
  versionCheck(row, input.expectedVersion);
  if (["DISPOSED"].includes(row.lifecycle_status)) throw assetError(409, "ASSET_ALREADY_DISPOSED");
  if (row.archived_at) throw assetError(409, "ASSET_STATE_INVALID", "An archived asset is read-only.");
  const draft = row.lifecycle_status === "DRAFT";
  requirePermission(c, draft ? ASSET.editDraft : ASSET.editDetails);
  if (!draft && [["serialNumber", "serial_number"], ["tagCode", "tag_code"]].some(([k, col]) => input[k] !== undefined && (text(input[k], 120) || null) !== (row[col] ?? null))) {
    throw assetError(409, "ASSET_IDENTIFIER_EDIT_DENIED", "Correct the serial number or replace the tag from the asset's Identification section, with a reason.");
  }
  const custodyGiven = PRE_ACTIVE_CUSTODY.some((k) => input[k] !== undefined);
  if (custodyGiven && !["DRAFT", "REGISTERED"].includes(row.lifecycle_status)) {
    if (input.locationId !== undefined && String(input.locationId ?? "") !== String(row.location_id ?? "")) throw assetError(409, "ASSET_LOCATION_TRANSFER_REQUIRED", "Use the Asset Transfer workflow to change the registered location.");
    throw assetError(409, "ASSET_CUSTODY_BY_TRANSFER");
  }
  const allowed = draft ? EDITABLE_DRAFT : [...EDITABLE_DETAILS, ...(row.lifecycle_status === "REGISTERED" ? PRE_ACTIVE_CUSTODY : [])];
  const refused = Object.keys(input).filter((k) => !["expectedVersion"].includes(k) && !allowed.includes(k) && input[k] !== undefined);
  if (refused.length) throw assetError(403, "ASSET_PERMISSION_DENIED", `These cannot be changed now: ${refused.join(", ")}.`, { fields: refused });
  const fields = await cleanFields(client, c, input, allowed);
  if (fields.category_id && fields.category_id !== row.category_id && row.capitalization_class === "CAPITALIZED") throw assetError(409, "ASSET_STATE_INVALID", "A capitalized asset keeps its category; Finance changes its accounting treatment.");
  const ident = await assertIdentity(client, c, { serialNumber: fields.serial_number, tagCode: fields.tag_code, manufacturer: fields.manufacturer ?? row.manufacturer, duplicateException: input.duplicateException }, row.id);
  const changed = Object.keys(fields).filter((col) => String(fields[col] ?? "") !== String(row[col] ?? ""));
  if (!changed.length) return { assetId: row.id, version: row.row_version, changed: [] };
  const pick = Object.fromEntries(changed.map((col) => [col, fields[col]]));
  if ("category_id" in pick) pick.category_policy_version = (await client.query(`SELECT policy_version FROM tenant.asset_categories WHERE id = $1`, [pick.category_id])).rows[0]?.policy_version ?? 1;
  if ("current_user_id" in pick) pick.availability_status = pick.current_user_id ? "ASSIGNED" : "AVAILABLE";
  const updated = await applyFields(client, c, row, pick);
  await recordAssetEvent(client, c, row.id, "asset.updated", { changed, before: Object.fromEntries(changed.map((col) => [col, row[col] ?? null])) });
  if (changed.includes("serial_number")) await recordDuplicateException(client, c, updated, ident.exception, updated.serial_number);
  if (changed.some((col) => ["current_user_id", "location_id", "current_department_id"].includes(col))) {
    await movement(client, c, row, { type: "assignment", toUser: updated.current_user_id, toDepartment: updated.current_department_id, toLocation: updated.location_id, reason: "Initial assignment changed before commissioning" });
    if (changed.includes("current_user_id")) await notifyCustodian(client, c, updated, updated.current_user_id);
  }
  if (changed.some((col) => ["warranty_provider", "warranty_start_date", "warranty_end_date", "warranty_reference"].includes(col))) {
    await client.query(`INSERT INTO tenant.asset_warranties (organization_id, asset_id, supplier_id, provider_name, warranty_type, start_date, end_date, terms, created_by) VALUES ($1,$2,$3,$4,'manufacturer',$5,$6,$7,$8)`,
      [c.organizationId, row.id, updated.supplier_id ?? null, updated.warranty_provider ?? null, updated.warranty_start_date ?? null, updated.warranty_end_date ?? null, updated.warranty_reference ?? null, c.userId]).catch(() => null);
  }
  return { assetId: row.id, version: updated.row_version, changed };
}

// ------------------------------------------------------------------ lifecycle
// action: register | activate | hold | release | retire | mark-lost | mark-found; input: { reason?, availableForUseDate?, expectedVersion?, idempotencyKey? }
export async function transitionAsset(client, c, assetId, action, input = {}) {
  const rule = TRANSITIONS[action];
  if (!rule) throw assetError(400, "ASSET_STATUS_INVALID_TRANSITION", "Unknown asset action.");
  if (!["register", "activate"].includes(action)) {
    const status = await import("../asset-status/status-commands.js");
    const run = { hold: status.placeAssetOnHold, release: status.releaseAssetHold, retire: status.retireAsset, "confirm-lost": status.confirmAssetLost, recover: status.recoverAsset, reinstate: status.reinstateAsset }[action];
    return run(client, c, assetId, input);
  }
  requirePermission(c, rule.permission);
  const { replayOf, withStatusContext } = await import("../asset-status/status-commands.js");
  const key = keyOf(input);
  const replay = await replayOf(client, c, key);
  if (replay) return replay;
  const row = await loadAssetRow(client, c, assetId, { lock: true });
  if (action === "register" && row.lifecycle_status === "REGISTERED") return { assetId: row.id, lifecycle: row.lifecycle_status, replayed: true };
  if (action === "activate" && row.lifecycle_status === "ACTIVE") throw assetError(409, "ASSET_STATUS_ALREADY_ACTIVE", "This asset is already active.");
  versionCheck(row, input.expectedVersion);
  if (row.lifecycle_status === "DISPOSED") throw assetError(409, "ASSET_ALREADY_DISPOSED");
  if (row.archived_at) throw assetError(409, "ASSET_STATUS_INVALID_TRANSITION", "An archived asset's status does not change.");
  if (!rule.from.includes(row.lifecycle_status)) throw assetError(409, "ASSET_STATUS_INVALID_TRANSITION", `A ${row.lifecycle_status.toLowerCase().replace(/_/g, " ")} asset cannot be ${DONE[action]}.`);
  const sets = { lifecycle_status: rule.to };
  const missing = [];
  const category = (await client.query(`SELECT * FROM tenant.asset_categories WHERE id = $1`, [row.category_id])).rows[0];
  if (!category?.active) missing.push("an active category");
  if (!row.ownership) missing.push("ownership");
  if (category) missing.push(...categoryRequirements(category, row, action).map((m) => `${m} (${category.name})`));
  if (action === "activate") {
    if (!row.location_id && !missing.some((m) => m.startsWith("a location"))) missing.push("a location");
    if (row.condition === "UNSERVICEABLE") missing.push("a usable condition (it is recorded as unserviceable)");
    if (row.asset_type === "UNDER_CONSTRUCTION") missing.push("completion: change the asset type once construction or installation is finished");
    const allocation = (await client.query(`SELECT 1 FROM tenant.asset_acquisition_allocations WHERE asset_id = $1 AND status = 'ACTIVE'`, [row.id])).rows[0];
    if (row.capitalization_class !== "TRACKED_ONLY" && row.ownership === "owned" && !allocation) missing.push("its acquisition source (a purchase line, the opening register or an approved exception)");
    const day = dayOrNull(input.availableForUseDate, "the available-for-use date") ?? (await client.query(`SELECT to_char(current_date, 'YYYY-MM-DD') AS d`)).rows[0].d;
    if (row.acquisition_date && day < String(row.acquisition_date).slice(0, 10)) missing.push("an available-for-use date on or after the purchase date");
    sets.placed_in_service_date = day;
    sets.commissioned_at = new Date().toISOString();
    sets.availability_status = row.current_user_id || row.current_department_id ? "ASSIGNED" : "AVAILABLE";
  }
  if (missing.length) throw assetError(409, "ASSET_ACTIVATION_INCOMPLETE", `Before ${action === "register" ? "registering" : "commissioning"}: ${missing.join("; ")}.`, { missing });
  const reason = text(input.reason, 1000) || null;
  const updated = await withStatusContext(client, c, { action, reason, key, effective: sets.placed_in_service_date }, () => applyFields(client, c, row, sets));
  await recordAssetEvent(client, c, row.id, `asset.${action}`, { from: row.lifecycle_status, to: rule.to, reason, availableForUseDate: sets.placed_in_service_date ?? null,
    note: action === "activate" && row.capitalization_class === "PENDING" ? "Commissioned before Finance confirmed capitalization; Finance reviews it separately." : null });
  return { assetId: row.id, lifecycle: updated.lifecycle_status, availability: updated.availability_status, version: updated.row_version };
}
// A draft never registered, or an asset at the end of its life, leaves the everyday register; everything about it is kept.
export async function archiveAsset(client, c, assetId, input = {}) {
  requirePermission(c, ASSET.retire);
  const row = await loadAssetRow(client, c, assetId, { lock: true });
  if (row.archived_at) return { assetId: row.id, archived: true, replayed: true };
  if (!["DRAFT", "RETIRED", "DISPOSED", "LOST"].includes(row.lifecycle_status)) throw assetError(409, "ASSET_STATE_INVALID", "Only a draft, or a retired, disposed or lost asset, can be archived.");
  const reason = text(input.reason, 500);
  if (reason.length < 3) throw assetError(400, "ASSET_INPUT_INVALID", "Give a reason.", { field: "reason" });
  await client.query(`UPDATE tenant.assets SET archived_at = clock_timestamp(), archived_by = $3 WHERE organization_id = $1 AND id = $2`, [c.organizationId, row.id, c.userId]);
  await recordAssetEvent(client, c, row.id, "asset.archived", { reason });
  return { assetId: row.id, archived: true };
}

// ------------------------------------------------------------------ acquisition
// The source line behind an allocation, with its quantity, the purchase order line it belongs to and a proposed per-unit cost (tax-exclusive).
export async function acquisitionSource(client, c, sourceType, sourceLineId) {
  let lineId;
  try { lineId = uuid(sourceLineId, "Source line"); } catch { throw assetError(400, "ASSET_SOURCE_INVALID"); }
  const q = async (sql) => (await client.query(sql, [c.organizationId, lineId])).rows[0];
  let row = null;
  if (sourceType === "SUPPLIER_INVOICE_LINE") {
    row = await q(`SELECT line.id, line.vendor_bill_id AS document_id, bill.bill_number AS document_number, bill.status, bill.bill_type, line.description, COALESCE(line.invoiced_quantity, line.quantity) AS quantity,
        line.net_amount, btrim(bill.currency_code) AS currency, line.purchase_order_line_id AS root, bill.party_id AS supplier_id, to_char(bill.bill_date, 'YYYY-MM-DD') AS document_date, bill.content_hash AS version
      FROM tenant.accounting_vendor_bill_lines line JOIN tenant.accounting_vendor_bills bill ON bill.id = line.vendor_bill_id WHERE line.organization_id = $1 AND line.id = $2`);
    if (row && (row.bill_type !== "bill" || !["approved", "posted", "partially_paid", "paid", "overdue", "disputed"].includes(row.status))) throw assetError(409, "ASSET_SOURCE_INVALID", `${row.document_number} is not an approved supplier bill.`);
  } else if (sourceType === "GOODS_RECEIPT_LINE") {
    row = await q(`SELECT line.id, line.goods_receipt_id AS document_id, receipt.receipt_number AS document_number, receipt.status, line.description, COALESCE(line.base_quantity, line.accepted_quantity) AS quantity,
        CASE WHEN pol.ordered_quantity > 0 THEN pol.taxable_amount / pol.ordered_quantity * COALESCE(line.accepted_quantity, 0) END AS net_amount, NULL::text AS currency, line.purchase_order_line_id AS root,
        po.party_id AS supplier_id, to_char(receipt.receipt_date, 'YYYY-MM-DD') AS document_date, NULL::text AS version
      FROM tenant.goods_receipt_lines line JOIN tenant.goods_receipts receipt ON receipt.id = line.goods_receipt_id LEFT JOIN tenant.purchase_order_lines pol ON pol.id = line.purchase_order_line_id
      LEFT JOIN tenant.purchase_orders po ON po.id = receipt.purchase_order_id
     WHERE line.organization_id = $1 AND line.id = $2`);
    if (row && row.status !== "posted") throw assetError(409, "ASSET_SOURCE_INVALID", `${row.document_number} is not a posted goods receipt.`);
    if (row) row.quantity = Number(row.quantity ?? 0);
  } else if (sourceType === "PURCHASE_ORDER_LINE") {
    row = await q(`SELECT line.id, line.purchase_order_id AS document_id, po.purchase_order_number AS document_number, po.status, line.description, COALESCE(line.base_quantity, line.ordered_quantity) AS quantity,
        line.taxable_amount AS net_amount, btrim(po.currency_code) AS currency, line.id AS root, po.party_id AS supplier_id, NULL::text AS document_date, NULL::text AS version
      FROM tenant.purchase_order_lines line JOIN tenant.purchase_orders po ON po.id = line.purchase_order_id WHERE line.organization_id = $1 AND line.id = $2`);
    if (row && !["confirmed", "closed"].includes(row.status)) throw assetError(409, "ASSET_SOURCE_INVALID", `${row.document_number} is not a confirmed purchase order.`);
  } else throw assetError(400, "ASSET_SOURCE_INVALID");
  if (!row) throw assetError(404, "ASSET_SOURCE_COMPANY_MISMATCH", "That purchase line was not found in this Company.");
  const quantity = Number(row.quantity ?? 0);
  // Units already claimed on this line, and on any line of the same purchase order line (receipt and bill of the same units).
  const claimed = Number((await client.query(`SELECT COALESCE(sum(allocated_quantity), 0) AS n FROM tenant.asset_acquisition_allocations WHERE organization_id = $1 AND status = 'ACTIVE' AND source_line_id = $2`, [c.organizationId, row.id])).rows[0].n);
  let rootClaimed = 0;
  let rootQuantity = null;
  if (row.root) {
    rootClaimed = Number((await client.query(`SELECT COALESCE(sum(allocated_quantity), 0) AS n FROM tenant.asset_acquisition_allocations WHERE organization_id = $1 AND status = 'ACTIVE' AND (root_po_line_id = $2 OR source_line_id = $2)`,
      [c.organizationId, row.root])).rows[0].n);
    rootQuantity = Number((await client.query(`SELECT COALESCE(base_quantity, ordered_quantity) AS q FROM tenant.purchase_order_lines WHERE organization_id = $1 AND id = $2`, [c.organizationId, row.root])).rows[0]?.q ?? quantity);
  }
  const available = Math.max(0, Math.min(quantity - claimed, rootQuantity === null ? Infinity : rootQuantity - rootClaimed));
  const unitCost = quantity > 0 && row.net_amount !== null && row.net_amount !== undefined ? (Math.round((Number(row.net_amount) / quantity) * 100) / 100).toFixed(2) : null;
  return { ...row, sourceType, quantity, claimed, available, unitCost };
}
// input: { sourceType, sourceLineId?, reason?, openingCost?, commandId? } — this asset's acquisition basis (one unit).
export async function allocateAcquisition(client, c, assetId, input = {}, options = {}) {
  requirePermission(c, options.skipScope ? ASSET.create : ASSET.acquisition);
  const command = keyOf(input, "commandId");
  if (command) {
    const done = (await client.query(`SELECT id, allocation_number FROM tenant.asset_acquisition_allocations WHERE organization_id = $1 AND command_id = $2`, [c.organizationId, command])).rows[0];
    if (done) return { allocationId: done.id, number: `AQ-${done.allocation_number}`, replayed: true };
  }
  const asset = await loadAssetRow(client, c, assetId, { lock: true });
  if (asset.lifecycle_status === "DISPOSED") throw assetError(409, "ASSET_ALREADY_DISPOSED");
  const live = (await client.query(`SELECT id FROM tenant.asset_acquisition_allocations WHERE asset_id = $1 AND status = 'ACTIVE'`, [asset.id])).rows[0];
  if (live) throw assetError(409, "ASSET_SOURCE_ALREADY_ALLOCATED", "This asset already has an acquisition source; reverse it first.");
  const type = String(input.sourceType ?? "");
  const reason = text(input.reason, 1000) || null;
  // The share of one source unit this asset is (an invoice quantity of a box of 10 is 0.1 per asset).
  const share = input.unitQuantity === undefined ? 1 : Number(input.unitQuantity);
  if (!(share > 0 && share <= 1)) throw assetError(400, "ASSET_INPUT_INVALID", "Units per invoice quantity must be a whole number of 1 or more.");
  let values;
  if (type === "OPENING_BALANCE" || type === "MANUAL_EXCEPTION") {
    if (type === "MANUAL_EXCEPTION" && (!reason || reason.length < 3)) throw assetError(400, "ASSET_INPUT_INVALID", "Explain why there is no purchase document.", { field: "reason" });
    if (type === "OPENING_BALANCE" && !has(c, ASSET.acquisition) && !has(c, ASSET.import)) throw assetError(403, "ASSET_PERMISSION_DENIED");
    const cost = input.openingCost === undefined || input.openingCost === null || input.openingCost === "" ? null : Number(input.openingCost);
    if (cost !== null && !(cost >= 0)) throw assetError(400, "ASSET_INPUT_INVALID", "Enter the original cost as 0 or more.", { field: "openingCost" });
    values = { type, document: null, line: null, root: null, cost: cost === null ? null : cost.toFixed(2), basis: cost === null ? "NONE" : "OPENING_BALANCE", costStatus: cost === null ? "NOT_APPLICABLE" : "PROPOSED",
      currency: asset.currency_code, version: null, method: type === "OPENING_BALANCE" ? "OPENING_BALANCE" : "OTHER" };
  } else {
    const probe = await acquisitionSource(client, c, type, input.sourceLineId);
    await lock(client, probe.root ?? probe.id);
    const source = await acquisitionSource(client, c, type, input.sourceLineId);
    if (source.available < share - 1e-9) throw assetError(409, "ASSET_SOURCE_ALREADY_ALLOCATED", `${source.document_number}: all ${source.quantity} unit(s) are already registered.`, { available: source.available });
    values = { type, document: source.document_id, line: source.id, root: source.root, cost: source.unitCost === null ? null : (Math.round(Number(source.unitCost) * share * 100) / 100).toFixed(2), basis: source.unitCost === null ? "NONE" : "LINE_NET_PER_UNIT", costStatus: "PROPOSED",
      currency: source.currency ?? asset.currency_code, version: source.version, method: "PURCHASE", supplierId: source.supplier_id, documentDate: source.document_date };
  }
  const made = (await client.query(`INSERT INTO tenant.asset_acquisition_allocations (organization_id, asset_id, source_type, source_document_id, source_line_id, root_po_line_id, allocated_quantity, allocated_cost,
        cost_basis, cost_status, currency, source_version, reason, batch_id, command_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$16,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id, allocation_number`,
  [c.organizationId, asset.id, values.type, values.document, values.line, values.root, values.cost, values.basis, values.costStatus, values.currency, values.version, reason, options.batchId ?? null, command, c.userId, share])).rows[0];
  const sets = { acquisition_method: asset.acquisition_method ?? values.method };
  if (values.supplierId && !asset.supplier_id) sets.supplier_id = values.supplierId;
  if (values.documentDate && !asset.acquisition_date) sets.acquisition_date = values.documentDate;
  await applyFields(client, c, asset, sets);
  await recordAssetEvent(client, c, asset.id, "asset.acquisition_linked", { allocationId: made.id, sourceType: values.type, sourceLineId: values.line, proposedCost: values.cost, costStatus: values.costStatus });
  return { allocationId: made.id, number: `AQ-${made.allocation_number}`, proposedCost: values.cost, costStatus: values.costStatus };
}
export async function reverseAcquisition(client, c, allocationId, input = {}) {
  requirePermission(c, ASSET.acquisition);
  const row = (await client.query(`SELECT * FROM tenant.asset_acquisition_allocations WHERE organization_id = $1 AND id = $2 FOR UPDATE`, [c.organizationId, uuid(allocationId, "Allocation")])).rows[0];
  if (!row) throw assetError(404, "ASSET_NOT_FOUND", "That allocation was not found.");
  if (row.status === "REVERSED") return { allocationId: row.id, status: "REVERSED", replayed: true };
  const asset = await loadAssetRow(client, c, row.asset_id, { lock: true });
  if (asset.capitalization_class === "CAPITALIZED") throw assetError(409, "ASSET_COST_REVIEW_REQUIRED", "This asset is capitalized; Finance corrects its acquisition basis.");
  const reason = text(input.reason, 500);
  if (reason.length < 3) throw assetError(400, "ASSET_INPUT_INVALID", "Give a reason.", { field: "reason" });
  await client.query(`UPDATE tenant.asset_acquisition_allocations SET status = 'REVERSED', reversed_by = $2, reversed_at = clock_timestamp(), reversal_reason = $3 WHERE id = $1`, [row.id, c.userId, reason]);
  await recordAssetEvent(client, c, asset.id, "asset.acquisition_reversed", { allocationId: row.id, reason });
  return { allocationId: row.id, status: "REVERSED" };
}
// Finance confirms the acquisition cost of an asset (the proposed per-unit, tax-exclusive figure, or a corrected one).
export async function confirmAcquisitionCost(client, c, allocationId, input = {}) {
  requirePermission(c, ASSET.capitalize);
  const row = (await client.query(`SELECT * FROM tenant.asset_acquisition_allocations WHERE organization_id = $1 AND id = $2 AND status = 'ACTIVE' FOR UPDATE`, [c.organizationId, uuid(allocationId, "Allocation")])).rows[0];
  if (!row) throw assetError(404, "ASSET_NOT_FOUND", "That allocation was not found.");
  const cost = input.cost === undefined ? Number(row.allocated_cost) : Number(input.cost);
  if (!(cost >= 0)) throw assetError(400, "ASSET_INPUT_INVALID", "Enter the confirmed cost.", { field: "cost" });
  await client.query(`UPDATE tenant.asset_acquisition_allocations SET allocated_cost = $2, cost_status = 'FINANCE_CONFIRMED' WHERE id = $1`, [row.id, cost.toFixed(2)]);
  await recordAssetEvent(client, c, row.asset_id, "asset.acquisition_cost_confirmed", { allocationId: row.id, cost: cost.toFixed(2), proposed: row.allocated_cost === null ? null : String(row.allocated_cost) });
  return { allocationId: row.id, cost: cost.toFixed(2) };
}

// ------------------------------------------------------------------ bulk registration from a purchase line
// input: { sourceType, sourceLineId, name, categoryId, assetType?, capitalizationClass?, ownership?, manufacturer?, model?, purchaseDate?, receivedDate?, condition?, warranty…?,
//   units: [{ serialNumber?, tagCode?, locationId?, departmentId?, custodianUserId? }, …], idempotencyKey } — one asset per unit, each validated; nothing is created if a unit is invalid.
export async function registerAssetsFromSource(client, c, input = {}) {
  if (!has(c, "assets.acquisition.register") && !has(c, "assets.acquisition.bulk_register")) requirePermission(c, ASSET.registerBulk);
  const key = keyOf(input);
  if (!key) throw assetError(400, "ASSET_INPUT_INVALID", "A registration key is required so a retry cannot register the units twice.");
  const done = (await client.query(`SELECT * FROM tenant.asset_registration_batches WHERE organization_id = $1 AND idempotency_key = $2`, [c.organizationId, key])).rows[0];
  if (done) {
    const assets = (await client.query(`SELECT id, asset_number FROM tenant.assets WHERE registration_batch_id = $1 ORDER BY asset_number`, [done.id])).rows;
    return { batchId: done.id, number: `ARB-${done.batch_number}`, status: done.status, created: assets.map((a) => ({ assetId: a.id, assetNumber: a.asset_number })), replayed: true };
  }
  const units = Array.isArray(input.units) ? input.units : [];
  if (!units.length || units.length > 500) throw assetError(400, "ASSET_INPUT_INVALID", "Enter between 1 and 500 units.", { field: "units" });
  const probe = await acquisitionSource(client, c, String(input.sourceType ?? ""), input.sourceLineId);
  await lock(client, probe.root ?? probe.id);
  const source = await acquisitionSource(client, c, String(input.sourceType ?? ""), input.sourceLineId);
  const share = input.unitsPerQuantity ? 1 / Number(input.unitsPerQuantity) : 1;
  if (!(share > 0 && share <= 1)) throw assetError(400, "ASSET_INPUT_INVALID", "Units per invoice quantity must be a whole number of 1 or more.");
  if (units.length * share > source.available + 1e-9) throw assetError(409, "ASSET_SOURCE_ALREADY_ALLOCATED", `Only ${source.available} of ${source.quantity} unit(s) on ${source.document_number} are still unregistered.`, { available: source.available });
  // Every unit is validated first: distinct serials and tags, valid locations and custodians.
  const errors = [];
  const seen = { serial: new Map(), tag: new Map() };
  for (const [i, unit] of units.entries()) {
    const unitErrors = [];
    let serial = null;
    let tag = null;
    try { serial = cleanIdentifier(unit.serialNumber, "serial number", 120); } catch (failure) { unitErrors.push(failure.message); }
    try { tag = cleanIdentifier(unit.tagCode, "asset tag", 60); } catch (failure) { unitErrors.push(failure.message); }
    const serialKey = normalizeIdentifier(serial);
    const tagKey = normalizeIdentifier(tag);
    if (serialKey) { if (seen.serial.has(serialKey)) unitErrors.push(`serial ${serial} repeats unit ${seen.serial.get(serialKey) + 1}`); seen.serial.set(serialKey, i); }
    if (tagKey) { if (seen.tag.has(tagKey)) unitErrors.push(`tag ${tag} repeats unit ${seen.tag.get(tagKey) + 1}`); seen.tag.set(tagKey, i); }
    for (const check of [() => assertIdentity(client, c, { serialNumber: serial, tagCode: tag, manufacturer: input.manufacturer }), () => locationOf(client, c, unit.locationId), () => departmentOf(client, c, unit.departmentId),
      () => custodianOf(client, c, unit.custodianUserId)]) {
      try { await check(); } catch (failure) { unitErrors.push(failure.message); }
    }
    if (unitErrors.length) errors.push({ unit: i + 1, errors: unitErrors });
  }
  if (errors.length) throw assetError(400, "ASSET_MIGRATION_VALIDATION_FAILED", "Some units need correction; nothing was registered.", { units: errors });
  await categoryOf(client, c, input.categoryId);
  const batch = (await client.query(`INSERT INTO tenant.asset_registration_batches (organization_id, kind, source_type, source_line_id, requested_count, status, idempotency_key, created_by)
      VALUES ($1,'FROM_SOURCE',$2,$3,$4,'IN_PROGRESS',$5,$6) RETURNING id, batch_number`, [c.organizationId, source.sourceType, source.id, units.length, key, c.userId])).rows[0];
  const created = [];
  const shared = Object.fromEntries(["name", "description", "categoryId", "assetType", "capitalizationClass", "ownership", "manufacturer", "model", "purchaseDate", "receivedDate", "condition",
    "warrantyProvider", "warrantyStartDate", "warrantyEndDate", "warrantyReference", "supportContact", "notes"].filter((k) => input[k] !== undefined).map((k) => [k, input[k]]));
  for (const [i, unit] of units.entries()) {
    const made = await createAssetDraft(client, c, { ...shared, acquisitionMethod: "PURCHASE", serialNumber: unit.serialNumber, tagCode: unit.tagCode, locationId: unit.locationId, departmentId: unit.departmentId,
      custodianUserId: unit.custodianUserId, idempotencyKey: `${key}:${i + 1}`, acquisition: { sourceType: source.sourceType, sourceLineId: source.id, ...(share < 1 ? { unitQuantity: share } : {}) } }, { batchId: batch.id });
    await transitionAsset(client, c, made.assetId, "register", {});
    created.push({ unit: i + 1, assetId: made.assetId, assetNumber: made.assetNumber });
  }
  await client.query(`UPDATE tenant.asset_registration_batches SET created_count = $2, status = 'COMPLETED', completed_at = clock_timestamp() WHERE id = $1`, [batch.id, created.length]);
  return { batchId: batch.id, number: `ARB-${batch.batch_number}`, status: "COMPLETED", created, remaining: Math.round((source.available - created.length * share) * 10000) / 10000 };
}

// ------------------------------------------------------------------ verification
// input: { outcome, observedLocationId?, observedLocationText?, condition?, note?, method? } — an observation; it never moves the asset.
export async function recordAssetVerification(client, c, assetId, input = {}) {
  requirePermission(c, ASSET.verify);
  const asset = await loadAssetRow(client, c, assetId, { lock: true });
  if (asset.lifecycle_status === "DISPOSED") throw assetError(409, "ASSET_ALREADY_DISPOSED");
  const outcome = oneOf(input.outcome, ["FOUND", "NOT_FOUND", "WRONG_LOCATION", "DAMAGED"], "outcome");
  if (!outcome) throw assetError(400, "ASSET_INPUT_INVALID", "Choose what you found.", { field: "outcome" });
  const observed = input.observedLocationId ? (await locationOf(client, c, input.observedLocationId)).id : null;
  const observedText = text(input.observedLocationText, 300) || null;
  if (outcome === "WRONG_LOCATION" && !observed && !observedText) throw assetError(400, "ASSET_INPUT_INVALID", "Say where you found it.", { field: "observedLocationId" });
  const condition = oneOf(input.condition, ["NEW", "GOOD", "FAIR", "DAMAGED", "UNSERVICEABLE"], "condition");
  const method = oneOf(input.method, ["MANUAL", "QR", "SEARCH"], "method") ?? "MANUAL";
  const made = (await client.query(`INSERT INTO tenant.asset_verifications (organization_id, asset_id, outcome, observed_location_id, observed_location_text, expected_location_id, expected_custodian_user_id, condition, note, method, verified_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id, verified_at`, [c.organizationId, asset.id, outcome, observed, observedText, asset.location_id ?? null, asset.current_user_id ?? null, condition, text(input.note, 1000) || null, method, c.userId])).rows[0];
  if (outcome !== "NOT_FOUND") await client.query(`UPDATE tenant.assets SET last_verified_at = $3 WHERE organization_id = $1 AND id = $2`, [c.organizationId, asset.id, made.verified_at]);
  await recordAssetEvent(client, c, asset.id, "asset.verified", { verificationId: made.id, outcome, observedLocationId: observed, condition });
  const status = await import("../asset-status/status-commands.js");
  let conditionStatus = null;
  if (condition && condition !== asset.condition) {
    conditionStatus = (await status.recordAssetCondition(client, c, asset.id, { condition, reason: text(input.note, 1000) || "Observed during verification" }, { fromVerification: true, source: "VERIFICATION", sourceId: made.id })).status;
  }
  if (outcome === "WRONG_LOCATION" || observed) {
    const locations = await import("../asset-locations/location-commands.js");
    await locations.recordAssetLocationObservation(client, c, asset.id, { locationId: observed ?? undefined, locationText: observedText ?? undefined, reason: text(input.note, 1000) || null },
      { fromVerification: true, verificationId: made.id });
  }
  let missingReport = null;
  if (outcome === "NOT_FOUND" && ["REGISTERED", "ACTIVE", "ON_HOLD"].includes(asset.lifecycle_status)) {
    missingReport = await status.reportMissingAsset(client, c, asset.id, { description: text(input.note, 1000) || "Not found during physical verification" }, { fromVerification: true });
  }
  return { verificationId: made.id, outcome, discrepancy: outcome !== "FOUND", conditionStatus, missingReport };
}

// ------------------------------------------------------------------ documents
export async function uploadAssetFile(client, c, assetId, input = {}, options = {}) {
  const asset = await loadAssetRow(client, c, assetId);
  if (!has(c, ASSET.editDetails) && !has(c, ASSET.editDraft) && !has(c, ASSET.create)) throw assetError(403, "ASSET_PERMISSION_DENIED");
  const file = await storeFile(client, { organizationId: c.organizationId, entityType: ASSET_FILE_ENTITY, entityId: asset.id, prepared: input.prepared, uploadedBy: c.userId ?? null }, options);
  await recordAssetEvent(client, c, asset.id, "asset.document_added", { fileId: file.id, fileName: file.fileName ?? file.file_name, kind: text(input.kind, 40) || null });
  return { assetId: asset.id, id: file.id, fileName: file.fileName ?? file.file_name };
}
export async function listAssetFiles(client, c, assetId) {
  const asset = await loadAssetRow(client, c, assetId);
  const rows = await listFiles(client, { organizationId: c.organizationId, entityType: ASSET_FILE_ENTITY, entityId: asset.id });
  return rows.map((row) => ({ id: row.id, fileName: row.fileName, mimeType: row.mimeType, sizeBytes: Number(row.sizeBytes ?? 0), uploadedAt: row.createdAt }));
}
export async function readAssetFile(client, c, assetId, fileId, options = {}) {
  const asset = await loadAssetRow(client, c, assetId);
  const row = (await client.query(`SELECT id, file_name, mime_type FROM public.attachments WHERE organization_id = $1 AND entity_type = $2 AND entity_id = $3 AND id = $4`,
    [c.organizationId, ASSET_FILE_ENTITY, String(asset.id), uuid(fileId, "File")])).rows[0];
  if (!row) throw assetError(404, "ASSET_NOT_FOUND", "File not found.");
  const content = await readFileContent(client, { organizationId: c.organizationId, entityType: ASSET_FILE_ENTITY, entityId: asset.id, fileId: row.id }, options);
  return { fileName: row.file_name, mimeType: row.mime_type, body: content.body };
}
// Evidence stays: a document is archived (kept in history), never deleted.
export async function archiveAssetFile(client, c, assetId, fileId) {
  requirePermission(c, ASSET.editDetails);
  const asset = await loadAssetRow(client, c, assetId);
  await archiveFile(client, { organizationId: c.organizationId, entityType: ASSET_FILE_ENTITY, entityId: asset.id, fileId: uuid(fileId, "File"), actorUserId: c.userId ?? null });
  await recordAssetEvent(client, c, asset.id, "asset.document_archived", { fileId });
  return { archived: true };
}

// ------------------------------------------------------------------ reminders (for a scheduled run)
// Custodians hear of warranties ending within the alert window; the registering asset manager of assets not verified within the period.
export async function sendAssetRegisterReminders(client, c) {
  const settings = await loadSettings(client, c);
  const days = Number(settings.warranty_alert_days ?? 30);
  const period = Number(settings.verification_period_days ?? 365);
  let sent = 0;
  const warranties = (await client.query(`SELECT id, asset_number, name, current_user_id, to_char(warranty_end_date, 'YYYY-MM-DD') AS ends FROM tenant.assets WHERE organization_id = $1 AND archived_at IS NULL
      AND lifecycle_status IN ('ACTIVE', 'ON_HOLD') AND warranty_end_date BETWEEN current_date AND current_date + $2::int AND current_user_id IS NOT NULL`, [c.organizationId, days])).rows;
  for (const row of warranties) {
    if (await createNotification(client, { organizationId: c.organizationId, userId: row.current_user_id, category: "asset_register", title: `${row.asset_number} warranty ends ${row.ends}`,
      message: `${row.name}: report any fault before the warranty ends.`, href: `/assets/register/${row.id}`, entityType: ASSET_FILE_ENTITY, entityId: row.id })) sent += 1;
  }
  const overdue = (await client.query(`SELECT created_by, count(*)::int AS n FROM tenant.assets WHERE organization_id = $1 AND archived_at IS NULL AND lifecycle_status = 'ACTIVE'
      AND (last_verified_at IS NULL OR last_verified_at < now() - ($2::int || ' days')::interval) GROUP BY created_by`, [c.organizationId, period])).rows;
  for (const row of overdue) {
    if (await createNotification(client, { organizationId: c.organizationId, userId: row.created_by, category: "asset_register", title: `${row.n} asset(s) due for verification`,
      message: `Not verified in the last ${period} days.`, href: "/assets/register?filter=unverified", entityType: null, entityId: null })) sent += 1;
  }
  return { sent };
}
