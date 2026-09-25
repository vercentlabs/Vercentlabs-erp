import assert from "node:assert/strict";
import test from "node:test";

import {
  CrmAccountIntelligenceError,
  getAccountHierarchy,
  setAccountParent,
} from "../src/modules/crm/prospect-and-relationship-master-data/account-intelligence.js";

const org = "11111111-1111-4111-8111-111111111111";
const user = "22222222-2222-4222-8222-222222222222";
const accountA = "33333333-3333-4333-8333-333333333333";
const accountB = "44444444-4444-4444-8444-444444444444";
const accountC = "55555555-5555-4555-8555-555555555555";

function context() {
  return { organizationId: org, userId: user, allowAllCompanies: true, permissions: ["crm.records.view_all"], roleSlugs: [] };
}

function norm(sql) {
  return sql.replace(/\s+/g, " ").trim();
}

function hierarchyClient({
  accounts = {},
  cycleDetected = false,
} = {}) {
  const calls = [];
  const events = [];
  return {
    calls,
    events,
    async query(rawSql, params = []) {
      const sql = norm(rawSql);
      calls.push({ sql, params });
      if (/^SELECT party\.\*,parent\.display_name/.test(sql)) {
        const id = params[1];
        const row = accounts[id];
        if (!row) return { rows: [] };
        return { rows: [{ ...row, id }] };
      }
      if (/^WITH RECURSIVE ancestors AS/.test(sql)) {
        return { rows: cycleDetected ? [{ "?column?": 1 }] : [] };
      }
      if (/^UPDATE tenant\.business_parties\s+SET parent_party_id=\$1/.test(sql)) {
        const [nextParentId, , , childId] = params;
        accounts[childId] = { ...accounts[childId], parent_party_id: nextParentId };
        return { rows: [{ ...accounts[childId], id: childId }] };
      }
      if (/^INSERT INTO tenant\.crm_account_hierarchy_events/.test(sql)) {
        events.push(params);
        return { rows: [] };
      }
      if (/^WITH RECURSIVE tree AS/.test(sql)) {
        // getAccountHierarchy's ancestor/descendant queries — return empty by
        // default; tests that need real rows override query() directly.
        return { rows: [] };
      }
      if (/^SELECT event\.\*,/.test(sql)) {
        return { rows: [] };
      }
      return { rows: [] };
    },
  };
}

test("F002 hierarchy: an account cannot be set as its own parent", async () => {
  const client = hierarchyClient({ accounts: { [accountA]: { status: "active" } } });
  await assert.rejects(
    () => setAccountParent(client, context(), accountA, accountA),
    (error) => error instanceof CrmAccountIntelligenceError && error.code === "CRM_ACCOUNT_HIERARCHY_SELF_PARENT",
  );
  assert.equal(client.calls.some((c) => c.sql.startsWith("UPDATE tenant.business_parties")), false);
});

test("F002 hierarchy: an inactive proposed parent is rejected", async () => {
  const client = hierarchyClient({
    accounts: {
      [accountA]: { status: "active" },
      [accountB]: { status: "inactive" },
    },
  });
  await assert.rejects(
    () => setAccountParent(client, context(), accountA, accountB),
    (error) => error instanceof CrmAccountIntelligenceError && error.code === "CRM_ACCOUNT_HIERARCHY_PARENT_INACTIVE",
  );
});

test("F002 hierarchy: a cycle (proposed parent is already a descendant) is rejected", async () => {
  const client = hierarchyClient({
    accounts: {
      [accountA]: { status: "active" },
      [accountC]: { status: "active" },
    },
    cycleDetected: true,
  });
  await assert.rejects(
    () => setAccountParent(client, context(), accountA, accountC),
    (error) => error instanceof CrmAccountIntelligenceError && error.code === "CRM_ACCOUNT_HIERARCHY_CYCLE",
  );
  assert.equal(client.calls.some((c) => c.sql.startsWith("UPDATE tenant.business_parties")), false, "no write may happen once a cycle is detected");
});

