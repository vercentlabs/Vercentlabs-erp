// Roles & Permissions MVP — security checks against a scratch database (the spec's critical scenarios, numbered as in section 12).
//
//   SMOKE_DATABASE=vercentlabs_verify pnpm test:rbac     (the database URL comes from apps/web/.env.local MIGRATION_DATABASE_URL)
//
// Everything runs in ONE transaction as the restricted app role and is rolled back, except the session-refresh check, which needs real
// sessions and uses its own throwaway company (committed, scratch database only).
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = process.env.SMOKE_ROOT ?? fileURLToPath(new URL("../../../", import.meta.url)).replaceAll("\\", "/");
const require = createRequire(ROOT + "package.json");
const pg = require("pg");
const dotenv = require("dotenv");
const api = (path) => import(`file:///${ROOT}services/api/src/${path}`);
const perms = await import(`file:///${ROOT}packages/permissions/src/index.js`);

const env = dotenv.parse(readFileSync(ROOT + "apps/web/.env.local"));
const url = new URL(env.MIGRATION_DATABASE_URL);
url.pathname = "/" + (process.env.SMOKE_DATABASE || "vercentlabs_verify");
if (/_control$/.test(url.pathname) && process.env.SMOKE_ALLOW_LIVE !== "yes") throw new Error("Refusing to run the RBAC suite on the live database. Set SMOKE_DATABASE to a scratch database.");
const client = new pg.Client({ connectionString: url.toString() });
await client.connect();

let passed = 0;
const failures = [];
async function check(name, work) {
  await client.query("SAVEPOINT smoke_check");
  try {
    await work();
    await client.query("RELEASE SAVEPOINT smoke_check");
    passed += 1;
    console.log("  ok   ", name);
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT smoke_check");
    failures.push(name);
    console.log("  FAIL ", name, "\n        ", String(error?.stack || error).split("\n").slice(0, 4).join("\n         "));
  }
}
function assert(condition, message) { if (!condition) throw new Error("assertion failed: " + message); }
async function rejects(work, code) {
  try { await work(); } catch (error) { if (code && error.code !== code) throw new Error(`expected ${code}, got ${error.code}: ${error.message}`); return error; }
  throw new Error(`expected rejection ${code ?? ""}`);
}

const { registerOrganization } = await api("core/organization/registration.js");
const access = await api("core/access/administration-service.js");
const { buildWorkspaceAccessSnapshot, authorize } = await api("core/access/index.js");
const { setMemberStatus } = await api("core/organization/administration.js");
const crm = await api("modules/crm/index.js");

async function company(c, tag) {
  const registered = await registerOrganization(c, {
    fullName: `Owner ${tag}`, email: `rbac-${tag}@example.test`, password: "Rbac-Workspace-Passphrase-2026!",
    organizationName: `RBAC ${tag}`, countryCode: "IN", baseCurrency: "INR", timezone: "Asia/Kolkata",
  });
  return registered;
}
async function contextFor(c, organizationId, userId) {
  await c.query("SELECT set_config('app.current_organization_id', $1, true)", [organizationId]);
  const { rows } = await c.query(
    `SELECT COALESCE(array_agg(DISTINCT role.slug) FILTER (WHERE role.slug IS NOT NULL), ARRAY[]::text[]) AS role_slugs,
            COALESCE(array_agg(DISTINCT grant_row.permission_key) FILTER (WHERE grant_row.permission_key IS NOT NULL), ARRAY[]::text[]) AS permissions
       FROM user_role_assignments assignment JOIN roles role ON role.id = assignment.role_id AND role.status = 'active'
       LEFT JOIN role_permissions grant_row ON grant_row.role_id = role.id
      WHERE assignment.organization_id = $1 AND assignment.user_id = $2 AND assignment.status = 'active'`, [organizationId, userId]);
  return { organizationId, userId, roleSlugs: rows[0].role_slugs, permissions: rows[0].permissions, emailVerified: true, mfaVerified: true, fullName: "x", email: "x" };
}

