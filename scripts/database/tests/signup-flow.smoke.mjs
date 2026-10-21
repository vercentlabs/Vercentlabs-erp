// MVP 44 (new workspace signup and email-code sign-in): the 4 details are checked; a 6-digit code (10 minutes, 5 wrong tries, a new one
// cancels the old, 30 seconds between codes, 5 an hour) proves the email; no website → the person's one line suggests the apps; the
// workspace is made in one go with only the picked apps switched on, no password, the email verified and what we understood saved; an
// email that already has a workspace gets no second one; sign-in by code never says whether an email is registered; someone without a
// password confirms sensitive changes with a code; the website reader refuses private addresses; the Get started card ticks itself and
// can be closed and reopened; the GST question saves to the company registration; an invited teammate joins with just a name.
//
//   SMOKE_DATABASE=vercentlabs_verify pnpm test:signup-flow     (the database URL comes from apps/web/.env.local MIGRATION_DATABASE_URL)
//
// Everything runs in ONE transaction as the restricted app role and is rolled back.
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
if (/_control$/.test(url.pathname) && process.env.SMOKE_ALLOW_LIVE !== "yes") throw new Error("Refusing to run the signup suite on the live database. Set SMOKE_DATABASE to a scratch database.");
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
    console.log("  FAIL ", name, "\n        ", String(error?.stack || error).split("\n").slice(0, 5).join("\n         "));
  }
}
function assert(condition, message) { if (!condition) throw new Error("assertion failed: " + message); }
async function refused(work, code) {
  await client.query("SAVEPOINT refused");
  try { await work(); } catch (error) { await client.query("ROLLBACK TO SAVEPOINT refused"); if (code && error.code !== code) throw new Error(`expected ${code}, got ${error.code}: ${error.message}`); return error; }
  await client.query("RELEASE SAVEPOINT refused");
  throw new Error(`expected rejection ${code ?? ""}`);
}
const CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
function gstin(state, pan, entity = "1") {
  const base = `${state}${pan}${entity}Z`;
  let sum = 0;
  for (let i = 0; i < 14; i += 1) { const p = CHARS.indexOf(base[i]) * (i % 2 === 0 ? 1 : 2); sum += Math.floor(p / 36) + (p % 36); }
  return base + CHARS[(36 - (sum % 36)) % 36];
}

