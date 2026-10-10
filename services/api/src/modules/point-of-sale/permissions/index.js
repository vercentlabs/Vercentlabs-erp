// Cashier Permissions: what a cashier may do at a POS, within which limits, and when a supervisor must approve. Company-scoped permission
// profiles built from a server-defined catalogue (CASHIER_PERMISSION_CATALOGUE); every cashier is assigned one active profile. Shared roles
// keep controlling who administers profiles (pos.permission_profiles.*); outlet access keeps controlling where a cashier may work.
//
// Every protected POS action asks authorizePosAction(): an active user and cashier with an active profile, access to the outlet, the grant
// enabled, a reason when the grant asks for one, and the limits. The answer is ALLOW, DENY or REQUIRES_APPROVAL. An exception above a
// cashier's limit can be approved once by another person whose own profile holds the matching approval grant and limit; the approval is
// bound to the exact action, transaction, version and amount, expires, and is consumed atomically. Approval never lifts a hard rule (stock,
// tax, payment evidence, refundable balance) — those stay with their own services.
import { POS_PERMISSION_PROFILE_PERMISSIONS as P } from "@vercentlabs/permissions";

import { add, decimal, formatDecimal } from "../../../core/decimal.js";
import { accessiblePosStoreIds } from "../shared/access-control.js";

