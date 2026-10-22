// Sales teams and their members (Settings › Teams). Teams group people for lead assignment (round robin, team queues) and team record
// visibility. These used the generic CRM resource layer; that layer is gone (CRM plan 5.9) and the rules it applied to teams live here:
// the members are active people of this company, a team is never its own ancestor, a person has one active membership of a team at a
// time, every change checks the version the editor loaded, and each change publishes crm.sales-teams.* / crm.sales-team-members.*.
import { CrmError } from "../data-management/errors.js";
import { queueOutboxEvent } from "../data-management/outbox.js";
import { addParameter, camelizeRow, limitValue } from "../data-management/record-utils.js";
import { assertSalesTeamParentAllowed } from "./hierarchy-rules.js";

const TEAM = Object.freeze({
  resource: "sales-teams", table: "tenant.crm_sales_teams", label: "Sales team", code: "CRM_SALES_TEAM", orderBy: "name ASC, id ASC",
  fields: { parentTeamId: "parent_team_id", code: "code", name: "name", managerUserId: "manager_user_id", defaultPipelineId: "default_pipeline_id", currencyCode: "currency_code", status: "status" },
});
const MEMBER = Object.freeze({
  resource: "sales-team-members", table: "tenant.crm_sales_team_members", label: "Team membership", code: "CRM_TEAM_MEMBERSHIP",
  orderBy: "effective_from DESC NULLS LAST, created_at DESC, id ASC",
  fields: { teamId: "team_id", userId: "user_id", memberRole: "member_role", allocationPercent: "allocation_percent", effectiveFrom: "effective_from", effectiveTo: "effective_to", status: "status" },
});
const USER_FIELDS = new Set(["managerUserId", "userId"]);
export const SALES_TEAM_MEMBER_ROLES = Object.freeze(["seller", "manager", "sales_ops", "overlay", "observer"]);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function fieldErrors(issues) {
  const errors = {};
  for (const item of issues) (errors[item.field] ||= []).push(item.message);
  return { errors, issues };
}

// A second team with the same code is refused with a message (checked first; this covers two saves at the same moment).
async function unique(kind, run) {
  try { return await run(); } catch (error) {
    if (error?.code === "23505" && kind === TEAM) throw new CrmError(409, "Another team already has this code.", "CRM_SALES_TEAM_CODE_EXISTS", fieldErrors([{ field: "code", message: "Already used by another team." }]));
    throw error;
  }
}

const entries = (kind, input) => Object.entries(input ?? {}).filter(([key, value]) => kind.fields[key] && value !== undefined);

async function assertActiveMembers(client, context, kind, input) {
  const ids = [...new Set(entries(kind, input).filter(([key, value]) => USER_FIELDS.has(key) && value).map(([, value]) => value))];
  if (!ids.length) return;
  const { rows } = await client.query(
    `SELECT user_id FROM public.organization_memberships WHERE organization_id = $1 AND user_id = ANY($2::uuid[]) AND status = 'active'`,
    [context.organizationId, ids]);
  if (rows.length < ids.length)
    throw new CrmError(409, "Team managers and members must be active people of this company.", "CRM_USER_OUTSIDE_ORGANIZATION");
}

function assertVersion(kind, before, expectedUpdatedAt) {
  const supplied = String(expectedUpdatedAt || "").trim();
  if (!supplied) throw new CrmError(400, `Refresh this ${kind.label} before changing it.`, `${kind.code}_VERSION_REQUIRED`);
  const expected = new Date(supplied);
  if (!Number.isFinite(expected.getTime())) throw new CrmError(400, `The ${kind.label} version is invalid. Refresh and try again.`, `${kind.code}_VERSION_INVALID`);
  if (expected.getTime() !== new Date(before.updatedAt ?? "").getTime())
    throw new CrmError(409, `This ${kind.label} changed after you loaded it. Refresh and try again.`, "CRM_STALE_WRITE");
}

