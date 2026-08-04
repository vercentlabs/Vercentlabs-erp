import assert from "node:assert/strict";
import path from "node:path";

import dotenv from "dotenv";
import pg from "pg";

import {
  CRM_COMMUNICATION_CAPABILITY_IDS,
  bookMeeting,
  claimSharedInboxThread,
  createProviderOAuthState,
  createSharedInbox,
  upsertSharedInboxMember,
  upsertEmailSignature,
  getCommunicationTimeline,
  getCommunicationsDashboard,
  getCrmCommunicationsReadiness,
  getMeetingAvailability,
  ingestCalendarDelta,
  ingestMailboxDelta,
  queueOutboundEmail,
  recordCrmCommunicationsAcceptance,
  recordEmailEngagementEvent,
} from "@vercentlabs/api";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local"), quiet: true });
dotenv.config({ quiet: true });

const databaseUrl =
  process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
assert.ok(databaseUrl, "MIGRATION_DATABASE_URL or DATABASE_URL is required.");

const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
const client = await pool.connect();
const unique = `CRM04-${Date.now()}`;

function nextMonday() {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  const days = (8 - date.getUTCDay()) % 7 || 7;
  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

try {
  const migration = await client.query(
    "SELECT 1 FROM tenant_schema_migrations WHERE name=$1",
    ["031_crm_communications_calendar.sql"],
  );
  assert.ok(migration.rows[0], "CRM-04 tenant migration is not applied.");

  const baseline = (
    await client.query(
      `SELECT organization.id AS organization_id,organization.created_by AS user_id,company.id AS company_id
       FROM public.organizations organization
       JOIN public.companies company ON company.organization_id=organization.id
       WHERE organization.status='active' AND organization.created_by IS NOT NULL
       ORDER BY organization.created_at LIMIT 1`,
    )
  ).rows[0];
  assert.ok(
    baseline?.organization_id && baseline?.user_id && baseline?.company_id,
    "An active organisation, owner and company are required.",
  );

  await client.query("BEGIN");
  await client.query(
    "SELECT set_config('app.current_organization_id',$1,true)",
    [baseline.organization_id],
  );

  const context = {
    organizationId: baseline.organization_id,
    userId: baseline.user_id,
    activeCompanyId: baseline.company_id,
    activeBranchId: null,
    allowAllCompanies: true,
    permissions: [
      "crm.view",
      "crm.communications.manage",
      "crm.integrations.manage",
      "crm.reports.view",
    ],
    roleSlugs: ["organization_owner"],
  };

  const syncAccount = (
    await client.query(
      `INSERT INTO tenant.crm_sync_accounts(
         organization_id,company_id,user_id,provider,external_account_id,
         display_name,credential_reference,scopes,sync_direction,email_address,
         webhook_subscription_id,status,created_by,updated_by
       ) VALUES($1,$2,$3,'gmail',$4,$5,$6,$7,'two_way',$8,$9,'connected',$3,$3)
       RETURNING *`,
      [
        baseline.organization_id,
        baseline.company_id,
        baseline.user_id,
        unique,
        `${unique} Gmail`,
        "env:CRM04_TEST_PROVIDER_CREDENTIAL",
        JSON.stringify(["gmail.readonly", "gmail.send", "calendar.events"]),
        `${unique.toLowerCase()}@example.com`,
        `subscription-${unique}`,
      ],
    )
  ).rows[0];

  const inbox = await createSharedInbox(client, context, {
    companyId: baseline.company_id,
    syncAccountId: syncAccount.id,
    name: `${unique} Sales Inbox`,
    address: `${unique.toLowerCase()}@example.com`,
    slaMinutes: 60,
    collisionTimeoutMinutes: 15,
  });
  assert.equal(inbox.sync_account_id, syncAccount.id);
  const inboxMember = await upsertSharedInboxMember(client, context, inbox.id, {
    userId: baseline.user_id,
    memberRole: "manager",
    routingWeight: 100,
  });
  assert.equal(inboxMember.member_role, "manager");
  const signature = await upsertEmailSignature(client, context, {
    companyId: baseline.company_id,
    name: `${unique} Default signature`,
    bodyHtml: `<p>Regards,<br>${unique} Sales</p>`,
    bodyText: `Regards, ${unique} Sales`,
    isDefault: true,
  });
  assert.equal(signature.is_default, true);

  const oauth = await createProviderOAuthState(client, context, {
    provider: "gmail",
    redirectUri: "http://localhost:3001/api/crm/communications/oauth/callback",
    scopes: ["gmail.readonly", "calendar.events"],
  });
  assert.ok(oauth.state && oauth.verifier);

  const mailbox = await ingestMailboxDelta(client, context, syncAccount.id, {
    inboxId: inbox.id,
    provider: "gmail",
    nextCursor: `${unique}-history-2`,
    messages: [
      {
        id: `${unique}-message-1`,
        threadId: `${unique}-thread-1`,
        internalDate: String(Date.now()),
        labelIds: ["INBOX", "UNREAD"],
        snippet: "Please share the proposal.",
        payload: {
          mimeType: "text/plain",
          headers: [
            {
              name: "From",
              value: `Buyer <buyer.${unique.toLowerCase()}@example.com>`,
            },
            {
              name: "To",
              value: `${unique.toLowerCase()}@example.com`,
            },
            { name: "Subject", value: `${unique} proposal request` },
            { name: "Message-ID", value: `<${unique}@example.com>` },
          ],
          body: {
            data: Buffer.from("Please share the proposal.").toString(
              "base64url",
            ),
          },
        },
      },
    ],
  });
  assert.equal(mailbox.inserted, 1);

  const thread = (
    await client.query(
      `SELECT * FROM tenant.crm_email_threads
       WHERE organization_id=$1 AND provider='gmail' AND external_thread_id=$2`,
      [baseline.organization_id, `${unique}-thread-1`],
    )
  ).rows[0];
  assert.ok(thread?.id);
  const claimed = await claimSharedInboxThread(client, context, thread.id);
  assert.equal(claimed.assigned_user_id, baseline.user_id);

  const outbound = await queueOutboundEmail(client, context, {
    companyId: baseline.company_id,
    inboxId: inbox.id,
    syncAccountId: syncAccount.id,
    provider: "gmail",
    externalThreadId: `${unique}-thread-1`,
    providerMessageId: `${unique}-message-outbound`,
    fromAddress: `${unique.toLowerCase()}@example.com`,
    toAddresses: [`buyer.${unique.toLowerCase()}@example.com`],
    subject: `${unique} proposal`,
    bodyText: "Attached is the requested proposal.",
    timezone: "UTC",
    sendWindow: { start: "00:00", end: "23:59" },
    hourlyLimit: 10000,
  });
  assert.equal(outbound.status, "queued");

  const delivered = await recordEmailEngagementEvent(client, context, {
    provider: "gmail",
    providerMessageId: `${unique}-message-outbound`,
    providerEventId: `${unique}-delivered`,
    eventType: "delivered",
    recipient: `buyer.${unique.toLowerCase()}@example.com`,
    occurredAt: new Date().toISOString(),
  });
  assert.equal(delivered.duplicate, false);
  const unsubscribe = await recordEmailEngagementEvent(client, context, {
    provider: "gmail",
    providerMessageId: `${unique}-message-outbound`,
    providerEventId: `${unique}-unsubscribe`,
    eventType: "unsubscribe",
    recipient: `buyer.${unique.toLowerCase()}@example.com`,
    occurredAt: new Date().toISOString(),
  });
  assert.equal(unsubscribe.duplicate, false);
  await assert.rejects(
    () =>
      queueOutboundEmail(client, context, {
        provider: "gmail",
        fromAddress: `${unique.toLowerCase()}@example.com`,
        toAddresses: [`buyer.${unique.toLowerCase()}@example.com`],
        subject: "Suppressed",
        bodyText: "Must not send",
        timezone: "UTC",
        sendWindow: { start: "00:00", end: "23:59" },
      }),
    /suppressed/i,
  );

  const monday = nextMonday();
  const date = monday.toISOString().slice(0, 10);
  const meetingLink = (
    await client.query(
      `INSERT INTO tenant.crm_meeting_links(
         organization_id,company_id,owner_user_id,name,slug,duration_minutes,
         buffer_before_minutes,buffer_after_minutes,timezone,availability,
         meeting_provider,location_template,status,created_by,updated_by
       ) VALUES($1,$2,$3,$4,$5,30,15,15,'UTC',$6,'google_meet',$7,'active',$3,$3)
       RETURNING *`,
      [
        baseline.organization_id,
        baseline.company_id,
        baseline.user_id,
        `${unique} Discovery`,
        unique.toLowerCase(),
        JSON.stringify({ monday: [{ start: "09:00", end: "12:00" }] }),
        "Online meeting",
      ],
    )
  ).rows[0];

  await ingestCalendarDelta(client, context, syncAccount.id, {
    provider: "gmail",
    nextCursor: `${unique}-calendar-2`,
    events: [
      {
        id: `${unique}-busy-event`,
        summary: "Busy",
        start: { dateTime: `${date}T09:30:00.000Z`, timeZone: "UTC" },
        end: { dateTime: `${date}T10:00:00.000Z`, timeZone: "UTC" },
        status: "confirmed",
      },
    ],
  });

  const slots = await getMeetingAvailability(
    client,
    context,
    meetingLink.id,
    date,
    { now: new Date(`${date}T00:00:00.000Z`) },
  );
  assert.ok(slots.length > 0);
  assert.ok(!slots.some((slot) => slot.startsAt === `${date}T09:15:00.000Z`));
  const booking = await bookMeeting(client, context, meetingLink.id, {
    guestName: "CRM-04 Buyer",
    guestEmail: `meeting.${unique.toLowerCase()}@example.com`,
    guestTimezone: "UTC",
    startsAt: slots[0].startsAt,
    now: `${date}T00:00:00.000Z`,
  });
  assert.equal(booking.status, "confirmed");

  const timeline = await getCommunicationTimeline(client, context, {});
  assert.ok(timeline.length >= 2);
  const dashboard = await getCommunicationsDashboard(client, context);
  assert.ok(Number(dashboard.summary.open_threads) >= 1);
  assert.ok(dashboard.upcomingMeetings.length >= 1);

  for (const capabilityId of CRM_COMMUNICATION_CAPABILITY_IDS) {
    await recordCrmCommunicationsAcceptance(client, context, {
      capabilityId,
      status: "passed",
      commitSha: process.env.RELEASE_SHA || "crm04-local",
      providerAcceptance: ["CRM-002", "CRM-036", "CRM-045"].includes(
        capabilityId,
      )
        ? "sandbox"
        : "not_required",
      evidence: {
        liveFixture: unique,
        syncAccountId: syncAccount.id,
        inboxId: inbox.id,
        threadId: thread.id,
        meetingBookingId: booking.id,
        tenantScoped: true,
      },
    });
  }
  const readiness = await getCrmCommunicationsReadiness(client, context);
  assert.equal(readiness.readiness, "ready");
  assert.equal(readiness.passed, 9);

  await client.query("ROLLBACK");
  console.log("CRM-04 communications live verification passed.");
} catch (error) {
  try {
    await client.query("ROLLBACK");
  } catch {}
  throw error;
} finally {
  client.release();
  await pool.end();
}
