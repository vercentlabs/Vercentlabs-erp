// Support MVP 37 (the ticket desk): a customer emails support → one ticket, matched to the customer and contact, acknowledged; the agent
// replies from the support mailbox (its delivery state is the mail queue's); the customer's reply joins the same ticket; private notes are
// never emailed; resolve, close, reopen — a reply to a resolved ticket reopens it, to a closed one opens a linked follow-up; no duplicate
// tickets on redelivery; blocked senders, loops, bounces, unmatched senders, deadlines and their pause, permissions, visibility, isolation,
// dashboard, reports and settings.
//
//   SMOKE_DATABASE=vercentlabs_verify pnpm test:support-desk     (the database URL comes from apps/web/.env.local MIGRATION_DATABASE_URL)
//
// Everything runs in ONE transaction as the restricted app role and is rolled back.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = process.env.SMOKE_ROOT ?? fileURLToPath(new URL("../../../", import.meta.url)).replaceAll("\\", "/");
const require = createRequire(ROOT + "package.json");
const pg = require("pg");
const dotenv = require("dotenv");
const api = (path) => import(`file:///${ROOT}services/api/src/${path}`);

const env = dotenv.parse(readFileSync(ROOT + "apps/web/.env.local"));
const url = new URL(env.MIGRATION_DATABASE_URL);
url.pathname = "/" + (process.env.SMOKE_DATABASE || "vercentlabs_verify");
if (/_control$/.test(url.pathname) && process.env.SMOKE_ALLOW_LIVE !== "yes") throw new Error("Refusing to run the Support suite on the live database. Set SMOKE_DATABASE to a scratch database.");
const client = new pg.Client({ connectionString: url.toString() });
await client.connect();
// A mail transport counts as configured (nothing is sent: the queue is driven by hand below).
const noMailEnv = Object.fromEntries(Object.entries({ ...process.env, ...env }).filter(([k]) => !/^SMTP_|^AUTH_EMAIL_(WEBHOOK|FROM)/.test(k)));
const mailEnv = { ...noMailEnv, AUTH_EMAIL_WEBHOOK_URL: "http://127.0.0.1:9/never" };

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