test("F002 hierarchy: setting a valid parent updates the row and writes an audit hierarchy event", async () => {
  const client = hierarchyClient({
    accounts: {
      [accountA]: { status: "active", parent_party_id: null },
      [accountB]: { status: "active" },
    },
  });
  const updated = await setAccountParent(client, context(), accountA, accountB, "Reorganized under regional HQ");
  assert.equal(updated.parent_party_id, accountB);
  assert.equal(client.events.length, 1);
  assert.equal(client.events[0][3], accountB, "new_parent_party_id must be recorded");
  assert.equal(client.events[0][4], "parent_set");
  assert.match(client.events[0][5], /regional HQ/);
});

test("F002 hierarchy: clearing the parent (null) is a no-op guard against redundant writes when already unparented", async () => {
  const client = hierarchyClient({
    accounts: { [accountA]: { status: "active", parent_party_id: null } },
  });
  const result = await setAccountParent(client, context(), accountA, null);
  assert.equal(client.calls.some((c) => c.sql.startsWith("UPDATE tenant.business_parties")), false, "already-unparented + clear-parent must not issue a write");
  assert.equal(result.parent_party_id, null);
});

test("F002 hierarchy: getAccountHierarchy returns ancestors, descendants and computed metrics", async () => {
  const client = {
    calls: [],
    async query(rawSql, params = []) {
      const sql = norm(rawSql);
      this.calls.push({ sql, params });
      if (/^SELECT party\.\*,parent\.display_name/.test(sql)) {
        return { rows: [{ id: accountA, display_name: "Acme India", status: "active" }] };
      }
      if (/^WITH RECURSIVE tree AS[\s\S]*ORDER BY tree\.depth DESC/.test(sql)) {
        return { rows: [{ id: accountB, display_name: "Acme Global", depth: 1, caller_can_access: true }] };
      }
      if (/^WITH RECURSIVE tree AS[\s\S]*ORDER BY tree\.depth,tree\.display_name/.test(sql)) {
        return {
          rows: [
            { id: accountC, parent_party_id: accountA, display_name: "Acme India — West", depth: 1, caller_can_access: true },
            { id: "66666666-6666-4666-8666-666666666666", parent_party_id: accountC, display_name: "Acme India — West — Pune", depth: 2, caller_can_access: true },
          ],
        };
      }
      if (/^SELECT event\.\*,/.test(sql)) {
        return { rows: [] };
      }
      return { rows: [] };
    },
  };
  const result = await getAccountHierarchy(client, context(), accountA);
  assert.equal(result.ancestors.length, 1);
  assert.equal(result.descendants.length, 2);
  assert.equal(result.metrics.ancestorCount, 1);
  assert.equal(result.metrics.descendantCount, 2);
  assert.equal(result.metrics.hierarchyDepth, 2);
});

test("F002 hierarchy: hidden Accounts are dropped and depth is rebased to the VISIBLE structure (no gap reveals hidden levels)", async () => {
  const hidden = "77777777-7777-4777-8777-777777777777";
  const client = {
    async query(rawSql) {
      const sql = norm(rawSql);
      if (/^SELECT party\.\*,parent\.display_name/.test(sql)) return { rows: [{ id: accountA, display_name: "Root", status: "active", parent_visible: true }] };
      if (/ORDER BY tree\.depth DESC/.test(sql)) return { rows: [] };
      if (/ORDER BY tree\.depth,tree\.display_name/.test(sql))
        return { rows: [
          { id: hidden, parent_party_id: accountA, display_name: "Hidden", depth: 1, caller_can_access: false },
          { id: accountC, parent_party_id: hidden, display_name: "Visible grandchild", depth: 2, caller_can_access: true },
        ] };
      return { rows: [] };
    },
  };
  const result = await getAccountHierarchy(client, context(), accountA);
  assert.deepEqual(result.descendants.map((row) => row.id), [accountC], "the hidden Account is never returned");
  assert.equal(result.descendants[0].depth, 1, "depth counts only visible levels");
  assert.equal(result.descendants[0].parent_party_id, null, "no link to (or id of) the hidden parent");
  assert.equal(result.descendants[0].caller_can_access, undefined, "internal flag never leaves the server");
  assert.equal(result.metrics.hierarchyDepth, 1);
  assert.equal(result.metrics.descendantCount, 1);
});
