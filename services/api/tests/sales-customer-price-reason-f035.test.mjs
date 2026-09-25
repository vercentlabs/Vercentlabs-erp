import assert from "node:assert/strict";
import test from "node:test";

import { upsertSalesCustomerPrice } from "../src/modules/sales/pass1-operations.js";

const org = "11111111-1111-4111-8111-111111111111";
const company = "22222222-2222-4222-8222-222222222222";
const user = "33333333-3333-4333-8333-333333333333";
const partyId = "44444444-4444-4444-8444-444444444444";
const itemId = "55555555-5555-4555-8555-555555555555";

function context() {
  return {
    organizationId: org,
    userId: user,
    activeCompanyId: company,
    activeBranchId: null,
    allowAllCompanies: false,
    permissions: ["sales.settings.manage"],
    roleSlugs: [],
  };
}

function priceClient({ existingRule = null } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql.includes("FROM tenant.business_parties"))
        return { rows: [{ id: partyId, company_id: company, display_name: "Acme Corp" }] };
      if (sql.includes("FROM tenant.items"))
        return { rows: [{ id: itemId, company_id: company }] };
      if (sql.startsWith("SELECT id,code FROM tenant.sales_pricing_rules"))
        return { rows: existingRule ? [existingRule] : [] };
      if (sql.startsWith("UPDATE tenant.sales_pricing_rules"))
        return { rows: [{ id: existingRule?.id, reason: values[values.length - 2] }] };
      if (sql.startsWith("INSERT INTO tenant.sales_pricing_rules")) {
        // Map $N placeholders in `values` back onto the actual column list so
        // a positional mismatch (wrong value landing in the wrong column) is
        // caught directly, not just "it returned something".
        const columns = sql.match(/\(([^)]+)\)/)[1].split(",").map((c) => c.trim());
        const valuesClause = sql.slice(sql.indexOf("VALUES") + 7, sql.indexOf(") RETURNING")).trim();
        // Split top-level commas only (the code expression's commas are all inside parens).
        const parts = [];
        let depth = 0, current = "";
        for (const char of valuesClause) {
          if (char === "(") depth += 1;
          if (char === ")") depth -= 1;
          if (char === "," && depth === 0) { parts.push(current.trim()); current = ""; }
          else current += char;
        }
        parts.push(current.trim());
        assert.equal(parts.length, columns.length, "column/value count mismatch");
        const row = {};
        for (let i = 0; i < columns.length; i += 1) {
          const part = parts[i];
          const placeholderMatch = part.match(/^\$(\d+)(?:::[a-z]+)?$/);
          if (placeholderMatch) row[columns[i]] = values[Number(placeholderMatch[1]) - 1];
          else if (part.startsWith("'") && part.endsWith("'")) row[columns[i]] = part.slice(1, -1);
          else row[columns[i]] = part; // literal number or computed expression
        }
        return { rows: [row] };
      }
      return { rows: [] };
    },
  };
}

test("F035: creating a customer-specific price without a reason is rejected", async () => {
  const client = priceClient();
  await assert.rejects(
    upsertSalesCustomerPrice(client, context(), {
      partyId, itemId, fixedRate: 100,
    }),
    (error) => error.status === 400 && error.code === "SALES_CUSTOMER_PRICE_REASON_REQUIRED",
  );
});

test("F035: creating a customer-specific price with a reason persists every column in the correct position", async () => {
  const client = priceClient();
  const row = await upsertSalesCustomerPrice(client, context(), {
    partyId, itemId, fixedRate: 250, minimumQuantity: 5, reason: "Volume discount agreed with account manager",
  });
  assert.equal(row.organization_id, org);
  assert.equal(row.company_id, company);
  assert.equal(row.party_id, partyId);
  assert.equal(row.party_type, "customer");
  assert.equal(row.item_id, itemId);
  assert.equal(row.minimum_quantity, 5);
  assert.equal(row.adjustment_type, "fixed_rate");
  assert.equal(row.adjustment_value, 250);
  assert.equal(row.reason, "Volume discount agreed with account manager");
  assert.equal(row.status, "active");
  assert.equal(row.created_by, user);
  assert.equal(row.updated_by, user);
});

test("F035: changing an existing customer-specific price requires a reason and keeps the old price as history", async () => {
  const client = priceClient({
    existingRule: { id: "rule-1", code: "CUST-EXISTING" },
  });
  await assert.rejects(
    upsertSalesCustomerPrice(client, context(), { partyId, itemId, fixedRate: 300 }),
    (error) => error.status === 400 && error.code === "SALES_CUSTOMER_PRICE_REASON_REQUIRED",
  );
  const result = await upsertSalesCustomerPrice(client, context(), {
    partyId, itemId, fixedRate: 300, reason: "Renegotiated for renewal",
  });
  // The change is a new row carrying the new reason; the old row is retired
  // and linked to it (history kept), never overwritten in place.
  const insert = client.calls.find((c) => c.sql.includes("INSERT INTO tenant.sales_pricing_rules"));
  assert.ok(insert.values.includes("Renegotiated for renewal"));
  const retire = client.calls.find((c) => c.sql.includes("superseded_by_id=$3"));
  assert.equal(retire.values[1], "rule-1");
  assert.equal(result.reason, "Renegotiated for renewal");
});
