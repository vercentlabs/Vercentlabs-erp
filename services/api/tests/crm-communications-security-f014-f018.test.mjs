// Security regression net for the CRM communications/meeting services:
// provider webhook signatures, OAuth state, provider URL allowlist, credential
// resolution, shared-inbox membership and provider message normalisation.
// Imports go through the public communications.js boundary, so the same file
// describes the behaviour both before and after that file became a
// compatibility barrel.
import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import test from "node:test";

import {
  assertTrustedProviderUrl,
  claimSharedInboxThread,
  consumeProviderOAuthState,
  createProviderOAuthState,
  crmCommunicationsHash,
  fetchProviderMailboxDelta,
  normalizeProviderMessage,
  resolveProviderCredential,
  verifyCrmProviderWebhookSignature,
} from "../src/modules/crm/activities/communications.js";

const org = "11111111-1111-4111-8111-111111111111";
const user = "22222222-2222-4222-8222-222222222222";
const threadId = "33333333-3333-4333-8333-333333333333";
const inboxId = "44444444-4444-4444-8444-444444444444";
const context = { organizationId: org, userId: user, roleSlugs: [], permissions: ["crm.communications.manage"] };

function recordingClient(responder) {
  const calls = [];
  return {
    calls,
    async query(sql, values = []) {
      calls.push({ sql, values });
      return responder(sql, values) ?? { rows: [] };
    },
  };
}

// ------------------------------------------------------------- webhooks

const secret = "s".repeat(32);
const sign = (timestamp, rawBody, key = secret) =>
  createHmac("sha256", key).update(`${timestamp}.${rawBody}`).digest("hex");

test("webhook signature: HMAC-SHA256 over `${timestamp}.${rawBody}` within a 5-minute window", () => {
  const now = 1_700_000_000_000;
  const rawBody = '{"event":"message"}';
  const timestamp = String(now - 1000);
  assert.equal(verifyCrmProviderWebhookSignature({ rawBody, timestamp, signature: sign(timestamp, rawBody), secret, now }), true);
  assert.equal(verifyCrmProviderWebhookSignature({ rawBody, timestamp, signature: `sha256=${sign(timestamp, rawBody)}`, secret, now }), true);
  const edge = String(now - 300000);
  assert.equal(verifyCrmProviderWebhookSignature({ rawBody, timestamp: edge, signature: sign(edge, rawBody), secret, now }), true);
});

test("webhook signature: stale or future timestamps, tampered bodies, malformed signatures and short secrets are rejected", () => {
  const now = 1_700_000_000_000;
  const rawBody = '{"event":"message"}';
  const stale = String(now - 300001);
  assert.equal(verifyCrmProviderWebhookSignature({ rawBody, timestamp: stale, signature: sign(stale, rawBody), secret, now }), false);
  const future = String(now + 300001);
  assert.equal(verifyCrmProviderWebhookSignature({ rawBody, timestamp: future, signature: sign(future, rawBody), secret, now }), false);
  const ts = String(now);
  assert.equal(verifyCrmProviderWebhookSignature({ rawBody: '{"event":"other"}', timestamp: ts, signature: sign(ts, rawBody), secret, now }), false);
  assert.equal(verifyCrmProviderWebhookSignature({ rawBody, timestamp: ts, signature: sign(ts, rawBody).slice(1), secret, now }), false);
  assert.equal(verifyCrmProviderWebhookSignature({ rawBody, timestamp: ts, signature: "z".repeat(64), secret, now }), false);
  assert.equal(verifyCrmProviderWebhookSignature({ rawBody, timestamp: "not-a-number", signature: sign("not-a-number", rawBody), secret, now }), false);
  const shortSecret = "s".repeat(23);
  assert.equal(verifyCrmProviderWebhookSignature({ rawBody, timestamp: ts, signature: sign(ts, rawBody, shortSecret), secret: shortSecret, now }), false);
});

// ---------------------------------------------------------- OAuth state

test("OAuth state: only Gmail/Microsoft 365, HTTPS (or localhost) redirects, and only hashes are stored", async () => {
  const client = recordingClient(() => ({ rows: [] }));
  await assert.rejects(createProviderOAuthState(client, context, { provider: "yahoo", redirectUri: "https://app.test/cb" }), { status: 400 });
  await assert.rejects(createProviderOAuthState(client, context, { provider: "gmail", redirectUri: "http://app.test/cb" }), { status: 400 });
  assert.equal(client.calls.length, 0);

  const issued = await createProviderOAuthState(client, context, { provider: "Gmail", redirectUri: "https://app.test/cb", scopes: ["mail"] });
  assert.equal(issued.provider, "gmail");
  assert.equal(issued.expiresInSeconds, 600);
  const insert = client.calls[0];
  assert.match(insert.sql, /INSERT INTO tenant\.crm_provider_oauth_states/);
  assert.match(insert.sql, /expires_at\)\s*VALUES\([\s\S]*now\(\)\+interval '10 minutes'\)/);
  assert.ok(!insert.values.includes(issued.state), "the raw state must never be stored");
  assert.ok(!insert.values.includes(issued.verifier), "the raw verifier must never be stored");
  assert.equal(insert.values[3], crmCommunicationsHash(issued.state));
  assert.equal(insert.values[4], crmCommunicationsHash(issued.verifier));
  await createProviderOAuthState(client, context, { provider: "microsoft365", redirectUri: "http://localhost:3001/cb" });
});

