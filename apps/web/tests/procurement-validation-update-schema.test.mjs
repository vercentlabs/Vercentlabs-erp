// Regression test for a real production defect found via a browser E2E run
// (tests/e2e/erp-procurement-source-to-pay-journey.spec.ts): every PATCH to
// a Procurement resource returned 500 with "Error: .partial() cannot be
// used on object schemas containing refinements". Zod 4 refuses .partial()
// on any ZodObject that already carries a .superRefine()/.refine() effect
// (even from an upstream .extend()), and parseProcurementUpdate called
// .partial() on schemas built that way. No test exercised this function
// before — every other test either called the domain layer directly or
// only exercised parseProcurementCreate.
import assert from "node:assert/strict";
import test from "node:test";
import { loadTsModule } from "./helpers/load-ts-module.mjs";

const { parseProcurementUpdate, parseProcurementCreate } = await loadTsModule(
  "apps/web/src/modules/procurement/validation.ts",
);

test("parseProcurementUpdate accepts a partial update for every document-kind resource", () => {
  const cases = [
    ["suppliers", { legalName: "Updated Ltd" }],
    ["requisitions", { title: "Updated title" }],
    ["sourcing-events", { bids: [{ supplierId: "11111111-1111-1111-1111-111111111111" }] }],
    ["purchase-orders", { title: "Updated PO" }],
    ["receipts", { receiptDate: "2026-01-01" }],
  ];
  for (const [resource, patch] of cases) {
    const result = parseProcurementUpdate(resource, { ...patch, expectedVersion: 2 });
    assert.equal(result.expectedVersion, 2, `${resource}: expectedVersion must round-trip`);
  }
});

test("parseProcurementUpdate accepts a partial update for a child resource with no dedicated schema", () => {
  const result = parseProcurementUpdate("sourcing-bids", {
    quotationNumber: "SQ-002",
    expectedVersion: 1,
  });
  assert.equal(result.quotationNumber, "SQ-002");
});

test("parseProcurementUpdate still rejects lifecycle-internal fields", () => {
  assert.throws(() =>
    parseProcurementUpdate("suppliers", { status: "active", expectedVersion: 1 }),
  );
});

test("parseProcurementCreate still rejects lifecycle-internal fields on create", () => {
  assert.throws(() =>
    parseProcurementCreate("suppliers", {
      legalName: "Test",
      supplierCode: "SUP-1",
      status: "active",
    }),
  );
});