// Role, allocation and dates are checked here so a bad value gets a clear message, not a database refusal.
async function prepareMembership(client, context, input, before = null) {
  const prepared = { ...input };
  const issues = [];
  const has = (key) => Object.prototype.hasOwnProperty.call(prepared, key) && prepared[key] !== undefined;
  if (has("memberRole") && prepared.memberRole !== null) {
    const role = String(prepared.memberRole).trim().toLowerCase().replace(/[\s-]+/g, "_");
    if (!SALES_TEAM_MEMBER_ROLES.includes(role)) issues.push({ field: "memberRole", message: "Choose Seller, Manager, Sales operations, Overlay or Observer." });
    else prepared.memberRole = role;
  }
  if (has("allocationPercent") && prepared.allocationPercent !== null) {
    const share = Number(prepared.allocationPercent);
    if (!Number.isFinite(share) || share <= 0 || share > 100) issues.push({ field: "allocationPercent", message: "Allocation is a percentage above 0 and up to 100." });
    else prepared.allocationPercent = share;
  }
  for (const field of ["effectiveFrom", "effectiveTo"]) {
    if (!has(field) || prepared[field] === null || prepared[field] === "") { if (has(field)) prepared[field] = null; continue; }
    const value = String(prepared[field]).trim().slice(0, 10);
    if (!DATE.test(value) || Number.isNaN(new Date(`${value}T00:00:00Z`).getTime())) issues.push({ field, message: "Enter a date (YYYY-MM-DD)." });
    else prepared[field] = value;
  }
  const day = (value) => (value ? String(value instanceof Date ? value.toISOString() : value).slice(0, 10) : null);
  const from = prepared.effectiveFrom ?? before?.effectiveFrom ?? null;
  const to = prepared.effectiveTo ?? (has("effectiveTo") ? null : before?.effectiveTo ?? null);
  if (from && to && day(to) < day(from)) issues.push({ field: "effectiveTo", message: "The end date cannot be before the start date." });
  if (issues.length) throw new CrmError(400, issues[0].message, "CRM_TEAM_MEMBERSHIP_INVALID", fieldErrors(issues));

  const teamId = prepared.teamId ?? before?.teamId;
  const team = (await client.query(`SELECT status FROM tenant.crm_sales_teams WHERE organization_id = $1 AND id = $2`, [context.organizationId, teamId])).rows[0];
  if (!team) throw new CrmError(404, "That team was not found.", "CRM_SALES_TEAM_NOT_FOUND");
  if (team.status !== "active") throw new CrmError(409, "People can only be added to an active team.", "CRM_SALES_TEAM_INACTIVE");
  const existing = (await client.query(
    `SELECT 1 FROM tenant.crm_sales_team_members WHERE organization_id = $1 AND team_id = $2 AND user_id = $3 AND status = 'active'
        AND (effective_to IS NULL OR effective_to >= COALESCE($4::date, current_date)) LIMIT 1`,
    [context.organizationId, teamId, prepared.userId, prepared.effectiveFrom ?? null])).rows[0];
  if (existing) throw new CrmError(409, "This person is already an active member of the team. End that membership first to change it.", "CRM_TEAM_MEMBERSHIP_EXISTS",
    fieldErrors([{ field: "userId", message: "Already an active member of this team." }]));
  return prepared;
}

async function list(client, context, kind, filters = {}) {
  const parameters = [context.organizationId];
  let where = "record.organization_id = $1";
  if (filters.status && filters.status !== "all") where += ` AND record.status = ${addParameter(parameters, filters.status)}`;
  if (kind === MEMBER) {
    // A membership belongs to one team; members are only ever listed per team.
    if (!filters.teamId) throw new CrmError(400, "Choose the team whose members to list.", "CRM_TEAM_REQUIRED");
    where += ` AND record.team_id = ${addParameter(parameters, filters.teamId)}`;
  }
  const search = String(filters.search || "").trim();
  if (search && kind === TEAM) {
    const pattern = addParameter(parameters, `%${search.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`);
    where += ` AND (record.code ILIKE ${pattern} OR record.name ILIKE ${pattern})`;
  }
  const limit = limitValue(filters.limit);
  const offset = Math.max(0, Math.min(10_000_000, Math.trunc(Number(filters.offset || 0) || 0)));
  const total = Number((await client.query(`SELECT count(*)::int AS total FROM ${kind.table} record WHERE ${where}`, parameters)).rows[0]?.total || 0);
  const { rows } = await client.query(
    `SELECT record.* FROM ${kind.table} record WHERE ${where} ORDER BY ${kind.orderBy} LIMIT ${addParameter(parameters, limit)} OFFSET ${addParameter(parameters, offset)}`, parameters);
  return { rows: rows.map(camelizeRow), total, limit, offset };
}

async function get(client, context, kind, id) {
  const row = (await client.query(`SELECT * FROM ${kind.table} WHERE organization_id = $1 AND id = $2`, [context.organizationId, id])).rows[0];
  if (!row) throw new CrmError(404, `${kind.label} not found.`);
  return camelizeRow(row);
}

async function insert(client, context, kind, input) {
  const values = entries(kind, input);
  if (!values.length) throw new CrmError(400, "No fields were supplied.");
  const columns = ["organization_id", ...values.map(([key]) => kind.fields[key]), "created_by", "updated_by"];
  const raw = [context.organizationId, ...values.map(([, value]) => value), context.userId, context.userId];
  // A field sent as null on create means "no value": the column's default.
  const parameters = [];
  const placeholders = raw.map((value) => (value === null ? "DEFAULT" : addParameter(parameters, value)));
  const created = camelizeRow((await unique(kind, () => client.query(`INSERT INTO ${kind.table} (${columns.join(", ")}) VALUES (${placeholders.join(", ")}) RETURNING *`, parameters))).rows[0]);
  await queueOutboxEvent(client, context, `crm.${kind.resource}.created`, kind.resource, created.id, created);
  return created;
}

