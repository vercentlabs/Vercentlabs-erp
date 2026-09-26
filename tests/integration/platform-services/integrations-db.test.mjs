// Developer API keys, OAuth (local provider stand-in), webhooks (local HTTP
// receivers, the worker's own delivery code) and inbound email -> Support,
// against real PostgreSQL on the restricted runtime role. Includes upgrade
// replays of migrations 064 (legacy wildcard keys) and 184 (CRM webhooks).
import assert from "node:assert/strict";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createMemoryObjectStorage } from "../../../packages/document-engine/src/index.js";
import { enforceRateLimit } from "../../../services/api/src/core/security.js";
import { publishDomainEvent } from "../../../services/api/src/core/platform/events/index.js";
import { setObjectStorageForTests } from "../../../services/api/src/core/platform/files/index.js";
import {
  authenticateApiKey,
  createApiKey,
  createDeveloperApp,
  getApiPlatformContext,
  listApiKeys,
  requireApiScope,
  revokeApiKey,
  revokeDeveloperApp,
} from "../../../services/api/src/core/platform/integrations/api-keys/index.js";
import { createInboundMailRoute } from "../../../services/api/src/core/platform/integrations/inbound-mail/index.js";
import {
  beginOAuthConnection,
  consumeOAuthState,
  exchangeOAuthCode,
  getOAuthAccessToken,
  listOAuthConnections,
  revokeOAuthConnection,
  saveOAuthConnection,
} from "../../../services/api/src/core/platform/integrations/oauth/index.js";
import { decryptSecret } from "../../../services/api/src/core/platform/secrets/index.js";
import {
  createWebhookSubscription,
  listWebhookDeliveries,
  listWebhookSubscriptions,
  redeliverWebhookDelivery,
  rotateWebhookSecret,
  verifyOutboundWebhookSignature,
} from "../../../services/api/src/core/platform/integrations/webhooks/index.js";
import { receiveInboundMail } from "../../../services/api/src/orchestration/integrations/inbound-mail.js";
import { dispatchOrganizationEvents, processOrganizationWebhooks } from "../../../services/worker/src/webhooks.js";
import { startOAuthStandIn } from "../../support/oauth-standin.mjs";
import { createRuntimeKit, expectCode } from "../shared-runtime/runtime-kit.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const migrationBody = (relative) => fs.readFileSync(path.join(root, relative), "utf8").replace(/^\s*BEGIN;\s*/i, "").replace(/\s*COMMIT;\s*$/i, "");
const ENV = {
  NODE_ENV: "test",
  APP_URL: "http://localhost:3001",
  INTEGRATION_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
  GOOGLE_OAUTH_CLIENT_ID: "standin-client",
  GOOGLE_OAUTH_CLIENT_SECRET: "standin-secret",
  WEBHOOK_ALLOW_PRIVATE_TARGETS: "true",
  ATTACHMENT_SCAN_MODE: "local",
};
Object.assign(process.env, { INTEGRATION_TOKEN_ENCRYPTION_KEY: ENV.INTEGRATION_TOKEN_ENCRYPTION_KEY, ATTACHMENT_SCAN_MODE: "local" });

