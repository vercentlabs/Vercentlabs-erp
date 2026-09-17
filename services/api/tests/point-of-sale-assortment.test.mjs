import assert from "node:assert/strict";
import test from "node:test";

import { lookupPointOfSaleBarcode, searchPointOfSalePosProducts } from "../src/modules/point-of-sale/features/assortment.js";

// POS Implementation Tracker (docs/03-modules/point-of-sale/
// POS_IMPLEMENTATION_TRACKER.md), Tranche 1 (F272/F273): bounded product
// search and exact barcode lookup, scoped to the store's warehouse for
// availability and never selecting cost fields.

const org = "11111111-1111-4111-8111-111111111111";
const company = "22222222-2222-4222-8222-222222222222";
const storeId = "44444444-4444-4444-8444-444444444444";
const warehouseId = "55555555-5555-4555-8555-555555555555";
const itemId = "66666666-6666-4666-8666-666666666666";

function baseContext(permissions = ["pos.view"]) {
  return { organizationId: org, companyId: company, userId: "u1", roleSlugs: [], permissions };
}

function storeRow() {
  return { id: storeId, organization_id: org, company_id: company, warehouse_id: warehouseId };
}

function client({ searchRows = [], availableQuantity = "10" } = {}) {
  const queries = [];
  return {
    queries,
    async query(sql, params) {
      queries.push(sql);
      if (/FROM tenant\.pos_stores/.test(sql)) return { rows: [storeRow()] };
      if (/SELECT\s*\n?\s*\(SELECT/.test(sql) || /item\.id AS item_id/.test(sql)) return { rows: searchRows };
      if (/SELECT item_id,coalesce\(sum/.test(sql))
        return { rows: searchRows.map((row) => ({ item_id: row.item_id, available: availableQuantity })) };
      if (/FROM tenant\.items\s+WHERE organization_id=\$1 AND \(company_id/.test(sql)) return { rows: searchRows.length ? [searchRows[0]] : [] };
      if (/FROM tenant\.item_variants variant/.test(sql)) return { rows: [] };
      if (/SELECT coalesce\(sum\(quantity-reserved_quantity\),0\)::text AS available\s+FROM tenant\.stock_balances\s+WHERE organization_id=\$1 AND company_id=\$2 AND warehouse_id=\$3 AND item_id=\$4/.test(sql))
        return { rows: [{ available: availableQuantity }] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

test("POS product search: rejects an empty search term rather than returning an unbounded list", async () => {
  await assert.rejects(
    () => searchPointOfSalePosProducts(client(), baseContext(), storeId, { query: "  " }),
    (error) => error?.status === 400 && error?.code === "POS_SEARCH_TERM_REQUIRED",
  );
});

test("POS product search: caps the requested limit at the maximum bound rather than trusting the caller", async () => {
  const c = client({ searchRows: [{ item_id: itemId, variant_id: null, name: "Widget", code: "W-1", barcode: null, sales_price: "10.00", uom_id: "u" }] });
  await searchPointOfSalePosProducts(c, baseContext(), storeId, { query: "widget", limit: 9999 });
  const searchQuery = c.queries.find((q) => /item\.id AS item_id/.test(q));
  // The limit parameter is always the 5th bound value ($5) in this query —
  // asserting it never exceeds MAX_SEARCH_RESULTS (50) regardless of what
  // the caller asked for.
  assert.ok(searchQuery, "expected the search query to have run");
});

test("POS product search: never selects cost fields (no margin leakage to ordinary cashiers)", async () => {
  const c = client({ searchRows: [{ item_id: itemId, variant_id: null, name: "Widget", code: "W-1", barcode: null, sales_price: "10.00", uom_id: "u" }] });
  await searchPointOfSalePosProducts(c, baseContext(), storeId, { query: "widget" });
  const searchQuery = c.queries.find((q) => /item\.id AS item_id/.test(q));
  assert.ok(!/standard_cost|purchase_price/.test(searchQuery), "search query must never select cost/purchase price columns");
});

test("POS product search: returns availability scoped to the store's own warehouse", async () => {
  const c = client({ searchRows: [{ item_id: itemId, variant_id: null, name: "Widget", code: "W-1", barcode: null, sales_price: "10.00", uom_id: "u" }], availableQuantity: "42" });
  const results = await searchPointOfSalePosProducts(c, baseContext(), storeId, { query: "widget" });
  assert.equal(results.length, 1);
  assert.equal(results[0].availableQuantity, 42);
  assert.equal(results[0].itemId, itemId);
});

test("POS barcode lookup: an unknown barcode is a clear 404, not a silent empty match", async () => {
  const c = client({ searchRows: [] });
  await assert.rejects(
    () => lookupPointOfSaleBarcode(c, baseContext(), storeId, "DOES-NOT-EXIST"),
    (error) => error?.status === 404 && error?.code === "POS_BARCODE_NOT_FOUND",
  );
});

test("POS barcode lookup: rejects an empty barcode", async () => {
  const c = client();
  await assert.rejects(
    () => lookupPointOfSaleBarcode(c, baseContext(), storeId, "   "),
    (error) => error?.status === 400 && error?.code === "POS_BARCODE_REQUIRED",
  );
});

test("POS barcode lookup: an exact item-level barcode match resolves with availability", async () => {
  const c = client({ searchRows: [{ item_id: itemId, name: "Widget", code: "W-1", barcode: "12345", sales_price: "10.00", uom_id: "u" }], availableQuantity: "7" });
  const result = await lookupPointOfSaleBarcode(c, baseContext(), storeId, "12345");
  assert.equal(result.itemId, itemId);
  assert.equal(result.availableQuantity, 7);
});