try {
  await client.query("BEGIN");
  await client.query("SET LOCAL ROLE vercent_app");
  const { registerOrganization } = await api("core/organization/registration.js");
  const tag = Math.random().toString(16).slice(2, 10);
  const register = (name) => registerOrganization(client, {
    fullName: "Smoke Owner", email: `${name}-${tag}@example.test`, password: "Tr1al-Workspace-Passphrase!", organizationName: `${name} ${tag}`, countryCode: "IN", baseCurrency: "INR",
    timezone: "Asia/Kolkata",
  });
  const other = await register("othersupport");
  const registered = await register("support");
  const organizationId = registered.organizationId;
  const switchTo = (org) => client.query("SELECT set_config('app.current_organization_id', $1, true)", [org]);
  await switchTo(organizationId);
  async function contextFor(userId, org = organizationId) {
    const { rows } = await client.query(
      `SELECT COALESCE(array_agg(DISTINCT role.slug), ARRAY[]::text[]) AS role_slugs,
              COALESCE(array_agg(DISTINCT grant_row.permission_key) FILTER (WHERE grant_row.permission_key IS NOT NULL), ARRAY[]::text[]) AS permissions
         FROM user_role_assignments assignment JOIN roles role ON role.id = assignment.role_id
         LEFT JOIN role_permissions grant_row ON grant_row.role_id = role.id
        WHERE assignment.organization_id = $1 AND assignment.user_id = $2`, [org, userId]);
    return { organizationId: org, userId, roleSlugs: rows[0].role_slugs, permissions: rows[0].permissions };
  }
  async function addMember(roleSlug, name) {
    const id = (await client.query(`INSERT INTO users (id, email, full_name, password_hash, status) VALUES (gen_random_uuid(), $1, $2, 'x', 'active') RETURNING id`,
      [`${name.split(" ")[0].toLowerCase()}-${tag}@example.test`, name])).rows[0].id;
    await client.query(`INSERT INTO organization_memberships (organization_id, user_id, role, status) VALUES ($1, $2, 'member', 'active')`, [organizationId, id]);
    await client.query(`INSERT INTO user_role_assignments (organization_id, user_id, role_id, is_primary, status) SELECT $1, $2, id, true, 'active' FROM roles WHERE organization_id = $1 AND slug = $3`,
      [organizationId, id, roleSlug]);
    return contextFor(id);
  }
  const owner = await contextFor(registered.userId);
  const lead = await addMember("support_manager", "Sara Lead");
  const agent = await addMember("customer_success_manager", "Arjun Agent");
  const agent2 = await addMember("customer_success_manager", "Bela Agent");
  const seller = await addMember("sales_manager", "Meera Sales");
  const buyer = await addMember("buyer", "Bina Buyer");
  const sd = await api("modules/support/desk/index.js");
  const crm = await api("modules/crm/index.js");

  // The customer Lumen Retail and its contact Asha (asha@lumen.example); a second contact sharing an address with another account.
  const lumen = await crm.createAccount(client, owner, { displayName: "Lumen Retail" });
  const asha = await crm.createContact(client, owner, { accountId: lumen.id, firstName: "Asha", lastName: "Rao", email: `asha-${tag}@lumen.example` });
  await client.query(`UPDATE tenant.business_parties SET party_type = 'customer' WHERE id = $1 AND party_type NOT IN ('customer', 'both')`, [lumen.id]);
  const shared = `shared-${tag}@example.test`;
  const acmeA = await crm.createAccount(client, owner, { displayName: "Acme A" });
  const acmeB = await crm.createAccount(client, owner, { displayName: "Acme B" });
  await crm.createContact(client, owner, { accountId: acmeA.id, firstName: "Sam", lastName: "One", email: shared });
  const samTwo = await crm.createContact(client, owner, { accountId: acmeB.id, firstName: "Sam", lastName: "Two", email: `sam2-${tag}@example.test` });
  await client.query(`UPDATE tenant.contacts SET email = $2 WHERE id = $1`, [samTwo.id, shared]);

  // The support mailbox, connected to an inbound route.
  const route = (await client.query(`INSERT INTO public.inbound_mail_routes (organization_id, name, route_key_hash, route_key_prefix, target, recorded_as_user_id, encrypted_signing_secret)
    VALUES ($1, 'Support inbox', $2, $3, 'support.email_to_ticket', $4, '{}'::jsonb) RETURNING *`, [organizationId, `h-${tag}`, `p${tag}`, lead.userId])).rows[0];
  const address = `help-${tag}@vercent.example`;
  await refused(() => sd.saveSupportMailbox(client, agent, { name: "Help", address }), "SUPPORT_ACCESS_DENIED");
  const mailbox = await sd.saveSupportMailbox(client, lead, { name: "Help desk", address, displayName: "Vercent Help", inboundRouteId: route.id, defaultAgentUserId: agent.userId,
    blockedDomains: "spam.example", signature: "Vercent Help Desk" });
  let mid = 0;
  const email = (extra = {}) => ({ provider: "test", messageId: `<m${++mid}-${tag}@customer.example>`, references: [], from: `asha-${tag}@lumen.example`, fromName: "Asha Rao",
    to: [address], subject: "Lamp not switching on", text: "The lamp I bought does not switch on.", attachments: [], autoSubmitted: false, ...extra });
  const deliver = (message) => sd.deliverEmailToSupport(client, route, message, [], { env: mailEnv });
  const ticketOf = (id, ctx = lead) => sd.getSupportTicket(client, ctx, id);
  const step = async (fn, ctx, id, input = {}, ...rest) => { const t = await ticketOf(id); return fn(client, ctx, id, { version: t.rowVersion, ...input }, ...rest); };
  const mail = async (communicationId) => (await client.query(`SELECT l.* FROM public.mail_log l JOIN tenant.support_communications m ON m.mail_log_id = l.id WHERE m.id = $1`, [communicationId])).rows[0];

  let first;
  let firstMail;
  await check("S1. Email-to-ticket: one ticket numbered TKT-, matched to the customer and its contact, given to the mailbox's agent, deadlines set, acknowledged by email; a redelivery creates nothing", async () => {
    firstMail = email();
    const r = await deliver(firstMail);
    assert(r.outcome === "new_ticket", JSON.stringify(r));
    first = await ticketOf(r.ticketId);
    assert(/^TKT/.test(first.number) && first.source === "EMAIL" && first.customer?.id === lumen.id && first.contact?.id === asha.id && first.agent?.id === agent.userId && !first.unmatched, JSON.stringify(first.customer));
    assert(first.responseDue && first.resolutionDue && first.response === "RUNNING" && first.status === "open", JSON.stringify([first.status, first.response]));
    const ack = first.messages.find((m) => m.kind === "SYSTEM");
    assert(ack && ack.delivery === "QUEUED" && ack.to[0] === `asha-${tag}@lumen.example` && /TKT/.test(ack.subject), JSON.stringify(ack));
    const again = await deliver(firstMail);
    assert(again.outcome === "duplicate" && again.ticketId === first.id, JSON.stringify(again));
    assert((await sd.listSupportTickets(client, lead, { search: "Lamp not switching" })).length === 1, "one ticket");
  });

  let replyId;
  await check("S2. The agent replies from the support mailbox: a message with its own Message-ID answering the customer's email, queued until the mail worker sends it; sent and bounced come from the mail log; a failed reply is sent again", async () => {
    await refused(() => sd.replyToSupportCustomer(client, seller, first.id, { body: "x" }, mailEnv), "SUPPORT_ACCESS_DENIED");
    const r = await sd.replyToSupportCustomer(client, agent, first.id, { body: "Please check the switch on the cord.", idempotencyKey: `r-${tag}` }, mailEnv);
    const again = await sd.replyToSupportCustomer(client, agent, first.id, { body: "Please check the switch on the cord.", idempotencyKey: `r-${tag}` }, mailEnv);
    assert(r.delivery === "QUEUED" && again.replayed && again.id === r.id, JSON.stringify(r));
    replyId = r.id;
    const row = (await client.query(`SELECT * FROM tenant.support_communications WHERE id = $1`, [r.id])).rows[0];
    assert(row.kind === "REPLY" && row.in_reply_to === firstMail.messageId && row.external_message_id.startsWith("<tkt-") && row.sender_address === address, JSON.stringify(row));
    const log = await mail(r.id);
    assert(log.status === "queued" && log.template === "support_reply" && log.message_id === row.external_message_id, log.status);
    let t = await ticketOf(first.id);
    assert(t.firstRespondedAt && t.response === "MET", t.response);
    await client.query(`UPDATE public.mail_log SET status = 'sent', sent_at = now() WHERE id = $1`, [log.id]);
    t = await ticketOf(first.id);
    assert(t.messages.find((m) => m.id === r.id).delivery === "SENT", "sent");
    await client.query(`UPDATE public.mail_log SET status = 'failed', last_error = 'Connection refused' WHERE id = $1`, [log.id]);
    t = await ticketOf(first.id);
    const failed = t.messages.find((m) => m.id === r.id);
    assert(failed.delivery === "SENT" || failed.delivery === "FAILED", failed.delivery);
    const unconfigured = await sd.replyToSupportCustomer(client, agent, first.id, { body: "Second try" }, noMailEnv);
    assert(unconfigured.delivery === "FAILED" && /not sent/.test(unconfigured.error), JSON.stringify(unconfigured));
    const retried = await sd.retrySupportReply(client, agent, first.id, { messageId: unconfigured.id }, mailEnv);
    assert(retried.delivery === "QUEUED", JSON.stringify(retried));
    await refused(() => sd.retrySupportReply(client, agent, first.id, { messageId: unconfigured.id }, mailEnv), "SUPPORT_TICKET_STATE");
  });

  await check("S3. The customer's reply joins the same ticket (by In-Reply-To, or the ticket number in the subject); waiting on the customer pauses the clock and their reply resumes it", async () => {
    await step(sd.setSupportTicketStatus, agent, first.id, { status: "pending_customer" });
    let t = await ticketOf(first.id);
    assert(t.status === "pending_customer" && t.response === "MET" && t.resolution === "PAUSED", JSON.stringify([t.status, t.resolution]));
    const reply = (await client.query(`SELECT external_message_id FROM tenant.support_communications WHERE id = $1`, [replyId])).rows[0].external_message_id;
    const r = await deliver(email({ subject: `Re: Lamp not switching on [${first.number}]`, text: "Still dead after checking the switch.", references: [reply] }));
    assert(r.outcome === "reply" && r.ticketId === first.id, JSON.stringify(r));
    t = await ticketOf(first.id);
    assert(t.status === "open" && t.messages.filter((m) => m.kind === "CUSTOMER").length === 2 && !t.messages.some((m) => m.kind === "SYSTEM" && m.at > t.createdAt && m.subject?.includes("Re: Re")), t.status);
    const bySubject = await deliver(email({ subject: `About ${first.number} — [${first.number}]`, text: "Photo attached." }));
    assert(bySubject.ticketId === first.id && bySubject.outcome === "reply", JSON.stringify(bySubject));
  });

  await check("S4. Private notes are staff-only and never emailed (the database refuses a note with recipients); someone who may not see notes doesn't get them", async () => {
    await sd.addSupportNote(client, agent, first.id, { body: "Customer is a key account — replace, don't repair." });
    const t = await ticketOf(first.id);
    const note = t.messages.find((m) => m.kind === "NOTE");
    assert(note.private && note.delivery === null && note.to.length === 0, JSON.stringify(note));
    await refused(() => client.query(`UPDATE tenant.support_communications SET to_addresses = ARRAY['x@y.z'] WHERE id = $1`, [note.id]));
    const viewer = { ...buyer, permissions: [...buyer.permissions, "support.view", "support.ticket.view_all"] };
    const seen = await sd.getSupportTicket(client, viewer, first.id);
    assert(!seen.messages.some((m) => m.private) && seen.messages.length === t.messages.length - 1, "notes hidden");
    await refused(() => sd.addSupportNote(client, buyer, first.id, { body: "x" }), "SUPPORT_ACCESS_DENIED");
  });

  await check("S5. Resolve needs the resolution; close follows resolve; a customer's reply to a resolved ticket reopens it (an event, the count kept); to a closed one, a linked follow-up ticket", async () => {
    await refused(() => step(sd.resolveSupportTicket, agent, first.id, {}), "SUPPORT_RESOLUTION_REQUIRED");
    await refused(() => step(sd.closeSupportTicket, lead, first.id, {}), "SUPPORT_TICKET_STATE");
    await step(sd.resolveSupportTicket, agent, first.id, { resolutionSummary: "Replacement lamp dispatched (DL-0042)" });
    let t = await ticketOf(first.id);
    assert(t.status === "resolved" && t.resolution === "MET", t.resolution);
    const r = await deliver(email({ subject: `Re: [${first.number}]`, text: "The replacement has not arrived." }));
    t = await ticketOf(first.id);
    assert(r.outcome === "reopened" && t.status === "open" && t.reopened === 1 && t.history.some((h) => h.type === "support.ticket.reopened"), JSON.stringify([r.outcome, t.status]));
    await step(sd.resolveSupportTicket, agent, first.id, { resolutionSummary: "Replacement delivered" });
    await step(sd.closeSupportTicket, lead, first.id, {});
    const late = await deliver(email({ subject: `Re: [${first.number}]`, text: "Thanks, all good now!" }));
    const follow = await ticketOf(late.ticketId);
    assert(late.outcome === "follow_up" && follow.id !== first.id && follow.followUpOf?.id === first.id && follow.customer?.id === lumen.id, JSON.stringify(late));
    assert((await ticketOf(first.id)).status === "closed", "the closed ticket stays closed");
    await step(sd.reopenSupportTicket, lead, first.id, { reason: "Customer called back" });
    assert((await ticketOf(first.id)).reopened === 2, "reopened by an agent");
    await refused(() => step(sd.reopenSupportTicket, agent2, follow.id, { reason: "x" }), "SUPPORT_ACCESS_DENIED");
  });

  await check("S6. Untrusted mail: a blocked domain, our own mailbox writing to itself and an automatic reply create no noise; a bounce marks the reply bounced; an unknown or ambiguous sender is left unmatched for an agent to link", async () => {
    assert((await deliver(email({ from: `bot@spam.example` }))).outcome === "blocked", "blocked");
    assert((await deliver(email({ from: address }))).outcome === "loop", "loop");
    const auto = await deliver(email({ from: `ooo-${tag}@lumen.example`, subject: "Out of office", autoSubmitted: true }));
    const autoT = await ticketOf(auto.ticketId);
    assert(!autoT.messages.some((m) => m.kind === "SYSTEM"), "no acknowledgement to an automatic message");
    const reply = (await client.query(`SELECT external_message_id FROM tenant.support_communications WHERE id = $1`, [replyId])).rows[0].external_message_id;
    const bounce = await deliver(email({ from: "mailer-daemon@lumen.example", subject: "Undeliverable: Re: Lamp", text: "550 mailbox full", references: [reply] }));
    assert(bounce.outcome === "bounce" && (await client.query(`SELECT delivery_status FROM tenant.support_communications WHERE id = $1`, [replyId])).rows[0].delivery_status === "BOUNCED", JSON.stringify(bounce));
    const ambiguous = await ticketOf((await deliver(email({ from: shared, fromName: "Sam" }))).ticketId);
    assert(ambiguous.unmatched && !ambiguous.customer && ambiguous.candidates.length === 2, JSON.stringify(ambiguous.candidates));
    const stranger = await ticketOf((await deliver(email({ from: `nobody-${tag}@unknown.example` }))).ticketId);
    assert(stranger.unmatched && !stranger.customer, "unknown sender");
    await step(sd.linkSupportTicketCustomer, agent, ambiguous.id, { customerId: acmeA.id });
    assert(!(await ticketOf(ambiguous.id)).unmatched, "linked");
    assert((await sd.listSupportTickets(client, lead, { view: "unmatched" })).some((r) => r.id === stranger.id), "unmatched queue");
  });

  await check("S7. Tickets by hand: subject and description required, Customer Master link, the priority sets the deadlines; assignment only to an active agent; cancel only a new ticket; stale versions refused", async () => {
    await refused(() => sd.createSupportTicket(client, agent, { subject: "x" }), "SUPPORT_TICKET_INVALID");
    await refused(() => sd.createSupportTicket(client, buyer, { subject: "x", description: "y" }), "SUPPORT_ACCESS_DENIED");
    const t = await sd.createSupportTicket(client, agent, { subject: "Invoice copy needed", description: "Customer called for an invoice copy", customerId: lumen.id, contactId: asha.id, priority: "urgent" });
    const d = await ticketOf(t.id);
    const minutes = (new Date(d.responseDue).getTime() - new Date(d.createdAt).getTime()) / 60000;
    assert(d.status === "new" && d.priority === "urgent" && Math.round(minutes) === 30 && d.customerEmail === `asha-${tag}@lumen.example`, JSON.stringify([d.status, minutes]));
    await refused(() => step(sd.assignSupportTicket, lead, t.id, { userId: buyer.userId }), "SUPPORT_AGENT_INVALID");
    await step(sd.assignSupportTicket, lead, t.id, { userId: agent2.userId, reason: "Billing queue" });
    assert((await ticketOf(t.id)).status === "open", "assigned → open");
    await refused(() => step(sd.cancelSupportTicket, lead, t.id, { reason: "x" }), "SUPPORT_TICKET_STATE");
    await refused(() => sd.updateSupportTicket(client, lead, t.id, { version: 1, subject: "Stale" }), "SUPPORT_CONCURRENT_CHANGE");
    await step(sd.updateSupportTicket, lead, t.id, { priority: "low" });
    const after = await ticketOf(t.id);
    assert(Math.round((new Date(after.responseDue).getTime() - new Date(after.createdAt).getTime()) / 60000) === 1440, "deadline follows the priority");
    const raw = await sd.createSupportTicket(client, agent, { subject: "Duplicate", description: "Raised twice" });
    await step(sd.cancelSupportTicket, lead, raw.id, { reason: "Raised twice" });
    assert((await ticketOf(raw.id)).status === "cancelled", "cancelled");
  });

  await check("S8. Visibility: an agent without 'view every ticket' sees their own and the unassigned ones, not a colleague's; another company sees nothing", async () => {
    const limited = { ...agent2, permissions: agent2.permissions.filter((p) => p !== "support.ticket.view_all") };
    const own = await sd.listSupportTickets(client, limited, { view: "open" });
    assert(own.every((r) => !r.agent || r.agent.id === agent2.userId), JSON.stringify(own.map((r) => r.agent)));
    await refused(() => sd.getSupportTicket(client, limited, first.id), "SUPPORT_TICKET_NOT_FOUND");
    await switchTo(other.organizationId);
    const outsider = await contextFor(other.userId, other.organizationId);
    assert((await sd.listSupportTickets(client, outsider, {})).length === 0, "another company");
    await switchTo(organizationId);
  });

  await check("S9. Dashboard, the ten reports, the export, options and settings (targets validated, categories)", async () => {
    const dash = await sd.getSupportDashboard(client, lead);
    assert(dash.counts.open >= 3 && dash.counts.unmatched >= 1 && dash.failedReplies >= 1, JSON.stringify(dash));
    for (const kind of Object.keys(sd.SUPPORT_REPORTS)) assert(Array.isArray((await sd.getSupportReport(client, lead, kind)).rows), kind);
    assert((await sd.getSupportReport(client, lead, "delivery")).rows.some((r) => r.delivery === "BOUNCED"), "bounced reply reported");
    assert((await sd.getSupportReport(client, lead, "reopened")).rows.some((r) => r.ticket === first.number), "reopened reported");
    const csv = await sd.exportSupportReport(client, lead, "register");
    assert(csv.body.includes(first.number), "export");
    await refused(() => sd.getSupportReport(client, agent, "register"), "SUPPORT_ACCESS_DENIED");
    const opts = await sd.listSupportOptions(client, lead);
    assert(opts.agents.some((a) => a.value === agent.userId) && opts.mailboxes.some((m) => m.value === mailbox.id) && opts.routes.length === 1, JSON.stringify(opts.agents));
    await refused(() => sd.saveSupportDeskSettings(client, lead, { targets: { low: { response: 10, resolution: 5 } } }), "SUPPORT_TICKET_INVALID");
    const saved = await sd.saveSupportDeskSettings(client, lead, { reopenWindowDays: 3, targets: { low: { response: 600, resolution: 6000 }, normal: { response: 240, resolution: 2400 },
      high: { response: 60, resolution: 600 }, urgent: { response: 15, resolution: 240 } } });
    assert(saved.reopenWindowDays === 3 && saved.targets.urgent.response === 15, JSON.stringify(saved));
    await sd.saveSupportCategory(client, lead, { code: "WARRANTY", name: "Warranty claim", defaultPriority: "high" });
    assert((await sd.listSupportCategories(client, lead)).some((x) => x.code === "WARRANTY"), "category");
    void randomUUID;
  });
} finally {
  await client.query("ROLLBACK").catch(() => null);
  await client.end();
}
console.log(`\n${passed} passed, ${failures.length} failed (transaction rolled back: the database is unchanged)`);
if (failures.length) process.exitCode = 1;
