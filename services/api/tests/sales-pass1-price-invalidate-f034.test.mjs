import assert from "node:assert/strict";
import test from "node:test";

import {
  deactivateSalesPriceListItem,
  deactivateSalesPricingRule,
} from "../src/modules/sales/pass1-operations.js";

const org = "11111111-1111-4111-8111-111111111111";
const company = "22222222-2222-4222-8222-222222222222";
const user = "44444444-4444-4444-8444-444444444444";
const itemId = "55555555-5555-4555-8555-555555555555";
const ruleId = "66666666-6666-4666-8666-666666666666";

function context(overrides = {}) {
  return {
    organizationId: org,
    userId: user,
    activeCompanyId: company,
    activeBranchId: null,
    allowAllCompanies: false,
    permissions: ["sales.settings.manage"],
    roleSlugs: [],
    ...overrides,
  };
}

test("F034: deactivateSalesPriceListItem marks the item inactive", async () => {
  const calls = [];
  const client = {
    async query(sql, values) {
      calls.push({ sql, values });
      if (sql.includes("UPDATE tenant.price_list_items"))
        return { rows: [{ id: itemId, status: "inactive" }] };
      return { rows: [] };
    },
  };
  const row = await deactivateSalesPriceListItem(client, context(), itemId);
  assert.equal(row.status, "inactive");
  assert.equal(calls[0].values[0], org);
});

test("F034: deactivateSalesPriceListItem 404s when the item doesn't exist in this org", async () => {
  const client = { async query() { return { rows: [] }; } };
  await assert.rejects(
    deactivateSalesPriceListItem(client, context(), itemId),
    (error) => error.status === 404 && error.code === "SALES_PRICE_LIST_ITEM_NOT_FOUND",
  );
});

test("F034: deactivateSalesPricingRule scopes by the active company (companyVisible-style, not the old stricter convention)", async () => {
  const calls = [];
  const client = {
    async query(sql, values) {
      calls.push({ sql, values });
      return { rows: [{ id: ruleId, status: "inactive" }] };
    },
  };
  await deactivateSalesPricingRule(client, context(), ruleId);
  const update = calls[0];
  assert.match(update.sql, /company_id IS NULL OR record\.company_id=\$3/);
  assert.deepEqual(update.values, [org, ruleId, company, user]);
});

test("F034: deactivateSalesPricingRule with allowAllCompanies applies no company filter", async () => {
  const calls = [];
  const client = {
    async query(sql, values) {
      calls.push({ sql, values });
      return { rows: [{ id: ruleId, status: "inactive" }] };
    },
  };
  await deactivateSalesPricingRule(client, context({ allowAllCompanies: true, activeCompanyId: null }), ruleId);
  const update = calls[0];
  assert.doesNotMatch(update.sql, /company_id/);
  assert.deepEqual(update.values, [org, ruleId, user]);
});

test("F034: deactivateSalesPricingRule fails closed with no active company and no allowAllCompanies", async () => {
  const calls = [];
  const client = {
    async query(sql, values) {
      calls.push({ sql, values });
      return { rows: [] };
    },
  };
  await assert.rejects(
    deactivateSalesPricingRule(client, context({ activeCompanyId: null }), ruleId),
    (error) => error.status === 404,
  );
  assert.match(calls[0].sql, /AND false/);
});

test("F034: deactivation requires sales.settings.manage permission", async () => {
  const client = { async query() { return { rows: [] }; } };
  await assert.rejects(
    deactivateSalesPriceListItem(client, context({ permissions: [] }), itemId),
    (error) => error.status === 403,
  );
  await assert.rejects(
    deactivateSalesPricingRule(client, context({ permissions: [] }), ruleId),
    (error) => error.status === 403,
  );
});
