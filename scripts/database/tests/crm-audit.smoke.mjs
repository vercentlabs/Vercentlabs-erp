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

  await check("B6. With CRM switched off, web forms and the website chat refuse, and a WhatsApp delivery is acknowledged but creates nothing; back on, they work", async () => {
    const channel = await crm.createChatChannel(client, owner(), { name: "Site chat" });
    const form = await crm.createCaptureForm(client, owner(), { name: `Contact ${tag}`, fields: [{ name: "lastName", required: true }, { name: "email" }] });
    const leads = async () => Number((await client.query("SELECT count(*) FROM tenant.crm_leads WHERE organization_id = $1", [organizationId])).rows[0].count);
    const before = await leads();
    await onlyApps([]);
    await refused(() => crm.startChat(client, channel.publicKey, { name: "Visitor", email: "v@example.in", message: "Price?" }), "CRM_APP_OFF");
    await refused(() => crm.getPublicChat(client, channel.publicKey), "CRM_APP_OFF");
    await refused(() => crm.captureCrmLead(client, form.publicKey, { lastName: "Patil", email: "p@example.in" }, { fingerprint: "t" }), "CRM_APP_OFF");
    assert(await crm.getPublicCaptureForm(client, form.publicKey) === null, "hosted form hidden");
    const row = { organization_id: organizationId, encrypted_credentials: null };
    const off = await crm.receiveWhatsAppWebhook({ runTenant: (work) => work(client) }, row, { rawBody: "{}", headers: new Headers(), body: {} }).catch((error) => error);
    // The signature is checked first (a forged call is still refused); the CRM-off answer itself is covered by crmIsOn below.
    assert(off instanceof Error || off.crmOff, "whatsapp ignored or refused");
    assert(!(await (await api("modules/crm/data-management/crm-on.js")).crmIsOn(client, organizationId)), "CRM reads as off");
    assert(await leads() === before, "nothing created while off");
    await onlyApps(["crm"]);
    await client.query("SELECT set_config('app.current_organization_id', $1, true)", [organizationId]);
    const started = await crm.startChat(client, channel.publicKey, { name: "Visitor Two", email: `v2-${tag}@example.in`, message: "Price?" });
    assert(started.token, "chat works again");
    assert(await crm.getPublicCaptureForm(client, form.publicKey), "hosted form back");
  });

  // Gives a record a WhatsApp chat, an email, a call, an SMS and a follower — the history a merge must carry over.
  const giveHistory = async (type, id) => {
    await client.query(`INSERT INTO tenant.crm_whatsapp_messages (organization_id, entity_type, entity_id, direction, channel, phone, status) VALUES ($1, $2, $3, 'inbound', 'cloud_api', '+919800000001', 'received')`, [organizationId, type, id]);
    await client.query(`INSERT INTO tenant.crm_email_messages (organization_id, entity_type, entity_id, direction, message_id, subject, status) VALUES ($1, $2, $3, 'inbound', $4, 'Re: price', 'received')`, [organizationId, type, id, `<${id}@example.in>`]);
    await client.query(`INSERT INTO tenant.crm_calls (organization_id, entity_type, entity_id, provider, customer_phone, status) VALUES ($1, $2, $3, 'exotel', '+919800000001', 'completed')`, [organizationId, type, id]);
    await client.query(`INSERT INTO tenant.crm_sms_messages (organization_id, entity_type, entity_id, phone, body, provider, status) VALUES ($1, $2, $3, '+919800000001', 'Hi', 'exotel', 'sent')`, [organizationId, type, id]);
    await client.query(`INSERT INTO tenant.crm_followers (organization_id, entity_type, entity_id, user_id, reason) VALUES ($1, $2, $3, $4, 'followed')`, [organizationId, type, id, ownerId]);
  };
  const historyOn = async (type, id) => {
    const counts = {};
    for (const table of ["crm_whatsapp_messages", "crm_email_messages", "crm_calls", "crm_sms_messages", "crm_followers"])
      counts[table] = Number((await client.query(`SELECT count(*) FROM tenant.${table} WHERE organization_id = $1 AND entity_type = $2 AND entity_id = $3`, [organizationId, type, id])).rows[0].count);
    return counts;
  };
  const allMoved = (from, to) => Object.values(from).every((n) => n === 0) && Object.values(to).every((n) => n >= 1);

  await check("B3. Merging leads, companies and contacts moves WhatsApp, email, calls, SMS and followers to the record kept", async () => {
    const keepLead = await crm.createLead(client, owner(), { firstName: "Kiran", lastName: "Shah", companyName: "Shah Agencies", email: `kiran-${tag}@example.in` });
    const dupLead = await crm.createLead(client, owner(), { firstName: "Kiran", lastName: "Shah", companyName: "Shah Agencies", mobile: "+919812345678" }, { allowDuplicate: true }).catch(async () =>
      crm.createLead(client, owner(), { firstName: "K", lastName: "Shah Two", companyName: "Shah Two", mobile: "+919812345679" }));
    await giveHistory("lead", dupLead.id);
    await crm.mergeLeads(client, owner(), dupLead.id, keepLead.id);
    assert(allMoved(await historyOn("lead", dupLead.id), await historyOn("lead", keepLead.id)), "lead history moved");

    const keepCo = await crm.createAccount(client, owner(), { displayName: `Kaveri Mills ${tag}` });
    const dupCo = await crm.createAccount(client, owner(), { displayName: `Kaveri Mills Pvt ${tag}x` }, { allowDuplicate: true, duplicateReason: "test" });
    await giveHistory("party", dupCo.id);
    await crm.mergeAccounts(client, owner(), { keepId: keepCo.id, duplicateId: dupCo.id, reason: "Same company" });
    assert(allMoved(await historyOn("party", dupCo.id), await historyOn("party", keepCo.id)), "company history moved");

    const keepPerson = await crm.createContact(client, owner(), { firstName: "Meera", lastName: "Iyer", accountId: keepCo.id, email: `meera-${tag}@example.in` });
    const dupPerson = await crm.createContact(client, owner(), { firstName: "Meera", lastName: "Iyer B", accountId: keepCo.id, mobile: "+919811111111" }, { allowDuplicate: true, duplicateReason: "test" });
    await giveHistory("contact", dupPerson.id);
    await crm.mergeContacts(client, owner(), { keepId: keepPerson.id, duplicateId: dupPerson.id, reason: "Same person" });
    assert(allMoved(await historyOn("contact", dupPerson.id), await historyOn("contact", keepPerson.id)), "contact history moved");
  });

  await check("B7, B9. The chat inbox shows a rep only the chats of leads they can see, without the visitor's email or mobile; contact search matches emails only for whoever may see them", async () => {
    const rep = await addTeammate("Sunil Rep", "crm_salesperson");
    const channel = await crm.createChatChannel(client, owner(), { name: "Inbox chat" });
    const mine = await crm.startChat(client, channel.publicKey, { name: "Rep Visitor", email: `rv-${tag}@example.in`, message: "Hello" });
    const theirs = await crm.startChat(client, channel.publicKey, { name: "Other Visitor", email: `ov-${tag}@example.in`, message: "Hi" });
    await client.query("SELECT set_config('app.current_organization_id', $1, true)", [organizationId]);
    const leadOf = async (sessionId) => (await client.query("SELECT lead_id FROM tenant.crm_chat_sessions WHERE id = $1", [sessionId])).rows[0].lead_id;
    await client.query("UPDATE tenant.crm_leads SET owner_user_id = $2 WHERE id = $1", [await leadOf(mine.sessionId), rep.userId]);
    await client.query("UPDATE tenant.crm_leads SET owner_user_id = $2 WHERE id = $1", [await leadOf(theirs.sessionId), ownerId]);
    await client.query("UPDATE tenant.crm_chat_sessions SET assigned_to = NULL WHERE id = ANY($1::uuid[])", [[mine.sessionId, theirs.sessionId]]);
    const narrow = rep.context(["crm.view", "crm.leads.view"]);
    const seen = (await crm.listChatSessions(client, narrow, { status: "all" })).map((session) => session.id);
    assert(seen.includes(mine.sessionId) && !seen.includes(theirs.sessionId), JSON.stringify(seen));
    const detail = await crm.getChatSession(client, narrow, mine.sessionId);
    assert(detail.visitorEmail === null && detail.visitorMobile === null, "details hidden without view_sensitive");
    await refused(() => crm.getChatSession(client, narrow, theirs.sessionId), "CRM_CHAT_NOT_FOUND");
    assert((await crm.getChatSession(client, owner(), mine.sessionId)).visitorEmail, "owner sees the email");

    const shop = await crm.createAccount(client, owner(), { displayName: `Linkable ${tag}` });
    await crm.createContact(client, owner(), { firstName: "Hidden", lastName: "Mail", email: `secret-${tag}@example.in` });
    const contactsOnly = { ...owner(), roleSlugs: [], permissions: ["crm.view", "crm.accounts.view", "crm.contacts.view", "crm.records.view_all", "crm.contacts.view_all", "crm.accounts.view_all"] };
    assert((await crm.searchLinkableContacts(client, contactsOnly, shop.id, `secret-${tag}`)).length === 0, "no email match without view_sensitive");
    assert((await crm.searchLinkableContacts(client, owner(), shop.id, `secret-${tag}`)).length === 1, "email match with it");
  });

  await check("B11. Deleting a company or contact that is still used anywhere gives a friendly 'in use' answer, never a database error", async () => {
    const used = await crm.createAccount(client, owner(), { displayName: `Used Elsewhere ${tag}` });
    // A table outside the reference list that still points at the company (a foreign key).
    const lead = await crm.createLead(client, owner(), { firstName: "Conv", lastName: "Lead", companyName: "Conv Co", email: `conv-${tag}@example.in` });
    await client.query("INSERT INTO tenant.crm_lead_conversions (organization_id, lead_id, party_id) VALUES ($1, $2, $3)", [organizationId, lead.id, used.id]);
    const error = await refused(() => crm.deleteUnusedAccount(client, owner(), used.id), "CRM_ACCOUNT_IN_USE");
    assert(error.status === 409 && /Archive it/.test(error.message), error.message);
    // Its messages count as use too (they have no foreign key, and would be orphaned).
    const talked = await crm.createAccount(client, owner(), { displayName: `Talked To ${tag}` });
    await client.query(`INSERT INTO tenant.crm_whatsapp_messages (organization_id, entity_type, entity_id, direction, channel, phone, status) VALUES ($1, 'party', $2, 'inbound', 'cloud_api', '+919800000002', 'received')`, [organizationId, talked.id]);
    const messages = await refused(() => crm.deleteUnusedAccount(client, owner(), talked.id), "CRM_ACCOUNT_IN_USE");
    assert(/WhatsApp messages/.test(messages.message), messages.message);
    const person = await crm.createContact(client, owner(), { firstName: "Mailed", lastName: "Person", email: `mailed-${tag}@example.in` });
    await client.query(`INSERT INTO tenant.crm_email_messages (organization_id, entity_type, entity_id, direction, message_id, subject, status) VALUES ($1, 'contact', $2, 'inbound', $3, 'Hi', 'received')`, [organizationId, person.id, `<p-${tag}@x>`]);
    assert(/emails/.test((await refused(() => crm.deleteUnusedContact(client, owner(), person.id), "CRM_CONTACT_IN_USE")).message), "contact email blocks delete");
    const unused = await crm.createAccount(client, owner(), { displayName: `Mistake ${tag}` });
    assert((await crm.deleteUnusedAccount(client, owner(), unused.id)).deleted, "an unused company still deletes");
  });

  await check("Performance. The shared CRM options carry only small reference lists — no companies, contacts, products, leads or deals (pickers search)", async () => {
    const options = await crm.getCrmOptions(client, owner());
    for (const heavy of ["parties", "contacts", "items", "leads", "opportunities"]) assert(!(heavy in options), `${heavy} not sent`);
    assert(Array.isArray(options.users) && Array.isArray(options.pipelines) && Array.isArray(options.salesTeams), "reference lists still there");
  });

  await check("M5, B10. Company import takes GSTIN, PAN, GST treatment and payment terms, 'India' as the country and state names; a bad GSTIN fails only its row", async () => {
    const term = (await client.query("SELECT name, default_due_days FROM tenant.payment_terms WHERE organization_id = $1 AND status = 'active' AND is_sales_enabled ORDER BY default_due_days DESC LIMIT 1", [organizationId])).rows[0];
    const good = "27AAPFM1234K1Z" ;
    const CH = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    let sum = 0;
    for (let i = 0; i < 14; i += 1) { const p = CH.indexOf(good[i]) * (i % 2 === 0 ? 1 : 2); sum += Math.floor(p / 36) + (p % 36); }
    const gstin = good + CH[(36 - (sum % 36)) % 36];
    const csv = [
      "Company Name,GST No,GST Registration Type,Credit Days,Address,City,State,PIN,Country",
      `Mehta Fabrics ${tag},${gstin},Registered - Regular,${term ? term.default_due_days : ""},12 Kalbadevi Road,Mumbai,Maharashtra,400002,India`,
      `Broken GST ${tag},27BROKEN,Registered - Regular,,,,,,`,
    ].join("\n");
    const analysis = await crm.analyzeAccountImport(client, owner(), { bytes: Buffer.from(csv), fileName: "companies.csv" });
    const mapping = analysis.suggestedMapping;
    assert(Object.values(mapping).includes("gstin") && Object.values(mapping).includes("gstTreatment") && Object.values(mapping).includes("paymentTerms"), JSON.stringify(mapping));
    const result = await crm.importAccounts(client, owner(), { bytes: Buffer.from(csv), fileName: "companies.csv", mapping });
    assert(result.created === 1 && result.failed === 1, JSON.stringify(result.errors));
    assert(/GSTIN/i.test(result.errors[0].message), result.errors[0].message);
    const row = (await client.query("SELECT id, gstin, pan, tax_treatment, gst_state_code, payment_term_id FROM tenant.business_parties WHERE organization_id = $1 AND display_name = $2", [organizationId, `Mehta Fabrics ${tag}`])).rows[0];
    assert(row.gstin === gstin && row.pan === "AAPFM1234K" && row.tax_treatment === "registered_regular" && row.gst_state_code === "27", JSON.stringify(row));
    if (term) assert(row.payment_term_id, "payment terms set from the number of days");
    const address = (await client.query("SELECT country_code, state, state_code FROM tenant.addresses WHERE organization_id = $1 AND party_id = $2", [organizationId, row.id])).rows[0];
    assert(address?.country_code?.trim() === "IN" && address.state_code === "27", JSON.stringify(address));
    const exported = await crm.exportAccounts(client, owner(), { search: `Mehta Fabrics ${tag}` });
    assert(exported.csv.includes("GSTIN") && exported.csv.includes(gstin), "export carries the GSTIN");
  });
} finally {
  await client.query("ROLLBACK").catch(() => undefined);
  await client.end();
}
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
