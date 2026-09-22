import assert from "node:assert/strict";
import test from "node:test";

import { previewSalesDocument, SalesError } from "../src/modules/sales/index.js";

const org = "11111111-1111-4111-8111-111111111111";
const companyId = "22222222-2222-4222-8222-222222222222";
const partyId = "33333333-3333-4333-8333-333333333333";
const itemId = "44444444-4444-4444-8444-444444444444";
const uomId = "55555555-5555-4555-8555-555555555555";
const boxUomId = "77777777-7777-4777-8777-777777777777";
const userId = "66666666-6666-4666-8666-666666666666";
const variantId = "88888888-8888-4888-8888-888888888888";

const context = {
  organizationId: org,
  userId,
  activeCompanyId: companyId,
  activeBranchId: null,
  allowAllCompanies: true,
  permissions: ["sales.view", "sales.price.override"],
  roleSlugs: [],
};

function baseInput(lineOverrides = {}) {
  return {
    companyId,
    partyId,
    ownerUserId: userId,
    currencyCode: "USD",
    lines: [{ itemId, quantity: "10", ...lineOverrides }],
  };
}

// F033: the pricing engine (calculateLine) used to resolve every line purely
// off the parent item -- no way to sell a specific variant/SKU, and no way
// to sell in a UOM other than the item's base one despite item_uom_conversions
// existing. This mirrors sales-header-discount-f039.test.mjs's mock-client
// pattern, adding the variant lookup and UOM-conversion branches.
function client({ variant = null, conversion = null } = {}) {
  return {
    async query(sql, values = []) {
      if (sql.includes("FROM public.companies"))
        return { rows: [{ id: companyId, name: "Acme", base_currency: "USD", country_code: "US" }] };
      if (sql.includes("FROM public.branches WHERE organization_id=$1 AND company_id=$2"))
        return { rows: [{ id: "branch-1" }] };
      if (sql.includes("FROM tenant.business_parties WHERE organization_id=$1 AND id=$2"))
        return { rows: [{ id: partyId, company_id: companyId, party_type: "customer", display_name: "Acme Customer", status: "active", payment_term_id: null, credit_limit: "0" }] };
      if (sql.includes("FROM public.organization_memberships membership") && sql.includes("users.id"))
        return { rows: [{ id: userId, full_name: "Owner" }] };
      if (sql.includes("FROM tenant.currencies WHERE organization_id=$1 AND code=$2"))
        return { rows: [{ code: "USD", decimal_places: 2, status: "active" }] };
      if (sql.includes("FROM tenant.sales_settings")) return { rows: [{}] };
      if (sql.includes("FROM tenant.items item"))
        return { rows: [{ id: itemId, company_id: companyId, code: "ITEM-1", name: "Widget", description: "", hsn_sac_code: null, uom_id: uomId, standard_cost: "40", sales_price: "100", tax_category_id: null, uom_code: "EA", uom_name: "Each" }] };
      if (sql.includes("FROM tenant.item_variants WHERE organization_id=$1 AND id=$2 AND item_id=$3"))
        return { rows: variant ? [variant] : [] };
      if (sql.includes("FROM tenant.item_uom_conversions conversion"))
        return { rows: conversion ? [conversion] : [] };
      if (sql.includes("FROM tenant.price_list_items")) return { rows: [] };
      if (sql.includes("FROM tenant.sales_pricing_rules WHERE organization_id=$1 AND status='active'")) return { rows: [] };
      return { rows: [] };
    },
  };
}

test("F033: a variant's own sales_price and standard_cost override the item's, and its identity is snapshotted onto the line", async () => {
  const preview = await previewSalesDocument(
    client({ variant: { id: variantId, sku: "ITEM-1-L-RED", name: "Large / Red", sales_price: "150", standard_cost: "60" } }),
    context,
    baseInput({ variantId }),
  );
  const [line] = preview.lines;
  assert.equal(line.unitPrice, "150.000000");
  assert.equal(preview.totals.subtotal, "1500.000000");
  assert.equal(line.variantId, variantId);
  assert.equal(line.variantSkuSnapshot, "ITEM-1-L-RED");
  assert.equal(line.itemCodeSnapshot, "ITEM-1-L-RED");
  assert.equal(line.itemNameSnapshot, "Widget — Large / Red");
  assert.equal(line.pricingTrace.priceSource, "variant.sales_price");
});

test("F033: a variant with no price/cost of its own falls back to the item's", async () => {
  const preview = await previewSalesDocument(
    client({ variant: { id: variantId, sku: "ITEM-1-L-RED", name: "Large / Red", sales_price: null, standard_cost: null } }),
    context,
    baseInput({ variantId }),
  );
  assert.equal(preview.lines[0].unitPrice, "100.000000");
});

test("F033: a variant that does not belong to the line's item is rejected", async () => {
  await assert.rejects(
    previewSalesDocument(client({ variant: null }), context, baseInput({ variantId })),
    (error) => error instanceof SalesError && error.status === 409 && /variant does not belong/.test(error.message),
  );
});

test("F033: selling in a UOM with a defined conversion re-bases the quantity by the conversion factor", async () => {
  const preview = await previewSalesDocument(
    client({ conversion: { conversion_factor: "12", uom_code: "BOX" } }),
    context,
    baseInput({ uomId: boxUomId, quantity: "2" }),
  );
  // 2 boxes x 12 each = 24 base units x $100 standard cost basis -- verified via cost total below.
  assert.equal(preview.totals.costTotal, "960.000000"); // 24 * 40
});

test("F033: selling in a UOM with no conversion to the item's base UOM is rejected", async () => {
  await assert.rejects(
    previewSalesDocument(client({ conversion: null }), context, baseInput({ uomId: boxUomId })),
    (error) => error instanceof SalesError && error.status === 409 && /no conversion to the item's base UOM/.test(error.message),
  );
});
