import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  CRM_COMMUNICATION_CAPABILITY_IDS,
  CrmCommunicationsError,
  calculateMeetingSlots,
  crmCommunicationsHash,
  normalizeProviderCalendarEvent,
  normalizeProviderMessage,
  outboundSendDecision,
  queueOutboundEmail,
  verifyCrmProviderWebhookSignature,
} from "../src/crm/communications.js";

test("CRM-04 exposes exactly nine communication capabilities", () => {
  assert.deepEqual(CRM_COMMUNICATION_CAPABILITY_IDS, [
    "CRM-001",
    "CRM-002",
    "CRM-004",
    "CRM-005",
    "CRM-036",
    "CRM-038",
    "CRM-040",
    "CRM-045",
    "CRM-081",
  ]);
});

test("Gmail and Microsoft messages normalize into one contract", () => {
  const gmail = normalizeProviderMessage("gmail", {
    id: "gmail-1",
    threadId: "gmail-thread",
    internalDate: "1700000000000",
    labelIds: ["INBOX", "UNREAD"],
    snippet: "Hello from Gmail",
    payload: {
      mimeType: "text/plain",
      headers: [
        { name: "From", value: "A Person <person@example.com>" },
        { name: "To", value: "sales@example.com" },
        { name: "Subject", value: "Gmail subject" },
      ],
      body: { data: Buffer.from("Gmail body").toString("base64url") },
    },
  });
  const microsoft = normalizeProviderMessage("microsoft365", {
    id: "ms-1",
    conversationId: "ms-thread",
    subject: "Microsoft subject",
    bodyPreview: "Microsoft body",
    receivedDateTime: "2026-08-03T10:00:00.000Z",
    isRead: false,
    from: { emailAddress: { address: "person@example.com" } },
    toRecipients: [{ emailAddress: { address: "sales@example.com" } }],
  });
  assert.equal(gmail.direction, "inbound");
  assert.equal(gmail.unread, true);
  assert.equal(gmail.bodyText, "Gmail body");
  assert.equal(microsoft.externalThreadId, "ms-thread");
  assert.equal(microsoft.toAddresses[0], "sales@example.com");
});

test("provider webhook signatures are timestamp-bound and constant-shape", () => {
  const rawBody = JSON.stringify({ event: "message.created" });
  const timestamp = "1722679200000";
  const secret = "crm04-webhook-secret-that-is-long-enough";
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
  assert.equal(
    verifyCrmProviderWebhookSignature({
      rawBody,
      timestamp,
      signature: `sha256=${signature}`,
      secret,
      now: Number(timestamp),
    }),
    true,
  );
  assert.equal(
    verifyCrmProviderWebhookSignature({
      rawBody,
      timestamp,
      signature,
      secret,
      now: Number(timestamp) + 600000,
    }),
    false,
  );
});

test("meeting slots respect availability, buffers, notice and busy ranges", () => {
  const slots = calculateMeetingSlots({
    date: "2026-08-03",
    durationMinutes: 30,
    bufferBeforeMinutes: 15,
    bufferAfterMinutes: 15,
    minimumNoticeMinutes: 0,
    now: new Date("2026-08-03T08:00:00.000Z"),
    availability: {
      monday: [{ start: "09:00", end: "11:00" }],
    },
    busy: [
      {
        start: "2026-08-03T09:30:00.000Z",
        end: "2026-08-03T10:00:00.000Z",
      },
    ],
  });
  assert.ok(slots.some((slot) => slot.startsAt === "2026-08-03T10:15:00.000Z"));
  assert.ok(
    !slots.some((slot) => slot.startsAt === "2026-08-03T09:15:00.000Z"),
  );
});

