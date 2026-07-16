import assert from "node:assert/strict";
import test from "node:test";

import {
  BusinessDataError,
  createBusinessDataRecord,
  isBusinessDataResource,
  listBusinessDataRecords,
} from "../src/index.js";

const context = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  userId: "22222222-2222-4222-8222-222222222222",
  activeCompanyId: "33333333-3333-4333-8333-333333333333",
  activeBranchId: null,
  allowAllCompanies: true,
};

test("business-data service rejects unknown resources", async () => {
  assert.equal(isBusinessDataResource("items"), true);
  assert.equal(isBusinessDataResource("unknown"), false);

  await assert.rejects(
    () =>
      listBusinessDataRecords(
        { query: async () => ({ rows: [] }) },
        context,
        "unknown",
      ),
    (error) => error instanceof BusinessDataError && error.status === 404,
  );
});

test("business-data service builds allowlisted item inserts", async () => {
  const calls = [];
  const client = {
    async query(sql, values) {
      calls.push({ sql, values });
      return {
        rows: [
          {
            id: "44444444-4444-4444-8444-444444444444",
            organization_id: context.organizationId,
            code: "ITM-001",
            name: "Bearing",
            status: "active",
          },
        ],
      };
    },
  };

  const record = await createBusinessDataRecord(client, context, "items", {
    companyId: null,
    code: "ITM-001",
    name: "Bearing",
    description: "",
    itemType: "product",
    groupId: null,
    uomId: "55555555-5555-4555-8555-555555555555",
    hsnSacCode: "",
    barcode: "",
    trackInventory: true,
    allowNegativeStock: false,
    valuationMethod: "moving_average",
    standardCost: 0,
    salesPrice: 0,
    purchasePrice: 0,
    taxCategoryId: null,
    status: "active",
  });

  assert.match(calls[0].sql, /INSERT INTO tenant\.items/);
  assert.equal(record.organizationId, context.organizationId);
  assert.equal(record.code, "ITM-001");
});