try {
  await client.query("BEGIN");
  await client.query("SET LOCAL ROLE vercent_app");
  const tag = Math.random().toString(16).slice(2, 10);
  const signup = await api("core/organization/signup/index.js");
  const codes = await api("core/auth/email-code.js");
  const codeAuth = await api("core/auth/code-sign-in.js");
  const { tokenHash } = await api("core/auth/session.js");
  const start = await api("core/organization/workspace-start.js");
  const lifecycle = await api("core/auth/lifecycle.js");
  const NO_AI = { APP_URL: "http://localhost:3001" };
  // The test can't read the email, so it sets a code it knows on the latest one.
  const knownCode = async (email, purpose, code = "246810") => {
    await client.query(`UPDATE public.email_codes SET code_hash = $3 WHERE id = (SELECT id FROM public.email_codes WHERE lower(email) = $1 AND purpose = $2 AND consumed_at IS NULL AND cancelled_at IS NULL ORDER BY created_at DESC LIMIT 1)`,
      [email, purpose, tokenHash(`${email}|${purpose}|${code}`)]);
    return code;
  };
  const age = (email, seconds) => client.query(`UPDATE public.email_codes SET created_at = created_at - ($2 || ' seconds')::interval WHERE lower(email) = $1`, [email, String(seconds)]);
  const email = `ravi-${tag}@sharmatextiles.in`;
  let token;

  await check("S1. Screen 1: each field is checked with its own message; a website gets https://; Continue sends a code", async () => {
    const field = async (input, name) => (await refused(() => signup.startSignup(client, input, { env: NO_AI }), "SIGNUP_INVALID")).details.field === name;
    const ok = { fullName: "Ravi Kumar", email, companyName: "Sharma Textiles" };
    assert(await field({ ...ok, fullName: "R" }, "fullName") && await field({ ...ok, email: "ravi@" }, "email") && await field({ ...ok, companyName: "S" }, "companyName")
      && await field({ ...ok, website: "not a website" }, "website"), "messages per field");
    const started = await signup.startSignup(client, { ...ok, website: "", timezone: "Asia/Kolkata" }, { env: NO_AI, ipAddress: "203.0.113.9" });
    token = started.token;
    const mail = (await client.query(`SELECT template, subject FROM public.mail_log WHERE $1 = ANY(recipients) ORDER BY created_at DESC LIMIT 1`, [email])).rows[0];
    assert(mail.template === "sign-in-code" && !/\d{6}/.test(mail.subject), "the code is queued, and never stored in plain text");
    assert(signup.normalizeWebsite("sharmatextiles.in") === "https://sharmatextiles.in" && signup.normalizeWebsite("http://a.in/") === "https://a.in", "https added");
  });

  await check("S2. Code rules: 5 wrong tries lock the code; a new one only after 30 seconds and it cancels the old; an expired code is replaced; at most 5 codes an hour", async () => {
    for (let i = 0; i < 4; i += 1) assert((await signup.verifySignupCode(client, token, "000000", NO_AI)).reason === "wrong", "wrong");
    assert((await signup.verifySignupCode(client, token, "000000", NO_AI)).reason === "locked", "fifth try locks");
    assert((await signup.verifySignupCode(client, token, "000000", NO_AI)).reason === "locked", "stays locked");
    await refused(() => signup.resendSignupCode(client, token, NO_AI), "AUTH_CODE_TOO_SOON");
    await age(email, 31);
    await signup.resendSignupCode(client, token, NO_AI);
    const live = (await client.query(`SELECT count(*)::int AS n FROM public.email_codes WHERE lower(email) = $1 AND cancelled_at IS NULL AND consumed_at IS NULL`, [email])).rows[0].n;
    assert(live === 1, "a new code cancels the old");
    await client.query(`UPDATE public.email_codes SET expires_at = now() - interval '1 minute' WHERE lower(email) = $1 AND cancelled_at IS NULL`, [email]);
    await age(email, 31);
    assert((await signup.verifySignupCode(client, token, "123456", NO_AI)).reason === "expired", "expired");
    assert((await client.query(`SELECT count(*)::int AS n FROM public.email_codes WHERE lower(email) = $1 AND cancelled_at IS NULL AND consumed_at IS NULL AND expires_at > now()`, [email])).rows[0].n === 1, "a new one was sent");
    await age(email, 31);
    await signup.resendSignupCode(client, token, NO_AI);
    await age(email, 31);
    await signup.resendSignupCode(client, token, NO_AI);
    await age(email, 31);
    await refused(() => signup.resendSignupCode(client, token, NO_AI), "AUTH_CODE_LIMIT");
  });

  await check("S3. The right code: no website, so Screen 3 asks what the business does; one line suggests apps (a limit of 5 suggestion runs)", async () => {
    const code = await knownCode(email, "signup");
    const result = await signup.verifySignupCode(client, token, code, NO_AI);
    assert(result.ok && !result.existingUserId, JSON.stringify(result));
    assert((await signup.getSignupState(client, token)).next === "describe", "Screen 3");
    await refused(() => signup.describeSignupBusiness(client, token, "x", { env: NO_AI }), "SIGNUP_INVALID");
    const state = await signup.describeSignupBusiness(client, token, "We make cotton fabric and sell to shops", { env: NO_AI });
    assert(state.next === "apps" && state.apps.suggested[0].key === "manufacturing" && state.apps.suggested.length <= 5 && state.apps.others.length === 12 - state.apps.suggested.length,
      JSON.stringify(state.apps.suggested));
    assert(state.profile.confidence === "medium" && state.suggestionsLeft === 4, JSON.stringify(state.profile));
  });

  let organizationId;
  let ownerId;
  await check("S4. Set up workspace: one transaction — only the picked apps on, the first app first, no password, email verified, owner, what we understood saved, the website text not kept", async () => {
    await refused(() => signup.completeSignup(client, token, { apps: [] }, { env: NO_AI }), "SIGNUP_INVALID");
    const done = await signup.completeSignup(client, token, { apps: ["manufacturing", "sales", "bogus"] }, { env: NO_AI });
    organizationId = done.organizationId;
    ownerId = done.userId;
    assert(done.firstApp === "manufacturing" && done.apps.length === 2, JSON.stringify(done));
    await client.query("SELECT set_config('app.current_organization_id', $1, true)", [organizationId]);
    const modules = (await client.query(`SELECT module_key FROM public.organization_modules WHERE organization_id = $1 AND status = 'enabled' ORDER BY module_key`, [organizationId])).rows.map((r) => r.module_key);
    // Manufacturing keeps the Stock it needs on (its app manifest).
    assert(modules.join() === "manufacturing,sales,stock", modules.join());
    const user = (await client.query(`SELECT password_hash, email_verified_at FROM public.users WHERE id = $1`, [ownerId])).rows[0];
    assert(user.password_hash === null && user.email_verified_at, "no password, verified");
    const org = (await client.query(`SELECT country_code, base_currency, timezone, business_profile FROM public.organizations WHERE id = $1`, [organizationId])).rows[0];
    assert(org.country_code.trim() === "IN" && org.base_currency === "INR" && org.business_profile.firstApp === "manufacturing" && /cotton/.test(org.business_profile.description), JSON.stringify(org));
    const free = (await client.query(`SELECT selected_modules FROM public.organization_subscriptions WHERE organization_id = $1`, [organizationId])).rows[0];
    assert(JSON.stringify(free.selected_modules) === '["manufacturing"]', "the Free plan's app is pre-filled");
    const row = (await client.query(`SELECT status, website_text FROM public.signup_requests WHERE token_hash = $1`, [tokenHash(token)])).rows[0];
    assert(row.status === "completed" && row.website_text === null, "completed");
    await refused(() => signup.completeSignup(client, token, { apps: ["sales"] }, { env: NO_AI }), "SIGNUP_STATE");
    const off = (await client.query(`SELECT count(*)::int AS n FROM public.audit_events WHERE organization_id = $1 AND event_type = 'module.disabled'`, [organizationId])).rows[0].n;
    assert(off === 9, String(off)); // 12 apps less the 2 picked and the Stock Manufacturing needs
  });

  await check("S5. The same email again: a code is still sent, and after it the person goes to the workspace they have — never a second one", async () => {
    await client.query("SELECT set_config('app.current_organization_id', '', true)");
    await age(email, 3600);
    const again = await signup.startSignup(client, { fullName: "Ravi Kumar", email, companyName: "Another Co", website: "sharmatextiles.in" }, { env: NO_AI });
    assert(again.website === null, "the website is not read for an existing workspace");
    await age(email, 31);
    const code = await knownCode(email, "signup", "135790");
    const result = await signup.verifySignupCode(client, again.token, code, NO_AI);
    assert(result.ok && result.existingUserId === ownerId, JSON.stringify(result));
    await refused(() => signup.completeSignup(client, again.token, { apps: ["crm"] }, { env: NO_AI }), "SIGNUP_EXISTING_WORKSPACE");
  });

  await check("S6. Sign-in by code: a known email gets a code that signs in; an unknown one gets the same answer and an invitation to set one up; a code for one email doesn't work for another", async () => {
    await age(email, 3600);
    const known = await codeAuth.requestSignInCode(client, email, NO_AI);
    const stranger = `nobody-${tag}@example.test`;
    const unknown = await codeAuth.requestSignInCode(client, stranger, NO_AI);
    assert(known.message === unknown.message, "same answer either way");
    const strangerMail = (await client.query(`SELECT template FROM public.mail_log WHERE $1 = ANY(recipients) ORDER BY created_at DESC LIMIT 1`, [stranger])).rows[0];
    assert(strangerMail.template === "sign-in-no-account", strangerMail.template);
    const code = await knownCode(email, "sign_in", "112233");
    assert((await codeAuth.verifySignInCode(client, stranger, code, NO_AI)).ok === false, "not for another email");
    const result = await codeAuth.verifySignInCode(client, email, code, NO_AI);
    assert(result.ok && result.userId === ownerId, JSON.stringify(result));
    assert((await codeAuth.verifySignInCode(client, email, code, NO_AI)).ok === false, "a code works once");
  });

  await check("S7. Confirming it's you: no password → a code to the email marks this session for 10 minutes; with a password, the password", async () => {
    const sessionId = (await client.query(`INSERT INTO public.sessions (id, user_id, token_hash, expires_at, idle_expires_at) VALUES (gen_random_uuid(), $1, $2, now() + interval '1 day', now() + interval '1 day') RETURNING id`,
      [ownerId, tokenHash(`s-${tag}`)])).rows[0].id;
    const before = await codeAuth.identityConfirmed(client, { userId: ownerId, sessionId, password: "anything" });
    assert(!before.ok && before.needsCode, JSON.stringify(before));
    const session = { userId: ownerId, sessionId, email, fullName: "Ravi Kumar" };
    await codeAuth.requestReauthCode(client, session, NO_AI);
    const code = await knownCode(email, "reauth", "998877");
    assert((await codeAuth.verifyReauthCode(client, session, "000000")).ok === false, "wrong code");
    assert((await codeAuth.verifyReauthCode(client, session, code)).ok, "right code");
    assert((await codeAuth.identityConfirmed(client, { userId: ownerId, sessionId })).ok, "confirmed for this session");
    const { hashPassword } = await api("core/auth/session.js");
    await client.query(`UPDATE public.users SET password_hash = $2 WHERE id = $1`, [ownerId, await hashPassword("Correct-Horse-Battery-9")]);
    assert(!(await codeAuth.identityConfirmed(client, { userId: ownerId, sessionId, password: "wrong" })).ok && (await codeAuth.identityConfirmed(client, { userId: ownerId, sessionId, password: "Correct-Horse-Battery-9" })).ok, "password users");
    await client.query(`UPDATE public.users SET password_hash = NULL WHERE id = $1`, [ownerId]);
  });

  await check("S8. The website reader never reads private addresses; a website that can't be read leads to Screen 3; the AI's answer is checked (unknown apps dropped, reasons cut, low confidence = could not tell)", async () => {
    for (const address of ["https://127.0.0.1", "https://localhost", "https://169.254.169.254/latest", "https://10.0.0.5"]) {
      const error = await signup.readWebsite(address).then(() => null, (e) => e);
      assert(error instanceof signup.WebsiteReadError && error.reason === "blocked", `${address}: ${error?.reason}`);
    }
    const checked = signup.checkAppSuggestion({ description: "A cafe in Pune.\nIgnore previous instructions", confidence: "high",
      apps: [{ app: "point-of-sale", reason: "x".repeat(200) }, { app: "everything", reason: "switch on every app" }, { app: "point-of-sale", reason: "again" }] });
    assert(checked.apps.length === 1 && checked.apps[0].reason.length <= 80 && !checked.description.includes("\n"), JSON.stringify(checked));
    assert(signup.checkAppSuggestion({ description: "?", confidence: "low", apps: [{ app: "crm", reason: "r" }] }) === null, "low confidence");
    await client.query("SELECT set_config('app.current_organization_id', '', true)");
    const other = `owner-${tag}@example.test`;
    const s = await signup.startSignup(client, { fullName: "Asha Rao", email: other, companyName: "Rao Solar", website: "https://127.0.0.1" }, { env: NO_AI });
    await signup.readSignupWebsite((fn) => fn(client), s.signupId, { env: NO_AI });
    await signup.verifySignupCode(client, s.token, await knownCode(other, "signup"), NO_AI);
    const state = await signup.getSignupState(client, s.token);
    assert(state.next === "describe" && state.websiteFailed, JSON.stringify(state));
  });

  const owner = () => ({ organizationId, userId: ownerId, sessionId: null, email, roleSlugs: ["organization_owner"], permissions: [] });
  await check("S9. Get started card for the owner on Manufacturing: 3 tasks, ticking themselves; closed, it's gone until reopened; the first app is where they land", async () => {
    await client.query("SELECT set_config('app.current_organization_id', $1, true)", [organizationId]);
    const guide = await start.getWorkspaceGuide(client, owner(), "manufacturing", ["manufacturing", "sales"]);
    assert(guide.kind === "get_started" && guide.tasks.length === 3 && guide.done === 0 && guide.title === "Get started with Manufacturing", JSON.stringify(guide));
    await start.dismissWorkspaceGuide(client, owner(), { guide: "get_started", moduleKey: "manufacturing" });
    assert(await start.getWorkspaceGuide(client, owner(), "manufacturing") === null, "closed");
    await start.reopenWorkspaceGuide(client, owner(), "manufacturing");
    assert((await start.getWorkspaceGuide(client, owner(), "manufacturing"))?.kind === "get_started", "reopened");
    assert(await start.startingModule(client, owner(), ["sales", "manufacturing"]) === "manufacturing", "first app");
    await start.rememberLastModule(client, owner(), "sales");
    assert(await start.startingModule(client, owner(), ["sales", "manufacturing"]) === "sales", "last used");
  });

  await check("S10. The GST question: needed for a new company; 'Yes' with the GSTIN saves the company registration and its state; Accounting's GST task is then done", async () => {
    const before = await start.getGstDetailsStatus(client, owner());
    assert(before.needed && before.canEdit, JSON.stringify(before));
    await refused(() => start.saveGstDetails(client, { ...owner(), roleSlugs: [], permissions: [] }, { registered: true, gstin: "x" }), "GST_DETAILS_DENIED");
    const own = gstin("24", "AAPCS1234K");
    const after = await start.saveGstDetails(client, owner(), { registered: true, gstin: own });
    assert(!after.needed && after.gstin === own && after.stateCode === "24", JSON.stringify(after));
    await client.query(`UPDATE public.organization_modules SET status = 'enabled' WHERE organization_id = $1 AND module_key = 'accounting'`, [organizationId]);
    const acc = await start.getWorkspaceGuide(client, owner(), "accounting");
    assert(acc.tasks.find((t) => t.action === "gst").done, "GST task done");
  });

  await check("S11. A teammate joins from the invite with just a name (no password), and sees a Welcome card instead of Get started", async () => {
    const roleId = (await client.query(`SELECT id FROM public.roles WHERE organization_id = $1 AND slug = 'sales_representative'`, [organizationId])).rows[0].id;
    const mate = `mate-${tag}@example.test`;
    const invite = await lifecycle.createOrganizationInvitation(client, { organizationId, invitedByUserId: ownerId, email: mate, roleIds: [roleId], primaryRoleId: roleId, note: "Welcome aboard",
      inviter: { roleSlugs: ["organization_owner"], permissions: [] } }, NO_AI);
    const mail = (await client.query(`SELECT template FROM public.mail_log WHERE $1 = ANY(recipients) ORDER BY created_at DESC LIMIT 1`, [mate])).rows[0];
    assert(mail.template === "organization-invitation", "invitation queued");
    await client.query(`UPDATE public.organization_invitations SET token_hash = $2 WHERE id = $1`, [invite.invitationId, tokenHash(`invite-${tag}`)]);
    await client.query("SAVEPOINT accept");
    const accepted = await lifecycle.acceptOrganizationInvitation(client, `invite-${tag}`, { fullName: "Meena Shah" });
    assert(accepted.mintNewSession, "new account");
    await client.query("SELECT set_config('app.current_organization_id', $1, true)", [organizationId]);
    const user = (await client.query(`SELECT password_hash, email_verified_at FROM public.users WHERE id = $1`, [accepted.userId])).rows[0];
    assert(user.password_hash === null && user.email_verified_at, "no password, the link proved the email");
    const guide = await start.getWorkspaceGuide(client, { organizationId, userId: accepted.userId, email: mate, roleSlugs: ["sales_representative"], permissions: ["sales.view"] }, "sales", ["sales"]);
    assert(guide.kind === "welcome" && /Ravi gave you access to Sales/.test(guide.line), JSON.stringify(guide));
  });
} finally {
  await client.query("ROLLBACK").catch(() => undefined);
  await client.end();
}
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