test("developer API: apps, keys, scopes, machine principal", async (t) => {
  const kit = await createRuntimeKit();
  try {
    const org = await kit.organization(["admin"]);
    const other = await kit.organization(["x"]);
    const admin = org.session("admin", ["integrations.manage"]);
    // Administration runs under the admin's organisation; key authentication
    // starts with NO organisation (the key alone establishes it).
    const platform = (work) => kit.tenant(org.organizationId, work);
    const ingress = (work) => kit.runtime(async (client) => {
      await client.query("BEGIN");
      try {
        const result = await work(client);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    });

    const app = await platform((client) => createDeveloperApp(client, admin, { name: "Warehouse sync" }));
    const first = await platform((client) => createApiKey(client, admin, app.id, { name: "Primary", scopes: ["platform.context.read"] }));
    const second = await platform((client) => createApiKey(client, admin, app.id, { name: "Rotation", scopes: ["platform.context.read"] }));

    await t.test("one app holds several keys; the plaintext is returned once and only its hash is stored", async () => {
      assert.notEqual(first.token, second.token);
      const stored = (await kit.owner.query(`SELECT key_hash, key_prefix FROM api_keys WHERE developer_app_id=$1`, [app.id])).rows;
      assert.equal(stored.length, 2);
      assert.ok(stored.every((row) => row.key_hash === createHash("sha256").update(row.key_prefix === first.key.prefix ? first.token : second.token).digest("hex")));
      assert.ok(!JSON.stringify(await platform((client) => listApiKeys(client, org.organizationId))).includes(first.token));
    });

    await t.test("unknown scopes and '*' cannot be issued", async () => {
      await assert.rejects(platform((client) => createApiKey(client, admin, app.id, { name: "Bad", scopes: ["*"] })), expectCode("PLATFORM_API_SCOPE_UNKNOWN"));
      await assert.rejects(platform((client) => createApiKey(client, admin, app.id, { name: "Bad", scopes: ["crm.leads.write"] })), expectCode("PLATFORM_API_SCOPE_UNKNOWN"));
      await assert.rejects(kit.owner.query(`UPDATE api_keys SET scopes=ARRAY['*'] WHERE developer_app_id=$1`, [app.id]), "the database refuses wildcard scopes");
    });

    await t.test("a key authenticates to its own organisation only, with its registered scopes", async () => {
      const principal = await ingress((client) => authenticateApiKey(client, first.token));
      assert.equal(principal.organizationId, org.organizationId);
      assert.deepEqual([...principal.scopes], ["platform.context.read"]);
      const context = await kit.tenant(principal.organizationId, (client) => getApiPlatformContext(client, principal));
      assert.equal(context.organization.id, org.organizationId);
      assert.equal(context.app.name, "Warehouse sync");
      for (const leaked of ["password", "billing", "role", "users", first.token]) assert.ok(!JSON.stringify(context).toLowerCase().includes(leaked.toLowerCase()), leaked);
      assert.notEqual(context.organization.id, other.organizationId);
    });

    await t.test("rate limit per key", async () => {
      const principal = await ingress((client) => authenticateApiKey(client, second.token));
      for (let attempt = 0; attempt < 3; attempt += 1) await platform((client) => enforceRateLimit(client, `api-key:${principal.apiKeyId}`, 3, 60));
      await assert.rejects(platform((client) => enforceRateLimit(client, `api-key:${principal.apiKeyId}`, 3, 60)), (error) => error.status === 429);
      await kit.owner.query(`DELETE FROM auth_rate_limits WHERE key=$1`, [`api-key:${principal.apiKeyId}`]);
    });

    await t.test("revoked and expired keys are refused; revoking the app refuses every key", async () => {
      await platform((client) => revokeApiKey(client, admin, first.key.id));
      await assert.rejects(ingress((client) => authenticateApiKey(client, first.token)), expectCode("PLATFORM_API_KEY_INVALID"));
      const expiring = await platform((client) => createApiKey(client, admin, app.id, { name: "Short", scopes: ["platform.context.read"], expiresAt: new Date(Date.now() + 60_000).toISOString() }));
      await kit.owner.query(`UPDATE api_keys SET expires_at = now() - interval '1 second' WHERE id=$1`, [expiring.key.id]);
      await assert.rejects(ingress((client) => authenticateApiKey(client, expiring.token)), expectCode("PLATFORM_API_KEY_INVALID"));
      await ingress((client) => authenticateApiKey(client, second.token));
      const revoked = await platform((client) => revokeDeveloperApp(client, admin, app.id));
      assert.ok(revoked.revokedKeys >= 1);
      await assert.rejects(ingress((client) => authenticateApiKey(client, second.token)), expectCode("PLATFORM_API_KEY_INVALID"));
      assert.equal((await kit.owner.query(`SELECT count(*)::int AS n FROM api_keys WHERE developer_app_id=$1`, [app.id])).rows[0].n, 3, "key history is never deleted");
      const events = (await kit.owner.query(`SELECT event_type FROM audit_events WHERE organization_id=$1 AND event_type LIKE 'integration.%' ORDER BY created_at`, [org.organizationId])).rows.map((row) => row.event_type);
      assert.ok(events.includes("integration.api_key_created") && events.includes("integration.api_key_revoked") && events.includes("integration.developer_app_revoked"));
      assert.ok(!JSON.stringify(await kit.owner.query(`SELECT metadata FROM audit_events WHERE organization_id=$1`, [org.organizationId])).includes(second.token), "no plaintext key in audit");
    });

    await t.test("requireApiScope separates machine scopes from human permissions", () => {
      assert.throws(() => requireApiScope({ scopes: [] }, "platform.context.read"), expectCode("PLATFORM_API_SCOPE_DENIED"));
    });
  } finally {
    await kit.close();
  }
});

test("developer API upgrade: legacy wildcard and app-less keys (migration 064)", async () => {
  const kit = await createRuntimeKit();
  try {
    const org = await kit.organization(["owner"]);
    const client = kit.owner;
    await client.query("BEGIN");
    await client.query(`ALTER TABLE api_keys DROP CONSTRAINT api_keys_no_wildcard_scope`);
    await client.query(`ALTER TABLE api_keys ALTER COLUMN developer_app_id DROP NOT NULL`);
    const keyId = randomUUID();
    await client.query(
      `INSERT INTO api_keys (id, organization_id, developer_app_id, name, key_prefix, key_hash, scopes, created_by) VALUES ($1,$2,NULL,'Legacy','vlk_live_legacy',$3,ARRAY['*','legacy.unknown'],$4)`,
      [keyId, org.organizationId, createHash("sha256").update(randomUUID()).digest("hex"), org.ids.owner],
    );
    await client.query(migrationBody("database/platform/migrations/064_developer_apps_and_api_scopes.sql"));
    await client.query("COMMIT");
    const row = (await client.query(`SELECT scopes, developer_app_id FROM api_keys WHERE id=$1`, [keyId])).rows[0];
    assert.deepEqual(row.scopes, ["legacy.unknown", "platform.context.read"], "wildcard became today's explicit scopes; the unknown string is kept but grants nothing");
    assert.ok(row.developer_app_id, "an app was created for the key");
    await assert.rejects(client.query(`UPDATE api_keys SET scopes=ARRAY['*'] WHERE id=$1`, [keyId]), "the wildcard constraint is back");
  } finally {
    await kit.owner.query("ROLLBACK").catch(() => undefined);
    await kit.close();
  }
});

test("OAuth: PKCE flow, encrypted tokens, refresh, rotation, reconnect", async (t) => {
  const kit = await createRuntimeKit();
  const standin = await startOAuthStandIn({ clients: { google: { clientId: ENV.GOOGLE_OAUTH_CLIENT_ID, clientSecret: ENV.GOOGLE_OAUTH_CLIENT_SECRET } } });
  const env = { ...ENV, OAUTH_STANDIN_URL: standin.baseUrl };
  try {
    const org = await kit.organization(["admin"]);
    const other = await kit.organization(["x"]);
    const admin = org.session("admin", ["integrations.manage"]);
    const tx = (work) => kit.tenant(org.organizationId, work);
    const authorize = async () => {
      const started = await tx((client) => beginOAuthConnection(client, admin, { profile: "google.identity", returnPath: "/settings/integrations" }, env));
      const response = await fetch(started.authorizeUrl, { redirect: "manual" });
      const callback = new URL(response.headers.get("location"));
      return { callback, state: callback.searchParams.get("state"), code: callback.searchParams.get("code") };
    };
    let connectionId;

    await t.test("the provider is sent to the server's own callback; the connection stores only ciphertext", async () => {
      const { callback, state, code } = await authorize();
      assert.equal(`${callback.origin}${callback.pathname}`, "http://localhost:3001/api/settings/integrations/oauth/callback/google");
      const attempt = await tx((client) => consumeOAuthState(client, admin, "google", state, env));
      assert.equal(attempt.returnPath, "/settings/integrations");
      const exchanged = await exchangeOAuthCode(attempt.profileKey, { code, redirectUri: attempt.redirectUri, codeVerifier: attempt.codeVerifier }, env);
      connectionId = (await tx((client) => saveOAuthConnection(client, admin, exchanged, env))).id;
      const row = (await kit.owner.query(`SELECT * FROM oauth_connections WHERE id=$1`, [connectionId])).rows[0];
      assert.equal(row.status, "active");
      assert.equal(row.profile_key, "google.identity");
      assert.equal(row.provider_account_label, "connected.user@example.test");
      assert.ok(!JSON.stringify(row.encrypted_credentials).includes(exchanged.tokens.accessToken));
      const listed = await tx((client) => listOAuthConnections(client, org.organizationId));
      assert.equal(listed.length, 1);
      assert.ok(!JSON.stringify(listed).includes(exchanged.tokens.accessToken) && !("encryptedCredentials" in listed[0]));
      assert.deepEqual(await tx((client) => listOAuthConnections(client, other.organizationId)), []);
    });

    await t.test("a state is single-use, expires, and belongs to its user", async () => {
      const { state } = await authorize();
      await tx((client) => consumeOAuthState(client, admin, "google", state, env));
      await assert.rejects(tx((client) => consumeOAuthState(client, admin, "google", state, env)), expectCode("PLATFORM_OAUTH_STATE_INVALID"));
      const expired = await authorize();
      await kit.owner.query(`UPDATE oauth_states SET expires_at = now() - interval '1 second' WHERE consumed_at IS NULL AND organization_id=$1`, [org.organizationId]);
      await assert.rejects(tx((client) => consumeOAuthState(client, admin, "google", expired.state, env)), expectCode("PLATFORM_OAUTH_STATE_INVALID"));
      const stolen = await authorize();
      await assert.rejects(tx((client) => consumeOAuthState(client, { ...admin, userId: randomUUID() }, "google", stolen.state, env)), expectCode("PLATFORM_OAUTH_STATE_INVALID"));
    });

    await t.test("a wrong PKCE verifier or a provider refusal never connects", async () => {
      const { state, code } = await authorize();
      const attempt = await tx((client) => consumeOAuthState(client, admin, "google", state, env));
      await assert.rejects(exchangeOAuthCode(attempt.profileKey, { code, redirectUri: attempt.redirectUri, codeVerifier: "wrong-verifier-wrong-verifier-wrong-verifier" }, env), expectCode("PLATFORM_OAUTH_EXCHANGE_FAILED"));
      await standin.setConfig({ consent: "deny" });
      const denied = await authorize();
      assert.equal(denied.callback.searchParams.get("error"), "access_denied");
      assert.equal(denied.code, null);
      await standin.setConfig({ consent: "allow" });
    });

    await t.test("refresh happens only when needed, rotates the refresh token and bumps the credential version", async () => {
      const withClient = (work) => tx(work);
      const token1 = await getOAuthAccessToken(withClient, { organizationId: org.organizationId, connectionId }, env);
      const before = (await kit.owner.query(`SELECT credential_version, encrypted_credentials FROM oauth_connections WHERE id=$1`, [connectionId])).rows[0];
      assert.equal(await getOAuthAccessToken(withClient, { organizationId: org.organizationId, connectionId }, env), token1, "an unexpired token is reused");
      await kit.owner.query(`UPDATE oauth_connections SET expires_at = now() - interval '1 minute' WHERE id=$1`, [connectionId]);
      const token2 = await getOAuthAccessToken(withClient, { organizationId: org.organizationId, connectionId }, env);
      assert.notEqual(token2, token1);
      const after = (await kit.owner.query(`SELECT credential_version, encrypted_credentials, last_refreshed_at FROM oauth_connections WHERE id=$1`, [connectionId])).rows[0];
      assert.equal(after.credential_version, before.credential_version + 1);
      assert.notEqual((await decryptSecret(after.encrypted_credentials, env)).refreshToken, (await decryptSecret(before.encrypted_credentials, env)).refreshToken);
      assert.ok(after.last_refreshed_at);
    });

    await t.test("a transient provider failure keeps the connection; a revoked grant requires reconnecting", async () => {
      const withClient = (work) => tx(work);
      await kit.owner.query(`UPDATE oauth_connections SET expires_at = now() - interval '1 minute' WHERE id=$1`, [connectionId]);
      await standin.setConfig({ failNextToken: true });
      await assert.rejects(getOAuthAccessToken(withClient, { organizationId: org.organizationId, connectionId }, env), expectCode("PLATFORM_OAUTH_REFRESH_FAILED"));
      assert.equal((await kit.owner.query(`SELECT status FROM oauth_connections WHERE id=$1`, [connectionId])).rows[0].status, "active");
      standin.revokeAllRefreshTokens();
      await assert.rejects(getOAuthAccessToken(withClient, { organizationId: org.organizationId, connectionId }, env), expectCode("PLATFORM_OAUTH_RECONNECT_REQUIRED"));
      assert.equal((await kit.owner.query(`SELECT status FROM oauth_connections WHERE id=$1`, [connectionId])).rows[0].status, "reconnect_required");
    });

    await t.test("revocation wipes credentials; another organisation cannot revoke", async () => {
      await assert.rejects(tx((client) => revokeOAuthConnection(client, { organizationId: other.organizationId, userId: other.ids.x }, connectionId, { administrator: true })), expectCode("PLATFORM_OAUTH_CONNECTION_NOT_FOUND"));
      await tx((client) => revokeOAuthConnection(client, admin, connectionId, { administrator: true }));
      const row = (await kit.owner.query(`SELECT status, encrypted_credentials FROM oauth_connections WHERE id=$1`, [connectionId])).rows[0];
      assert.equal(row.status, "revoked");
      assert.deepEqual(row.encrypted_credentials, {});
    });
  } finally {
    await standin.close();
    await kit.close();
  }
});

function receiver(behaviour) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      requests.push({ headers: req.headers, body });
      const [status, headers] = behaviour(requests.length);
      res.writeHead(status, headers || {});
      res.end("ok");
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${server.address().port}/hook`, requests, close: () => new Promise((done) => server.close(done)) })));
}

test("webhooks: per-subscription deliveries, signing, retries, dead letters, redelivery", async (t) => {
  const kit = await createRuntimeKit();
  const receivers = await Promise.all([
    receiver(() => [200]),
    receiver((count) => [count === 1 ? 500 : 200]),
    receiver(() => [200]),
    receiver(() => [400]),
    receiver(() => [302, { location: "http://169.254.169.254/" }]),
  ]);
  const [a, b, c, d, redirecting] = receivers;
  const config = { worker: { leaseMilliseconds: 60_000, batchSize: 20, webhookTimeoutMilliseconds: 5_000, allowPrivateWebhookTargets: true } };
  try {
    const org = await kit.organization(["admin"]);
    const other = await kit.organization(["x"]);
    const admin = org.session("admin", ["integrations.manage"]);
    const tenant = (work) => kit.tenant(org.organizationId, work);
    const create = (name, url, eventTypes = ["crm.leads.assigned"]) => tenant((client) => createWebhookSubscription(client, admin, { name, endpointUrl: url, eventTypes }, ENV));
    const process = () => processOrganizationWebhooks(kit.pool, "test-worker", config, org.organizationId, { env: ENV });
    const deliveries = async () => (await kit.owner.query(`SELECT d.*, s.name FROM tenant.webhook_deliveries d JOIN tenant.webhook_subscriptions s ON s.id=d.subscription_id WHERE d.organization_id=$1`, [org.organizationId])).rows;
    const created = {};
    for (const [name, target] of [["A", a], ["B", b], ["C", c]]) created[name] = await create(name, target.url);

    await t.test("subscriptions: registered events only; secret revealed once and stored encrypted", async () => {
      await assert.rejects(create("Bad", a.url, ["crm.anything"]), expectCode("PLATFORM_WEBHOOK_EVENT_UNKNOWN"));
      assert.match(created.A.signingSecret, /^whsec_/);
      const stored = (await kit.owner.query(`SELECT encrypted_signing_secret FROM tenant.webhook_subscriptions WHERE id=$1`, [created.A.subscription.id])).rows[0];
      assert.ok(!JSON.stringify(stored).includes(created.A.signingSecret));
      assert.ok(!JSON.stringify(await tenant((client) => listWebhookSubscriptions(client, org.organizationId))).includes(created.A.signingSecret));
      assert.deepEqual(await kit.tenant(other.organizationId, (client) => listWebhookSubscriptions(client, other.organizationId)), []);
    });

    let eventId;
    await t.test("one event to three subscribers -> three deliveries; a retry re-sends only the failed one", async () => {
      eventId = await tenant((client) => publishDomainEvent(client, { organizationId: org.organizationId, moduleKey: "crm", eventType: "crm.leads.assigned", entityType: "leads", entityId: randomUUID(), payload: { ownerUserId: org.ids.admin, reason: "manual", email: "secret@customer.test", phone: "+91 99999 00000" } }));
      await tenant((client) => publishDomainEvent(client, { organizationId: org.organizationId, eventType: "crm.custom.emitted", entityType: "leads", entityId: randomUUID(), payload: {} }));
      await process();
      const rows = await deliveries();
      assert.equal(rows.length, 3, "an unregistered event creates no deliveries");
      assert.deepEqual(Object.fromEntries(rows.map((row) => [row.name, row.status])), { A: "delivered", B: "retry", C: "delivered" });
      await process();
      assert.equal(a.requests.length, 1);
      await kit.owner.query(`UPDATE tenant.webhook_deliveries SET next_attempt_at = now() WHERE status='retry'`);
      await process();
      assert.deepEqual(Object.fromEntries((await deliveries()).map((row) => [row.name, row.status])), { A: "delivered", B: "delivered", C: "delivered" });
      assert.equal(a.requests.length, 1, "A never received a duplicate");
      assert.equal(c.requests.length, 1);
      assert.equal(b.requests.length, 2);
      assert.equal(b.requests[0].headers["x-vercentlabs-delivery-id"], b.requests[1].headers["x-vercentlabs-delivery-id"], "a retry keeps the delivery id");
    });

    await t.test("deliveries are signed (v1) and minimised", async () => {
      const request = a.requests[0];
      assert.equal(request.headers["x-vercentlabs-event"], "crm.leads.assigned");
      assert.equal(request.headers["x-vercentlabs-event-id"], eventId);
      assert.ok(
        verifyOutboundWebhookSignature(created.A.signingSecret, { deliveryId: request.headers["x-vercentlabs-delivery-id"], timestamp: request.headers["x-vercentlabs-timestamp"], body: request.body, signatureHeader: request.headers["x-vercentlabs-signature"] }),
      );
      const body = JSON.parse(request.body);
      assert.equal(body.type, "crm.leads.assigned");
      assert.equal(body.data.ownerUserId, org.ids.admin);
      assert.ok(!request.body.includes("secret@customer.test") && !request.body.includes("99999"), "payload is the registered allow-list only");
    });

    await t.test("re-dispatching the same event never duplicates a delivery", async () => {
      await kit.owner.query(`UPDATE tenant.platform_events SET dispatch_status='pending' WHERE id=$1`, [eventId]);
      await process();
      assert.equal((await deliveries()).length, 3);
      assert.equal(a.requests.length, 1);
    });

    await t.test("a webhook created after an event never receives that older event", async () => {
      const earlier = await tenant((client) => publishDomainEvent(client, { organizationId: org.organizationId, moduleKey: "crm", eventType: "crm.leads.archived", entityType: "leads", entityId: randomUUID(), payload: {} }));
      const late = await create("Late", c.url, ["crm.leads.archived"]);
      await process();
      const rows = (await deliveries()).filter((row) => row.subscription_id === late.subscription.id);
      assert.deepEqual(rows, [], "the pre-existing event is not delivered to the new webhook");
      assert.ok(earlier);
    });

    await t.test("a crashed worker's lease is reclaimed", async () => {
      const lease = await tenant((client) => publishDomainEvent(client, { organizationId: org.organizationId, eventType: "crm.leads.assigned", entityType: "leads", entityId: randomUUID(), payload: {} }));
      await kit.owner.query(`UPDATE tenant.webhook_subscriptions SET status='disabled' WHERE name IN ('B','C') AND organization_id=$1`, [org.organizationId]);
      await dispatchOrganizationEvents(kit.pool, org.organizationId);
      const stuck = (await kit.owner.query(`SELECT id FROM tenant.webhook_deliveries WHERE event_id=$1`, [lease])).rows[0];
      // A worker claimed it and died mid-delivery: the lease is an hour old.
      await kit.owner.query(`UPDATE tenant.webhook_deliveries SET status='processing', locked_by='dead-worker', locked_at = now() - interval '1 hour', attempt_count=1 WHERE id=$1`, [stuck.id]);
      await process();
      assert.equal((await kit.owner.query(`SELECT status FROM tenant.webhook_deliveries WHERE id=$1`, [stuck.id])).rows[0].status, "delivered");
      await kit.owner.query(`UPDATE tenant.webhook_subscriptions SET status='active' WHERE organization_id=$1`, [org.organizationId]);
    });

    await t.test("a terminal failure is a dead letter; manual redelivery re-sends the same delivery", async () => {
      const dead = await create("D", d.url);
      const redirect = await create("R", redirecting.url);
      await kit.owner.query(`UPDATE tenant.webhook_subscriptions SET status='disabled' WHERE name IN ('A','B','C') AND organization_id=$1`, [org.organizationId]);
      await tenant((client) => publishDomainEvent(client, { organizationId: org.organizationId, eventType: "crm.leads.assigned", entityType: "leads", entityId: randomUUID(), payload: {} }));
      await process();
      const [deadDelivery] = await tenant((client) => listWebhookDeliveries(client, org.organizationId, { subscriptionId: dead.subscription.id }));
      assert.equal(deadDelivery.status, "dead");
      const [redirectDelivery] = await tenant((client) => listWebhookDeliveries(client, org.organizationId, { subscriptionId: redirect.subscription.id }));
      assert.equal(redirectDelivery.status, "dead", "a redirect is never followed");
      assert.equal(redirecting.requests.length, 1);
      await tenant((client) => redeliverWebhookDelivery(client, admin, deadDelivery.id));
      await process();
      assert.equal(d.requests.length, 2);
      assert.equal(d.requests[0].headers["x-vercentlabs-delivery-id"], d.requests[1].headers["x-vercentlabs-delivery-id"]);
      await assert.rejects(tenant((client) => redeliverWebhookDelivery(client, admin, (a.requests[0] && randomUUID()))), expectCode("PLATFORM_WEBHOOK_REDELIVERY_NOT_ALLOWED"));
    });

    await t.test("rotating the secret signs later deliveries with the new one", async () => {
      await kit.owner.query(`UPDATE tenant.webhook_subscriptions SET status = CASE WHEN name='A' THEN 'active' ELSE 'disabled' END WHERE organization_id=$1`, [org.organizationId]);
      const rotated = await tenant((client) => rotateWebhookSecret(client, admin, created.A.subscription.id, ENV));
      await tenant((client) => publishDomainEvent(client, { organizationId: org.organizationId, eventType: "crm.leads.assigned", entityType: "leads", entityId: randomUUID(), payload: {} }));
      await process();
      const last = a.requests.at(-1);
      const input = { deliveryId: last.headers["x-vercentlabs-delivery-id"], timestamp: last.headers["x-vercentlabs-timestamp"], body: last.body, signatureHeader: last.headers["x-vercentlabs-signature"] };
      assert.ok(verifyOutboundWebhookSignature(rotated.signingSecret, input));
      assert.equal(verifyOutboundWebhookSignature(created.A.signingSecret, input), false);
    });

    await t.test("endpoint validation blocks unsafe targets in production", async () => {
      await assert.rejects(tenant((client) => createWebhookSubscription(client, admin, { name: "Meta", endpointUrl: "http://169.254.169.254/latest", eventTypes: ["crm.leads.assigned"] }, { ...ENV, NODE_ENV: "production", WEBHOOK_ALLOW_PRIVATE_TARGETS: "true" })), expectCode("PLATFORM_WEBHOOK_ENDPOINT_INVALID"));
      await assert.rejects(tenant((client) => createWebhookSubscription(client, admin, { name: "Plain", endpointUrl: "http://example.com/hook", eventTypes: ["crm.leads.assigned"] }, { ...ENV, NODE_ENV: "production" })), expectCode("PLATFORM_WEBHOOK_ENDPOINT_INVALID"));
    });
  } finally {
    await Promise.all(receivers.map((entry) => entry.close()));
    await kit.close();
  }
});

test("webhooks upgrade: CRM subscriptions and unfinished CRM outbox rows move to the platform (migration 184)", async () => {
  const kit = await createRuntimeKit();
  try {
    const org = await kit.organization(["owner"]);
    const subscriptionId = randomUUID();
    const pendingId = randomUUID();
    const deliveredId = randomUUID();
    await kit.owner.query(`INSERT INTO tenant.crm_webhook_subscriptions (id, organization_id, name, endpoint_url, event_types, status, created_by) VALUES ($1,$2,'Legacy hook','https://example.com/hook',ARRAY['crm.leads.assigned'],'inactive',$3)`, [subscriptionId, org.organizationId, org.ids.owner]);
    await kit.owner.query(
      `INSERT INTO tenant.crm_outbox_events (id, organization_id, event_type, entity_type, entity_id, payload, status) VALUES ($1,$3,'crm.leads.assigned','leads',$4,'{}'::jsonb,'failed'), ($2,$3,'crm.leads.assigned','leads',$4,'{}'::jsonb,'delivered')`,
      [pendingId, deliveredId, org.organizationId, randomUUID()],
    );
    await kit.owner.query(`BEGIN; ${migrationBody("database/tenant/migrations/184_platform_events_and_webhooks.sql")}; COMMIT;`);
    const subscription = (await kit.owner.query(`SELECT status, legacy_source, encrypted_signing_secret FROM tenant.webhook_subscriptions WHERE id=$1`, [subscriptionId])).rows[0];
    assert.deepEqual(subscription, { status: "disabled", legacy_source: "crm_webhook_subscriptions", encrypted_signing_secret: null });
    const events = Object.fromEntries((await kit.owner.query(`SELECT id, dispatch_status FROM tenant.platform_events WHERE id = ANY($1::uuid[])`, [[pendingId, deliveredId]])).rows.map((row) => [row.id, row.dispatch_status]));
    assert.deepEqual(events, { [pendingId]: "pending", [deliveredId]: "dispatched" });
    assert.equal((await kit.owner.query(`SELECT count(*)::int AS n FROM tenant.crm_outbox_events WHERE organization_id=$1`, [org.organizationId])).rows[0].n, 2, "history is kept");
  } finally {
    await kit.close();
  }
});

test("inbound email -> Support: routing, verification, idempotency, threading", async (t) => {
  const kit = await createRuntimeKit();
  setObjectStorageForTests(createMemoryObjectStorage());
  try {
    const org = await kit.organization(["admin"]);
    const other = await kit.organization(["x"]);
    await kit.owner.query(`INSERT INTO organization_modules (organization_id, module_key, name, status, enabled_at) VALUES ($1,'support','Support','enabled',now()) ON CONFLICT (organization_id, module_key) DO UPDATE SET status='enabled'`, [org.organizationId]);
    const admin = org.session("admin", ["integrations.manage"]);
    const route = await kit.tenant(org.organizationId, async (client) => createInboundMailRoute(client, admin, { name: "Help desk", target: "support.email_to_ticket", companyId: org.companyId }, ENV));
    const runners = {
      runPlatform: (work) => kit.runtime(async (client) => {
        await client.query("BEGIN");
        try {
          const result = await work(client);
          await client.query("COMMIT");
          return result;
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        }
      }),
      runTenant: (organizationId, work) => kit.tenant(organizationId, work),
    };
    const post = (message, { secret = route.signingSecret, routeKey = route.routeKey } = {}) => {
      const rawBody = JSON.stringify(message);
      return receiveInboundMail(runners, { routeKey, rawBody, signature: `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}` }, ENV);
    };
    const base = { provider: "standin-mail", from: { email: "Customer@Example.test", name: "Ria Customer" }, to: ["help@acme.test"] };
    const tickets = async () => (await kit.owner.query(`SELECT * FROM tenant.support_tickets WHERE organization_id=$1 ORDER BY created_at`, [org.organizationId])).rows;
    const communications = async (ticketId) => (await kit.owner.query(`SELECT * FROM tenant.support_communications WHERE ticket_id=$1 ORDER BY created_at`, [ticketId])).rows;

    await t.test("a new email opens exactly one ticket; the body's organisation id is ignored", async () => {
      const first = { ...base, messageId: "<m1@mail.test>", subject: "Printer broken", text: "It jams.", organizationId: other.organizationId };
      const result = await post(first);
      assert.equal(result.outcome, "new_ticket");
      const [ticket] = await tickets();
      assert.equal(ticket.channel, "email");
      assert.equal(ticket.customer_email, "customer@example.test");
      assert.equal(ticket.company_id, org.companyId);
      assert.equal((await kit.owner.query(`SELECT count(*)::int AS n FROM tenant.support_tickets WHERE organization_id=$1`, [other.organizationId])).rows[0].n, 0);
      const [message] = await communications(ticket.id);
      assert.equal(message.direction, "inbound");
      assert.equal(message.private_note, false, "customer mail is never a private note");
      assert.equal(message.external_message_id, "m1@mail.test");
      const replay = await post(first);
      assert.equal(replay.replayed, true);
      assert.equal((await tickets()).length, 1, "a provider replay creates nothing");
      await assert.rejects(post({ ...first, text: "Different body" }), expectCode("PLATFORM_INBOUND_MAIL_IDEMPOTENCY_CONFLICT"));
    });

    await t.test("a reply joins the thread once and resumes a pending-customer ticket", async () => {
      const [ticket] = await tickets();
      await kit.owner.query(`UPDATE tenant.support_tickets SET status='pending_customer' WHERE id=$1`, [ticket.id]);
      const reply = { ...base, messageId: "<m2@mail.test>", inReplyTo: "<m1@mail.test>", subject: "Re: Printer broken", text: "Still jammed." };
      assert.equal((await post(reply)).outcome, "reply");
      assert.equal((await communications(ticket.id)).length, 2);
      assert.notEqual((await tickets())[0].status, "pending_customer");
      await post(reply);
      assert.equal((await communications(ticket.id)).length, 2, "a duplicate reply adds nothing");
    });

    await t.test("attachments go through the malware/type pipeline", async () => {
      const result = await post({
        ...base,
        messageId: "<m3@mail.test>",
        subject: "Photos",
        text: "See attached",
        attachments: [
          { fileName: "notes.txt", contentType: "text/plain", contentBase64: Buffer.from("serial 123").toString("base64") },
          { fileName: "eicar.txt", contentType: "text/plain", contentBase64: Buffer.from("X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*").toString("base64") },
        ],
      });
      const files = (await kit.owner.query(`SELECT file_name, file_id FROM tenant.support_attachments WHERE ticket_id=$1`, [result.ticketId])).rows;
      assert.deepEqual(files.map((row) => row.file_name), ["notes.txt"]);
      assert.ok(files[0].file_id);
      const event = (await kit.owner.query(`SELECT attachment_notes FROM inbound_mail_events WHERE id=$1`, [result.eventId])).rows[0];
      assert.deepEqual(event.attachment_notes.map((note) => note.status), ["accepted", "rejected"]);
    });

    await t.test("a bad signature, an unknown route or a disabled route is refused", async () => {
      await assert.rejects(post({ ...base, messageId: "<m4@mail.test>", subject: "x", text: "x" }, { secret: "whsec_wrong" }), expectCode("PLATFORM_INBOUND_MAIL_SIGNATURE_INVALID"));
      await assert.rejects(post({ ...base, messageId: "<m5@mail.test>", subject: "x", text: "x" }, { routeKey: `imr_${randomBytes(24).toString("base64url")}` }), expectCode("PLATFORM_INBOUND_MAIL_ROUTE_NOT_FOUND"));
      await kit.owner.query(`UPDATE inbound_mail_routes SET status='disabled' WHERE id=$1`, [route.route.id]);
      await assert.rejects(post({ ...base, messageId: "<m6@mail.test>", subject: "x", text: "x" }), expectCode("PLATFORM_INBOUND_MAIL_ROUTE_NOT_FOUND"));
    });
  } finally {
    setObjectStorageForTests(null);
    await kit.owner.query(`DELETE FROM inbound_mail_routes WHERE organization_id IN (SELECT organization_id FROM inbound_mail_routes WHERE name='Help desk')`).catch(() => undefined);
    await kit.close();
  }
});
