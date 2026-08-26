import assert from "node:assert/strict";
import test from "node:test";

import {
  LeadSourceError,
  normalizeLeadSourceInput,
  resolveIngestionLeadSource,
  validateLeadSourceAssignment,
} from "../src/modules/crm/features/lead-sources/validation.js";
import {
  createCrmLeadSource,
  listCrmLeadSources,
  setCrmLeadSourceActive,
  updateCrmLeadSource,
} from "../src/modules/crm/lead-source-operations.js";

const context = Object.freeze({
  organizationId: "11111111-1111-4111-8111-111111111111",
  userId: "22222222-2222-4222-8222-222222222222",
  activeCompanyId: null,
  activeBranchId: null,
  allowAllCompanies: true,
});
const sourceId = "33333333-3333-4333-8333-333333333333";

test("F004 QA: malformed source identifiers fail before a database query", async () => {
  let queried = false;
  const client = { query: async () => { queried = true; return { rows: [] }; } };
  await assert.rejects(
    () => validateLeadSourceAssignment(client, context, "not-a-uuid"),
    (error) =>
      error.code === "CRM_LEAD_SOURCE_ID_INVALID" && error.status === 400,
  );
  assert.equal(queried, false);
});

test("F004: source input trims values, maps blank description to null and validates bounds", () => {
  assert.deepEqual(
    normalizeLeadSourceInput(
      {
        name: "  Trade Expo  ",
        description: "   ",
        channel: " EVENT ",
        sortOrder: "40",
      },
      { create: true },
    ),
    {
      name: "Trade Expo",
      description: null,
      channel: "event",
      sortOrder: 40,
    },
  );
  for (const name of ["", "   "])
    assert.throws(
      () => normalizeLeadSourceInput({ name }, { create: true }),
      (error) =>
        error.code === "CRM_LEAD_SOURCE_VALIDATION_ERROR" &&
        Boolean(error.details.errors.name),
    );
  assert.throws(
    () =>
      normalizeLeadSourceInput(
        { name: "Valid", channel: "telepathy" },
        { create: true },
      ),
    /available source channel/,
  );
});

test("F004: assignment requires an organization-owned active source", async () => {
  const active = {
    query: async () => ({
      rows: [{ id: sourceId, name: "Website", status: "active" }],
    }),
  };
  assert.equal(
    (await validateLeadSourceAssignment(active, context, sourceId)).id,
    sourceId,
  );
  const missing = { query: async () => ({ rows: [] }) };
  await assert.rejects(
    () => validateLeadSourceAssignment(missing, context, sourceId),
    (error) =>
      error instanceof LeadSourceError &&
      error.code === "CRM_LEAD_SOURCE_NOT_FOUND",
  );
  const inactive = {
    query: async () => ({
      rows: [{ id: sourceId, name: "Trade Expo", status: "inactive" }],
    }),
  };
  await assert.rejects(
    () => validateLeadSourceAssignment(inactive, context, sourceId),
    (error) => error.code === "CRM_LEAD_SOURCE_INACTIVE",
  );
});

test("F004: an unchanged inactive historical source can remain on unrelated Lead edits", async () => {
  const client = {
    query: async () => ({
      rows: [{ id: sourceId, name: "Trade Expo", status: "inactive" }],
    }),
  };
  const source = await validateLeadSourceAssignment(client, context, sourceId, {
    allowUnchangedInactive: true,
    currentSourceId: sourceId,
  });
  assert.equal(source.status, "inactive");
  await assert.rejects(
    () =>
      validateLeadSourceAssignment(client, context, sourceId, {
        allowUnchangedInactive: true,
        currentSourceId: "44444444-4444-4444-8444-444444444444",
      }),
    /Inactive lead sources/,
  );
});

test("F004: public ingestion falls back from an inactive configured source to the active default", async () => {
  const calls = [];
  const client = {
    async query(sql, values) {
      calls.push({ sql, values });
      return sql.includes("id=$2")
        ? { rows: [] }
        : { rows: [{ id: sourceId }] };
    },
  };
  assert.equal(
    await resolveIngestionLeadSource(
      client,
      context,
      "44444444-4444-4444-8444-444444444444",
    ),
    sourceId,
  );
  assert.match(calls[1].sql, /is_default DESC/);
  assert.match(calls[1].sql, /code='WEBSITE'/);
});

function lifecycleClient(initial = {}) {
  const calls = [];
  let row = {
    id: sourceId,
    organization_id: context.organizationId,
    name: "Trade Expo",
    code: "TRADE_EXPO",
    description: null,
    channel: "event",
    sort_order: 100,
    is_default: false,
    is_system: false,
    status: "active",
    archived_at: null,
    lead_count: 4,
    updated_at: "2026-08-25T00:00:00Z",
    ...initial,
  };
  return {
    calls,
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (
        sql.includes("SELECT 1 FROM tenant.crm_lead_sources") &&
        sql.includes("code=$2")
      )
        return { rows: [] };
      if (sql.includes("INSERT INTO tenant.crm_lead_sources")) {
        row = {
          ...row,
          name: values[1],
          code: values[2],
          description: values[3],
          channel: values[4],
          sort_order: values[5],
          is_default: values[6],
        };
        return { rows: [{ id: sourceId }] };
      }
      if (
        sql.includes("UPDATE tenant.crm_lead_sources SET") &&
        sql.includes("name=")
      ) {
        row = { ...row, name: values[2], description: values[3] };
        return { rows: [] };
      }
      if (sql.includes("SET status=$3")) {
        row = {
          ...row,
          status: values[2],
          archived_at: values[3],
          is_default: values[2] === "inactive" ? false : row.is_default,
        };
        return { rows: [] };
      }
      if (
        sql.includes("FROM tenant.crm_lead_sources source") &&
        sql.includes("source.id=$2")
      )
        return { rows: [row] };
      if (sql.includes("INSERT INTO tenant.crm_outbox_events"))
        return { rows: [] };
      if (sql.includes("count(*)::int AS count"))
        return { rows: [{ count: 1 }] };
      if (sql.includes("FROM tenant.crm_lead_sources source"))
        return { rows: [row] };
      return { rows: [] };
    },
  };
}