test("OAuth state: consumption is single-use, unexpired and keyed by both hashes", async () => {
  const consumed = recordingClient(() => ({ rows: [{ provider: "gmail", redirect_uri: "https://app.test/cb", requested_scopes: [] }] }));
  const row = await consumeProviderOAuthState(consumed, context, { state: "abc", verifier: "def" });
  assert.equal(row.provider, "gmail");
  const update = consumed.calls[0];
  assert.match(update.sql, /consumed_at IS NULL AND expires_at>now\(\)/);
  assert.deepEqual(update.values, [org, crmCommunicationsHash("abc"), crmCommunicationsHash("def")]);
  const none = recordingClient(() => ({ rows: [] }));
  await assert.rejects(consumeProviderOAuthState(none, context, { state: "abc", verifier: "def" }), { status: 401, code: "CRM_OAUTH_STATE_INVALID" });
});

test("crmCommunicationsHash is a key-order-independent SHA-256", () => {
  assert.equal(crmCommunicationsHash({ b: 1, a: [2, { d: 3, c: 4 }] }), crmCommunicationsHash({ a: [2, { c: 4, d: 3 }], b: 1 }));
  assert.equal(crmCommunicationsHash("x"), createHash("sha256").update('"x"').digest("hex"));
});

// ------------------------------------------------- provider HTTP / secrets

test("provider URL allowlist: HTTPS to Google/Microsoft endpoints only, no credentials, ports or look-alike hosts", () => {
  for (const ok of [
    "https://gmail.googleapis.com/gmail/v1/users/me/profile",
    "https://www.googleapis.com/calendar/v3/calendars/primary/events",
    "https://graph.microsoft.com/v1.0/me/events",
  ])
    assert.equal(assertTrustedProviderUrl(ok), new URL(ok).toString());
  for (const bad of [
    "http://graph.microsoft.com/v1.0/me/events",
    "https://graph.microsoft.com.evil.test/v1.0/me/events",
    "https://evil.test/?u=https://graph.microsoft.com",
    "https://user:pass@graph.microsoft.com/v1.0/me",
    "https://graph.microsoft.com:8443/v1.0/me",
    "not a url",
  ])
    assert.throws(() => assertTrustedProviderUrl(bad), { status: 400, code: "CRM_PROVIDER_URL_UNTRUSTED" });
});

test("a tampered delta cursor cannot send the bearer token to another host", async () => {
  let called = false;
  const fetchImpl = async () => {
    called = true;
    return { ok: true, status: 200, json: async () => ({ value: [] }) };
  };
  await assert.rejects(
    fetchProviderMailboxDelta(
      { provider: "microsoft365", sync_cursor: "https://evil.test/steal" },
      { fetchImpl, credential: { accessToken: "token" } },
    ),
    { code: "CRM_PROVIDER_URL_UNTRUSTED" },
  );
  assert.equal(called, false);
});

test("provider requests refuse redirects and send the token only as a bearer header", async () => {
  let seen;
  const fetchImpl = async (url, init) => {
    seen = { url, init };
    return { ok: true, status: 200, json: async () => ({ value: [], "@odata.deltaLink": "https://graph.microsoft.com/v1.0/me/delta?token=1" }) };
  };
  await fetchProviderMailboxDelta({ provider: "microsoft365", sync_cursor: null }, { fetchImpl, credential: { accessToken: "token" } });
  assert.equal(seen.init.redirect, "error");
  assert.equal(seen.init.headers.Authorization, "Bearer token");
  assert.ok(seen.init.signal, "requests carry a timeout signal");
});

test("provider credentials come only from environment-backed JSON secrets with an access token", () => {
  const env = { CRM_GMAIL_TOKEN: JSON.stringify({ accessToken: "abc" }) };
  assert.deepEqual(resolveProviderCredential("env:CRM_GMAIL_TOKEN", env), { accessToken: "abc" });
  assert.deepEqual(resolveProviderCredential("CRM_GMAIL_TOKEN", env), { accessToken: "abc" });
  assert.throws(() => resolveProviderCredential("lowercase_name", env), { status: 503, code: "CRM_PROVIDER_SECRET_REFERENCE_INVALID" });
  assert.throws(() => resolveProviderCredential("env:CRM_MISSING", env), { status: 503, code: "CRM_PROVIDER_SECRET_MISSING" });
  assert.throws(() => resolveProviderCredential("env:BAD_JSON", { BAD_JSON: "{" }), { status: 503, code: "CRM_PROVIDER_SECRET_INVALID" });
  assert.throws(() => resolveProviderCredential("env:NO_TOKEN", { NO_TOKEN: "{}" }), { status: 503, code: "CRM_PROVIDER_ACCESS_TOKEN_MISSING" });
});

