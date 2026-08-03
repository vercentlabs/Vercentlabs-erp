import assert from "node:assert/strict";
import test from "node:test";
import {
  CRM_CONVERSATION_CAPABILITY_IDS,
  crmConversationHash,
  buildConversationInsights,
  normalizePhoneNumber,
  normalizeTelephonyEvent,
  telephonyTransitionAllowed,
  verifyTelephonyWebhookSignature,
} from "../src/crm/conversation-intelligence.js";
import { createHmac } from "node:crypto";

test("CRM-05 exposes exactly four governed capabilities", () => {
  assert.deepEqual(CRM_CONVERSATION_CAPABILITY_IDS, [
    "CRM-003",
    "CRM-006",
    "CRM-046",
    "CRM-049",
  ]);
});

test("phone numbers normalize to E.164", () => {
  assert.equal(normalizePhoneNumber("98765 43210"), "+919876543210");
  assert.throws(() => normalizePhoneNumber("12"), /E\.164/);
});

test("telephony webhook signatures are timestamp bound", () => {
  const rawBody = JSON.stringify({ id: "event-1" });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const secret = "crm05-test-secret";
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
  assert.equal(
    verifyTelephonyWebhookSignature({ rawBody, timestamp, secret, signature }),
    true,
  );
  assert.equal(
    verifyTelephonyWebhookSignature({
      rawBody,
      timestamp: "1",
      secret,
      signature,
    }),
    false,
  );
});

test("provider events normalize into the stable call contract", () => {
  const event = normalizeTelephonyEvent("twilio", {
    EventSid: "EV1",
    CallSid: "CA1",
    CallStatus: "completed",
    From: "+919876543210",
    To: "+919999999999",
    CallDuration: "45",
  });
  assert.equal(event.providerEventId, "EV1");
  assert.equal(event.providerCallId, "CA1");
  assert.equal(event.eventType, "completed");
  assert.equal(event.durationSeconds, 45);
});

test("call state transitions fail closed", () => {
  assert.equal(telephonyTransitionAllowed("scheduled", "answered"), true);
  assert.equal(telephonyTransitionAllowed("completed", "answered"), false);
});

test("transcript output produces reviewable summaries and action items", () => {
  const result = buildConversationInsights({
    transcript:
      "Customer needs a proposal. Send it tomorrow. Budget is approved.",
    actionItems: [{ title: "Send proposal", dueAt: "2026-08-04T10:00:00Z" }],
    signals: [{ type: "commitment", content: "Budget approved", score: 0.9 }],
  });
  assert.match(result.summary, /Customer needs/);
  assert.equal(result.actionItems.length, 1);
  assert.equal(result.signals[0].type, "commitment");
});

test("conversation evidence hashes are stable across object key order", () => {
  assert.equal(
    crmConversationHash({ b: 2, a: 1 }),
    crmConversationHash({ a: 1, b: 2 }),
  );
});
