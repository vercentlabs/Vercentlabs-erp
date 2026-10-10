// Cashiers: the POS profile over an existing workspace user (tenant.pos_cashiers) — the person accountable for POS sessions and
// transactions. Authentication stays with the user, employment with HR, authorization with roles and permissions; a cashier holds only
// POS facts: a code, Active / Inactive, where they may work (pos_cashier_outlets), a default outlet, an optional display name and HR link.
//
// - Operating needs all of: an active cashier profile, an active workspace membership, access to the outlet, a POS operating permission,
//   and the terminal rules (active terminal at an active outlet, one session per terminal). A cashier owns one open session at a time
//   (pos_cashier_open_shift_uidx). The current outlet, terminal, session, sales and cash are read from sessions and transactions.
// - A cashier with an open session cannot be deactivated or lose that outlet; a used cashier keeps its code and user and is never deleted.
import { POS_CASHIER_PERMISSIONS as P } from "@vercentlabs/permissions";

import { CASHIER_PERMISSION_CATALOGUE, assignPermissionProfile } from "../permissions/index.js";

export class PosCashierError extends Error {
  constructor(status, message, code = "POS_CASHIER_ERROR", details = undefined) {
    super(message);
    this.name = "PosCashierError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const CODE = /^[A-Z0-9][A-Z0-9._/-]{0,29}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OPEN_SESSION = "('open', 'closing')";
const BYPASS_ROLES = ["organization_owner", "system_administrator"];
const can = (c, permission) => Boolean(c.roleSlugs?.some((slug) => BYPASS_ROLES.includes(slug)) || c.permissions?.includes(permission));
const require = (c, permission, message) => { if (!can(c, permission)) throw new PosCashierError(403, message, "PERMISSION_DENIED"); };
const text = (value, max = 500) => { const out = String(value ?? "").trim().replace(/\s+/g, " "); return out ? out.slice(0, max) : null; };
const has = (input, key) => Object.prototype.hasOwnProperty.call(input ?? {}, key);
const issue = (field, message, code = "POS_CASHIER_VALIDATION", status = 400) => new PosCashierError(status, message, code, { issues: [{ field, message }] });
const uuid = (value, label, code = "POS_CASHIER_VALIDATION") => { const id = String(value ?? "").trim(); if (!UUID.test(id)) throw new PosCashierError(400, `${label} is not valid.`, code); return id; };
const optionalId = (value, label) => (value === null || value === undefined || value === "" ? null : uuid(value, label));
const n = (value) => Number(value ?? 0);
const round = (value) => Math.round(Number(value ?? 0) * 1e6) / 1e6;
const label = (code, name) => (code ? `${code} · ${name}` : null);
export const normalizeCashierCode = (value) => String(value ?? "").normalize("NFKC").trim().toUpperCase();

async function history(client, c, cashierId, eventType, summary, changes = {}, reason = null) {
  await client.query(
    `INSERT INTO tenant.pos_cashier_history (organization_id, cashier_id, event_type, summary, changes, reason, actor_user_id) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [c.organizationId, cashierId, eventType, String(summary).slice(0, 500), JSON.stringify(changes), reason, c.userId ?? null]);
}

export function cashierCapabilities(c) {
  return Object.fromEntries(Object.entries(P).map(([name, permission]) => [name, can(c, permission)]));
}

// What a user may do at a POS: their cashier profile's permission profile (Cashier Permissions) — it can operate only while that profile is
// active and grants POS access — plus their POS roles, shown for information.
async function userAuthority(client, organizationId, userId) {
  const roles = (await client.query(
    `SELECT COALESCE(array_agg(DISTINCT role.name) FILTER (WHERE role.module_key = 'point-of-sale'), ARRAY[]::text[]) AS pos_roles
       FROM public.user_role_assignments assignment JOIN public.roles role ON role.id = assignment.role_id AND role.status = 'active'
      WHERE assignment.organization_id = $1 AND assignment.user_id = $2 AND assignment.status = 'active'
        AND assignment.starts_at <= now() AND (assignment.expires_at IS NULL OR assignment.expires_at > now())`, [organizationId, userId])).rows[0];
  const profile = (await client.query(
    `SELECT profile.id, profile.code, profile.name, profile.status,
            COALESCE((SELECT array_agg(grant_row.permission_code) FROM tenant.pos_permission_profile_grants grant_row
                       WHERE grant_row.organization_id = profile.organization_id AND grant_row.profile_id = profile.id AND grant_row.enabled), ARRAY[]::text[]) AS granted
       FROM tenant.pos_cashiers cashier JOIN tenant.pos_permission_profiles profile ON profile.organization_id = cashier.organization_id AND profile.id = cashier.permission_profile_id
      WHERE cashier.organization_id = $1 AND cashier.user_id = $2`, [organizationId, userId])).rows[0] ?? null;
  const granted = profile?.status === "active" ? profile.granted : [];
  return {
    canOperate: granted.includes("POS_ACCESS"), posRoles: roles?.pos_roles ?? [],
    profileId: profile?.id ?? null, profileName: profile?.name ?? null, profileStatus: profile?.status ?? null,
    abilities: CASHIER_PERMISSION_CATALOGUE.map((item) => ({ key: item.code, label: item.label, area: item.area, allowed: granted.includes(item.code) })),
  };
}

// ------------------------------------------------------------------ reading

const SELECT = `
  SELECT cashier.*, users.full_name, users.email, users.status AS user_status, membership.status AS membership_status,
         employee.employee_number, outlet.code AS default_outlet_code, outlet.name AS default_outlet_name,
         COALESCE((SELECT array_agg(access.store_id ORDER BY store.name) FROM tenant.pos_cashier_outlets access
                    JOIN tenant.pos_stores store ON store.organization_id = access.organization_id AND store.id = access.store_id
                   WHERE access.organization_id = cashier.organization_id AND access.cashier_id = cashier.id), ARRAY[]::uuid[]) AS outlet_ids,
         COALESCE((SELECT array_agg(store.code ORDER BY store.name) FROM tenant.pos_cashier_outlets access
                    JOIN tenant.pos_stores store ON store.organization_id = access.organization_id AND store.id = access.store_id
                   WHERE access.organization_id = cashier.organization_id AND access.cashier_id = cashier.id), ARRAY[]::text[]) AS outlet_codes,
         session.id AS session_id, session.shift_number AS session_number, session.opened_at AS session_opened_at, session.store_id AS session_outlet_id,
         session_outlet.code AS session_outlet_code, session_outlet.name AS session_outlet_name, session_outlet.timezone AS session_timezone,
         session_terminal.id AS session_terminal_id, session_terminal.code AS session_terminal_code, session_terminal.name AS session_terminal_name,
         (SELECT min(shift.opened_at) FROM tenant.pos_shifts shift WHERE shift.organization_id = cashier.organization_id AND shift.cashier_user_id = cashier.user_id) AS first_used_at,
         GREATEST((SELECT max(GREATEST(shift.opened_at, shift.closed_at)) FROM tenant.pos_shifts shift WHERE shift.organization_id = cashier.organization_id AND shift.cashier_user_id = cashier.user_id),
                  (SELECT max(sale.completed_at) FROM tenant.pos_sales sale WHERE sale.organization_id = cashier.organization_id AND sale.cashier_id = cashier.id)) AS last_activity
    FROM tenant.pos_cashiers cashier
    JOIN public.users users ON users.id = cashier.user_id
    LEFT JOIN public.organization_memberships membership ON membership.organization_id = cashier.organization_id AND membership.user_id = cashier.user_id
    LEFT JOIN tenant.hr_employees employee ON employee.organization_id = cashier.organization_id AND employee.id = cashier.employee_id
    LEFT JOIN tenant.pos_stores outlet ON outlet.organization_id = cashier.organization_id AND outlet.id = cashier.default_outlet_id
    LEFT JOIN LATERAL (SELECT * FROM tenant.pos_shifts open_shift WHERE open_shift.organization_id = cashier.organization_id AND open_shift.cashier_user_id = cashier.user_id
                        AND open_shift.status IN ${OPEN_SESSION} ORDER BY open_shift.opened_at DESC NULLS LAST LIMIT 1) session ON true
    LEFT JOIN tenant.pos_stores session_outlet ON session_outlet.organization_id = cashier.organization_id AND session_outlet.id = session.store_id
    LEFT JOIN tenant.pos_terminals session_terminal ON session_terminal.organization_id = cashier.organization_id AND session_terminal.id = session.terminal_id`;

function toCashier(row) {
  const userActive = row.user_status === "active" && row.membership_status === "active";
  return {
    id: row.id, code: row.code, userId: row.user_id, name: row.display_name || row.full_name, fullName: row.full_name, displayName: row.display_name, email: row.email,
    userActive, employeeId: row.employee_id, employeeNumber: row.employee_number ?? null, status: row.status, isActive: row.status === "active",
    // Usable only while the profile and the workspace user are both active.
    operable: row.status === "active" && userActive,
    operationalState: row.session_id ? "session_open" : row.status === "active" && userActive ? "available" : "inactive",
    defaultOutletId: row.default_outlet_id, defaultOutlet: label(row.default_outlet_code, row.default_outlet_name), outletIds: row.outlet_ids, outlets: row.outlet_codes,
    currentSessionId: row.session_id ?? null, currentSession: row.session_number ?? null, currentOutletId: row.session_outlet_id ?? null,
    currentOutlet: label(row.session_outlet_code, row.session_outlet_name), currentTerminalId: row.session_terminal_id ?? null,
    currentTerminal: label(row.session_terminal_code, row.session_terminal_name), sessionOpenedAt: row.session_opened_at ?? null,
    businessDate: row.session_opened_at ? new Intl.DateTimeFormat("en-CA", { timeZone: row.session_timezone || "Asia/Kolkata" }).format(new Date(row.session_opened_at)) : null,
    notes: row.notes, used: Boolean(row.first_used_at), firstUsedAt: row.first_used_at ?? null, lastActivity: row.last_activity ?? null,
    version: n(row.version || 1), createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

// Cashiers the person may see: cashier administrators see all; anyone else with View Cashiers sees those sharing an outlet with them.
async function visibleOutletIds(client, c) {
  if (c.roleSlugs?.some((slug) => BYPASS_ROLES.includes(slug))) return null;
  if (["pos.store.manage", "pos.settings.manage", P.create, P.edit, P.assignOutlets].some((permission) => c.permissions?.includes(permission))) return null;
  const { rows } = await client.query(
    `SELECT access.store_id FROM tenant.pos_cashier_outlets access JOIN tenant.pos_cashiers cashier ON cashier.organization_id = access.organization_id AND cashier.id = access.cashier_id
      WHERE access.organization_id = $1 AND cashier.user_id = $2`, [c.organizationId, c.userId ?? null]);
  return rows.map((row) => row.store_id);
}

// filters: view (all | active | inactive | on_shift), search (name, code, email, employee number), outletId, status, role (POS role name), profileId.
export async function listCashiers(client, c, filters = {}) {
  require(c, P.view, "You do not have permission to view cashiers.");
  const values = [c.organizationId];
  const bind = (value) => { values.push(value); return `$${values.length}`; };
  const where = ["cashier.organization_id = $1"];
  const view = filters.view ?? "all";
  if (view === "active" || filters.status === "active") where.push("cashier.status = 'active'");
  if (view === "inactive" || filters.status === "inactive") where.push("cashier.status = 'inactive'");
  if (view === "on_shift") where.push("session.id IS NOT NULL");
  if (filters.outletId && UUID.test(filters.outletId))
    where.push(`EXISTS (SELECT 1 FROM tenant.pos_cashier_outlets access WHERE access.organization_id = cashier.organization_id AND access.cashier_id = cashier.id AND access.store_id = ${bind(filters.outletId)})`);
  const term = text(filters.search);
  if (term) where.push(`lower(concat_ws(' ', cashier.code, cashier.display_name, users.full_name, users.email, employee.employee_number)) LIKE ${bind(`%${term.toLowerCase()}%`)}`);
  const visible = await visibleOutletIds(client, c);
  if (visible) where.push(`(cashier.user_id = ${bind(c.userId ?? null)} OR EXISTS (SELECT 1 FROM tenant.pos_cashier_outlets access WHERE access.organization_id = cashier.organization_id
    AND access.cashier_id = cashier.id AND access.store_id = ANY(${bind(visible)}::uuid[])))`);
  const { rows } = await client.query(`${SELECT} WHERE ${where.join(" AND ")} ORDER BY cashier.status, lower(COALESCE(cashier.display_name, users.full_name))`, values);
  const cashiers = [];
  for (const row of rows) {
    const authority = await userAuthority(client, c.organizationId, row.user_id);
    if (filters.role && !authority.posRoles.includes(filters.role)) continue;
    if (filters.profileId && authority.profileId !== filters.profileId) continue;
    cashiers.push({ ...toCashier(row), posRoles: authority.posRoles, canOperate: authority.canOperate, profileId: authority.profileId, profileName: authority.profileName });
  }
  return { cashiers, capabilities: cashierCapabilities(c) };
}

async function loadCashier(client, c, cashierId, { lock = false } = {}) {
  const id = uuid(cashierId, "Cashier", "CASHIER_NOT_FOUND");
  if (lock) await client.query(`SELECT id FROM tenant.pos_cashiers WHERE organization_id = $1 AND id = $2 FOR UPDATE`, [c.organizationId, id]);
  const row = (await client.query(`${SELECT} WHERE cashier.organization_id = $1 AND cashier.id = $2`, [c.organizationId, id])).rows[0];
  if (!row) throw new PosCashierError(404, "Cashier not found.", "CASHIER_NOT_FOUND");
  return row;
}

async function assertVisible(client, c, row) {
  const visible = await visibleOutletIds(client, c);
  if (visible && row.user_id !== c.userId && !row.outlet_ids.some((id) => visible.includes(id))) throw new PosCashierError(404, "Cashier not found.", "CASHIER_NOT_FOUND");
}

// The cashier with their outlets, what their roles let them do at a POS, and the setup check.
export async function getCashier(client, c, cashierId) {
  require(c, P.view, "You do not have permission to view cashiers.");
  const row = await loadCashier(client, c, cashierId);
  await assertVisible(client, c, row);
  const authority = await userAuthority(client, c.organizationId, row.user_id);
  return { ...toCashier(row), ...authority, outletAccess: await outletAccessOf(client, c, row), setup: await setupIssues(client, c, row, authority),
    capabilities: cashierCapabilities(c) };
}

async function outletAccessOf(client, c, row) {
  const { rows } = await client.query(
    `SELECT store.id, store.code, store.name, store.active, access.granted_at, granter.full_name AS granted_by_name
       FROM tenant.pos_cashier_outlets access JOIN tenant.pos_stores store ON store.organization_id = access.organization_id AND store.id = access.store_id
       LEFT JOIN public.users granter ON granter.id = access.granted_by
      WHERE access.organization_id = $1 AND access.cashier_id = $2 ORDER BY lower(store.name)`, [c.organizationId, row.id]);
  return rows.map((outlet) => ({ outletId: outlet.id, outlet: label(outlet.code, outlet.name), outletActive: outlet.active, isDefault: outlet.id === row.default_outlet_id,
    inSession: outlet.id === row.session_outlet_id, grantedAt: outlet.granted_at, grantedBy: outlet.granted_by_name }));
}

// ------------------------------------------------------------------ writing

async function memberOrFail(client, c, userId) {
  if (!userId) throw issue("userId", "Choose the workspace user this cashier is.", "CASHIER_USER_REQUIRED");
  const id = uuid(userId, "User");
  const member = (await client.query(
    `SELECT membership.status, users.status AS user_status FROM public.organization_memberships membership JOIN public.users users ON users.id = membership.user_id
      WHERE membership.organization_id = $1 AND membership.user_id = $2`, [c.organizationId, id])).rows[0];
  if (!member) throw issue("userId", "Choose a member of this workspace.", "CASHIER_COMPANY_MISMATCH");
  if (member.status !== "active" || member.user_status !== "active") throw issue("userId", "This user is inactive. Choose an active member of the workspace.", "CASHIER_USER_INACTIVE");
  return id;
}

async function checkCode(client, c, code, exceptId = null) {
  if (!CODE.test(code)) throw issue("code", "Use up to 30 letters, numbers, dots, dashes or slashes, such as CSH-014.");
  const clash = (await client.query(
    `SELECT COALESCE(cashier.display_name, users.full_name) AS name FROM tenant.pos_cashiers cashier JOIN public.users users ON users.id = cashier.user_id
      WHERE cashier.organization_id = $1 AND upper(btrim(cashier.code)) = $2 AND ($3::uuid IS NULL OR cashier.id <> $3)`, [c.organizationId, code, exceptId])).rows[0];
  if (clash) throw issue("code", `${code} is already the code of ${clash.name}.`, "CASHIER_CODE_EXISTS", 409);
}

// The next free CSH-nnn code.
async function nextCode(client, c) {
  const { rows } = await client.query(`SELECT COALESCE(max(substring(code FROM '^CSH-([0-9]+)$')::int), 0) AS last FROM tenant.pos_cashiers WHERE organization_id = $1`, [c.organizationId]);
  return `CSH-${String(n(rows[0].last) + 1).padStart(3, "0")}`;
}

async function checkEmployee(client, c, employeeId, userId) {
  const id = optionalId(employeeId, "Employee");
  if (!id) return null;
  const employee = (await client.query(`SELECT user_id FROM tenant.hr_employees WHERE organization_id = $1 AND id = $2`, [c.organizationId, id])).rows[0];
  if (!employee) throw issue("employeeId", "Choose an employee of the company.");
  if (employee.user_id && employee.user_id !== userId) throw issue("employeeId", "This employee belongs to another user.");
  return id;
}

async function checkOutlets(client, c, outletIds) {
  const ids = [...new Set((Array.isArray(outletIds) ? outletIds : []).map((id) => uuid(id, "Outlet")))];
  if (!ids.length) return [];
  const { rows } = await client.query(`SELECT id FROM tenant.pos_stores WHERE organization_id = $1 AND id = ANY($2::uuid[])`, [c.organizationId, ids]);
  if (rows.length !== ids.length) throw issue("outletIds", "Choose outlets of the company.", "CASHIER_COMPANY_MISMATCH");
  return ids;
}

async function guarded(client, run) {
  await client.query("SAVEPOINT cashier_write");
  try { const result = await run(); await client.query("RELEASE SAVEPOINT cashier_write"); return result; } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT cashier_write");
    if (error?.code === "23505" && /code/.test(error.constraint ?? "")) throw issue("code", "Another cashier with this code was just saved. Reload and try again.", "CASHIER_CODE_EXISTS", 409);
    if (error?.code === "23505" && /user/.test(error.constraint ?? "")) throw issue("userId", "This user already has a cashier profile.", "CASHIER_EXISTS", 409);
    if (error?.code === "23514" && error.constraint === "pos_cashiers_default_outlet_allowed") throw issue("defaultOutletId", error.message, "DEFAULT_OUTLET_NOT_ALLOWED", 409);
    throw error;
  }
}

async function usedBy(client, c, row) {
  const used = [];
  for (const [what, sql] of [
    ["sessions", `SELECT 1 FROM tenant.pos_shifts WHERE organization_id = $1 AND (cashier_id = $2 OR cashier_user_id = $3) LIMIT 1`],
    ["sales", `SELECT 1 FROM tenant.pos_sales sale WHERE sale.organization_id = $1 AND (sale.cashier_id = $2 OR EXISTS (SELECT 1 FROM tenant.pos_shifts shift
      WHERE shift.organization_id = sale.organization_id AND shift.id = sale.shift_id AND shift.cashier_user_id = $3)) LIMIT 1`],
    ["returns", `SELECT 1 FROM tenant.pos_returns WHERE organization_id = $1 AND (cashier_id = $2 OR requested_by = $3) LIMIT 1`],
  ]) if ((await client.query(sql, [c.organizationId, row.id, row.user_id])).rows[0]) used.push(what);
  return used;
}

// input: { userId, code (default the next CSH-nnn), displayName, employeeId, outletIds, defaultOutletId, permissionProfileId, notes, activate }. Saved Inactive
// unless activate is true and the setup is complete.
export async function createCashier(client, c, input = {}) {
  require(c, P.create, "You do not have permission to create cashiers.");
  const userId = await memberOrFail(client, c, input.userId);
  if ((await client.query(`SELECT 1 FROM tenant.pos_cashiers WHERE organization_id = $1 AND user_id = $2`, [c.organizationId, userId])).rows[0])
    throw issue("userId", "This user already has a cashier profile. Add outlets to it instead.", "CASHIER_EXISTS", 409);
  const code = text(input.code) ? normalizeCashierCode(input.code) : await nextCode(client, c);
  await checkCode(client, c, code);
  const employeeId = await checkEmployee(client, c, input.employeeId, userId);
  if (has(input, "outletIds") && (input.outletIds ?? []).length) require(c, P.assignOutlets, "You do not have permission to assign cashier outlets.");
  const outletIds = await checkOutlets(client, c, input.outletIds);
  const defaultOutletId = optionalId(input.defaultOutletId, "Default outlet");
  if (defaultOutletId && !outletIds.includes(defaultOutletId)) throw issue("defaultOutletId", "The default outlet must be one of the cashier's outlets.", "DEFAULT_OUTLET_NOT_ALLOWED");
  const id = await guarded(client, async () => (await client.query(
    `INSERT INTO tenant.pos_cashiers (organization_id, user_id, employee_id, code, display_name, notes, status, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, 'inactive', $7, $7) RETURNING id`,
    [c.organizationId, userId, employeeId, code, text(input.displayName, 60), text(input.notes, 2000), c.userId ?? null])).rows[0].id);
  for (const outletId of outletIds)
    await client.query(`INSERT INTO tenant.pos_cashier_outlets (organization_id, cashier_id, store_id, granted_by) VALUES ($1, $2, $3, $4)`, [c.organizationId, id, outletId, c.userId ?? null]);
  if (defaultOutletId) await client.query(`UPDATE tenant.pos_cashiers SET default_outlet_id = $3 WHERE organization_id = $1 AND id = $2`, [c.organizationId, id, defaultOutletId]);
  if (input.permissionProfileId) await assignPermissionProfile(client, c, id, input.permissionProfileId);
  await history(client, c, id, "created", `Cashier ${code} created (inactive until activated)`, { code, outlets: outletIds.length });
  if (input.activate === true) return setCashierStatus(client, c, id, "active");
  return getCashier(client, c, id);
}

// input: displayName, notes, employeeId, defaultOutletId, code and userId (only while unused), expectedVersion, reason.
export async function updateCashier(client, c, cashierId, input = {}) {
  require(c, P.view, "You do not have permission to view cashiers.");
  const row = await loadCashier(client, c, cashierId, { lock: true });
  if (has(input, "expectedVersion") && input.expectedVersion !== null && input.expectedVersion !== undefined && Number(input.expectedVersion) !== Number(row.version))
    throw new PosCashierError(409, "Someone else changed this cashier after you opened it. Reload it.", "POS_CASHIER_VERSION_CONFLICT");
  const code = has(input, "code") ? normalizeCashierCode(input.code) : row.code;
  const userId = has(input, "userId") && input.userId ? uuid(input.userId, "User") : row.user_id;
  // A used cashier keeps its code and its user: receipts and reports identify the person by them.
  if (code !== row.code || userId !== row.user_id) {
    const used = await usedBy(client, c, row);
    if (used.length && userId !== row.user_id) throw issue("userId", `Cashier ${row.code} has ${used.join(", ")}, so it stays linked to ${row.full_name}.`, "CASHIER_USER_FIXED", 409);
    if (used.length) throw issue("code", `Cashier ${row.code} has ${used.join(", ")}, so its code stays.`, "CASHIER_CODE_FIXED", 409);
    if (code !== row.code) await checkCode(client, c, code, row.id);
    if (userId !== row.user_id) {
      await memberOrFail(client, c, userId);
      if ((await client.query(`SELECT 1 FROM tenant.pos_cashiers WHERE organization_id = $1 AND user_id = $2 AND id <> $3`, [c.organizationId, userId, row.id])).rows[0])
        throw issue("userId", "This user already has a cashier profile.", "CASHIER_EXISTS", 409);
    }
  }
  const next = {
    code, user_id: userId, display_name: has(input, "displayName") ? text(input.displayName, 60) : row.display_name, notes: has(input, "notes") ? text(input.notes, 2000) : row.notes,
    employee_id: has(input, "employeeId") ? await checkEmployee(client, c, input.employeeId, userId) : row.employee_id,
    default_outlet_id: has(input, "defaultOutletId") ? optionalId(input.defaultOutletId, "Default outlet") : row.default_outlet_id,
  };
  if (next.default_outlet_id && !row.outlet_ids.includes(next.default_outlet_id))
    throw issue("defaultOutletId", "The default outlet must be one of the cashier's outlets.", "DEFAULT_OUTLET_NOT_ALLOWED");
  const changed = Object.keys(next).filter((column) => String(next[column] ?? "") !== String(row[column] ?? ""));
  if (!changed.length) return getCashier(client, c, row.id);
  require(c, changed.every((column) => column === "default_outlet_id") ? P.assignOutlets : P.edit, "You do not have permission to edit cashiers.");
  await guarded(client, () => client.query(
    `UPDATE tenant.pos_cashiers SET ${changed.map((column, index) => `${column} = $${index + 3}`).join(", ")}, version = version + 1, updated_by = $${changed.length + 3}, updated_at = now()
      WHERE organization_id = $1 AND id = $2`, [c.organizationId, row.id, ...changed.map((column) => next[column]), c.userId ?? null]));
  const diff = (columns) => Object.fromEntries(columns.filter((column) => changed.includes(column)).map((column) => [column, { from: row[column] ?? null, to: next[column] ?? null }]));
  const reason = text(input.reason, 300);
  if (changed.includes("code")) await history(client, c, row.id, "code_changed", `Code changed from ${row.code} to ${code} (before first use)`, diff(["code"]), reason);
  if (changed.includes("user_id")) await history(client, c, row.id, "user_changed", "Linked user corrected (before first use)", diff(["user_id"]), reason);
  if (changed.includes("default_outlet_id")) await history(client, c, row.id, "default_outlet_changed", "Default outlet changed (only what Open POS preselects)", diff(["default_outlet_id"]), reason);
  const other = changed.filter((column) => !["code", "user_id", "default_outlet_id"].includes(column));
  if (other.length) await history(client, c, row.id, "updated", `${other.map((column) => column.replace(/_id$/, "").replace(/_/g, " ")).join(", ")} changed`, diff(other), reason);
  return getCashier(client, c, row.id);
}

// outletIds: the whole list of outlets the cashier may work at. The outlet of their open session cannot be removed; a removed default is cleared.
export async function setCashierOutlets(client, c, cashierId, outletIds = [], { defaultOutletId } = {}) {
  require(c, P.assignOutlets, "You do not have permission to assign cashier outlets.");
  const row = await loadCashier(client, c, cashierId, { lock: true });
  const ids = await checkOutlets(client, c, outletIds);
  const removed = row.outlet_ids.filter((id) => !ids.includes(id));
  const added = ids.filter((id) => !row.outlet_ids.includes(id));
  if (row.session_outlet_id && removed.includes(row.session_outlet_id))
    throw new PosCashierError(409, `${row.code} has an open session at ${row.session_outlet_code}. Close it before removing that outlet.`, "CASHIER_OUTLET_REMOVAL_BLOCKED");
  const nextDefault = defaultOutletId === undefined ? (removed.includes(row.default_outlet_id) ? null : row.default_outlet_id) : optionalId(defaultOutletId, "Default outlet");
  if (nextDefault && !ids.includes(nextDefault)) throw issue("defaultOutletId", "The default outlet must be one of the cashier's outlets.", "DEFAULT_OUTLET_NOT_ALLOWED");
  if (row.default_outlet_id !== nextDefault && removed.includes(row.default_outlet_id))
    await client.query(`UPDATE tenant.pos_cashiers SET default_outlet_id = NULL WHERE organization_id = $1 AND id = $2`, [c.organizationId, row.id]);
  if (removed.length) await client.query(`DELETE FROM tenant.pos_cashier_outlets WHERE organization_id = $1 AND cashier_id = $2 AND store_id = ANY($3::uuid[])`, [c.organizationId, row.id, removed]);
  for (const outletId of added)
    await client.query(`INSERT INTO tenant.pos_cashier_outlets (organization_id, cashier_id, store_id, granted_by) VALUES ($1, $2, $3, $4)`, [c.organizationId, row.id, outletId, c.userId ?? null]);
  if ((nextDefault ?? null) !== (row.default_outlet_id ?? null))
    await client.query(`UPDATE tenant.pos_cashiers SET default_outlet_id = $3 WHERE organization_id = $1 AND id = $2`, [c.organizationId, row.id, nextDefault]);
  if (added.length || removed.length || (nextDefault ?? null) !== (row.default_outlet_id ?? null))
    await client.query(`UPDATE tenant.pos_cashiers SET version = version + 1, updated_by = $3, updated_at = now() WHERE organization_id = $1 AND id = $2`, [c.organizationId, row.id, c.userId ?? null]);
  const codes = async (list) => (list.length ? (await client.query(`SELECT code FROM tenant.pos_stores WHERE organization_id = $1 AND id = ANY($2::uuid[]) ORDER BY code`, [c.organizationId, list])).rows.map((outlet) => outlet.code) : []);
  if (added.length) await history(client, c, row.id, "outlet_added", `Outlet access added: ${(await codes(added)).join(", ")}`, { added });
  if (removed.length) await history(client, c, row.id, "outlet_removed", `Outlet access removed: ${(await codes(removed)).join(", ")}`, { removed });
  if ((nextDefault ?? null) !== (row.default_outlet_id ?? null)) await history(client, c, row.id, "default_outlet_changed", "Default outlet changed", { from: row.default_outlet_id, to: nextDefault });
  return getCashier(client, c, row.id);
}

export async function assignOutletAccess(client, c, cashierId, outletId) {
  const row = await loadCashier(client, c, cashierId);
  return setCashierOutlets(client, c, cashierId, [...new Set([...row.outlet_ids, uuid(outletId, "Outlet")])]);
}

export async function removeOutletAccess(client, c, cashierId, outletId) {
  const row = await loadCashier(client, c, cashierId);
  return setCashierOutlets(client, c, cashierId, row.outlet_ids.filter((id) => id !== outletId));
}

export async function setDefaultOutlet(client, c, cashierId, outletId) {
  return updateCashier(client, c, cashierId, { defaultOutletId: outletId });
}

// ------------------------------------------------------------------ setup, activation, deactivation, deletion

async function setupIssues(client, c, row, authority = null) {
  const issues = [];
  if (row.user_status !== "active" || row.membership_status !== "active") issues.push({ code: "USER_INACTIVE", field: "userId", message: `${row.full_name}'s workspace user is inactive.` });
  if (!row.outlet_ids.length) issues.push({ code: "OUTLETS", field: "outletIds", message: "Give the cashier at least one outlet to work at." });
  const held = authority ?? await userAuthority(client, c.organizationId, row.user_id);
  if (!held.profileId) issues.push({ code: "PERMISSIONS", field: "permissionProfileId", message: "Assign an active permission profile." });
  else if (held.profileStatus !== "active") issues.push({ code: "PERMISSIONS", field: "permissionProfileId", message: `The permission profile ${held.profileName} is not active.` });
  else if (!held.canOperate) issues.push({ code: "PERMISSIONS", field: "permissionProfileId", message: `The permission profile ${held.profileName} does not grant POS access.` });
  return issues;
}

export async function validateCashierSetup(client, c, cashierId) {
  require(c, P.view, "You do not have permission to view cashiers.");
  const row = await loadCashier(client, c, cashierId);
  await assertVisible(client, c, row);
  return setupIssues(client, c, row);
}

export async function validateCashierForDeactivation(client, c, cashierId) {
  require(c, P.view, "You do not have permission to view cashiers.");
  const row = await loadCashier(client, c, cashierId);
  return row.session_id
    ? [{ code: "OPEN_SESSION", message: `${row.code} has an open POS session (${row.session_number} at ${row.session_outlet_code}). Close it first.` }] : [];
}

// Activate: only when setup is complete. Deactivate: only with no open session. Reactivation reuses the same profile.
export async function setCashierStatus(client, c, cashierId, status, input = {}) {
  require(c, P.status, "You do not have permission to activate or deactivate cashiers.");
  if (!["active", "inactive"].includes(status)) throw issue("status", "Choose Active or Inactive.");
  const row = await loadCashier(client, c, cashierId, { lock: true });
  if (row.status === status) throw new PosCashierError(409, `This cashier is already ${status}.`, "POS_CASHIER_STATUS_UNCHANGED");
  if (status === "active") {
    const missing = await setupIssues(client, c, row);
    if (missing.length) throw new PosCashierError(409, `This cashier cannot be activated yet. ${missing.map((entry) => entry.message).join(" ")}`, "CASHIER_SETUP_INCOMPLETE", { issues: missing });
  } else {
    const blockers = await validateCashierForDeactivation(client, c, row.id);
    if (blockers.length) throw new PosCashierError(409, `This cashier cannot be deactivated. ${blockers.map((entry) => entry.message).join(" ")}`, "CASHIER_DEACTIVATION_BLOCKED", { blockers });
  }
  await client.query(`UPDATE tenant.pos_cashiers SET status = $3, version = version + 1, updated_by = $4, updated_at = now() WHERE organization_id = $1 AND id = $2`,
    [c.organizationId, row.id, status, c.userId ?? null]);
  await history(client, c, row.id, status === "active" ? "activated" : "deactivated", status === "active" ? (row.first_used_at ? "Reactivated" : "Activated") : "Deactivated",
    { from: row.status, to: status }, text(input.reason, 300));
  return getCashier(client, c, row.id);
}

export async function deleteCashier(client, c, cashierId) {
  require(c, P.status, "You do not have permission to delete cashiers.");
  const row = await loadCashier(client, c, cashierId, { lock: true });
  const used = await usedBy(client, c, row);
  if (used.length) throw new PosCashierError(409, `This cashier has ${used.join(", ")}. Deactivate it instead.`, "POS_CASHIER_IN_USE", { references: used });
  await client.query(`DELETE FROM tenant.pos_cashiers WHERE organization_id = $1 AND id = $2`, [c.organizationId, row.id]);
  return { deleted: true };
}

// ------------------------------------------------------------------ operating

// May this user (the caller unless named) work at this outlet now? An active cashier profile, an active workspace user, access to the outlet
// and a POS operating permission — all of them. Returns the cashier row.
export async function validateCashierOperationAccess(client, c, outletId, userId = null) {
  const targetUserId = userId ?? c.userId;
  const row = (await client.query(`${SELECT} WHERE cashier.organization_id = $1 AND cashier.user_id = $2`, [c.organizationId, targetUserId])).rows[0];
  if (!row) throw new PosCashierError(403, "This person has no cashier profile. Create one under POS → Cashiers.", "CASHIER_NOT_FOUND");
  if (row.user_status !== "active" || row.membership_status !== "active") throw new PosCashierError(403, `${row.full_name}'s workspace user is inactive.`, "CASHIER_USER_INACTIVE");
  if (row.status !== "active") throw new PosCashierError(403, `Cashier ${row.code} is inactive.`, "CASHIER_INACTIVE");
  if (!row.outlet_ids.includes(outletId)) throw new PosCashierError(403, `Cashier ${row.code} is not authorized to work at this outlet.`, "CASHIER_OUTLET_ACCESS_DENIED");
  const authority = await userAuthority(client, c.organizationId, targetUserId);
  if (!authority.profileId) throw new PosCashierError(403, `Cashier ${row.code} has no permission profile.`, "POS_PERMISSION_PROFILE_MISSING");
  if (authority.profileStatus !== "active") throw new PosCashierError(403, `The permission profile of ${row.code} is not active.`, "POS_PERMISSION_PROFILE_INACTIVE");
  if (!authority.canOperate) throw new PosCashierError(403, `${row.full_name}'s permission profile does not grant POS access.`, "CASHIER_PERMISSION_DENIED");
  return row;
}

// Before a session opens: the cashier can work at the outlet and has no session open anywhere (one drawer at a time).
export async function assertCashierCanOpenSession(client, c, { outletId, userId = null }) {
  const row = await validateCashierOperationAccess(client, c, outletId, userId);
  if (row.session_id)
    throw new PosCashierError(409, `Cashier ${row.code} already has an active POS session (${row.session_number} at ${row.session_outlet_code} / ${row.session_terminal_code}).`,
      "CASHIER_SESSION_ALREADY_OPEN", { sessionId: row.session_id });
  return row;
}

// "Open POS" for a cashier: resume their open session, or offer their outlets (default first) with the terminals free to open a session on.
export async function openPosForCashier(client, c, cashierId) {
  const row = await loadCashier(client, c, cashierId);
  if (row.user_id !== c.userId && !can(c, "pos.store.manage")) throw new PosCashierError(403, "You can open POS only as yourself.", "CASHIER_PERMISSION_DENIED");
  if (row.session_id) return { action: "resume", sessionId: row.session_id, outletId: row.session_outlet_id, terminalId: row.session_terminal_id, outlets: [] };
  if (row.status !== "active") throw new PosCashierError(409, `Cashier ${row.code} is inactive.`, "CASHIER_INACTIVE");
  if (row.user_status !== "active" || row.membership_status !== "active") throw new PosCashierError(409, `${row.full_name}'s workspace user is inactive.`, "CASHIER_USER_INACTIVE");
  const { rows } = await client.query(
    `SELECT store.id AS outlet_id, store.code AS outlet_code, store.name AS outlet_name, terminal.id AS terminal_id, terminal.code AS terminal_code, terminal.name AS terminal_name
       FROM tenant.pos_cashier_outlets access
       JOIN tenant.pos_stores store ON store.organization_id = access.organization_id AND store.id = access.store_id AND store.active
       LEFT JOIN tenant.pos_terminals terminal ON terminal.organization_id = store.organization_id AND terminal.store_id = store.id AND terminal.status = 'active'
             AND NOT EXISTS (SELECT 1 FROM tenant.pos_shifts shift WHERE shift.organization_id = terminal.organization_id AND shift.terminal_id = terminal.id AND shift.status IN ${OPEN_SESSION})
      WHERE access.organization_id = $1 AND access.cashier_id = $2
      ORDER BY (store.id = $3) DESC, lower(store.name), terminal.code`, [c.organizationId, row.id, row.default_outlet_id]);
  const outlets = [];
  for (const entry of rows) {
    let outlet = outlets.find((candidate) => candidate.outletId === entry.outlet_id);
    if (!outlet) { outlet = { outletId: entry.outlet_id, outlet: label(entry.outlet_code, entry.outlet_name), isDefault: entry.outlet_id === row.default_outlet_id, terminals: [] }; outlets.push(outlet); }
    if (entry.terminal_id) outlet.terminals.push({ terminalId: entry.terminal_id, terminal: label(entry.terminal_code, entry.terminal_name) });
  }
  const single = outlets.length === 1 && outlets[0].terminals.length === 1 ? { outletId: outlets[0].outletId, terminalId: outlets[0].terminals[0].terminalId } : null;
  return { action: "open_session", sessionId: null, outlets, preselected: single };
}

// ------------------------------------------------------------------ inquiries

export async function getCurrentCashierSession(client, c, cashierId) {
  require(c, P.view, "You do not have permission to view cashiers.");
  const row = await loadCashier(client, c, cashierId);
  await assertVisible(client, c, row);
  return row.session_id ? { id: row.session_id, number: row.session_number, outlet: label(row.session_outlet_code, row.session_outlet_name),
    terminal: label(row.session_terminal_code, row.session_terminal_name), openedAt: row.session_opened_at } : null;
}

// The cashier's sessions, the open one first; cash figures only for those who may see them.
export async function getCashierSessions(client, c, cashierId) {
  require(c, P.viewSessions, "You do not have permission to view the sessions of a cashier.");
  const row = await loadCashier(client, c, cashierId);
  await assertVisible(client, c, row);
  const cash = can(c, P.viewCash);
  const { rows } = await client.query(
    `SELECT shift.id, shift.shift_number, shift.status, shift.opened_at, shift.closed_at, shift.opening_cash, shift.expected_cash, shift.counted_cash, shift.cash_variance,
            store.code AS outlet_code, terminal.code AS terminal_code, (shift.opened_at AT TIME ZONE COALESCE(store.timezone, 'Asia/Kolkata'))::date::text AS business_date
       FROM tenant.pos_shifts shift
       JOIN tenant.pos_stores store ON store.organization_id = shift.organization_id AND store.id = shift.store_id
       JOIN tenant.pos_terminals terminal ON terminal.organization_id = shift.organization_id AND terminal.id = shift.terminal_id
      WHERE shift.organization_id = $1 AND (shift.cashier_id = $2 OR shift.cashier_user_id = $3)
      ORDER BY (shift.status IN ${OPEN_SESSION}) DESC, shift.opened_at DESC NULLS FIRST LIMIT 500`, [c.organizationId, row.id, row.user_id]);
  return rows.map((session) => ({
    id: session.id, number: session.shift_number, status: session.status, outlet: session.outlet_code, terminal: session.terminal_code, businessDate: session.business_date,
    openedAt: session.opened_at, closedAt: session.closed_at,
    ...(cash ? { openingCash: round(session.opening_cash), expectedCash: round(session.expected_cash), countedCash: session.counted_cash === null ? null : round(session.counted_cash),
      difference: session.cash_variance === null ? null : round(session.cash_variance) } : {}),
  }));
}

// Sales and returns the cashier made (kind: sales | returns), newest first, with the code and name they were recorded under.
export async function getCashierTransactions(client, c, cashierId, filters = {}) {
  require(c, P.viewTransactions, "You do not have permission to view the transactions of a cashier.");
  const row = await loadCashier(client, c, cashierId);
  await assertVisible(client, c, row);
  const kind = ["sales", "returns"].includes(filters.kind) ? filters.kind : null;
  const { rows } = await client.query(
    `SELECT * FROM (
       SELECT sale.id, 'sale' AS kind, sale.receipt_number AS number, sale.completed_at AS at, store.code AS outlet_code, terminal.code AS terminal_code, shift.shift_number,
              COALESCE(sale.customer_name, customer.display_name) AS customer_name, sale.grand_total AS amount, sale.status, sale.cashier_code, sale.cashier_name,
              (SELECT string_agg(DISTINCT payment.payment_method, ', ') FROM tenant.pos_payments payment WHERE payment.organization_id = sale.organization_id AND payment.cart_id = sale.cart_id) AS payment
         FROM tenant.pos_sales sale
         JOIN tenant.pos_stores store ON store.organization_id = sale.organization_id AND store.id = sale.store_id
         JOIN tenant.pos_terminals terminal ON terminal.organization_id = sale.organization_id AND terminal.id = sale.terminal_id
         LEFT JOIN tenant.pos_shifts shift ON shift.organization_id = sale.organization_id AND shift.id = sale.shift_id
         LEFT JOIN tenant.business_parties customer ON customer.organization_id = sale.organization_id AND customer.id = sale.customer_id
        WHERE sale.organization_id = $1 AND sale.cashier_id = $2 AND sale.status <> 'draft'
       UNION ALL
       SELECT ret.id, 'return', ret.return_number, COALESCE(ret.completed_at, ret.created_at), store.code, terminal.code, shift.shift_number, NULL, -ret.refund_total, ret.status,
              ret.cashier_code, ret.cashier_name, NULL
         FROM tenant.pos_returns ret
         JOIN tenant.pos_stores store ON store.organization_id = ret.organization_id AND store.id = ret.store_id
         JOIN tenant.pos_terminals terminal ON terminal.organization_id = ret.organization_id AND terminal.id = ret.terminal_id
         LEFT JOIN tenant.pos_shifts shift ON shift.organization_id = ret.organization_id AND shift.id = ret.shift_id
        WHERE ret.organization_id = $1 AND ret.cashier_id = $2
     ) entry
     WHERE ($3::text IS NULL OR ($3 = 'sales' AND entry.kind = 'sale') OR ($3 = 'returns' AND entry.kind = 'return'))
     ORDER BY entry.at DESC NULLS LAST LIMIT 500`, [c.organizationId, row.id, kind]);
  return rows.map((entry) => ({
    id: entry.id, kind: entry.kind, number: entry.number, at: entry.at, outlet: entry.outlet_code, terminal: entry.terminal_code, session: entry.shift_number,
    customer: entry.customer_name, amount: round(entry.amount), payment: entry.payment, status: entry.status, recordedAs: entry.cashier_code ? `${entry.cashier_code} · ${entry.cashier_name}` : null,
  }));
}

export async function getCashierHistory(client, c, cashierId) {
  require(c, P.view, "You do not have permission to view cashiers.");
  const { rows } = await client.query(
    `SELECT history.*, actor.full_name AS actor_name FROM tenant.pos_cashier_history history LEFT JOIN public.users actor ON actor.id = history.actor_user_id
      WHERE history.organization_id = $1 AND history.cashier_id = $2 ORDER BY history.created_at DESC, history.id DESC LIMIT 300`, [c.organizationId, uuid(cashierId, "Cashier")]);
  return rows.map((row) => ({ id: row.id, eventType: row.event_type, summary: row.summary, changes: row.changes, reason: row.reason, actorName: row.actor_name, createdAt: row.created_at }));
}

// Cashiers working at one outlet (the outlet's Users & Cashiers tab).
export async function listOutletCashiers(client, c, outletId) {
  const { rows } = await client.query(`${SELECT} WHERE cashier.organization_id = $1 AND EXISTS (SELECT 1 FROM tenant.pos_cashier_outlets access
      WHERE access.organization_id = cashier.organization_id AND access.cashier_id = cashier.id AND access.store_id = $2)
    ORDER BY lower(COALESCE(cashier.display_name, users.full_name))`, [c.organizationId, uuid(outletId, "Outlet")]);
  const out = [];
  for (const row of rows) {
    const authority = await userAuthority(client, c.organizationId, row.user_id);
    out.push({ ...toCashier(row), posRoles: authority.posRoles, canOperate: authority.canOperate, profileName: authority.profileName, abilities: authority.abilities });
  }
  return out;
}

// What the cashier screens need: workspace members without a profile, outlets, employees, POS roles.
export async function getCashierOptions(client, c) {
  require(c, P.view, "You do not have permission to view cashiers.");
  const members = (await client.query(
    `SELECT users.id, users.full_name, users.email, EXISTS (SELECT 1 FROM tenant.pos_cashiers cashier WHERE cashier.organization_id = membership.organization_id AND cashier.user_id = users.id) AS has_profile
       FROM public.organization_memberships membership JOIN public.users users ON users.id = membership.user_id
      WHERE membership.organization_id = $1 AND membership.status = 'active' AND users.status = 'active' ORDER BY users.full_name LIMIT 2000`, [c.organizationId])).rows;
  const outlets = (await client.query(`SELECT id, code, name, active FROM tenant.pos_stores WHERE organization_id = $1 ORDER BY active DESC, lower(name)`, [c.organizationId])).rows;
  const employees = (await client.query(`SELECT id, employee_number, user_id FROM tenant.hr_employees WHERE organization_id = $1 ORDER BY employee_number LIMIT 2000`, [c.organizationId])).rows;
  const roles = (await client.query(`SELECT DISTINCT name FROM public.roles WHERE organization_id = $1 AND module_key = 'point-of-sale' AND status = 'active' ORDER BY name`, [c.organizationId])).rows;
  return {
    members: members.map((row) => ({ id: row.id, name: row.full_name, email: row.email, hasProfile: row.has_profile })),
    outlets: outlets.map((row) => ({ id: row.id, label: label(row.code, row.name), active: row.active })),
    employees: employees.map((row) => ({ id: row.id, label: row.employee_number, userId: row.user_id })),
    roles: roles.map((row) => row.name), nextCode: await nextCode(client, c), capabilities: cashierCapabilities(c),
  };
}
