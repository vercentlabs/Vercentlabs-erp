import assert from "node:assert/strict";
import test from "node:test";

import {
  BusinessDataError,
  createBusinessDataRecord,
  getBusinessDataOverview,
  isBusinessDataResource,
  listBusinessDataRecords,
} from "../src/index.js";
import { readFileSync } from "node:fs";

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

test("business-data foundation passes an explicit base-currency boolean", () => {
  const source = readFileSync(
    new URL("../src/index.js", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(source, /\$2\s*=\s*\$6/);
  assert.match(
    source,
    /code === String\(organization\.base_currency\)\.trim\(\)/,
  );
});

test("business-data branch access fails closed with zero permitted branches", async () => {
  const restricted = { ...context, activeBranchId: null, allowAllCompanies: false };
  const calls = [];
  await listBusinessDataRecords(
    { query: async (text) => (calls.push(text), { rows: [] }) },
    restricted,
    "warehouses",
  );
  assert.equal(calls.length, 2);
  assert.match(calls[0], /AND false/);
  assert.match(calls[1], /AND false/);
  await assert.rejects(
    () => createBusinessDataRecord({ query: async () => assert.fail("must not query") }, restricted, "warehouses", { name: "Blocked", code: "BLOCKED" }),
    /allowed branch/,
  );
});

test("business-data writes reject unauthorized branches and companies", async () => {
  const restricted = {
    ...context,
    activeBranchId: "44444444-4444-4444-8444-444444444444",
    allowAllCompanies: false,
  };
  const client = { query: async () => assert.fail("must not query") };
  await assert.rejects(
    () => createBusinessDataRecord(client, restricted, "warehouses", {
      companyId: restricted.activeCompanyId,
      branchId: "55555555-5555-4555-8555-555555555555",
      name: "Wrong branch",
      code: "WRONG-BRANCH",
    }),
    /active branch context/,
  );
  await assert.rejects(
    () => createBusinessDataRecord(client, restricted, "warehouses", {
      companyId: "66666666-6666-4666-8666-666666666666",
      branchId: restricted.activeBranchId,
      name: "Wrong company",
      code: "WRONG-COMPANY",
    }),
    /active company context/,
  );
});

test("business-data administrators retain all-company and all-branch access", async () => {
  const calls = [];
  await listBusinessDataRecords(
    { query: async (text) => (calls.push(text), { rows: [] }) },
    { ...context, activeCompanyId: null, activeBranchId: null, allowAllCompanies: true },
    "warehouses",
  );
  assert.equal(calls.length, 2);
  assert.doesNotMatch(calls[0], /AND false/);
  assert.doesNotMatch(calls[1], /AND false|branch_id =/);
});

test("organization-wide business data remains available without a branch", async () => {
  const calls = [];
  await listBusinessDataRecords(
    { query: async (text) => (calls.push(text), { rows: [] }) },
    { ...context, activeCompanyId: null, activeBranchId: null, allowAllCompanies: false },
    "units-of-measure",
  );
  assert.equal(calls.length, 2);
  assert.doesNotMatch(calls[0], /AND false/);
  assert.doesNotMatch(calls[1], /AND false/);
  assert.match(calls[1], /t\.organization_id = \$1/);
});

test("business-data overview scopes aggregates and preserves organization-wide metrics", async () => {
  let captured;
  const restricted = {
    ...context,
    activeBranchId: "44444444-4444-4444-8444-444444444444",
    allowAllCompanies: false,
  };
  await getBusinessDataOverview(
    {
      async query(text, values) {
        captured = { text, values };
        return { rows: [{}] };
      },
    },
    restricted,
  );
  assert.deepEqual(captured.values, [
    restricted.organizationId,
    restricted.activeCompanyId,
    restricted.activeBranchId,
    false,
  ]);
  assert.match(captured.text, /warehouse\.company_id = \$2/);
  assert.match(captured.text, /warehouse\.branch_id = \$3/);
  assert.match(captured.text, /\$4::boolean OR/);
  assert.match(captured.text, /FROM tenant\.currencies\s+WHERE organization_id = \$1/);
});
