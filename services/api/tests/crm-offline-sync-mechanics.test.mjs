import assert from "node:assert/strict";
import test from "node:test";

import {
  applyOfflineBatch,
  applyOfflineMutation,
} from "../src/modules/crm/crm-data-operations-and-customization/offline-sync.js";

const org = "11111111-1111-4111-8111-111111111111";
const user = "44444444-4444-4444-8444-444444444444";
const opportunity = "55555555-5555-4555-8555-555555555555";
const existingMutation = "66666666-6666-4666-8666-666666666666";

const context = { organizationId: org, userId: user, activeCompanyId: null, activeBranchId: null, allowAllCompanies: true, roleSlugs: [], permissions: ["crm.view", "crm.leads.manage", "crm.opportunities.manage", "crm.activities.manage"] };

// Tranche M — these test applyOfflineBatch/applyOfflineMutation's OWN
// mechanics (batching, idempotency, stale-write conflict detection), not
// the per-resource governed-command routing already covered by
// crm-offline-sync-follow-up-parity.test.mjs and incidental usage in
// crm-lead-lifecycle-f007/crm-opportunity-scope-f009. Confirmed via grep
// before writing this that no existing test covers applyOfflineBatch's
// own size limit/aggregate counts or applyOfflineMutation's idempotency-
// replay/conflict-detection behavior specifically.
function createClient({ queries = {} } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, values = []) {
      calls.push({ sql, values });
      for (const [pattern, handler] of Object.entries(queries)) {
        if (sql.includes(pattern)) return handler(values);
      }
      if (sql.includes("FROM tenant.crm_mobile_mutations WHERE organization_id=$1 AND idempotency_key=$2")) return { rows: [] };
      return { rows: [] };
    },
  };
}

test("F022 offline mechanics: applyOfflineBatch rejects more than 50 mutations in one batch before applying any of them", async () => {
  const client = createClient();
  const mutations = Array.from({ length: 51 }, (_v, index) => ({
    clientMutationId: `client-${index}`,
    operation: "create",
    resource: "leads",
    idempotencyKey: `idem-${index}`,
    payload: { code: `L-${index}`, firstName: "Test" },
  }));
  await assert.rejects(
    () => applyOfflineBatch(client, context, { mutations }),
    (error) => error.code === "CRM_OFFLINE_BATCH_TOO_LARGE",
  );
  assert.equal(client.calls.length, 0, "an oversized batch must be rejected before any query runs");
});

test("F022 offline mechanics: applyOfflineBatch processes each mutation independently — a failure in one does not abort or short-circuit the rest of the batch", async () => {
  const client = createClient({
    queries: {
      // Row 2 targets a nonexistent activity: falls through activities:complete's
      // type-specific branches to the generic UPDATE, which itself matches
      // nothing and leaves `row` unset — a DIFFERENT failure reason than
      // row 1's input-validation throw, proving each result reflects its
      // OWN mutation, not a shared/aborted batch state.
      "SELECT activity_type FROM tenant.crm_activities": () => ({ rows: [] }),
      "UPDATE tenant.crm_activities SET status='completed'": () => ({ rows: [] }),
    },
  });
  const result = await applyOfflineBatch(client, context, {
    mutations: [
      { clientMutationId: "bad-validation", operation: "create", resource: "leads", idempotencyKey: "idem-bad-1", payload: {} }, // missing required code/firstName
      { clientMutationId: "bad-not-found", operation: "complete", resource: "activities", recordId: "77777777-7777-4777-8777-777777777777", idempotencyKey: "idem-bad-2", payload: {} },
    ],
  });
  assert.equal(result.results.length, 2, "both mutations must produce their own result, not one aborting the batch");
  assert.equal(result.failed, 2);
  assert.equal(result.results[0].error.code, "CRM_OFFLINE_LEAD_INVALID");
  assert.equal(result.results[1].error.code, "CRM_OFFLINE_TARGET_NOT_FOUND");
  assert.notEqual(result.results[0].error.code, result.results[1].error.code, "each mutation's own failure reason must be preserved independently, not collapsed to one shared error");
});

test("F022 offline mechanics: applyOfflineMutation replays an existing mutation for a repeated idempotency key instead of re-applying it", async () => {
  const client = createClient({
    queries: {
      "FROM tenant.crm_mobile_mutations WHERE organization_id=$1 AND idempotency_key=$2": () => ({ rows: [{ id: existingMutation, status: "applied" }] }),
    },
  });
  const result = await applyOfflineMutation(client, context, {
    clientMutationId: "client-1",
    operation: "create",
    resource: "leads",
    idempotencyKey: "idem-repeat",
    payload: { code: "L-2", firstName: "Repeat" },
  });
  assert.equal(result.idempotent, true);
  assert.equal(result.mutation.id, existingMutation);
  assert.ok(!client.calls.some(({ sql }) => sql.includes("INSERT INTO tenant.crm_leads")), "a replayed idempotency key must never re-apply the mutation");
});

test("F022 offline mechanics: a stale baseUpdatedAt records a real conflict, not a silent overwrite of a change the client never saw", async () => {
  const client = createClient({
    queries: {
      "SELECT id,stage_id,updated_at,status FROM tenant.crm_opportunities": () => ({ rows: [{ id: opportunity, stage_id: "stage-old", status: "open", updated_at: "2026-02-01T00:00:00.000Z" }] }),
      "INSERT INTO tenant.crm_mobile_conflicts": () => ({ rows: [{ id: "conflict-1", status: "open" }] }),
      "INSERT INTO tenant.crm_mobile_mutations": () => ({ rows: [{ id: "mutation-conflict", status: "conflict" }] }),
    },
  });
  const result = await applyOfflineMutation(client, context, {
    clientMutationId: "client-conflict",
    operation: "stage",
    resource: "opportunities",
    recordId: opportunity,
    baseUpdatedAt: "2026-01-01T00:00:00.000Z", // stale — the record moved on since this device last saw it
    idempotencyKey: "idem-conflict",
    payload: { stageId: "stage-new" },
  });
  assert.ok(result.conflict, "a stale baseUpdatedAt must be reported as a conflict, not silently applied");
  assert.equal(result.mutation.status, "conflict");
  assert.ok(!client.calls.some(({ sql }) => sql.startsWith("UPDATE tenant.crm_opportunities")), "a detected conflict must never reach the actual mutation write");
});

test("F022 offline mechanics: applyOfflineMutation fails closed on a resource/operation combination outside the fixed allow-list (leads:create / opportunities:stage / activities:create / activities:complete), rather than silently no-op'ing or attempting a raw mutation", async () => {
  const client = createClient();
  await assert.rejects(
    () =>
      applyOfflineMutation(client, context, {
        clientMutationId: "client-unknown",
        operation: "archive",
        resource: "accounts",
        recordId: "77777777-7777-4777-8777-777777777777",
        idempotencyKey: "idem-unknown",
        payload: {},
      }),
    (error) => error.code === "CRM_OFFLINE_MUTATION_UNSUPPORTED",
  );
  assert.equal(client.calls.length, 0, "an unsupported mutation shape must be rejected before any query runs");
});