// --------------------------------------------------------- shared inbox

test("shared inbox: a non-member cannot claim a thread by guessing its id, and nothing is written", async () => {
  const client = recordingClient((sql) => {
    if (/SELECT inbox_id FROM tenant\.crm_email_threads/.test(sql)) return { rows: [{ inbox_id: inboxId }] };
    if (/FROM tenant\.crm_shared_inbox_members/.test(sql)) return { rows: [] };
    return { rows: [] };
  });
  await assert.rejects(claimSharedInboxThread(client, context, threadId), { status: 403, code: "CRM_INBOX_SCOPE_FORBIDDEN" });
  assert.equal(client.calls.some(({ sql }) => /UPDATE tenant\.crm_email_threads/.test(sql)), false);
  const membership = client.calls.find(({ sql }) => /crm_shared_inbox_members/.test(sql));
  assert.deepEqual(membership.values, [org, inboxId, user]);
});

test("shared inbox: members claim with a collision guard; an organization owner bypasses membership", async () => {
  const member = recordingClient((sql) => {
    if (/SELECT inbox_id/.test(sql)) return { rows: [{ inbox_id: inboxId }] };
    if (/crm_shared_inbox_members/.test(sql)) return { rows: [{ "?column?": 1 }] };
    if (/UPDATE tenant\.crm_email_threads/.test(sql)) return { rows: [{ id: threadId, assigned_user_id: user }] };
    return { rows: [] };
  });
  const claimed = await claimSharedInboxThread(member, context, threadId);
  assert.equal(claimed.assigned_user_id, user);
  const update = member.calls.find(({ sql }) => /UPDATE tenant\.crm_email_threads/.test(sql));
  assert.match(update.sql, /thread\.assigned_user_id IS NULL OR thread\.assigned_user_id=\$3 OR thread\.claim_expires_at<now\(\)/);

  const owner = recordingClient((sql) => {
    if (/SELECT inbox_id/.test(sql)) return { rows: [{ inbox_id: inboxId }] };
    if (/UPDATE tenant\.crm_email_threads/.test(sql)) return { rows: [] };
    return { rows: [] };
  });
  await assert.rejects(claimSharedInboxThread(owner, { ...context, roleSlugs: ["organization_owner"] }, threadId), { status: 409, code: "CRM_INBOX_COLLISION" });
  assert.equal(owner.calls.some(({ sql }) => /crm_shared_inbox_members/.test(sql)), false);

  const missing = recordingClient(() => ({ rows: [] }));
  await assert.rejects(claimSharedInboxThread(missing, context, threadId), { status: 404, code: "CRM_INBOX_THREAD_NOT_FOUND" });
  await assert.rejects(claimSharedInboxThread(missing, context, "not-a-uuid"), { status: 400, code: "CRM_IDENTIFIER_INVALID" });
});

// -------------------------------------------------- message normalisation

test("provider messages normalise Gmail and Microsoft 365 payloads to one shape", () => {
  const body = Buffer.from("Hello there").toString("base64url");
  const gmail = normalizeProviderMessage("gmail", {
    id: "m1",
    threadId: "t1",
    labelIds: ["SENT", "UNREAD"],
    internalDate: "1700000000000",
    payload: {
      mimeType: "text/plain",
      body: { data: body },
      headers: [
        { name: "From", value: "Asha <ASHA@Example.com>" },
        { name: "To", value: "a@x.test, B <b@y.test>" },
        { name: "Subject", value: "Hi" },
        { name: "Message-ID", value: "<id@x>" },
      ],
    },
  });
  assert.equal(gmail.direction, "outbound");
  assert.equal(gmail.status, "sent");
  assert.equal(gmail.unread, true);
  assert.equal(gmail.fromAddress, "asha@example.com");
  assert.deepEqual(gmail.toAddresses, ["a@x.test", "b@y.test"]);
  assert.equal(gmail.bodyText, "Hello there");
  assert.equal(gmail.occurredAt, new Date(1_700_000_000_000).toISOString());

  const outlook = normalizeProviderMessage("microsoft365", {
    id: "m2",
    conversationId: "c2",
    isRead: false,
    from: { emailAddress: { address: "Sender@Corp.test" } },
    toRecipients: [{ emailAddress: { address: "to@corp.test" } }, { emailAddress: { address: "not-an-email" } }],
    body: { contentType: "html", content: "<p>Hi</p>" },
    receivedDateTime: "2026-10-01T10:00:00Z",
  });
  assert.equal(outlook.direction, "inbound");
  assert.equal(outlook.externalThreadId, "c2");
  assert.equal(outlook.fromAddress, "sender@corp.test");
  assert.deepEqual(outlook.toAddresses, ["to@corp.test"]);
  assert.equal(outlook.bodyHtml, "<p>Hi</p>");

  assert.throws(() => normalizeProviderMessage("imap", {}), { status: 400, code: "CRM_PROVIDER_MESSAGE_INVALID" });
});