export class PosPermissionError extends Error {
  constructor(status, message, code = "POS_PERMISSION_ERROR", details = undefined) {
    super(message);
    this.name = "PosPermissionError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

// ------------------------------------------------------------------ the catalogue

// limits: which limits the grant takes (percentage, amount); limitRequired: an enabled grant must state its limits (or be explicitly
// unlimited); reason: always asks for a reason; approval: the approval grant that may lift its limit.
const entry = (code, area, label, description, extra = {}) => Object.freeze({ code, area, label, description, limits: [], limitRequired: false, reason: false, approval: null, ...extra });
export const CASHIER_PERMISSION_CATALOGUE = Object.freeze([
  entry("POS_ACCESS", "sessions", "POS access", "Enter the POS workspace at the cashier's outlets."),
  entry("SESSION_OPEN_OWN", "sessions", "Open own session", "Open a POS session on an active terminal."),
  entry("SESSION_CLOSE_OWN", "sessions", "Close own session", "Close the cashier's own session. Required with Open own session."),
  entry("SESSION_VIEW_OWN", "sessions", "View own session", "See the summary of the cashier's own session."),
  entry("SESSION_VIEW_EXPECTED_CASH", "sessions", "See expected cash", "See the expected cash of an open session before counting it."),
  entry("SESSION_CLOSE_OTHER", "sessions", "Close another cashier's session", "Supervisor closure of someone else's session, with a reason.", { reason: true }),
  entry("SALE_CREATE", "sales", "Start a sale", "Start a POS sale in an open session."),
  entry("SALE_COMPLETE", "sales", "Complete a sale", "Complete checkout once payment, prices, tax and stock check out."),
  entry("SALE_HOLD", "sales", "Hold a sale", "Save an incomplete sale for later."),
  entry("SALE_RESUME_OWN", "sales", "Resume own held sale", "Pick up a sale the cashier held."),
  entry("SALE_RESUME_ANY", "sales", "Resume any held sale", "Pick up a sale another cashier held."),
  entry("SALE_CANCEL_UNPAID", "sales", "Cancel an unpaid sale", "Cancel a sale that was never completed."),
  entry("PAYMENT_VOID_PENDING", "sales", "Void a pending payment", "Void a payment that is still pending or unsettled."),
  entry("DISCOUNT_LINE_MANUAL", "discounts", "Manual line discount", "Discount one line by hand. The amount limit caps all manual discounts on the sale.",
    { limits: ["percentage", "amount"], limitRequired: true, approval: "APPROVE_DISCOUNT_EXCEPTION" }),
  entry("DISCOUNT_ORDER_MANUAL", "discounts", "Manual order discount", "Discount the whole sale by hand. The amount limit caps all manual discounts on the sale.",
    { limits: ["percentage", "amount"], limitRequired: true, approval: "APPROVE_DISCOUNT_EXCEPTION" }),
  entry("PRICE_OVERRIDE", "discounts", "Override a price", "Sell at a price other than the configured one, with a reason. The percentage caps the deviation.",
    { limits: ["percentage"], limitRequired: true, reason: true, approval: "APPROVE_PRICE_OVERRIDE" }),
  entry("CUSTOMER_SELECT", "sales", "Choose a customer", "Attach an existing customer to a sale."),
  entry("CUSTOMER_QUICK_CREATE", "sales", "Create a customer", "Create a customer from POS (also needs the CRM permission)."),
  entry("RECEIPT_PRINT", "receipts", "Print a receipt", "Print the receipt of a sale."),
  entry("RECEIPT_REPRINT", "receipts", "Reprint a receipt", "Print an existing receipt again."),
  entry("TRANSACTION_LOOKUP", "receipts", "Look up transactions", "Search sales at the cashier's outlets."),
  entry("RETURN_WITH_RECEIPT", "returns", "Return with receipt", "Take back items against an original sale."),
  entry("RETURN_WITHOUT_RECEIPT", "returns", "Return without receipt", "Take back items with no original sale (off by default).", { reason: true, approval: "APPROVE_NO_RECEIPT_RETURN" }),
  entry("REFUND_INITIATE", "returns", "Refund", "Refund money for a return or a payment. The amount caps one transaction.",
    { limits: ["amount"], limitRequired: true, approval: "APPROVE_REFUND_EXCEPTION" }),
  entry("RETURN_POLICY_OVERRIDE", "returns", "Override return policy", "Override a soft return-policy restriction, with a reason.", { reason: true, approval: "APPROVE_RETURN_POLICY_EXCEPTION" }),
  entry("CASH_DRAWER_OPEN_NO_SALE", "cash", "Open drawer without a sale", "Open the cash drawer with no sale, with a reason.", { reason: true }),
  entry("CASH_MOVEMENT_IN", "cash", "Cash in", "Record cash paid into the drawer. The amount caps one movement.",
    { limits: ["amount"], limitRequired: true, reason: true, approval: "APPROVE_CASH_MOVEMENT_EXCEPTION" }),
  entry("CASH_MOVEMENT_OUT", "cash", "Cash out", "Record cash paid out of the drawer. The amount caps one movement.",
    { limits: ["amount"], limitRequired: true, reason: true, approval: "APPROVE_CASH_MOVEMENT_EXCEPTION" }),
  entry("APPROVE_DISCOUNT_EXCEPTION", "approvals", "Approve discount exceptions", "Approve another cashier's discount above their limit, within this limit.",
    { limits: ["percentage", "amount"], limitRequired: true }),
  entry("APPROVE_PRICE_OVERRIDE", "approvals", "Approve price overrides", "Approve another cashier's price override above their limit, within this limit.",
    { limits: ["percentage"], limitRequired: true }),
  entry("APPROVE_REFUND_EXCEPTION", "approvals", "Approve refund exceptions", "Approve another cashier's refund above their limit, within this limit.",
    { limits: ["amount"], limitRequired: true }),
  entry("APPROVE_NO_RECEIPT_RETURN", "approvals", "Approve returns without receipt", "Approve another cashier's return without a receipt."),
  entry("APPROVE_RETURN_POLICY_EXCEPTION", "approvals", "Approve return-policy exceptions", "Approve another cashier's return-policy override."),
  entry("APPROVE_CASH_MOVEMENT_EXCEPTION", "approvals", "Approve cash-movement exceptions", "Approve another cashier's cash movement above their limit, within this limit.",
    { limits: ["amount"], limitRequired: true }),
]);
export const PERMISSION_AREAS = Object.freeze([
  { code: "sessions", label: "POS access and sessions" }, { code: "sales", label: "Sales and checkout" }, { code: "discounts", label: "Discounts and prices" },
  { code: "receipts", label: "Receipts and lookup" }, { code: "returns", label: "Returns and refunds" }, { code: "cash", label: "Cash drawer and movements" },
  { code: "approvals", label: "Supervisor approvals" },
]);
const BY_CODE = new Map(CASHIER_PERMISSION_CATALOGUE.map((item) => [item.code, item]));
const APPROVAL_MINUTES = 15;

const BYPASS_ROLES = ["organization_owner", "system_administrator"];
const can = (c, permission) => Boolean(c.roleSlugs?.some((slug) => BYPASS_ROLES.includes(slug)) || c.permissions?.includes(permission));
const require = (c, permission, message) => { if (!can(c, permission)) throw new PosPermissionError(403, message, "PERMISSION_DENIED"); };
const text = (value, max = 500) => { const out = String(value ?? "").trim().replace(/\s+/g, " "); return out ? out.slice(0, max) : null; };
const has = (input, key) => Object.prototype.hasOwnProperty.call(input ?? {}, key);
const issue = (field, message, code = "POS_PERMISSION_PROFILE_INVALID", status = 400) => new PosPermissionError(status, message, code, { issues: [{ field, message }] });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE = /^[A-Z0-9][A-Z0-9._/-]{0,29}$/;
const uuid = (value, label, code = "POS_PERMISSION_PROFILE_NOT_FOUND") => { const id = String(value ?? "").trim(); if (!UUID.test(id)) throw new PosPermissionError(404, `${label} not found.`, code); return id; };
const num = (value) => (value === null || value === undefined || value === "" ? null : Number(value));
// Money and percentages are compared as fixed-point decimals, never floats.
const dec = (value) => decimal(String(value ?? 0));
const plain = (value) => (value === null || value === undefined ? null : formatDecimal(decimal(String(value))));
export const normalizeProfileCode = (value) => String(value ?? "").normalize("NFKC").trim().toUpperCase();

async function history(client, c, profileId, eventType, summary, changes = {}) {
  await client.query(`INSERT INTO tenant.pos_permission_profile_history (organization_id, profile_id, event_type, summary, changes, actor_user_id) VALUES ($1, $2, $3, $4, $5, $6)`,
    [c.organizationId, profileId, eventType, String(summary).slice(0, 500), JSON.stringify(changes), c.userId ?? null]);
}

export function permissionProfileCapabilities(c) {
  return Object.fromEntries(Object.entries(P).map(([name, permission]) => [name, can(c, permission)]));
}

async function baseCurrency(client, organizationId) {
  return (await client.query(`SELECT base_currency FROM public.organizations WHERE id = $1`, [organizationId])).rows[0]?.base_currency?.trim() ?? "INR";
}

// ------------------------------------------------------------------ profiles: reading

function toGrant(row) {
  const item = BY_CODE.get(row.permission_code);
  return {
    code: row.permission_code, area: item?.area ?? "other", label: item?.label ?? row.permission_code, description: item?.description ?? null, enabled: row.enabled,
    limitMode: row.limit_mode, maxPercentage: num(row.max_percentage), maxAmount: num(row.max_amount), currency: row.amount_currency?.trim() ?? null,
    requireReason: row.require_reason || Boolean(item?.reason), reasonForced: Boolean(item?.reason), limits: item?.limits ?? [], limitRequired: Boolean(item?.limitRequired),
    approvalCode: item?.approval ?? null, supported: Boolean(item),
  };
}

const PROFILE_SELECT = `
  SELECT profile.*, updater.full_name AS updated_by_name,
         (SELECT count(*)::int FROM tenant.pos_cashiers cashier WHERE cashier.organization_id = profile.organization_id AND cashier.permission_profile_id = profile.id) AS assigned,
         (SELECT count(*)::int FROM tenant.pos_cashiers cashier WHERE cashier.organization_id = profile.organization_id AND cashier.permission_profile_id = profile.id
            AND cashier.status = 'active') AS assigned_active,
         (SELECT count(*)::int FROM tenant.pos_permission_profile_grants grant_row WHERE grant_row.organization_id = profile.organization_id AND grant_row.profile_id = profile.id
            AND grant_row.enabled) AS enabled_grants
    FROM tenant.pos_permission_profiles profile
    LEFT JOIN public.users updater ON updater.id = COALESCE(profile.updated_by, profile.created_by)`;

function toProfile(row) {
  return {
    id: row.id, code: row.code, name: row.name, description: row.description, status: row.status, assignedCashiers: row.assigned, activeCashiers: row.assigned_active,
    enabledGrants: row.enabled_grants, version: row.version, updatedAt: row.updated_at, updatedBy: row.updated_by_name ?? null, createdAt: row.created_at,
  };
}

// filters: status (draft | active | inactive), search (code, name).
export async function listPermissionProfiles(client, c, filters = {}) {
  require(c, P.view, "You do not have permission to view cashier permission profiles.");
  const values = [c.organizationId];
  const where = ["profile.organization_id = $1"];
  if (["draft", "active", "inactive"].includes(filters.status)) { values.push(filters.status); where.push(`profile.status = $${values.length}`); }
  const term = text(filters.search);
  if (term) { values.push(`%${term.toLowerCase()}%`); where.push(`lower(concat_ws(' ', profile.code, profile.name)) LIKE $${values.length}`); }
  const { rows } = await client.query(`${PROFILE_SELECT} WHERE ${where.join(" AND ")} ORDER BY profile.status = 'active' DESC, lower(profile.name)`, values);
  const summaries = await grantSummaries(client, c, rows.map((row) => row.id));
  return { profiles: rows.map((row) => ({ ...toProfile(row), summary: summaries.get(row.id) ?? [] })), capabilities: permissionProfileCapabilities(c) };
}

// The areas each profile grants something in, for the list's "Permissions summary".
async function grantSummaries(client, c, ids) {
  if (!ids.length) return new Map();
  const { rows } = await client.query(`SELECT profile_id, permission_code FROM tenant.pos_permission_profile_grants WHERE organization_id = $1 AND profile_id = ANY($2::uuid[]) AND enabled`,
    [c.organizationId, ids]);
  const map = new Map();
  for (const row of rows) {
    const area = BY_CODE.get(row.permission_code)?.area;
    if (!area) continue;
    const list = map.get(row.profile_id) ?? [];
    if (!list.includes(area)) list.push(area);
    map.set(row.profile_id, list);
  }
  for (const [id, list] of map) map.set(id, PERMISSION_AREAS.filter((area) => list.includes(area.code)).map((area) => area.label));
  return map;
}

async function loadProfile(client, c, profileId, { lock = false } = {}) {
  const id = uuid(profileId, "Permission profile");
  if (lock) await client.query(`SELECT id FROM tenant.pos_permission_profiles WHERE organization_id = $1 AND id = $2 FOR UPDATE`, [c.organizationId, id]);
  const row = (await client.query(`${PROFILE_SELECT} WHERE profile.organization_id = $1 AND profile.id = $2`, [c.organizationId, id])).rows[0];
  if (!row) throw new PosPermissionError(404, "Permission profile not found.", "POS_PERMISSION_PROFILE_NOT_FOUND");
  return row;
}

async function grantsOf(client, organizationId, profileId) {
  const { rows } = await client.query(`SELECT * FROM tenant.pos_permission_profile_grants WHERE organization_id = $1 AND profile_id = $2`, [organizationId, profileId]);
  const byCode = new Map(rows.map((row) => [row.permission_code, row]));
  // Every catalogue code is shown; one the profile never stored is simply off.
  return CASHIER_PERMISSION_CATALOGUE.map((item) => toGrant(byCode.get(item.code) ?? { permission_code: item.code, enabled: false, limit_mode: "not_applicable", require_reason: false }));
}

// The profile with every grant (catalogue order, grouped by area), its assigned cashiers and the validation result.
export async function getPermissionProfile(client, c, profileId) {
  require(c, P.view, "You do not have permission to view cashier permission profiles.");
  const row = await loadProfile(client, c, profileId);
  const grants = await grantsOf(client, c.organizationId, row.id);
  const cashiers = (await client.query(
    `SELECT cashier.id, cashier.code, cashier.status, COALESCE(cashier.display_name, users.full_name) AS name, cashier.profile_assigned_at, assigner.full_name AS assigned_by
       FROM tenant.pos_cashiers cashier JOIN public.users users ON users.id = cashier.user_id LEFT JOIN public.users assigner ON assigner.id = cashier.profile_assigned_by
      WHERE cashier.organization_id = $1 AND cashier.permission_profile_id = $2 ORDER BY cashier.code`, [c.organizationId, row.id])).rows;
  return {
    ...toProfile(row), grants, areas: PERMISSION_AREAS, currency: await baseCurrency(client, c.organizationId),
    cashiers: cashiers.map((cashier) => ({ id: cashier.id, code: cashier.code, name: cashier.name, status: cashier.status, assignedAt: cashier.profile_assigned_at, assignedBy: cashier.assigned_by })),
    issues: validateGrants(grants), capabilities: permissionProfileCapabilities(c),
  };
}

// ------------------------------------------------------------------ profiles: validation and writing

// What would stop the profile being activated ([] when it is valid).
function validateGrants(grants) {
  const issues = [];
  const byCode = new Map(grants.map((grant) => [grant.code, grant]));
  for (const grant of grants) {
    if (!grant.supported) { issues.push({ code: grant.code, message: `${grant.code} is not a supported permission.` }); continue; }
    if (!grant.enabled) continue;
    if (grant.limitRequired && grant.limitMode === "not_applicable")
      issues.push({ code: grant.code, message: `${grant.label} needs its limit set, or an explicit Unlimited.` });
    if (grant.limitMode === "limited") {
      if (grant.maxPercentage === null && grant.maxAmount === null) issues.push({ code: grant.code, message: `${grant.label} is limited but states no limit.` });
      if (grant.maxPercentage !== null && !grant.limits.includes("percentage")) issues.push({ code: grant.code, message: `${grant.label} takes no percentage limit.` });
      if (grant.maxAmount !== null && !grant.limits.includes("amount")) issues.push({ code: grant.code, message: `${grant.label} takes no amount limit.` });
    }
    if (!grant.limits.length && grant.limitMode !== "not_applicable") issues.push({ code: grant.code, message: `${grant.label} takes no limit.` });
  }
  if (byCode.get("SESSION_OPEN_OWN")?.enabled && !byCode.get("SESSION_CLOSE_OWN")?.enabled)
    issues.push({ code: "SESSION_CLOSE_OWN", message: "A profile that opens sessions must also close its own session." });
  if (byCode.get("SALE_COMPLETE")?.enabled && !byCode.get("SALE_CREATE")?.enabled)
    issues.push({ code: "SALE_CREATE", message: "Completing a sale needs Start a sale as well." });
  return issues;
}

async function checkCode(client, c, code, exceptId = null) {
  if (!CODE.test(code)) throw issue("code", "Use up to 30 letters, numbers, dots, dashes or slashes, such as SENIOR-CASHIER.");
  const clash = (await client.query(`SELECT name FROM tenant.pos_permission_profiles WHERE organization_id = $1 AND upper(btrim(code)) = $2 AND ($3::uuid IS NULL OR id <> $3)`,
    [c.organizationId, code, exceptId])).rows[0];
  if (clash) throw issue("code", `${code} is already the code of ${clash.name}.`, "POS_PERMISSION_PROFILE_DUPLICATE", 409);
}

// One grant from the editor: only catalogue codes, only the limits the code takes, unlimited only with that permission, amounts in the
// company's currency. Returns the row to store.
function readGrant(c, input, currency) {
  const code = String(input?.code ?? "").trim().toUpperCase();
  const item = BY_CODE.get(code);
  if (!item) throw issue("grants", `${code || "That"} is not a supported cashier permission.`, "POS_PERMISSION_CODE_INVALID");
  const enabled = input.enabled === true;
  const mode = input.limitMode ?? (item.limitRequired ? "limited" : "not_applicable");
  if (!["not_applicable", "limited", "unlimited"].includes(mode)) throw issue(code, `Choose a limit mode for ${item.label}.`, "POS_PERMISSION_PROFILE_INVALID_LIMIT");
  if (mode !== "not_applicable" && !item.limits.length) throw issue(code, `${item.label} takes no limit.`, "POS_PERMISSION_PROFILE_INVALID_LIMIT");
  if (mode === "unlimited" && enabled && !can(c, P.configureUnlimited))
    throw issue(code, `You may not grant an unlimited ${item.label.toLowerCase()}.`, "POS_UNLIMITED_LIMIT_NOT_AUTHORIZED", 403);
  const percentage = mode === "limited" && item.limits.includes("percentage") ? num(input.maxPercentage) : null;
  const amount = mode === "limited" && item.limits.includes("amount") ? num(input.maxAmount) : null;
  if (mode === "limited" && (input.maxPercentage ?? null) !== null && input.maxPercentage !== "" && !item.limits.includes("percentage"))
    throw issue(code, `${item.label} takes no percentage limit.`, "POS_PERMISSION_PROFILE_INVALID_LIMIT");
  if (mode === "limited" && (input.maxAmount ?? null) !== null && input.maxAmount !== "" && !item.limits.includes("amount"))
    throw issue(code, `${item.label} takes no amount limit.`, "POS_PERMISSION_PROFILE_INVALID_LIMIT");
  if (percentage !== null && (!Number.isFinite(percentage) || percentage < 0 || percentage > 100)) throw issue(code, `${item.label}: the percentage must be between 0 and 100.`, "POS_PERMISSION_PROFILE_INVALID_LIMIT");
  if (amount !== null && (!Number.isFinite(amount) || amount < 0)) throw issue(code, `${item.label}: the amount must be zero or more.`, "POS_PERMISSION_PROFILE_INVALID_LIMIT");
  if (mode === "limited" && percentage === null && amount === null) throw issue(code, `${item.label}: enter its limit, or choose Unlimited.`, "POS_PERMISSION_PROFILE_INVALID_LIMIT");
  return {
    code, enabled, limit_mode: mode, max_percentage: percentage === null ? null : plain(input.maxPercentage), max_amount: amount === null ? null : plain(input.maxAmount),
    amount_currency: amount === null ? null : currency, require_reason: item.reason || input.requireReason === true,
  };
}

async function writeGrants(client, c, profileId, grantInputs, { record = true } = {}) {
  const currency = await baseCurrency(client, c.organizationId);
  const before = new Map((await client.query(`SELECT * FROM tenant.pos_permission_profile_grants WHERE organization_id = $1 AND profile_id = $2`, [c.organizationId, profileId]))
    .rows.map((row) => [row.permission_code, row]));
  const seen = new Set();
  for (const input of Array.isArray(grantInputs) ? grantInputs : []) {
    const grant = readGrant(c, input, currency);
    if (seen.has(grant.code)) throw issue(grant.code, `${grant.code} appears twice.`, "POS_PERMISSION_CODE_INVALID");
    seen.add(grant.code);
    const old = before.get(grant.code);
    const same = old && old.enabled === grant.enabled && old.limit_mode === grant.limit_mode && String(old.max_percentage ?? "") === String(grant.max_percentage ?? "")
      && String(old.max_amount ?? "") === String(grant.max_amount ?? "") && old.require_reason === grant.require_reason;
    if (same) continue;
    await client.query(
      `INSERT INTO tenant.pos_permission_profile_grants (organization_id, profile_id, permission_code, enabled, limit_mode, max_percentage, max_amount, amount_currency, require_reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (organization_id, profile_id, permission_code) DO UPDATE SET enabled = EXCLUDED.enabled, limit_mode = EXCLUDED.limit_mode,
         max_percentage = EXCLUDED.max_percentage, max_amount = EXCLUDED.max_amount, amount_currency = EXCLUDED.amount_currency, require_reason = EXCLUDED.require_reason,
         version = tenant.pos_permission_profile_grants.version + 1, updated_at = now()`,
      [c.organizationId, profileId, grant.code, grant.enabled, grant.limit_mode, grant.max_percentage, grant.max_amount, grant.amount_currency, grant.require_reason]);
    if (!record) continue;
    const label = BY_CODE.get(grant.code).label;
    const was = { enabled: old?.enabled ?? false, limitMode: old?.limit_mode ?? "not_applicable", maxPercentage: old?.max_percentage ?? null, maxAmount: old?.max_amount ?? null };
    const now = { enabled: grant.enabled, limitMode: grant.limit_mode, maxPercentage: grant.max_percentage, maxAmount: grant.max_amount };
    if (was.enabled !== now.enabled) await history(client, c, profileId, "grant_changed", `${label} ${now.enabled ? "granted" : "revoked"}`, { code: grant.code, from: was, to: now });
    else if (now.limitMode === "unlimited" && was.limitMode !== "unlimited") await history(client, c, profileId, "unlimited_configured", `${label}: unlimited`, { code: grant.code, from: was, to: now });
    else await history(client, c, profileId, "limit_changed", `${label}: limits changed`, { code: grant.code, from: was, to: now });
  }
}

async function guarded(client, run) {
  await client.query("SAVEPOINT profile_write");
  try { const result = await run(); await client.query("RELEASE SAVEPOINT profile_write"); return result; } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT profile_write");
    if (error?.code === "23505" && /code/.test(error.constraint ?? "")) throw issue("code", "Another profile with this code was just saved. Reload and try again.", "POS_PERMISSION_PROFILE_DUPLICATE", 409);
    throw error;
  }
}

// input: { code, name, description, grants: [{ code, enabled, limitMode, maxPercentage, maxAmount, requireReason }] }. Saved as Draft.
export async function createPermissionProfile(client, c, input = {}) {
  require(c, P.manage, "You do not have permission to create cashier permission profiles.");
  const code = normalizeProfileCode(input.code);
  await checkCode(client, c, code);
  const name = text(input.name, 120);
  if (!name) throw issue("name", "Enter the profile name, such as Senior Cashier.");
  const id = await guarded(client, async () => (await client.query(
    `INSERT INTO tenant.pos_permission_profiles (organization_id, code, name, description, status, created_by, updated_by) VALUES ($1, $2, $3, $4, 'draft', $5, $5) RETURNING id`,
    [c.organizationId, code, name, text(input.description, 1000), c.userId ?? null])).rows[0].id);
  await writeGrants(client, c, id, CASHIER_PERMISSION_CATALOGUE.map((item) => ({ code: item.code, enabled: false, limitMode: "not_applicable" })), { record: false });
  if (input.grants) await writeGrants(client, c, id, input.grants, { record: false });
  await history(client, c, id, "created", `Profile ${code} created (Draft)`, { code, name });
  return getPermissionProfile(client, c, id);
}

// input: name, description, code (Draft only), grants, expectedVersion. An Active profile stays valid: a change that would make it invalid
// is refused; changes apply to the next protected action of every cashier holding it.
export async function updatePermissionProfile(client, c, profileId, input = {}) {
  require(c, P.manage, "You do not have permission to edit cashier permission profiles.");
  const row = await loadProfile(client, c, profileId, { lock: true });
  if (has(input, "expectedVersion") && input.expectedVersion !== null && input.expectedVersion !== undefined && Number(input.expectedVersion) !== Number(row.version))
    throw new PosPermissionError(409, "Someone else changed this profile after you opened it. Reload it.", "POS_PERMISSION_PROFILE_VERSION_CONFLICT");
  const changes = {};
  if (has(input, "code")) {
    const code = normalizeProfileCode(input.code);
    if (code !== row.code) {
      if (row.status !== "draft" || row.assigned > 0) throw issue("code", "The code of an activated or assigned profile stays as it is.", "POS_PERMISSION_PROFILE_CODE_FIXED", 409);
      await checkCode(client, c, code, row.id);
      changes.code = code;
    }
  }
  if (has(input, "name")) { const name = text(input.name, 120); if (!name) throw issue("name", "Enter the profile name."); if (name !== row.name) changes.name = name; }
  if (has(input, "description")) { const description = text(input.description, 1000); if ((description ?? null) !== (row.description ?? null)) changes.description = description; }
  const columns = Object.keys(changes);
  if (columns.length)
    await guarded(client, () => client.query(`UPDATE tenant.pos_permission_profiles SET ${columns.map((column, index) => `${column} = $${index + 3}`).join(", ")} WHERE organization_id = $1 AND id = $2`,
      [c.organizationId, row.id, ...columns.map((column) => changes[column])]));
  if (input.grants) await writeGrants(client, c, row.id, input.grants);
  if (row.status === "active") {
    const problems = validateGrants(await grantsOf(client, c.organizationId, row.id));
    if (problems.length) throw new PosPermissionError(409, `This profile is active, so it must stay valid. ${problems.map((entry) => entry.message).join(" ")}`, "POS_PERMISSION_PROFILE_INVALID_LIMIT", { issues: problems });
  }
  await client.query(`UPDATE tenant.pos_permission_profiles SET version = version + 1, updated_by = $3, updated_at = now() WHERE organization_id = $1 AND id = $2`, [c.organizationId, row.id, c.userId ?? null]);
  if (columns.length) await history(client, c, row.id, "updated", `${columns.join(", ")} changed`, Object.fromEntries(columns.map((column) => [column, { from: row[column] ?? null, to: changes[column] }])));
  return getPermissionProfile(client, c, row.id);
}

// A copy as a new Draft, with the same grants and limits.
export async function clonePermissionProfile(client, c, profileId, input = {}) {
  require(c, P.manage, "You do not have permission to create cashier permission profiles.");
  const source = await loadProfile(client, c, profileId);
  const grants = await grantsOf(client, c.organizationId, source.id);
  const clone = await createPermissionProfile(client, c, {
    code: input.code ?? `${source.code}-COPY`.slice(0, 30), name: input.name ?? `${source.name} (copy)`, description: source.description,
    grants: grants.map((grant) => ({ code: grant.code, enabled: grant.enabled, limitMode: grant.limitMode, maxPercentage: grant.maxPercentage, maxAmount: grant.maxAmount, requireReason: grant.requireReason })),
  });
  await history(client, c, clone.id, "cloned", `Cloned from ${source.code}`, { from: source.code });
  return getPermissionProfile(client, c, clone.id);
}

export async function validatePermissionProfile(client, c, profileId) {
  require(c, P.view, "You do not have permission to view cashier permission profiles.");
  const row = await loadProfile(client, c, profileId);
  return validateGrants(await grantsOf(client, c.organizationId, row.id));
}

// Activate: only a valid profile. Deactivate: only when no active cashier holds it (reassign them first).
export async function setPermissionProfileStatus(client, c, profileId, status) {
  require(c, P.status, "You do not have permission to activate or deactivate permission profiles.");
  if (!["active", "inactive"].includes(status)) throw issue("status", "Choose Active or Inactive.");
  const row = await loadProfile(client, c, profileId, { lock: true });
  if (row.status === status) throw new PosPermissionError(409, `This profile is already ${status}.`, "POS_PERMISSION_PROFILE_STATUS_UNCHANGED");
  if (status === "active") {
    const problems = validateGrants(await grantsOf(client, c.organizationId, row.id));
    if (problems.length) throw new PosPermissionError(409, `This profile cannot be activated yet. ${problems.map((entry) => entry.message).join(" ")}`, "POS_PERMISSION_PROFILE_INVALID_LIMIT", { issues: problems });
  } else if (row.assigned_active > 0) {
    throw new PosPermissionError(409, `${row.assigned_active} active cashier${row.assigned_active === 1 ? " holds" : "s hold"} this profile. Assign them another profile first.`, "POS_PROFILE_HAS_ACTIVE_ASSIGNMENTS");
  }
  await client.query(`UPDATE tenant.pos_permission_profiles SET status = $3, version = version + 1, updated_by = $4, updated_at = now() WHERE organization_id = $1 AND id = $2`,
    [c.organizationId, row.id, status, c.userId ?? null]);
  await history(client, c, row.id, status === "active" ? "activated" : "deactivated", status === "active" ? "Activated" : "Deactivated", { from: row.status, to: status });
  return getPermissionProfile(client, c, row.id);
}

export const activatePermissionProfile = (client, c, profileId) => setPermissionProfileStatus(client, c, profileId, "active");
export const deactivatePermissionProfile = (client, c, profileId) => setPermissionProfileStatus(client, c, profileId, "inactive");

// Only a profile never assigned and never behind an approval can be deleted.
export async function deletePermissionProfile(client, c, profileId) {
  require(c, P.manage, "You do not have permission to delete permission profiles.");
  const row = await loadProfile(client, c, profileId, { lock: true });
  const everAssigned = (await client.query(`SELECT 1 FROM tenant.pos_permission_profile_history WHERE organization_id = $1 AND profile_id = $2 AND event_type IN ('assigned', 'activated') LIMIT 1`,
    [c.organizationId, row.id])).rows[0];
  if (row.assigned > 0 || everAssigned) throw new PosPermissionError(409, "This profile has been activated or assigned. Deactivate it instead.", "POS_PERMISSION_PROFILE_IN_USE");
  await client.query(`DELETE FROM tenant.pos_permission_profiles WHERE organization_id = $1 AND id = $2`, [c.organizationId, row.id]);
  return { deleted: true };
}

// Give a cashier an active profile of the company (null removes it, leaving the cashier unable to operate). Audited on both sides.
export async function assignPermissionProfile(client, c, cashierId, profileId) {
  require(c, P.assign, "You do not have permission to assign permission profiles.");
  const cashier = (await client.query(`SELECT id, code, user_id, permission_profile_id FROM tenant.pos_cashiers WHERE organization_id = $1 AND id = $2 FOR UPDATE`,
    [c.organizationId, uuid(cashierId, "Cashier", "CASHIER_NOT_FOUND")])).rows[0];
  if (!cashier) throw new PosPermissionError(404, "Cashier not found.", "CASHIER_NOT_FOUND");
  if (cashier.user_id === c.userId && !c.roleSlugs?.some((slug) => BYPASS_ROLES.includes(slug)))
    throw new PosPermissionError(403, "You cannot change your own permission profile.", "POS_SELF_ASSIGNMENT_NOT_ALLOWED");
  let profile = null;
  if (profileId) {
    profile = (await client.query(`SELECT id, code, name, status FROM tenant.pos_permission_profiles WHERE organization_id = $1 AND id = $2`, [c.organizationId, String(profileId)])).rows[0];
    if (!profile) throw new PosPermissionError(404, "Choose a permission profile of this company.", "POS_PERMISSION_PROFILE_COMPANY_MISMATCH");
    if (profile.status !== "active") throw new PosPermissionError(409, `${profile.name} is not active. Only an active profile can be assigned.`, "POS_PERMISSION_PROFILE_INACTIVE");
  }
  if ((cashier.permission_profile_id ?? null) === (profile?.id ?? null)) return { cashierId: cashier.id, profileId: profile?.id ?? null };
  await client.query(`UPDATE tenant.pos_cashiers SET permission_profile_id = $3, profile_assigned_at = now(), profile_assigned_by = $4, version = version + 1, updated_at = now()
    WHERE organization_id = $1 AND id = $2`, [c.organizationId, cashier.id, profile?.id ?? null, c.userId ?? null]);
  await client.query(`INSERT INTO tenant.pos_cashier_history (organization_id, cashier_id, event_type, summary, changes, actor_user_id) VALUES ($1, $2, 'updated', $3, $4, $5)`,
    [c.organizationId, cashier.id, profile ? `Permission profile set to ${profile.name}` : "Permission profile removed", JSON.stringify({ permission_profile_id: { from: cashier.permission_profile_id, to: profile?.id ?? null } }), c.userId ?? null]);
  if (cashier.permission_profile_id) await history(client, c, cashier.permission_profile_id, "unassigned", `Unassigned from ${cashier.code}`, { cashier: cashier.code });
  if (profile) await history(client, c, profile.id, "assigned", `Assigned to ${cashier.code}`, { cashier: cashier.code });
  return { cashierId: cashier.id, profileId: profile?.id ?? null };
}

export async function getPermissionProfileAuditHistory(client, c, profileId) {
  require(c, P.viewHistory, "You do not have permission to view permission profile history.");
  const { rows } = await client.query(
    `SELECT history.*, actor.full_name AS actor_name FROM tenant.pos_permission_profile_history history LEFT JOIN public.users actor ON actor.id = history.actor_user_id
      WHERE history.organization_id = $1 AND history.profile_id = $2 ORDER BY history.created_at DESC, history.id DESC LIMIT 500`, [c.organizationId, uuid(profileId, "Permission profile")]);
  return rows.map((row) => ({ id: row.id, eventType: row.event_type, summary: row.summary, changes: row.changes, actorName: row.actor_name, createdAt: row.created_at }));
}

// ------------------------------------------------------------------ the authorization service

// The cashier behind a user and their profile's grants, as of now (permission changes apply to the very next action).
async function cashierAuthority(client, organizationId, userId) {
  const row = (await client.query(
    `SELECT cashier.id, cashier.code, cashier.status, cashier.permission_profile_id, profile.code AS profile_code, profile.name AS profile_name, profile.status AS profile_status,
            membership.status AS membership_status, users.status AS user_status, users.full_name
       FROM tenant.pos_cashiers cashier
       JOIN public.users users ON users.id = cashier.user_id
       LEFT JOIN public.organization_memberships membership ON membership.organization_id = cashier.organization_id AND membership.user_id = cashier.user_id
       LEFT JOIN tenant.pos_permission_profiles profile ON profile.organization_id = cashier.organization_id AND profile.id = cashier.permission_profile_id
      WHERE cashier.organization_id = $1 AND cashier.user_id = $2`, [organizationId, userId])).rows[0];
  if (!row) return null;
  const grants = row.permission_profile_id ? await grantsOf(client, organizationId, row.permission_profile_id) : [];
  return { ...row, grants: new Map(grants.map((grant) => [grant.code, grant])) };
}

// The effective permissions of a cashier (the caller unless a user is named): their profile and each grant with its limits.
export async function getEffectivePosPermissions(client, c, userId = null) {
  const authority = await cashierAuthority(client, c.organizationId, userId ?? c.userId);
  if (!authority) return null;
  return {
    cashierId: authority.id, cashierCode: authority.code, profileId: authority.permission_profile_id, profileCode: authority.profile_code ?? null, profileName: authority.profile_name ?? null,
    profileStatus: authority.profile_status ?? null, grants: [...authority.grants.values()],
  };
}

// The cashier-detail summary: profile, when and by whom it was assigned, and what it lets them do.
export async function getCashierEffectivePermissionSummary(client, c, cashierId) {
  const row = (await client.query(
    `SELECT cashier.user_id, cashier.profile_assigned_at, assigner.full_name AS assigned_by FROM tenant.pos_cashiers cashier LEFT JOIN public.users assigner ON assigner.id = cashier.profile_assigned_by
      WHERE cashier.organization_id = $1 AND cashier.id = $2`, [c.organizationId, uuid(cashierId, "Cashier", "CASHIER_NOT_FOUND")])).rows[0];
  if (!row) throw new PosPermissionError(404, "Cashier not found.", "CASHIER_NOT_FOUND");
  const effective = await getEffectivePosPermissions(client, c, row.user_id);
  // Limits are policy: shown to those who administer profiles, not to every viewer of a cashier.
  const showLimits = can(c, P.view);
  return {
    ...effective, assignedAt: row.profile_assigned_at, assignedBy: row.assigned_by,
    grants: (effective?.grants ?? []).map((grant) => (showLimits ? grant : { ...grant, maxPercentage: null, maxAmount: null, limitMode: grant.enabled ? "hidden" : grant.limitMode })),
  };
}

const deny = (status, message, reasonCode, details) => ({ decision: "DENY", status, message, reasonCode, details });

// The one decision every protected POS action asks for.
// request: { permission, outletId?, amount?, percentage?, reason?, approvalId?, resource?: { type, id, version } }.
// Returns { decision: ALLOW | DENY | REQUIRES_APPROVAL, reasonCode, message, grant, approvalCode, approvalId }.
export async function authorizePosAction(client, c, request) {
  const item = BY_CODE.get(request.permission);
  if (!item) return deny(400, "That is not a POS action.", "POS_PERMISSION_CODE_INVALID");
  const authority = await cashierAuthority(client, c.organizationId, c.userId);
  if (!authority) return deny(403, "You have no cashier profile, so you cannot do this at a POS.", "POS_PERMISSION_PROFILE_MISSING");
  if (authority.user_status !== "active" || authority.membership_status !== "active") return deny(403, "Your workspace user is inactive.", "CASHIER_USER_INACTIVE");
  if (authority.status !== "active") return deny(403, `Cashier ${authority.code} is inactive.`, "CASHIER_INACTIVE");
  if (!authority.permission_profile_id) return deny(403, "You have no permission profile. Ask an administrator to assign one.", "POS_PERMISSION_PROFILE_MISSING");
  if (authority.profile_status !== "active") return deny(403, "Your permission profile is not active.", "POS_PERMISSION_PROFILE_INACTIVE");
  if (request.outletId) {
    const outlets = await accessiblePosStoreIds(client, { ...c, roleSlugs: [], permissions: [] });
    if (!outlets?.includes(request.outletId)) return deny(403, "You are not authorized to work at this outlet.", "POS_CASHIER_OUTLET_ACCESS_DENIED");
  }
  const grant = authority.grants.get(item.code);
  if (!grant?.enabled) return deny(403, `Your permission profile does not allow: ${item.label}.`, "POS_PERMISSION_DENIED", { permission: item.code });
  if (grant.requireReason && !text(request.reason)) return deny(400, `${item.label} needs a reason.`, "POS_REASON_REQUIRED", { permission: item.code });
  const exceeded = exceeds(grant, request);
  if (!exceeded) return { decision: "ALLOW", reasonCode: "POS_ALLOWED", grant, approvalId: null };
  if (!item.approval) return deny(403, `${item.label}: ${exceeded}.`, "POS_PERMISSION_LIMIT_EXCEEDED", { permission: item.code });
  if (request.approvalId) {
    const approval = await consumeApprovalAtomically(client, c, request.approvalId, { permission: item.code, approvalCode: item.approval, resource: request.resource,
      amount: request.amount, percentage: request.percentage });
    return { decision: "ALLOW", reasonCode: "POS_ALLOWED_BY_APPROVAL", grant, approvalId: approval.id };
  }
  return { decision: "REQUIRES_APPROVAL", status: 409, reasonCode: "POS_APPROVAL_REQUIRED", message: `${item.label} above your limit needs a supervisor's approval (${exceeded}).`,
    grant, approvalCode: item.approval, details: { permission: item.code, approvalCode: item.approval, amount: request.amount ?? null, percentage: request.percentage ?? null } };
}

// Which limit, if any, the request goes beyond (both the percentage and the amount must hold).
function exceeds(grant, request) {
  if (grant.limitMode !== "limited") return null;
  if (grant.maxPercentage !== null && request.percentage !== undefined && request.percentage !== null && dec(request.percentage) > dec(grant.maxPercentage))
    return `${formatDecimal(dec(request.percentage))}% is above your ${grant.maxPercentage}%`;
  if (grant.maxAmount !== null && request.amount !== undefined && request.amount !== null && dec(request.amount) > dec(grant.maxAmount))
    return `${formatDecimal(dec(request.amount))} is above your ${grant.maxAmount} ${grant.currency ?? ""}`.trim();
  return null;
}

// authorizePosAction, throwing for DENY and REQUIRES_APPROVAL with a stable code the screen can act on.
export async function assertPosAction(client, c, request) {
  const result = await authorizePosAction(client, c, request);
  if (result.decision === "ALLOW") return result;
  throw new PosPermissionError(result.status ?? 403, result.message, result.reasonCode, result.details);
}

// Check limits only (no consumption) — used to re-verify recorded discounts at checkout.
export function validatePermissionLimits(grant, request) {
  return exceeds(grant, request);
}

// ------------------------------------------------------------------ supervisor approvals

// Where an approval belongs: the session, outlet and terminal of the transaction it is for.
async function contextOfResource(client, c, resource) {
  const queries = {
    pos_cart: `SELECT cart.store_id, cart.terminal_id, cart.shift_id, cart.version FROM tenant.pos_carts cart WHERE cart.organization_id = $1 AND cart.id = $2`,
    pos_sale: `SELECT sale.store_id, sale.terminal_id, sale.shift_id, NULL::int AS version FROM tenant.pos_sales sale WHERE sale.organization_id = $1 AND sale.id = $2`,
    pos_shift: `SELECT shift.store_id, shift.terminal_id, shift.id AS shift_id, NULL::int AS version FROM tenant.pos_shifts shift WHERE shift.organization_id = $1 AND shift.id = $2`,
  };
  if (!queries[resource?.type]) throw new PosPermissionError(400, "Approvals are for a cart, a sale or a session.", "POS_ACTION_INVALID_FOR_TRANSACTION_STATE");
  const row = (await client.query(queries[resource.type], [c.organizationId, uuid(resource.id, "Transaction", "POS_ACTION_INVALID_FOR_TRANSACTION_STATE")])).rows[0];
  if (!row) throw new PosPermissionError(404, "That transaction was not found.", "POS_ACTION_INVALID_FOR_TRANSACTION_STATE");
  return row;
}

function toApproval(row) {
  return {
    id: row.id, status: row.status, permission: row.permission_code, permissionLabel: BY_CODE.get(row.permission_code)?.label ?? row.permission_code, approvalCode: row.approval_code,
    resourceType: row.resource_type, resourceId: row.resource_id, resourceVersion: row.resource_version, action: row.requested_action,
    amount: row.requested_amount === null ? null : Number(row.requested_amount), percentage: row.requested_percentage === null ? null : Number(row.requested_percentage),
    currency: row.currency_code?.trim() ?? null, reason: row.reason, requestedBy: row.requested_by_name ?? null, requestedById: row.requested_by, approver: row.approver_name ?? null,
    outlet: row.outlet_code ?? null, terminal: row.terminal_code ?? null, session: row.session_number ?? null, decisionNote: row.decision_note,
    requestedAt: row.requested_at, decidedAt: row.decided_at, consumedAt: row.consumed_at, expiresAt: row.expires_at,
  };
}

const APPROVAL_SELECT = `
  SELECT approval.*, requester.full_name AS requested_by_name, approver.full_name AS approver_name, store.code AS outlet_code, terminal.code AS terminal_code, shift.shift_number AS session_number
    FROM tenant.pos_permission_approvals approval
    JOIN public.users requester ON requester.id = approval.requested_by
    LEFT JOIN public.users approver ON approver.id = approval.approver_user_id
    LEFT JOIN tenant.pos_stores store ON store.organization_id = approval.organization_id AND store.id = approval.outlet_id
    LEFT JOIN tenant.pos_terminals terminal ON terminal.organization_id = approval.organization_id AND terminal.id = approval.terminal_id
    LEFT JOIN tenant.pos_shifts shift ON shift.organization_id = approval.organization_id AND shift.id = approval.session_id`;

// A cashier asks for an exception: the exact action, transaction (and its version), amount or percentage, and why. Only for an action their
// profile grants (an approval lifts a limit, not a missing permission). Idempotent on idempotencyKey.
// input: { permission, resource: { type, id }, amount?, percentage?, action?, reason, idempotencyKey? }.
export async function requestSupervisorApproval(client, c, input = {}) {
  const item = BY_CODE.get(String(input.permission ?? ""));
  if (!item?.approval) throw new PosPermissionError(400, "That action cannot be approved as an exception.", "POS_PERMISSION_CODE_INVALID");
  const reason = text(input.reason, 500);
  if (!reason) throw new PosPermissionError(400, "Say why the exception is needed.", "POS_REASON_REQUIRED");
  const key = text(input.idempotencyKey, 120);
  if (key) {
    const existing = (await client.query(`${APPROVAL_SELECT} WHERE approval.organization_id = $1 AND approval.requested_by = $2 AND approval.idempotency_key = $3`,
      [c.organizationId, c.userId, key])).rows[0];
    if (existing) return toApproval(existing);
  }
  const resource = await contextOfResource(client, c, input.resource);
  const authority = await cashierAuthority(client, c.organizationId, c.userId);
  const check = await authorizePosAction(client, c, { permission: item.code, outletId: resource.store_id, reason });
  if (check.decision === "DENY") throw new PosPermissionError(check.status ?? 403, check.message, check.reasonCode, check.details);
  const { rows } = await client.query(
    `INSERT INTO tenant.pos_permission_approvals (organization_id, outlet_id, terminal_id, session_id, cashier_id, requested_by, permission_code, approval_code, resource_type, resource_id,
       resource_version, requested_action, requested_amount, requested_percentage, currency_code, reason, expires_at, idempotency_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, now() + make_interval(mins => $17), $18) RETURNING id`,
    [c.organizationId, resource.store_id, resource.terminal_id, resource.shift_id, authority.id, c.userId, item.code, item.approval, input.resource.type, input.resource.id,
      resource.version ?? null, JSON.stringify(input.action ?? {}), input.amount === undefined || input.amount === null ? null : plain(input.amount),
      input.percentage === undefined || input.percentage === null ? null : plain(input.percentage), await baseCurrency(client, c.organizationId), reason, APPROVAL_MINUTES, key]);
  return getPosApproval(client, c, rows[0].id);
}

export async function getPosApproval(client, c, approvalId) {
  const row = (await client.query(`${APPROVAL_SELECT} WHERE approval.organization_id = $1 AND approval.id = $2`, [c.organizationId, uuid(approvalId, "Approval", "POS_APPROVAL_NOT_FOUND")])).rows[0];
  if (!row) throw new PosPermissionError(404, "Approval not found.", "POS_APPROVAL_NOT_FOUND");
  return toApproval(row);
}

// Pending approvals the caller could decide (or their own requests with mine=true), newest first. Expired ones are marked as such.
export async function listPosApprovals(client, c, { status = "pending", mine = false } = {}) {
  await client.query(`UPDATE tenant.pos_permission_approvals SET status = 'expired' WHERE organization_id = $1 AND status IN ('pending', 'approved') AND expires_at <= now()`, [c.organizationId]);
  const values = [c.organizationId];
  const where = ["approval.organization_id = $1"];
  if (["pending", "approved", "rejected", "consumed", "expired"].includes(status)) { values.push(status); where.push(`approval.status = $${values.length}`); }
  if (mine) { values.push(c.userId); where.push(`approval.requested_by = $${values.length}`); }
  const outlets = await accessiblePosStoreIds(client, c);
  if (outlets && !mine) { values.push(outlets); where.push(`approval.outlet_id = ANY($${values.length}::uuid[])`); }
  const { rows } = await client.query(`${APPROVAL_SELECT} WHERE ${where.join(" AND ")} ORDER BY approval.requested_at DESC LIMIT 200`, values);
  return rows.map(toApproval);
}

// A supervisor approves: someone other than the requester, an active cashier whose active profile holds the approval grant, whose own limit
// covers the request, working at that outlet; the request still pending and unexpired.
export async function approvePosException(client, c, approvalId, input = {}) {
  const row = (await client.query(`SELECT * FROM tenant.pos_permission_approvals WHERE organization_id = $1 AND id = $2 FOR UPDATE`,
    [c.organizationId, uuid(approvalId, "Approval", "POS_APPROVAL_NOT_FOUND")])).rows[0];
  if (!row) throw new PosPermissionError(404, "Approval not found.", "POS_APPROVAL_NOT_FOUND");
  if (row.requested_by === c.userId) throw new PosPermissionError(403, "You cannot approve your own exception.", "POS_SELF_APPROVAL_NOT_ALLOWED");
  if (row.status !== "pending") throw new PosPermissionError(409, `This request is already ${row.status}.`, row.status === "consumed" ? "POS_APPROVAL_ALREADY_CONSUMED" : "POS_APPROVAL_NOT_PENDING");
  if (new Date(row.expires_at) <= new Date()) {
    await client.query(`UPDATE tenant.pos_permission_approvals SET status = 'expired' WHERE organization_id = $1 AND id = $2`, [c.organizationId, row.id]);
    throw new PosPermissionError(409, "This request has expired. Ask the cashier to request it again.", "POS_APPROVAL_EXPIRED");
  }
  const check = await authorizePosAction(client, c, { permission: row.approval_code, outletId: row.outlet_id, amount: row.requested_amount, percentage: row.requested_percentage });
  if (check.decision !== "ALLOW") throw new PosPermissionError(403, check.reasonCode === "POS_PERMISSION_DENIED" || check.reasonCode === "POS_PERMISSION_LIMIT_EXCEEDED"
    ? `You are not authorized to approve this exception${check.reasonCode === "POS_PERMISSION_LIMIT_EXCEEDED" ? " (it is above your own approval limit)" : ""}.` : check.message, "POS_APPROVER_NOT_AUTHORIZED");
  await client.query(`UPDATE tenant.pos_permission_approvals SET status = 'approved', approver_user_id = $3, decided_at = now(), decision_note = $4 WHERE organization_id = $1 AND id = $2`,
    [c.organizationId, row.id, c.userId, text(input.note, 500)]);
  return getPosApproval(client, c, row.id);
}

export async function rejectPosException(client, c, approvalId, input = {}) {
  const row = (await client.query(`SELECT * FROM tenant.pos_permission_approvals WHERE organization_id = $1 AND id = $2 FOR UPDATE`,
    [c.organizationId, uuid(approvalId, "Approval", "POS_APPROVAL_NOT_FOUND")])).rows[0];
  if (!row) throw new PosPermissionError(404, "Approval not found.", "POS_APPROVAL_NOT_FOUND");
  if (row.requested_by === c.userId) throw new PosPermissionError(403, "You cannot decide your own exception.", "POS_SELF_APPROVAL_NOT_ALLOWED");
  if (row.status !== "pending") throw new PosPermissionError(409, `This request is already ${row.status}.`, "POS_APPROVAL_NOT_PENDING");
  const check = await authorizePosAction(client, c, { permission: row.approval_code, outletId: row.outlet_id });
  if (check.decision === "DENY" && check.reasonCode !== "POS_PERMISSION_LIMIT_EXCEEDED") throw new PosPermissionError(403, "You are not authorized to decide this exception.", "POS_APPROVER_NOT_AUTHORIZED");
  await client.query(`UPDATE tenant.pos_permission_approvals SET status = 'rejected', approver_user_id = $3, decided_at = now(), decision_note = $4 WHERE organization_id = $1 AND id = $2`,
    [c.organizationId, row.id, c.userId, text(input.note, 500)]);
  return getPosApproval(client, c, row.id);
}

// Is this approval good for exactly this action? Requested by the caller, approved, unexpired, unused, for this permission and transaction,
// the transaction unchanged since the request, and the amount and percentage within what was approved.
export async function validateApproval(client, c, approvalId, { permission, approvalCode, resource, amount, percentage }) {
  const row = (await client.query(`SELECT * FROM tenant.pos_permission_approvals WHERE organization_id = $1 AND id = $2`,
    [c.organizationId, uuid(approvalId, "Approval", "POS_APPROVAL_NOT_FOUND")])).rows[0];
  if (!row) throw new PosPermissionError(404, "Approval not found.", "POS_APPROVAL_NOT_FOUND");
  if (row.requested_by !== c.userId) throw new PosPermissionError(403, "This approval was given to someone else.", "POS_APPROVER_NOT_AUTHORIZED");
  if (row.status === "consumed") throw new PosPermissionError(409, "This approval has already been used.", "POS_APPROVAL_ALREADY_CONSUMED");
  if (row.status !== "approved") throw new PosPermissionError(409, `This approval is ${row.status}.`, row.status === "expired" ? "POS_APPROVAL_EXPIRED" : "POS_APPROVAL_REQUIRED");
  if (new Date(row.expires_at) <= new Date()) throw new PosPermissionError(409, "This approval has expired. Request it again.", "POS_APPROVAL_EXPIRED");
  if (row.permission_code !== permission || row.approval_code !== approvalCode) throw new PosPermissionError(409, "This approval is for a different action.", "POS_APPROVAL_TRANSACTION_CHANGED");
  if (resource && (row.resource_type !== resource.type || row.resource_id !== resource.id)) throw new PosPermissionError(409, "This approval is for a different transaction.", "POS_APPROVAL_TRANSACTION_CHANGED");
  if (resource?.version !== undefined && resource.version !== null && row.resource_version !== null && Number(row.resource_version) !== Number(resource.version))
    throw new PosPermissionError(409, "The sale changed after the approval. Request it again.", "POS_APPROVAL_TRANSACTION_CHANGED");
  if (amount !== undefined && amount !== null && row.requested_amount !== null && dec(amount) > dec(row.requested_amount))
    throw new PosPermissionError(409, "The amount is above what was approved.", "POS_APPROVAL_TRANSACTION_CHANGED");
  if (percentage !== undefined && percentage !== null && row.requested_percentage !== null && dec(percentage) > dec(row.requested_percentage))
    throw new PosPermissionError(409, "The percentage is above what was approved.", "POS_APPROVAL_TRANSACTION_CHANGED");
  return row;
}

// Validate and use the approval once: the UPDATE only succeeds for the first caller, so two attempts can never both use it.
export async function consumeApprovalAtomically(client, c, approvalId, expectation) {
  const row = await validateApproval(client, c, approvalId, expectation);
  const consumed = (await client.query(
    `UPDATE tenant.pos_permission_approvals SET status = 'consumed', consumed_at = now() WHERE organization_id = $1 AND id = $2 AND status = 'approved' AND expires_at > now() RETURNING *`,
    [c.organizationId, row.id])).rows[0];
  if (!consumed) throw new PosPermissionError(409, "This approval has already been used.", "POS_APPROVAL_ALREADY_CONSUMED");
  return consumed;
}

// Total of all manual discounts on a cart (lines and order), for the per-sale amount cap.
export function sumAmounts(values) {
  return values.reduce((total, value) => add(total, dec(value)), decimal(0));
}

// ------------------------------------------------------------------ catalogue for screens

export function getCashierPermissionCatalogue() {
  return { permissions: CASHIER_PERMISSION_CATALOGUE, areas: PERMISSION_AREAS };
}
