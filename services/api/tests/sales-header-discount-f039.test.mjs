import assert from "node:assert/strict";
import test from "node:test";

import { previewSalesDocument } from "../src/modules/sales/index.js";

const org = "11111111-1111-4111-8111-111111111111";
const companyId = "22222222-2222-4222-8222-222222222222";
const partyId = "33333333-3333-4333-8333-333333333333";
const itemId = "44444444-4444-4444-8444-444444444444";
const uomId = "55555555-5555-4555-8555-555555555555";
const userId = "66666666-6666-4666-8666-666666666666";

const context = {
  organizationId: org,
  userId,
  activeCompanyId: companyId,
  activeBranchId: null,
  allowAllCompanies: true,
  permissions: ["sales.view", "sales.price.override"],
  roleSlugs: [],
};

function baseInput(overrides = {}) {
  return {
    companyId,
    partyId,
    ownerUserId: userId,
    currencyCode: "USD",
    lines: [
      {
        itemId,
        quantity: "10",
        unitPrice: "100",
      },
    ],
    ...overrides,
  };
}

function previewClient() {
  return {
    async query(sql, values = []) {
      if (sql.includes("FROM public.companies"))
        return { rows: [{ id: companyId, name: "Acme", base_currency: "USD", country_code: "US" }] };
      if (sql.includes("FROM public.branches WHERE organization_id=$1 AND company_id=$2"))
        return { rows: [{ id: "branch-1" }] };
      if (sql.includes("FROM tenant.business_parties WHERE organization_id=$1 AND id=$2"))
        return {
          rows: [
            {
              id: partyId,
              company_id: companyId,
              party_type: "customer",
              display_name: "Acme Customer",
              status: "active",
              payment_term_id: null,
              credit_limit: "0",
            },
          ],
        };
      if (sql.includes("FROM public.organization_memberships membership") && sql.includes("users.id"))
        return { rows: [{ id: userId, full_name: "Owner" }] };
      if (sql.includes("FROM tenant.currencies WHERE organization_id=$1 AND code=$2"))
        return { rows: [{ code: "USD", decimal_places: 2, status: "active" }] };
      if (sql.includes("FROM tenant.sales_settings"))
        return { rows: [{}] };
      if (sql.includes("FROM tenant.items item"))
        return {
          rows: [
            {
              id: itemId,
              company_id: companyId,
              code: "ITEM-1",
              name: "Widget",
              description: "",
              hsn_sac_code: null,
              uom_id: uomId,
              standard_cost: "40",
              sales_price: "100",
              tax_category_id: null,
              uom_code: "EA",
              uom_name: "Each",
            },
          ],
        };
      if (sql.includes("FROM tenant.sales_pricing_rules WHERE organization_id=$1 AND status='active'"))
        return { rows: [] };
      return { rows: [] };
    },
  };
}

test("F039: no header discount leaves totals unaffected", async () => {
  const client = previewClient();
  const preview = await previewSalesDocument(client, context, baseInput());
  assert.equal(preview.totals.subtotal, "1000.000000");
  assert.equal(preview.totals.headerDiscountAmount, "0.000000");
  assert.equal(preview.totals.discountTotal, "0.000000");
  assert.equal(preview.totals.grandTotal, "1000.000000");
});

test("F039: a 10% header discount reduces the grand total and is folded into discountTotal", async () => {
  const client = previewClient();
  const preview = await previewSalesDocument(
    client,
    context,
    baseInput({ headerDiscountPercent: "10" }),
  );
  assert.equal(preview.totals.subtotal, "1000.000000");
  assert.equal(preview.totals.headerDiscountAmount, "100.000000");
  assert.equal(preview.totals.discountTotal, "100.000000");
  assert.equal(preview.totals.grandTotal, "900.000000");
  assert.equal(preview.totals.maximumDiscountPercent, "10.000000");
});

test("F039: a header discount larger than any line discount drives maximumDiscountPercent (approval-threshold visibility)", async () => {
  const client = previewClient();
  const preview = await previewSalesDocument(
    client,
    context,
    baseInput({ headerDiscountPercent: "25" }),
  );
  assert.equal(preview.totals.maximumDiscountPercent, "25.000000");
});

test("F039: applying a header discount requires sales.price.override, same as a line override", async () => {
  const client = previewClient();
  const restricted = { ...context, permissions: ["sales.view"] };
  await assert.rejects(
    previewSalesDocument(client, restricted, baseInput({ headerDiscountPercent: "5" })),
    (error) => error.status === 403,
  );
});

test("F039: a header discount of 0 does not require sales.price.override", async () => {
  const client = previewClient();
  const restricted = { ...context, permissions: ["sales.view"] };
  const preview = await previewSalesDocument(
    client,
    restricted,
    baseInput({ headerDiscountPercent: "0" }),
  );
  assert.equal(preview.totals.grandTotal, "1000.000000");
});

test("F039: header discount must be between 0 and 100", async () => {
  const client = previewClient();
  await assert.rejects(
    previewSalesDocument(client, context, baseInput({ headerDiscountPercent: "150" })),
    (error) => error.status === 400,
  );
  await assert.rejects(
    previewSalesDocument(client, context, baseInput({ headerDiscountPercent: "-5" })),
    (error) => error.status === 400,
  );
});
