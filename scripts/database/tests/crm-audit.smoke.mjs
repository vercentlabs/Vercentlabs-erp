// CRM audit fixes (Vercentlabs CRM — Full Audit Report, 21 Oct 2026): each check proves one finding is fixed.
//
//   SMOKE_DATABASE=vercentlabs_verify npm run test:crm-audit     (the database URL comes from apps/web/.env.local MIGRATION_DATABASE_URL)
//
// Everything runs in ONE transaction as the restricted app role and is rolled back.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = process.env.SMOKE_ROOT ?? fileURLToPath(new URL("../../../", import.meta.url)).replaceAll("\\", "/");
const require = createRequire(ROOT + "package.json");
const pg = require("pg");
const dotenv = require("dotenv");
const api = (path) => import(`file:///${ROOT}services/api/src/${path}`);

const env = dotenv.parse(readFileSync(ROOT + "apps/web/.env.local"));
const url = new URL(env.MIGRATION_DATABASE_URL);
url.pathname = "/" + (process.env.SMOKE_DATABASE || "vercentlabs_verify");
if (/_control$/.test(url.pathname) && process.env.SMOKE_ALLOW_LIVE !== "yes") throw new Error("Refusing to run the CRM audit suite on the live database. Set SMOKE_DATABASE to a scratch database.");
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
    console.log("  FAIL ", name, "\n        ", String(error?.stack || error).split("\n").slice(0, 6).join("\n         "));
  }
}
function assert(condition, message) { if (!condition) throw new Error("assertion failed: " + message); }
async function refused(work, code) {
  await client.query("SAVEPOINT refused");
  try { await work(); } catch (error) { await client.query("ROLLBACK TO SAVEPOINT refused"); if (code && error.code !== code) throw new Error(`expected ${code}, got ${error.code}: ${error.message}`); return error; }
  await client.query("RELEASE SAVEPOINT refused");
  throw new Error(`expected rejection ${code ?? ""}`);
}
const sha = (value) => createHash("sha256").update(String(value)).digest("hex");

