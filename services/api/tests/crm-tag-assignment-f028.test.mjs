import assert from "node:assert/strict";
import test from "node:test";

import {
  assignRecordTag,
  listRecordTags,
  removeRecordTag,
} from "../src/modules/crm/crm-data-operations-and-customization/tag-assignment.js";

const org = "11111111-1111-4111-8111-111111111111";
const user = "44444444-4444-4444-8444-444444444444";
const lead = "55555555-5555-4555-8555-555555555555";
const tag = "66666666-6666-4666-8666-666666666666";

// resolveCrmEntityAccess's lead branch gates on crm.leads.view_sensitive
// (canViewSensitiveLeadContent) regardless of manage permission — a
// manager fixture needs both to reach past entity access into the
// manage-permission check this module adds on top.
const manager = { organizationId: org, userId: user, activeCompanyId: null, activeBranchId: null, allowAllCompanies: true, roleSlugs: [], permissions: ["crm.leads.manage", "crm.leads.view_sensitive"] };
const viewer = { organizationId: org, userId: user, activeCompanyId: null, activeBranchId: null, allowAllCompanies: true, roleSlugs: [], permissions: ["crm.leads.view_sensitive"] };

function createClient({ leadVisible = true, tagActive = true, queries = {} } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql.includes("FROM tenant.crm_leads")) return leadVisible ? { rows: [{ id: lead }] } : { rows: [] };
      if (sql.includes("SELECT * FROM tenant.crm_tags WHERE organization_id=$1 AND id=$2 AND status='active'"))
        return tagActive ? { rows: [{ id: tag, name: "VIP", color: "#111111", status: "active" }] } : { rows: [] };
      for (const [pattern, handler] of Object.entries(queries)) {
        if (sql.includes(pattern)) return handler(values);
      }
      return { rows: [] };
    },
  };
}

test("F028 tags: listRecordTags rejects a non-lead entity type", async () => {
  const client = createClient();
  await assert.rejects(
    () => listRecordTags(client, manager, "opportunity", lead),
    (error) => error.code === "CRM_TAG_ENTITY_INVALID",
  );
});

test("F028 tags: listRecordTags returns an empty list, not an error, when the caller cannot see the parent lead", async () => {
  const client = createClient({ leadVisible: false });
  const rows = await listRecordTags(client, manager, "lead", lead);
  assert.deepEqual(rows, []);
});

test("F028 tags: listRecordTags joins assigned tags via the crm_lead_tags junction", async () => {
  const client = createClient({
    queries: {
      "FROM tenant.crm_lead_tags lt": () => ({ rows: [{ tag_id: tag, name: "VIP", color: "#111111", assigned_at: "2026-09-01T00:00:00.000Z" }] }),
    },
  });
  const rows = await listRecordTags(client, manager, "lead", lead);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].tagId, tag);
  assert.equal(rows[0].name, "VIP");
});

test("F028 tags: assignRecordTag requires crm.leads.manage, not just read access to the lead", async () => {
  const client = createClient();
  await assert.rejects(
    () => assignRecordTag(client, viewer, "lead", lead, tag),
    (error) => error.code === "CRM_TAG_PERMISSION_DENIED",
  );
  assert.ok(!client.calls.some(({ sql }) => sql.includes("INSERT INTO tenant.crm_lead_tags")), "a permission-denied assignment must never reach the write");
});

test("F028 tags: assignRecordTag fails closed when the caller cannot access the parent lead, even with crm.leads.manage", async () => {
  const client = createClient({ leadVisible: false });
  await assert.rejects(
    () => assignRecordTag(client, manager, "lead", lead, tag),
    (error) => error.code === "CRM_TAG_RELATION_INVALID",
  );
});

test("F028 tags: assignRecordTag rejects an inactive or nonexistent tag", async () => {
  const client = createClient({ tagActive: false });
  await assert.rejects(
    () => assignRecordTag(client, manager, "lead", lead, tag),
    (error) => error.code === "CRM_TAG_NOT_FOUND",
  );
});

test("F028 tags: assignRecordTag inserts idempotently (ON CONFLICT DO NOTHING) and queues an outbox event", async () => {
  const client = createClient({
    queries: {
      "INSERT INTO tenant.crm_lead_tags": () => ({ rows: [], rowCount: 1 }),
      "INSERT INTO tenant.crm_outbox_events": () => ({ rows: [], rowCount: 1 }),
      "FROM tenant.crm_lead_tags lt": () => ({ rows: [{ tag_id: tag, name: "VIP", color: "#111111", assigned_at: "2026-09-01T00:00:00.000Z" }] }),
    },
  });
  const rows = await assignRecordTag(client, manager, "lead", lead, tag);
  assert.equal(rows[0].tagId, tag);
  const insert = client.calls.find(({ sql }) => sql.includes("INSERT INTO tenant.crm_lead_tags"));
  assert.ok(insert.sql.includes("ON CONFLICT"), "assigning an already-assigned tag must not throw a duplicate-key error");
  assert.ok(client.calls.some(({ sql }) => sql.includes("INSERT INTO tenant.crm_outbox_events")));
});

test("F028 tags: removeRecordTag requires crm.leads.manage", async () => {
  const client = createClient();
  await assert.rejects(
    () => removeRecordTag(client, viewer, "lead", lead, tag),
    (error) => error.code === "CRM_TAG_PERMISSION_DENIED",
  );
});

test("F028 tags: removeRecordTag 404s when the tag was never assigned to this record", async () => {
  const client = createClient({
    queries: {
      "DELETE FROM tenant.crm_lead_tags": () => ({ rows: [] }),
    },
  });
  await assert.rejects(
    () => removeRecordTag(client, manager, "lead", lead, tag),
    (error) => error.code === "CRM_TAG_ASSIGNMENT_NOT_FOUND",
  );
});

test("F028 tags: removeRecordTag deletes the junction row and queues an outbox event", async () => {
  const client = createClient({
    queries: {
      "DELETE FROM tenant.crm_lead_tags": () => ({ rows: [{ tag_id: tag }] }),
      "INSERT INTO tenant.crm_outbox_events": () => ({ rows: [], rowCount: 1 }),
      "FROM tenant.crm_lead_tags lt": () => ({ rows: [] }),
    },
  });
  const rows = await removeRecordTag(client, manager, "lead", lead, tag);
  assert.deepEqual(rows, []);
  assert.ok(client.calls.some(({ sql }) => sql.includes("INSERT INTO tenant.crm_outbox_events")));
});

test("F028 tags: organization isolation is enforced by parameterization on every crm_lead_tags query", async () => {
  const client = createClient({
    queries: {
      "FROM tenant.crm_lead_tags lt": () => ({ rows: [] }),
    },
  });
  await listRecordTags(client, manager, "lead", lead);
  const select = client.calls.find(({ sql }) => sql.includes("FROM tenant.crm_lead_tags lt"));
  assert.equal(select.values[0], org, "organization_id must be the first bound parameter, never string-interpolated");
});