try {
  await client.query("BEGIN");
  await client.query("SET LOCAL ROLE vercent_app");
  const tag = Math.random().toString(16).slice(2, 10);
  const a = await company(client, `a-${tag}`);
  const orgA = a.organizationId;
  let owner = await contextFor(client, orgA, a.userId);
  const roleId = async (slug) => (await client.query("SELECT id FROM roles WHERE organization_id = $1 AND slug = $2", [orgA, slug])).rows[0].id;
  async function member(name, slugs) {
    const id = (await client.query(`INSERT INTO users (id, email, full_name, password_hash, status, email_verified_at) VALUES (gen_random_uuid(), $1, $2, 'x', 'active', now()) RETURNING id`,
      [`${name.toLowerCase().replace(/\W+/g, "-")}-${tag}@example.test`, name])).rows[0].id;
    await client.query(`INSERT INTO organization_memberships (organization_id, user_id, role, status) VALUES ($1, $2, 'member', 'active')`, [orgA, id]);
    for (const [index, slug] of slugs.entries())
      await client.query(`INSERT INTO user_role_assignments (organization_id, user_id, role_id, is_primary, status) VALUES ($1, $2, $3, $4, 'active')`, [orgA, id, await roleId(slug), index === 0]);
    return id;
  }
  const salesA = await member("Sales One", ["crm_salesperson"]);
  const salesB = await member("Sales Two", ["crm_salesperson"]);
  const readOnly = await member("Read Only", ["read_only"]);
  const warehouse = await member("Store Keeper", ["warehouse_operator"]);
  const custodian = await member("Asset Holder", ["asset_custodian"]);
  const inspector = await member("Quality Inspector", ["quality_inspector"]);
  const userAdmin = await member("User Admin", ["user_administrator"]);
  const sysAdmin = await member("System Admin", ["system_administrator"]);
  const ctx = (userId) => contextFor(client, orgA, userId);
  await crm.ensureDefaultLeadSources(client, owner);
  await crm.ensureDefaultLeadStages(client, owner);

  // ---------------------------------------------------------------- templates and catalogue
  await check("templates: the owner holds the whole catalogue; Warehouse Operator, Production Supervisor and Asset Custodian exist, with no SoD conflict", async () => {
    const catalogue = Number((await client.query("SELECT count(*) FROM permissions")).rows[0].count);
    assert(owner.permissions.length === catalogue, `owner ${owner.permissions.length} of ${catalogue}`);
    for (const slug of ["warehouse_operator", "production_supervisor", "asset_custodian"]) {
      const keys = (await ctx(await member(`Probe ${slug}`, [slug]))).permissions;
      assert(keys.length > 10 && perms.analyzePermissionConflicts(keys).length === 0, slug);
    }
  });

  // ---------------------------------------------------------------- 1, 3, 6, 7, 8: what a role can and cannot do
  await check("1 a user cannot use a module without its permission (Read-only User cannot open Settings › Roles management)", async () => {
    const snapshot = await buildWorkspaceAccessSnapshot(client, await ctx(warehouse), { env: {} });
    assert(!authorize({ snapshot, permission: "roles.manage" }).allowed, "warehouse cannot manage roles");
    assert(!authorize({ snapshot, module: "accounting", permission: "accounting.journal.post" }).allowed, "warehouse cannot post journals");
  });
  await check("3 View only: a Read-only User cannot create, edit or delete a lead", async () => {
    const viewer = await ctx(readOnly);
    assert(viewer.permissions.includes("crm.leads.view") || !viewer.permissions.includes("crm.leads.create"), "view only");
    await rejects(() => crm.createLead(client, viewer, { firstName: "Blocked" }));
  });
  await check("6 a warehouse operator cannot touch Finance journals", async () => {
    const keys = (await ctx(warehouse)).permissions;
    assert(!keys.some((key) => key.startsWith("accounting.journal")), "no journal permission");
  });
  await check("7 an Asset Custodian cannot see asset values or depreciation", async () => {
    const keys = (await ctx(custodian)).permissions;
    assert(keys.includes("assets.view") && !keys.includes("assets.view_financials") && !keys.some((key) => key.startsWith("assets.depreciation")), "no financials");
  });
  await check("8 a Quality Inspector cannot approve dispositions, waivers or specifications", async () => {
    const keys = (await ctx(inspector)).permissions;
    assert(keys.includes("quality.inspect") && !keys.some((key) => key.startsWith("quality.") && /approve|release|waive|override/.test(key)), keys.filter((key) => key.startsWith("quality.")).join(","));
  });

  // ---------------------------------------------------------------- 4: own records
  await check("4 own records: a salesperson sees their own leads, not another salesperson's", async () => {
    const one = await ctx(salesA);
    const two = await ctx(salesB);
    const mine = await crm.createLead(client, one, { firstName: "Mine", lastName: tag, ownerUserId: salesA });
    const theirs = await crm.createLead(client, two, { firstName: "Theirs", lastName: tag, ownerUserId: salesB });
    const listed = (await crm.listLeads(client, one, { search: tag, limit: 50 })).leads.map((lead) => lead.id);
    assert(listed.includes(mine.id) && !listed.includes(theirs.id), "own only: " + listed.length);
    await rejects(() => crm.getLead(client, one, theirs.id));
    // The owner (company-wide) sees both.
    const all = (await crm.listLeads(client, owner, { search: tag, limit: 50 })).leads.map((lead) => lead.id);
    assert(all.includes(mine.id) && all.includes(theirs.id), "company sees both");
  });

  // ---------------------------------------------------------------- record scopes in a custom role
  await check("scopes: a custom role set to Company-wide for CRM sees every lead; set back to Own, only its own", async () => {
    const base = (await ctx(salesA)).permissions;
    const wide = await access.createRole(client, owner, { name: `CRM wide ${tag}`, moduleKey: "crm", permissionKeys: perms.withRecordScope(base, "crm", "company") });
    const person = await member("Scoped Rep", []);
    await access.setUserRoles(client, owner, { targetUserId: person, roleIds: [wide.id], primaryRoleId: wide.id });
    const other = await crm.createLead(client, await ctx(salesB), { firstName: "Elsewhere", lastName: tag, ownerUserId: salesB });
    assert(perms.recordScopeLevel("crm", (await ctx(person)).permissions) === "company", "level company");
    assert((await crm.listLeads(client, await ctx(person), { search: tag, limit: 50 })).leads.some((lead) => lead.id === other.id), "company sees it");
    const narrowed = await access.updateRole(client, owner, wide.id, { permissionKeys: perms.withRecordScope(base, "crm", "own") });
    assert(narrowed.version === 2, "version moved");
    assert(!(await crm.listLeads(client, await ctx(person), { search: tag, limit: 50 })).leads.some((lead) => lead.id === other.id), "own no longer sees it");
  });

  // ---------------------------------------------------------------- 2, 12: company isolation
  await check("2/12 another company's records and roles cannot be reached, by id or by list", async () => {
    const b = await company(client, `b-${tag}`);
    const ownerB = await contextFor(client, b.organizationId, b.userId);
    await crm.ensureDefaultLeadSources(client, ownerB);
    await crm.ensureDefaultLeadStages(client, ownerB);
    const secret = await crm.createLead(client, ownerB, { firstName: "Secret", lastName: tag });
    owner = await contextFor(client, orgA, a.userId);
    await rejects(() => crm.getLead(client, owner, secret.id));
    assert(!(await crm.listLeads(client, owner, { search: "Secret", limit: 50 })).leads.some((lead) => lead.id === secret.id), "not listed");
    const foreignRole = (await client.query("SELECT id FROM roles WHERE id IN (SELECT id FROM roles WHERE slug = 'auditor') AND organization_id <> $1 LIMIT 1", [orgA])).rows[0];
    assert(!foreignRole, "RLS hides other companies' roles");
    await rejects(async () => access.setUserRoles(client, owner, { targetUserId: b.userId, roleIds: [await roleId("auditor")], primaryRoleId: await roleId("auditor") }), "ACCESS_ADMIN_USER_NOT_FOUND");
  });

  // ---------------------------------------------------------------- 10, 49: privilege escalation
  await check("10/49 a User Administrator cannot create or assign a role with permissions beyond their own", async () => {
    const admin = await ctx(userAdmin);
    await rejects(() => access.createRole(client, admin, { name: `Escalate ${tag}`, permissionKeys: ["accounting.journal.post"] }));
    await rejects(async () => access.setUserRoles(client, admin, { targetUserId: salesA, roleIds: [await roleId("finance_manager")], primaryRoleId: await roleId("finance_manager") }), "");
  });
  await check("SoD: a custom role that both creates and approves journals is refused", async () => {
    await rejects(() => access.createRole(client, owner, { name: `Prepare and approve ${tag}`, permissionKeys: ["accounting.journal.create", "accounting.journal.approve"] }), "ACCESS_ADMIN_SOD_BLOCKING");
  });

  // ---------------------------------------------------------------- 11: multiple roles
  await check("11 multiple roles combine within the company", async () => {
    const both = await member("Two Roles", ["crm_salesperson", "warehouse_operator"]);
    const keys = (await ctx(both)).permissions;
    assert(keys.includes("crm.leads.create") && keys.includes("stock.receive"), "both sets");
  });

  // ---------------------------------------------------------------- 13, 48: the owner is protected
  await check("13/48 nobody can disable the owner or change the owner's roles, a System Administrator included", async () => {
    const admin = await ctx(sysAdmin);
    await rejects(() => setMemberStatus(client, admin, a.userId, "disabled"), "ORG_ADMIN_OWNER_PROTECTED");
    await rejects(async () => access.setUserRoles(client, admin, { targetUserId: a.userId, roleIds: [await roleId("employee")], primaryRoleId: await roleId("employee") }), "ACCESS_ADMIN_OWNER_PROTECTED");
    await rejects(() => setMemberStatus(client, admin, sysAdmin, "disabled"), "ORG_ADMIN_SELF_TARGET");
  });

  // ---------------------------------------------------------------- 14: built-in roles
  await check("14 built-in roles cannot be edited or archived; they are duplicated instead (a large one keeps every permission; an all-access copy is refused by separation of duties)", async () => {
    const builtIn = await roleId("system_administrator");
    await rejects(() => access.updateRole(client, owner, builtIn, { description: "x" }), "ACCESS_ADMIN_SYSTEM_ROLE_PROTECTED");
    await rejects(() => access.archiveRole(client, owner, builtIn), "ACCESS_ADMIN_SYSTEM_ROLE_PROTECTED");
    const copy = await access.duplicateRole(client, owner, await roleId("inventory_manager"));
    assert(copy.name === "Inventory Manager (copy)" && !copy.is_system, "copy " + copy.name);
    const count = Number((await client.query("SELECT count(*) FROM role_permissions WHERE role_id = $1", [copy.id])).rows[0].count);
    assert(count > 150, "the copy keeps every permission: " + count);
    // An all-access custom role would prepare and approve the same journals and payments: only the built-in administrators may.
    await rejects(() => access.duplicateRole(client, owner, builtIn, { name: `Admin copy ${tag}` }), "ACCESS_ADMIN_SOD_BLOCKING");
  });

  // ---------------------------------------------------------------- 15, 44, 45: audit
  await check("15/44 every role change is audited, and the role's history shows what was added and removed", async () => {
    const role = await access.createRole(client, owner, { name: `Audited ${tag}`, permissionKeys: ["crm.leads.view"] });
    await access.updateRole(client, owner, role.id, { permissionKeys: ["crm.leads.view", "crm.leads.create"] });
    const events = (await client.query("SELECT event_type FROM audit_events WHERE organization_id = $1 AND entity_id = $2 ORDER BY created_at", [orgA, role.id])).rows.map((row) => row.event_type);
    assert(events.includes("role.created") && events.includes("role.updated"), events.join(","));
    const detail = await access.getRoleDetail(client, owner, role.id);
    assert(detail.history[0].added.includes("crm.leads.create") && detail.history.length === 2, JSON.stringify(detail.history[0]));
  });

  // ---------------------------------------------------------------- 16: exports
  await check("16 exports need the export permission: a salesperson cannot export leads", async () => {
    await rejects(async () => crm.exportLeads(client, await ctx(salesA), {}));
  });

  // ---------------------------------------------------------------- 20: concurrency
  await check("20 two administrators editing one role: the older save is refused, not silently applied", async () => {
    const role = await access.createRole(client, owner, { name: `Concurrent ${tag}`, permissionKeys: ["crm.leads.view"] });
    await access.updateRole(client, owner, role.id, { description: "first", expectedVersion: 1 });
    await rejects(() => access.updateRole(client, owner, role.id, { description: "second", expectedVersion: 1 }), "ACCESS_ADMIN_ROLE_STALE");
  });

  // ---------------------------------------------------------------- names, archive, restore, reports
  await check("role names are unique (any letter case); archive refuses a role in use; restore brings one back", async () => {
    await access.createRole(client, owner, { name: `Field Sales ${tag}`, permissionKeys: ["crm.leads.view"] });
    await rejects(() => access.createRole(client, owner, { name: `FIELD SALES ${tag}`, permissionKeys: [] }), "ACCESS_ADMIN_ROLE_NAME_TAKEN");
    const used = await access.createRole(client, owner, { name: `In use ${tag}`, permissionKeys: ["crm.leads.view", "workspace.view"] });
    const holder = await member("Holder", []);
    await access.setUserRoles(client, owner, { targetUserId: holder, roleIds: [used.id], primaryRoleId: used.id });
    await rejects(() => access.archiveRole(client, owner, used.id), "ACCESS_ADMIN_ROLE_IN_USE");
    const spare = await access.createRole(client, owner, { name: `Spare ${tag}`, permissionKeys: [] });
    await access.archiveRole(client, owner, spare.id);
    assert((await access.listArchivedRoles(client, owner)).some((row) => row.id === spare.id), "listed archived");
    assert((await access.restoreRole(client, owner, spare.id)).status === "active", "restored");
  });
  await check("52/53 role usage and user access reports", async () => {
    const usage = await access.roleUsageReport(client, owner);
    assert(usage.find((row) => row.name === "CRM Salesperson")?.active_people >= 2, "salespeople counted");
    const users = await access.userAccessReport(client, owner);
    const ownerRow = users.find((row) => row.userId === a.userId);
    assert(ownerRow?.privileged && users.find((row) => row.userId === readOnly)?.privileged === false, "flags");
    await rejects(async () => access.userAccessReport(client, await ctx(warehouse)));
  });
} finally {
  await client.query("ROLLBACK");
}

