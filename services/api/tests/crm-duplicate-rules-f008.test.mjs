import assert from "node:assert/strict";
import test from "node:test";

import {
  DUPLICATE_SIGNAL_CATALOG,
  listDuplicateRules,
  upsertDuplicateRule,
  setDuplicateRuleEnabled,
} from "../src/modules/crm/prospect-and-relationship-master-data/duplicate-rules.js";
import { CrmError } from "../src/modules/crm/index.js";

const org = "11111111-1111-4111-8111-111111111111";
const user = "22222222-2222-4222-8222-222222222222";
const ruleId = "33333333-3333-4333-8333-333333333333";

function context() {
  return { organizationId: org, userId: user };
}

function norm(sql) {
  return sql.replace(/\s+/g, " ").trim();
}

function fakeClient() {
  const calls = [];
  return {
    calls,
    async query(rawSql, params = []) {
      const sql = norm(rawSql);
      calls.push({ sql, params });
      if (sql.startsWith("SELECT * FROM tenant.crm_duplicate_rules")) return { rows: [] };
      if (sql.startsWith("INSERT INTO tenant.crm_duplicate_rules")) {
        return {
          rows: [
            {
              id: ruleId,
              organization_id: org,
              entity_type: params[1],
              signal: params[2],
              method: params[3],
              weight: params[4],
              fuzzy_threshold: params[5],
              enabled: params[6],
              blocking: params[7],
            },
          ],
        };
      }
      if (sql.startsWith("UPDATE tenant.crm_duplicate_rules")) {
        return { rows: [{ id: ruleId, organization_id: org, enabled: params[2] }] };
      }
      if (sql.includes("INSERT INTO tenant.platform_events")) return { rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

test("F008 rules: DUPLICATE_SIGNAL_CATALOG covers lead/contact/account with no free-text signal", () => {
  for (const entity of ["lead", "contact", "account"]) {
    assert.ok(DUPLICATE_SIGNAL_CATALOG[entity].length > 0);
    for (const entry of DUPLICATE_SIGNAL_CATALOG[entity]) {
      assert.equal(typeof entry.signal, "string");
      assert.ok(["exact", "normalized", "fuzzy"].includes(entry.method));
    }
  }
});

test("F008 rules: upserting a rule for a signal/method NOT in the catalog is rejected before any write", async () => {
  const client = fakeClient();
  await assert.rejects(
    () =>
      upsertDuplicateRule(client, context(), {
        entityType: "lead",
        signal: "DROP TABLE crm_leads; --",
        method: "exact",
        weight: 50,
      }),
    (error) => error instanceof CrmError && error.code === "CRM_DUPLICATE_RULE_SIGNAL_INVALID",
  );
  assert.equal(client.calls.some((c) => c.sql.startsWith("INSERT INTO tenant.crm_duplicate_rules")), false);
});

test("F008 rules: weight must be an integer between 0 and 100", async () => {
  const client = fakeClient();
  await assert.rejects(
    () => upsertDuplicateRule(client, context(), { entityType: "lead", signal: "email", method: "exact", weight: 150 }),
    (error) => error instanceof CrmError && error.code === "CRM_DUPLICATE_RULE_WEIGHT_INVALID",
  );
  await assert.rejects(
    () => upsertDuplicateRule(client, context(), { entityType: "lead", signal: "email", method: "exact", weight: -1 }),
    (error) => error instanceof CrmError && error.code === "CRM_DUPLICATE_RULE_WEIGHT_INVALID",
  );
});

test("F008 rules: a fuzzy rule requires a threshold between 0 and 1 (defaults to 0.55 when omitted)", async () => {
  const client = fakeClient();
  const rule = await upsertDuplicateRule(client, context(), {
    entityType: "contact",
    signal: "name",
    method: "fuzzy",
    weight: 20,
  });
  assert.equal(rule.fuzzyThreshold, 0.55);

  await assert.rejects(
    () =>
      upsertDuplicateRule(client, context(), {
        entityType: "contact",
        signal: "name",
        method: "fuzzy",
        weight: 20,
        fuzzyThreshold: 1.5,
      }),
    (error) => error instanceof CrmError && error.code === "CRM_DUPLICATE_RULE_THRESHOLD_INVALID",
  );
});

test("F008 rules: an unknown entity type is rejected", async () => {
  const client = fakeClient();
  await assert.rejects(
    () => listDuplicateRules(client, context(), "opportunity"),
    (error) => error instanceof CrmError && error.code === "CRM_DUPLICATE_RULE_ENTITY_INVALID",
  );
});

test("F008 rules: setDuplicateRuleEnabled toggles enabled and records an outbox event", async () => {
  const client = fakeClient();
  const result = await setDuplicateRuleEnabled(client, context(), ruleId, false);
  assert.equal(result.enabled, false);
  assert.ok(client.calls.some((c) => c.sql.includes("INSERT INTO tenant.platform_events")));
});