try {
  await client.query("BEGIN");
  await client.query("SET LOCAL ROLE vercent_app");
  const { registerOrganization } = await api("core/organization/registration.js");
  const tag = Math.random().toString(16).slice(2, 10);
  const registered = await registerOrganization(client, {
    fullName: "Audit Owner", email: `audit-${tag}@example.test`, password: "Tr1al-Workspace-Passphrase!", organizationName: `Audit ${tag}`, countryCode: "IN", baseCurrency: "INR",
    timezone: "Asia/Kolkata",
  });
  const organizationId = registered.organizationId;
  const ownerId = registered.userId;
  await client.query("SELECT set_config('app.current_organization_id', $1, true)", [organizationId]);
  const onlyApps = (keys) => client.query(`UPDATE public.organization_modules SET status = CASE WHEN module_key = ANY($2::text[]) THEN 'enabled' ELSE 'disabled' END WHERE organization_id = $1`,
    [organizationId, keys]);
  await onlyApps(["crm"]);
  const grantsOf = async (userId) => (await client.query(
    `SELECT COALESCE(array_agg(DISTINCT role.slug), ARRAY[]::text[]) AS role_slugs,
            COALESCE(array_agg(DISTINCT grant_row.permission_key) FILTER (WHERE grant_row.permission_key IS NOT NULL), ARRAY[]::text[]) AS permissions
       FROM user_role_assignments assignment JOIN roles role ON role.id = assignment.role_id
       LEFT JOIN role_permissions grant_row ON grant_row.role_id = role.id
      WHERE assignment.organization_id = $1 AND assignment.user_id = $2`, [organizationId, userId])).rows[0];
  const ownerGrants = await grantsOf(ownerId);
  const owner = () => ({ organizationId, userId: ownerId, roleSlugs: ownerGrants.role_slugs, permissions: ownerGrants.permissions });

  const crm = await api("modules/crm/index.js");
  const lifecycle = await api("core/auth/lifecycle.js");
  const { tokenHash } = await api("core/auth/session.js");
  // A teammate who joins through an invitation, with the given role; returns { userId, context(permissions?) }.
  const addTeammate = async (name, roleSlug) => {
    const roleId = (await client.query(`SELECT id FROM public.roles WHERE organization_id = $1 AND slug = $2`, [organizationId, roleSlug])).rows[0]?.id;
    assert(roleId, `role ${roleSlug} exists`);
    const email = `${name.toLowerCase().replace(/\s+/g, ".")}-${tag}@example.test`;
    const invite = await lifecycle.createOrganizationInvitation(client, { organizationId, invitedByUserId: ownerId, email, roleIds: [roleId], primaryRoleId: roleId,
      inviter: { roleSlugs: ["organization_owner"], permissions: [] } }, { APP_URL: "http://localhost:3001" });
    const secret = `invite-${name}-${tag}`;
    await client.query(`UPDATE public.organization_invitations SET token_hash = $2 WHERE id = $1`, [invite.invitationId, tokenHash(secret)]);
    const accepted = await lifecycle.acceptOrganizationInvitation(client, secret, { fullName: name });
    await client.query("SELECT set_config('app.current_organization_id', $1, true)", [organizationId]);
    const grants = await grantsOf(accepted.userId);
    return { userId: accepted.userId, context: (permissions = grants.permissions) => ({ organizationId, userId: accepted.userId, roleSlugs: grants.role_slugs, permissions }) };
  };
  const company = await crm.createAccount(client, owner(), { displayName: `Sharma Traders ${tag}` });

  await check("B1. A campaign click link redirects only to an address that is in that recipient's email; any other address or token is refused", async () => {
    const mailing = await crm.createMailing(client, owner(), { name: "Diwali offer", audience: "leads", subject: "Offer", body: "Hi {{first_name}}, see https://shop.example.in/offer?a=1&b=2 today." });
    const token = "a".repeat(48);
    await client.query(`INSERT INTO tenant.crm_mailing_recipients (organization_id, mailing_id, entity_type, entity_id, email, status, token_hash) VALUES ($1, $2, 'lead', gen_random_uuid(), 'x@example.in', 'sent', $3)`,
      [organizationId, mailing.id, sha(token)]);
    const good = await crm.recordMailingClick(client, token, "https://shop.example.in/offer?a=1&b=2");
    assert(good.target === "https://shop.example.in/offer?a=1&b=2", JSON.stringify(good));
    await client.query("SELECT set_config('app.current_organization_id', $1, true)", [organizationId]);
    assert((await crm.recordMailingClick(client, token, "https://evil.example/phish")).target === null, "foreign address refused");
    await client.query("SELECT set_config('app.current_organization_id', $1, true)", [organizationId]);
    assert((await crm.recordMailingClick(client, "b".repeat(48), "https://shop.example.in/offer?a=1&b=2")).target === null, "unknown token refused");
    await client.query("SELECT set_config('app.current_organization_id', $1, true)", [organizationId]);
    assert((await crm.recordMailingClick(client, token, "javascript:alert(1)")).target === null, "non-web address refused");
  });

  await check("B2. A deal's history shows to whoever sees the deal (team grant, no lead-sensitive permission); archived leads and deals keep theirs", async () => {
    const rep = await addTeammate("Ravi Rep", "crm_salesperson");
    const team = await crm.createSalesTeam(client, owner(), { code: `T${tag}`.slice(0, 10), name: "North" });
    await crm.addSalesTeamMember(client, owner(), { teamId: team.id, userId: rep.userId, memberRole: "seller" });
    const deal = await crm.createOpportunity(client, owner(), { name: "Bulk order", accountId: company.id, teamId: team.id });
    // Only deal viewing — no crm.leads.view_sensitive, no view-all.
    const narrow = rep.context(["crm.view", "crm.opportunities.view"]);
    assert(await crm.resolveCrmEntityAccess(client, narrow, "opportunity", deal.id), "team deal's history visible");
    assert(!await crm.resolveCrmEntityAccess(client, rep.context([]), "opportunity", deal.id), "no deal permission, no history");
    await client.query(`UPDATE tenant.crm_opportunities SET archived_at = now() WHERE id = $1`, [deal.id]);
    assert(await crm.resolveCrmEntityAccess(client, owner(), "opportunity", deal.id), "archived deal keeps its history");
    const lead = await crm.createLead(client, owner(), { firstName: "Asha", lastName: "Rao", companyName: "Rao Foods", email: `asha-${tag}@example.in` });
    await crm.archiveLead(client, owner(), lead.id, {});
    assert(await crm.resolveCrmEntityAccess(client, owner(), "lead", lead.id), "archived lead keeps its history");
  });
} finally {
  await client.query("ROLLBACK").catch(() => undefined);
  await client.end();
}
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
