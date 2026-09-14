import assert from "node:assert/strict";
import test from "node:test";
import { createHmac, createHash } from "node:crypto";

import { verifyInboundMailSignature, recordInboundMailEvent, InboundMailError, PLATFORM_INBOUND_MAIL_IDEMPOTENCY_CONFLICT } from "../src/core/inbound-mail.js";

const SECRET = "a".repeat(32);

test("verifyInboundMailSignature accepts a correctly signed body and rejects a tampered one", () => {
  const body = new TextEncoder().encode(JSON.stringify({ hello: "world" }));
  const signature = createHmac("sha256", SECRET).update(body).digest("hex");
  assert.doesNotThrow(() => verifyInboundMailSignature(body, signature, { INBOUND_MAIL_WEBHOOK_SECRET: SECRET }));
  assert.throws(
    () => verifyInboundMailSignature(body, signature.replace(/^./, "0"), { INBOUND_MAIL_WEBHOOK_SECRET: SECRET }),
    (error) => error instanceof InboundMailError && error.code === "PLATFORM_INBOUND_MAIL_SIGNATURE_INVALID",
  );
});

test("verifyInboundMailSignature refuses to run without an operator-configured secret", () => {
  const body = new TextEncoder().encode("x");
  const wellFormedButUnverifiable = "0".repeat(64);
  assert.throws(
    () => verifyInboundMailSignature(body, wellFormedButUnverifiable, { INBOUND_MAIL_WEBHOOK_SECRET: "" }),
    (error) => error instanceof InboundMailError && error.code === "PLATFORM_INBOUND_MAIL_NOT_CONFIGURED",
  );
});

test("recordInboundMailEvent rejects a replayed provider-message-id whose payload digest diverges (no silent overwrite)", async () => {
  const client = {
    query: async (sql) => {
      if (/INSERT INTO inbound_mail_events/.test(sql)) return { rows: [] }; // ON CONFLICT DO NOTHING -> no row
      if (/SELECT id,payload_digest/.test(sql)) {
        return { rows: [{ id: "existing-1", payload_digest: createHash("sha256").update("original").digest("hex") }] };
      }
      return { rows: [] };
    },
  };
  await assert.rejects(
    recordInboundMailEvent(client, {
      organizationId: "org-1",
      provider: "sendgrid",
      providerMessageId: "msg-1",
      routeKey: "support",
      payloadDigest: createHash("sha256").update("different-content").digest("hex"),
    }),
    (error) => error instanceof InboundMailError && error.code === PLATFORM_INBOUND_MAIL_IDEMPOTENCY_CONFLICT,
  );
});

test("recordInboundMailEvent treats an identical replay (same digest) as a safe idempotent no-op", async () => {
  const digest = createHash("sha256").update("same-content").digest("hex");
  const client = {
    query: async (sql) => {
      if (/INSERT INTO inbound_mail_events/.test(sql)) return { rows: [] };
      if (/SELECT id,payload_digest/.test(sql)) return { rows: [{ id: "existing-1", payload_digest: digest }] };
      return { rows: [] };
    },
  };
  const result = await recordInboundMailEvent(client, {
    organizationId: "org-1",
    provider: "sendgrid",
    providerMessageId: "msg-1",
    routeKey: "support",
    payloadDigest: digest,
  });
  assert.equal(result.replayed, true);
  assert.equal(result.id, "existing-1");
});