test("F004: create generates an immutable normalized code, starts active and emits outbox", async () => {
  const client = lifecycleClient();
  const source = await createCrmLeadSource(client, context, {
    name: "  LinkedIn Organic ",
    description: " Social outreach ",
    channel: "social",
    sortOrder: 25,
  });
  assert.equal(source.name, "LinkedIn Organic");
  assert.equal(source.code, "LINKEDIN_ORGANIC");
  assert.equal(source.status, "active");
  assert.equal(
    client.calls.find((call) => call.sql.includes("crm_outbox_events"))
      .values[1],
    "crm.lead_sources.created",
  );
});

test("F004 QA: default writes clear the previous default before setting the new one", async () => {
  const createClient = lifecycleClient();
  await createCrmLeadSource(createClient, context, {
    name: "Default source",
    isDefault: true,
  });
  const clearBeforeCreate = createClient.calls.findIndex(
    (call) => call.sql.includes("WHERE organization_id=$1 AND is_default=true"),
  );
  const create = createClient.calls.findIndex((call) =>
    call.sql.includes("INSERT INTO tenant.crm_lead_sources"),
  );
  assert.ok(clearBeforeCreate >= 0 && clearBeforeCreate < create);

  const updateClient = lifecycleClient();
  await updateCrmLeadSource(updateClient, context, sourceId, {
    isDefault: true,
  });
  const clearBeforeUpdate = updateClient.calls.findIndex(
    (call) => call.sql.includes("id<>$2 AND is_default=true"),
  );
  const update = updateClient.calls.findIndex(
    (call) =>
      call.sql.includes("UPDATE tenant.crm_lead_sources SET") &&
      call.sql.includes("is_default=$"),
  );
  assert.ok(clearBeforeUpdate >= 0 && clearBeforeUpdate < update);
});

test("F004: update is partial, code/status are governed and duplicates are safely mapped", async () => {
  const client = lifecycleClient();
  const updated = await updateCrmLeadSource(client, context, sourceId, {
    name: " Industry Events ",
    description: " Exhibitions ",
  });
  assert.equal(updated.name, "Industry Events");
  assert.equal(updated.code, "TRADE_EXPO");
  await assert.rejects(
    () => updateCrmLeadSource(client, context, sourceId, { code: "CHANGED" }),
    (error) => error.code === "CRM_LEAD_SOURCE_GOVERNED_FIELD",
  );
  const duplicate = lifecycleClient();
  duplicate.query = async (sql) => {
    if (sql.startsWith("UPDATE")) {
      const error = new Error("constraint");
      error.code = "23505";
      throw error;
    }
    return { rows: [{ ...initialRow, id: sourceId }] };
  };
  const initialRow = {
    organization_id: context.organizationId,
    name: "Trade Expo",
    code: "TRADE_EXPO",
    status: "active",
    lead_count: 0,
  };
  await assert.rejects(
    () =>
      updateCrmLeadSource(duplicate, context, sourceId, { name: "website" }),
    (error) =>
      error.code === "CRM_LEAD_SOURCE_DUPLICATE" &&
      !/constraint|postgres/i.test(error.message),
  );
});

test("F004: deactivate/reactivate is soft, preserves usage and emits governed events", async () => {
  const client = lifecycleClient();
  const inactive = await setCrmLeadSourceActive(
    client,
    context,
    sourceId,
    false,
  );
  assert.equal(inactive.status, "inactive");
  assert.equal(inactive.leadCount, 4);
  assert.equal(
    client.calls.some((call) => /\bDELETE\b/i.test(call.sql)),
    false,
  );
  assert.equal(
    client.calls.find((call) => call.sql.includes("crm_outbox_events"))
      .values[1],
    "crm.lead_sources.deactivated",
  );
  const active = await setCrmLeadSourceActive(client, context, sourceId, true);
  assert.equal(active.status, "active");
  assert.equal(
    client.calls.filter((call) => call.sql.includes("crm_outbox_events")).at(-1)
      .values[1],
    "crm.lead_sources.reactivated",
  );
});

test("F004: catalogue listing is organization-scoped, searchable, status-aware and paginated", async () => {
  const client = lifecycleClient();
  const result = await listCrmLeadSources(client, context, {
    search: "trade",
    status: "inactive",
    limit: 25,
    offset: 0,
  });
  assert.equal(result.total, 1);
  assert.equal(result.rows[0].leadCount, 4);
  const count = client.calls.find((call) =>
    call.sql.includes("count(*)::int AS count"),
  );
  assert.match(count.sql, /source\.organization_id=\$1/);
  assert.match(count.sql, /source\.status=/);
  assert.match(count.sql, /ILIKE/);
});
