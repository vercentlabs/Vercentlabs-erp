#!/usr/bin/env node
// F018 Email history — the demo org has calls/WhatsApp/email communication
// rows on Accounts, but zero email threads, messages, engagement events,
// shared inboxes or sync accounts. Seeds, on one real open Opportunity, a
// three-message conversation, a proposal with open/click engagement, a hard
// bounce and a shared-inbox thread claimed by an agent. Messages go through
// the governed ingestMailboxDelta / recordEmailEngagementEvent /
// createSharedInbox / claimSharedInboxThread functions. The only direct SQL
// is the mailbox connection row (no governed creator exists: real ones come
// from the OAuth flow) — it carries a placeholder credential reference,
// never a secret. Local-only, idempotent by provider message id / names.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotEnv } from "dotenv";
import { Client } from "pg";
import {
  ingestMailboxDelta,
  recordEmailEngagementEvent,
  createSharedInbox,
  upsertSharedInboxMember,
  claimSharedInboxThread,
} from "../../services/api/src/index.js";
import { setTenantContext } from "../../packages/database/src/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
for (const file of [path.join(root, "apps/web/.env.local"), path.join(root, ".env")]) {
  if (fs.existsSync(file)) loadDotEnv({ path: file, override: false, quiet: true });
}
const connectionString = String(process.env.MIGRATION_DATABASE_URL || "").trim();
if (!connectionString) throw new Error("MIGRATION_DATABASE_URL is required.");
if (!/localhost|127\.0\.0\.1/.test(connectionString)) throw new Error("Refusing to run against a non-local database.");
const ORG_NAME = process.env.SEED_ORG_NAME || "Vercentlabs";
const OPPORTUNITY_NAME = "Suvidha Logistics Pvt Ltd — Custom Reporting Add-on";
const PROVIDER = "other";
const ago = (hours) => new Date(Date.now() - hours * 3600 * 1000).toISOString();