test("send windows, throttling and suppression fail closed", () => {
  assert.deepEqual(
    outboundSendDecision({
      now: new Date("2026-08-03T10:00:00.000Z"),
      timezone: "UTC",
      sendWindow: { start: "09:00", end: "18:00" },
      sentLastHour: 4,
      hourlyLimit: 10,
    }),
    { allowed: true, reason: null },
  );
  assert.equal(
    outboundSendDecision({
      now: new Date("2026-08-03T10:00:00.000Z"),
      suppressed: true,
    }).reason,
    "suppressed",
  );
  assert.equal(
    outboundSendDecision({
      now: new Date("2026-08-03T23:00:00.000Z"),
      timezone: "UTC",
      sendWindow: { start: "09:00", end: "18:00" },
    }).reason,
    "outside_send_window",
  );
});

test("calendar normalization and evidence hashes are deterministic", () => {
  const event = normalizeProviderCalendarEvent("microsoft365", {
    id: "event-1",
    subject: "Discovery",
    start: { dateTime: "2026-08-04T10:00:00.000Z", timeZone: "UTC" },
    end: { dateTime: "2026-08-04T10:30:00.000Z", timeZone: "UTC" },
    attendees: [
      { emailAddress: { address: "buyer@example.com", name: "Buyer" } },
    ],
  });
  assert.equal(event.externalEventId, "event-1");
  assert.equal(event.attendees.length, 1);
  assert.equal(
    crmCommunicationsHash({ b: 2, a: 1 }),
    crmCommunicationsHash({ a: 1, b: 2 }),
  );
  assert.throws(
    () => normalizeProviderMessage("other", {}),
    CrmCommunicationsError,
  );
});

test("outbound email renders active templates and signatures before queueing", async () => {
  const ids = {
    organization: "00000000-0000-4000-8000-000000000001",
    user: "00000000-0000-4000-8000-000000000002",
    template: "00000000-0000-4000-8000-000000000003",
    signature: "00000000-0000-4000-8000-000000000004",
    thread: "00000000-0000-4000-8000-000000000005",
    communication: "00000000-0000-4000-8000-000000000006",
    message: "00000000-0000-4000-8000-000000000007",
  };
  const client = {
    async query(sql, params = []) {
      if (sql.includes("FROM tenant.crm_engagement_templates")) {
        return {
          rows: [
            {
              id: ids.template,
              subject_template: "Hello {{contact.name}}",
              body_template: "<p>Welcome {{contact.name}}</p>",
              language_code: "en-IN",
            },
          ],
        };
      }
      if (sql.includes("FROM tenant.crm_email_signatures")) {
        return {
          rows: [
            {
              id: ids.signature,
              body_html: "<p>Regards, Sales</p>",
              body_text: "Regards, Sales",
            },
          ],
        };
      }
      if (sql.includes("FROM tenant.crm_email_suppressions"))
        return { rows: [] };
      if (sql.includes("count(*)::int AS total"))
        return { rows: [{ total: 0 }] };
      if (sql.includes("INSERT INTO tenant.crm_email_threads"))
        return { rows: [{ id: ids.thread }] };
      if (sql.includes("INSERT INTO tenant.crm_communications"))
        return { rows: [{ id: ids.communication }] };
      if (sql.includes("INSERT INTO tenant.crm_email_messages")) {
        return {
          rows: [
            {
              id: ids.message,
              subject: params[8],
              body_text: params[9],
              body_html: params[10],
            },
          ],
        };
      }
      if (sql.includes("INSERT INTO tenant.crm_outbox_events"))
        return { rows: [] };
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  const message = await queueOutboundEmail(
    client,
    {
      organizationId: ids.organization,
      userId: ids.user,
      activeCompanyId: null,
    },
    {
      provider: "manual",
      fromAddress: "sales@example.com",
      toAddresses: ["buyer@example.com"],
      templateId: ids.template,
      signatureId: ids.signature,
      variables: { contact: { name: "Asha" } },
      now: "2026-08-03T10:00:00.000Z",
    },
  );
  assert.equal(message.subject, "Hello Asha");
  assert.equal(message.body_text, "Welcome Asha\n\nRegards, Sales");
  assert.match(message.body_html, /Welcome Asha/);
  assert.match(message.body_html, /Regards, Sales/);
});
