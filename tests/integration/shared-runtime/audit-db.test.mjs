// Organisation audit read model over audit_events, against real PostgreSQL on
// the restricted runtime role. (The audit.view gate on the routes is asserted
// statically by `pnpm verify:shared-runtime`.)
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { getAuditEvent, listAuditActors, queryAuditEvents } from "../../../services/api/src/core/platform/audit/index.js";
import { createRuntimeKit, expectCode } from "./runtime-kit.mjs";

test("audit: organisation-scoped, filtered, stable cursor, redacted, read-only", async (t) => {
  const kit = await createRuntimeKit();
  try {
    const org = await kit.organization(["admin", "clerk"]);
    const other = await kit.organization(["outsider"]);
    const at = "2026-03-01T10:00:00.000Z";
    const insert = (organizationId, fields) =>
      kit.owner.query(
        `INSERT INTO audit_events (id, organization_id, actor_user_id, event_type, entity_type, entity_id, metadata, before_data, after_data, ip_address, user_agent, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [fields.id ?? randomUUID(), organizationId, fields.actor ?? null, fields.eventType, fields.entityType, fields.entityId ?? null, fields.metadata ?? {}, fields.before ?? null, fields.after ?? null, fields.ip ?? null, fields.userAgent ?? null, fields.createdAt ?? at],
      );
    // Twelve events sharing ONE timestamp: the cursor must still be stable.
    for (let index = 0; index < 12; index += 1) {
      await insert(org.organizationId, { actor: org.ids.admin, eventType: "organization.member_role_changed", entityType: "membership", entityId: `m-${index}` });
    }
    await insert(org.organizationId, { actor: org.ids.clerk, eventType: "billing.plan_changed", entityType: "billing", entityId: "sub-1", createdAt: "2026-02-01T09:00:00Z" });
    const sensitiveId = randomUUID();
    await insert(org.organizationId, {
      id: sensitiveId, actor: org.ids.clerk, eventType: "integration.api_key_created", entityType: "api_key", entityId: "key-1",
      metadata: { apiKey: "vl_live_secret", nested: { password: "hunter2", note: "x".repeat(20_000) } }, after: { clientSecret: "abc", name: "Zapier" },
      ip: "10.0.0.1", userAgent: "u".repeat(900), createdAt: "2026-01-15T09:00:00Z",
    });
    await insert(org.organizationId, { actor: null, eventType: "zz_unknown.something_new", entityType: "mystery", createdAt: "2026-01-01T00:00:00Z" });
    await insert(other.organizationId, { actor: other.ids.outsider, eventType: "organization.member_role_changed", entityType: "membership", entityId: "foreign" });
    const query = (filters, organizationId = org.organizationId) => kit.runtime((client) => queryAuditEvents(client, organizationId, filters));

    await t.test("only the caller's organisation, newest first", async () => {
      const { events } = await query({ limit: 100 });
      assert.equal(events.length, 15);
      assert.ok(!events.some((event) => event.entityId === "foreign"));
      assert.equal(events.at(-1).eventType, "zz_unknown.something_new", "unknown events are still listed (the UI labels them)");
      assert.equal(events.at(-1).actorName, null);
      const foreign = (await query({ limit: 100 }, other.organizationId)).events;
      assert.equal(foreign.length, 1);
      await assert.rejects(kit.runtime((client) => getAuditEvent(client, other.organizationId, sensitiveId)), expectCode("AUDIT_EVENT_NOT_FOUND"));
    });

    await t.test("keyset cursor is stable when timestamps collide", async () => {
      const seen = [];
      let cursor = null;
      do {
        const page = await query({ limit: 5, cursor, area: "organization" });
        seen.push(...page.events.map((event) => event.id));
        cursor = page.nextCursor;
      } while (cursor);
      assert.equal(seen.length, 12);
      assert.equal(new Set(seen).size, 12, "no row is repeated or skipped across pages");
      await assert.rejects(query({ cursor: "garbage" }), expectCode("AUDIT_QUERY_INVALID"));
    });

    await t.test("actor, area, action, record and date filters", async () => {
      assert.equal((await query({ actorUserId: org.ids.clerk })).events.length, 2);
      assert.equal((await query({ area: "billing" })).events.length, 1);
      assert.equal((await query({ eventType: "integration.api_key_created" })).events[0].id, sensitiveId);
      assert.equal((await query({ entityType: "membership", entityId: "m-3" })).events.length, 1);
      assert.equal((await query({ from: "2026-01-10", to: "2026-02-15" })).events.length, 2);
      await assert.rejects(query({ actorUserId: "1 OR 1=1" }), expectCode("AUDIT_QUERY_INVALID"));
      await assert.rejects(query({ eventType: "x'; DROP TABLE audit_events; --" }), expectCode("AUDIT_QUERY_INVALID"));
      await assert.rejects(query({ from: "not a date" }), expectCode("AUDIT_QUERY_INVALID"));
      assert.equal((await query({ limit: 100_000 })).events.length <= 100, true, "page size is capped");
    });

    await t.test("detail is redacted and size-capped", async () => {
      const detail = await kit.runtime((client) => getAuditEvent(client, org.organizationId, sensitiveId));
      const text = JSON.stringify(detail);
      assert.ok(!text.includes("vl_live_secret"));
      assert.ok(!text.includes("hunter2"));
      assert.equal(detail.after.clientSecret, "[redacted]");
      assert.equal(detail.after.name, "Zapier");
      assert.equal(detail.metadata.truncated, true, "an oversized payload is truncated");
      assert.ok(text.length < 20_000);
      assert.equal(detail.request.userAgent.length, 300);
      await assert.rejects(kit.runtime((client) => getAuditEvent(client, org.organizationId, "not-a-uuid")), expectCode("AUDIT_EVENT_NOT_FOUND"));
    });

    await t.test("actor filter options come from this organisation only", async () => {
      const actors = await kit.runtime((client) => listAuditActors(client, org.organizationId));
      assert.deepEqual(actors.map((actor) => actor.id).sort(), [org.ids.admin, org.ids.clerk].sort());
    });

    await t.test("audit events cannot be edited", async () => {
      await assert.rejects(kit.runtime((client) => client.query(`UPDATE audit_events SET event_type='tampered' WHERE id=$1`, [sensitiveId])));
    });
  } finally {
    await kit.close();
  }
});