// The UPDATE re-checks the loaded version (to the millisecond, the precision any client holds), so a concurrent change is never overwritten.
async function write(client, context, kind, before, changes, eventType) {
  const values = entries(kind, changes);
  if (!values.length) throw new CrmError(400, "No fields were supplied.");
  const parameters = [context.organizationId, before.id];
  const assignments = values.map(([key, value]) => `${kind.fields[key]} = ${addParameter(parameters, value)}`);
  const result = await unique(kind, () => client.query(
    `UPDATE ${kind.table} SET ${assignments.join(", ")}, updated_by = ${addParameter(parameters, context.userId)}, updated_at = now()
      WHERE organization_id = $1 AND id = $2 AND date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', ${addParameter(parameters, before.updatedAt)}::timestamptz)
      RETURNING *`, parameters));
  if (!result.rows[0]) throw new CrmError(409, `This ${kind.label} changed after you loaded it. Refresh and try again.`, "CRM_STALE_WRITE");
  const after = camelizeRow(result.rows[0]);
  await queueOutboxEvent(client, context, `crm.${kind.resource}.${eventType}`, kind.resource, after.id, eventType === "updated" ? { before, after } : after);
  return after;
}

export const listSalesTeams = (client, context, filters) => list(client, context, TEAM, filters);
export const getSalesTeam = (client, context, id) => get(client, context, TEAM, id);

async function assertCodeFree(client, context, code, id = null) {
  if (code === undefined || code === null || code === "") return;
  const taken = (await client.query(`SELECT 1 FROM tenant.crm_sales_teams WHERE organization_id = $1 AND code = $2 AND ($3::uuid IS NULL OR id <> $3) LIMIT 1`,
    [context.organizationId, String(code), id])).rows[0];
  if (taken) throw new CrmError(409, "Another team already has this code.", "CRM_SALES_TEAM_CODE_EXISTS", fieldErrors([{ field: "code", message: "Already used by another team." }]));
}

// A team's code is made from its name when none is given ("West Zone Sales" -> WEST_ZONE_SALES, then _2, _3… if taken).
async function codeFromName(client, context, name) {
  const base = String(name ?? "").toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 30) || "TEAM";
  const taken = new Set((await client.query(`SELECT code FROM tenant.crm_sales_teams WHERE organization_id = $1 AND code LIKE $2`, [context.organizationId, `${base}%`])).rows.map((row) => row.code));
  let code = base;
  for (let suffix = 2; taken.has(code); suffix += 1) code = `${base}_${suffix}`;
  return code;
}

export async function createSalesTeam(client, context, input = {}) {
  if (!String(input.name ?? "").trim()) throw new CrmError(400, "Name the team.", "CRM_SALES_TEAM_VALIDATION", fieldErrors([{ field: "name", message: "Name the team." }]));
  if (!String(input.code ?? "").trim()) input = { ...input, code: await codeFromName(client, context, input.name) };
  await assertCodeFree(client, context, input.code);
  await assertActiveMembers(client, context, TEAM, input);
  return insert(client, context, TEAM, input);
}

export async function updateSalesTeam(client, context, id, input = {}, { expectedUpdatedAt } = {}) {
  const before = await get(client, context, TEAM, id);
  assertVersion(TEAM, before, expectedUpdatedAt);
  await assertSalesTeamParentAllowed(client, context, "sales-teams", id, input);
  await assertCodeFree(client, context, input.code, id);
  await assertActiveMembers(client, context, TEAM, input);
  return write(client, context, TEAM, before, input, "updated");
}

export async function archiveSalesTeam(client, context, id, { expectedUpdatedAt } = {}) {
  const before = await get(client, context, TEAM, id);
  assertVersion(TEAM, before, expectedUpdatedAt);
  return write(client, context, TEAM, before, { status: "inactive" }, "archived");
}

export const listSalesTeamMembers = (client, context, filters) => list(client, context, MEMBER, filters);

export async function addSalesTeamMember(client, context, input = {}) {
  const prepared = await prepareMembership(client, context, input);
  await assertActiveMembers(client, context, MEMBER, prepared);
  return insert(client, context, MEMBER, prepared);
}

// Removing a person from a team ends (archives) the membership; the history stays.
export async function archiveSalesTeamMember(client, context, id, { expectedUpdatedAt } = {}) {
  const before = await get(client, context, MEMBER, id);
  assertVersion(MEMBER, before, expectedUpdatedAt);
  return write(client, context, MEMBER, before, { status: "inactive" }, "archived");
}