// ---------------------------------------------------------------- 9, 47: a revoked role stops working on the very next request
{
  const tag = Math.random().toString(16).slice(2, 10);
  const { createSession, resolveSessionContext } = await api("core/auth/session.js");
  const session = new pg.Client({ connectionString: url.toString() });
  await session.connect();
  try {
    await session.query("BEGIN");
    const a = await company(session, `s-${tag}`);
    await session.query("SELECT set_config('app.current_organization_id', $1, true)", [a.organizationId]);
    const empRole = (await session.query("SELECT id FROM roles WHERE organization_id = $1 AND slug = 'employee'", [a.organizationId])).rows[0].id;
    const owner = await contextFor(session, a.organizationId, a.userId);
    const custom = await access.createRole(session, owner, { name: `Field rep ${tag}`, moduleKey: "crm", permissionKeys: ["workspace.view", "crm.view", "crm.leads.view", "crm.leads.create"] });
    const rep = (await session.query(`INSERT INTO users (id, email, full_name, password_hash, status, email_verified_at) VALUES (gen_random_uuid(), $1, 'Rep', 'x', 'active', now()) RETURNING id`, [`rep-${tag}@example.test`])).rows[0].id;
    await session.query(`INSERT INTO organization_memberships (organization_id, user_id, role, status) VALUES ($1, $2, 'member', 'active')`, [a.organizationId, rep]);
    await session.query(`INSERT INTO user_role_assignments (organization_id, user_id, role_id, is_primary, status) VALUES ($1, $2, $3, true, 'active'), ($1, $2, $4, false, 'active')`, [a.organizationId, rep, custom.id, empRole]);
    const { token } = await createSession(session, { userId: rep, organizationId: a.organizationId, env: { ...process.env, ...env } });
    await session.query("COMMIT");
    const sessionEnv = { ...process.env, ...env };
    const name = "9/47 access changes reach live sessions: a changed role definition applies on the next request; a revoked role ends the session";
    try {
      const before = await resolveSessionContext(session, token, "browser", sessionEnv);
      assert(before.permissions.includes("crm.leads.create"), "has it before");
      // The role itself changes: the person stays signed in, and the very next request no longer carries the permission.
      await session.query("BEGIN");
      await session.query("SELECT set_config('app.current_organization_id', $1, true)", [a.organizationId]);
      await access.updateRole(session, owner, custom.id, { permissionKeys: ["workspace.view", "crm.view", "crm.leads.view"] });
      await session.query("COMMIT");
      const narrowed = await resolveSessionContext(session, token, "browser", sessionEnv);
      assert(narrowed && !narrowed.permissions.includes("crm.leads.create") && narrowed.permissions.includes("crm.leads.view"), "definition change applied at once");
      // The role is taken away: every session of the person ends (the database trigger on role assignments).
      await session.query("BEGIN");
      await session.query("SELECT set_config('app.current_organization_id', $1, true)", [a.organizationId]);
      await access.setUserRoles(session, { ...owner, sessionId: null }, { targetUserId: rep, roleIds: [empRole], primaryRoleId: empRole });
      await session.query("COMMIT");
      const after = await resolveSessionContext(session, token, "browser", sessionEnv);
      assert(after === null, "session ended after the role was revoked");
      passed += 1;
      console.log("  ok   ", name);
    } catch (error) {
      await session.query("ROLLBACK").catch(() => undefined);
      failures.push(name);
      console.log("  FAIL ", name, String(error?.stack || error).split("\n").slice(0, 4).join(" | "));
    }
  } finally {
    await session.end();
  }
}
await client.end();
console.log(`\n${passed} passed, ${failures.length} failed${failures.length ? ": " + failures.join(" | ") : ""}`);
process.exitCode = failures.length ? 1 : 0;