async function main() {
  const admin = new Client({ connectionString });
  await admin.connect();
  const organizationId = (await admin.query(`SELECT id FROM organizations WHERE name=$1 LIMIT 1`, [ORG_NAME])).rows[0]?.id;
  if (!organizationId) throw new Error(`Organization "${ORG_NAME}" not found.`);
  const owner = (await admin.query(
    `SELECT u.id, u.email FROM users u JOIN organization_memberships om ON om.user_id=u.id WHERE om.organization_id=$1 AND om.status='active' ORDER BY om.created_at ASC LIMIT 1`,
    [organizationId],
  )).rows[0];
  const opportunity = (await admin.query(`SELECT id, party_id FROM tenant.crm_opportunities WHERE organization_id=$1 AND name=$2 LIMIT 1`, [organizationId, OPPORTUNITY_NAME])).rows[0];
  if (!opportunity) throw new Error(`Opportunity "${OPPORTUNITY_NAME}" not found.`);
  const contact = (await admin.query(`SELECT * FROM tenant.contacts WHERE organization_id=$1 AND party_id=$2 ORDER BY created_at LIMIT 1`, [organizationId, opportunity.party_id])).rows[0];
  const customerEmail = contact?.email || contact?.primary_email || "procurement@suvidha.example";
  const ourEmail = owner.email || "sales@vercentlabs.example";
  const context = {
    organizationId, userId: owner.id, activeCompanyId: null, activeBranchId: null, allowAllCompanies: true,
    permissions: ["crm.records.view_all", "crm.leads.view_sensitive"], roleSlugs: ["organization_owner"],
  };
  async function withTx(fn) {
    await admin.query("BEGIN");
    try { await setTenantContext(admin, organizationId); const r = await fn(admin); await admin.query("COMMIT"); return r; }
    catch (e) { await admin.query("ROLLBACK"); throw e; }
  }
  const links = { opportunityId: opportunity.id, partyId: opportunity.party_id, contactId: contact?.id || null };
  console.log(`Seeding F018 Email history demo data on "${OPPORTUNITY_NAME}"...`);

  let account = (await admin.query(`SELECT id FROM tenant.crm_sync_accounts WHERE organization_id=$1 AND display_name='Sales mailbox (demo)' LIMIT 1`, [organizationId])).rows[0];
  if (!account) {
    account = (await withTx((c) => c.query(
      `INSERT INTO tenant.crm_sync_accounts(organization_id,user_id,provider,display_name,credential_reference,email_address,sync_direction,status,created_by,updated_by)
       VALUES($1,$2,$3,'Sales mailbox (demo)','demo-local-placeholder',$4,'two_way','connected',$2,$2) RETURNING id`,
      [organizationId, owner.id, PROVIDER, ourEmail]))).rows[0];
    console.log("Created demo mailbox connection");
  } else console.log("Already present: demo mailbox connection");

  const msg = (id, threadId, direction, subject, bodyText, hoursAgo, extra = {}) => ({
    providerMessageId: `f018-demo-${id}`, externalThreadId: `f018-demo-thread-${threadId}`, direction,
    fromAddress: direction === "inbound" ? customerEmail : ourEmail,
    toAddresses: [direction === "inbound" ? ourEmail : customerEmail], subject, bodyText,
    occurredAt: ago(hoursAgo), status: direction === "inbound" ? "received" : "sent", ...extra,
  });

  const exists = async (id) => (await admin.query(`SELECT 1 FROM tenant.crm_email_messages WHERE organization_id=$1 AND provider=$2 AND provider_message_id=$3`, [organizationId, PROVIDER, `f018-demo-${id}`])).rows[0];

  async function ingest(messages, extra = {}) {
    return withTx((c) => ingestMailboxDelta(c, context, account.id, { provider: PROVIDER, messages, ...links, ...extra }));
  }
  async function engage(id, eventType, hoursAgo, url) {
    await withTx((c) => recordEmailEngagementEvent(c, context, { provider: PROVIDER, providerMessageId: `f018-demo-${id}`, providerEventId: `f018-demo-${id}-${eventType}-${hoursAgo}`, eventType, occurredAt: ago(hoursAgo), url }));
  }

  if (!(await exists("req-1"))) {
    await ingest([
      msg("req-1", "req", "inbound", "Custom reporting add-on — requirements", "Hi, we need monthly pipeline by region and win/loss by source. Can you confirm the add-on covers both?", 96),
      msg("req-2", "req", "outbound", "RE: Custom reporting add-on — requirements", "Yes — both are covered in the standard add-on. I will send a proposal with pricing this week.", 90),
      msg("req-3", "req", "inbound", "RE: Custom reporting add-on — requirements", "Great, please also include forecast accuracy by owner. Our steering committee meets Friday.", 70),
    ]);
    console.log("Ingested 3-message conversation");
  } else console.log("Already present: requirements conversation");

  if (!(await exists("proposal"))) {
    await ingest([msg("proposal", "proposal", "outbound", "Proposal: Custom Reporting Add-on pricing", "Attached is the pricing summary: add-on INR 240,000 plus implementation INR 90,000. Valid for 30 days.", 48)]);
    await engage("proposal", "delivered", 47.9);
    await engage("proposal", "open", 40);
    await engage("proposal", "open", 22);
    await engage("proposal", "click", 21.5, "https://example.com/pricing-summary");
    console.log("Ingested proposal with delivered/open/click engagement");
  } else console.log("Already present: proposal");

  if (!(await exists("bounce"))) {
    await ingest([{ ...msg("bounce", "bounce", "outbound", "Following up on pricing", "Checking whether the pricing summary reached the right people.", 30), toAddresses: ["old.procurement@suvidha.example"] }]);
    await engage("bounce", "hard_bounce", 29.9);
    console.log("Ingested bounced follow-up");
  } else console.log("Already present: bounced email");

  if (!(await exists("inbox-1"))) {
    let inbox = (await admin.query(`SELECT id FROM tenant.crm_shared_inboxes WHERE organization_id=$1 AND name='Sales inbox' LIMIT 1`, [organizationId])).rows[0];
    if (!inbox) {
      inbox = await withTx((c) => createSharedInbox(c, context, { name: "Sales inbox", syncAccountId: account.id, address: ourEmail, slaMinutes: 240 }));
      await withTx((c) => upsertSharedInboxMember(c, context, inbox.id, { userId: owner.id, memberRole: "manager" }));
    }
    await ingest([msg("inbox-1", "inbox", "inbound", "Request: reporting sandbox access for our analysts", "Could we get a sandbox login for two analysts before the go-live decision?", 5)], { inboxId: inbox.id });
    const thread = (await admin.query(`SELECT id FROM tenant.crm_email_threads WHERE organization_id=$1 AND external_thread_id='f018-demo-thread-inbox'`, [organizationId])).rows[0];
    await withTx((c) => claimSharedInboxThread(c, context, thread.id, { userId: owner.id }));
    console.log("Ingested shared-inbox thread and claimed it");
  } else console.log("Already present: shared-inbox thread");

  console.log("Done.");
  await admin.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
