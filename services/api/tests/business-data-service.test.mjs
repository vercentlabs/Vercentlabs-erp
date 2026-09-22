import assert from "node:assert/strict";
import test from "node:test";

import {
  BusinessDataError,
  archiveBusinessDataRecord,
  createBusinessDataRecord,
  getBusinessDataOverview,
  getBusinessDataRecord,
  isBusinessDataResource,
  listBusinessDataRecords,
  updateBusinessDataRecord,
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
    new URL("../src/core/master-data.js", import.meta.url),
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

// F031: every master-data resource (not just customers) had no single-record
// read -- getBusinessDataRecord closes that gap once, in the shared engine,
// rather than each resource's route working around it with a list-and-find.
test("getBusinessDataRecord returns a camelized single record", async () => {
  const client = {
    async query(sql) {
      assert.match(sql, /SELECT t\.\*/);
      return {
        rows: [
          {
            id: "id-1",
            organization_id: context.organizationId,
            display_name: "Acme Dairy",
            party_type: "customer",
            status: "active",
          },
        ],
      };
    },
  };
  const record = await getBusinessDataRecord(client, context, "parties", "id-1");
  assert.equal(record.displayName, "Acme Dairy");
});

test("getBusinessDataRecord 404s when the scope clause excludes the row", async () => {
  const client = { async query() { return { rows: [] }; } };
  await assert.rejects(
    () => getBusinessDataRecord(client, context, "parties", "missing-id"),
    (error) => error instanceof BusinessDataError && error.status === 404,
  );
});

// F032: contacts/addresses each have a DB-enforced "one active primary" rule
// (contacts: per party; addresses: per party+address_type). Setting a second
// record primary used to hit that unique index and surface as an opaque 409
// DUPLICATE_RECORD -- the engine now demotes the previous primary in the
// same transaction instead, matching how every top-ERP customer master
// (NetSuite's default flags, SAP's partner functions) handles a new default
// superseding the old one.
test("createBusinessDataRecord demotes the previous primary contact before inserting a new primary one", async () => {
  const calls = [];
  const client = {
    async query(sql, values) {
      calls.push({ sql, values });
      if (sql.startsWith("UPDATE tenant.contacts")) return { rows: [] };
      return { rows: [{ id: "contact-2", organization_id: context.organizationId, party_id: "party-1", first_name: "New", is_primary: true, status: "active" }] };
    },
  };
  await createBusinessDataRecord(client, context, "contacts", { partyId: "party-1", firstName: "New", isPrimary: true, status: "active" });
  const demote = calls.find((c) => c.sql.startsWith("UPDATE tenant.contacts"));
  assert.ok(demote, "expected a demote UPDATE to run before the insert");
  assert.match(demote.sql, /is_primary = true/);
  assert.ok(demote.values.includes("party-1"));
});

test("createBusinessDataRecord does not demote anything when the new record isn't primary", async () => {
  const calls = [];
  const client = {
    async query(sql, values) {
      calls.push({ sql, values });
      return { rows: [{ id: "contact-2", organization_id: context.organizationId, party_id: "party-1", first_name: "New", is_primary: false, status: "active" }] };
    },
  };
  await createBusinessDataRecord(client, context, "contacts", { partyId: "party-1", firstName: "New", isPrimary: false, status: "active" });
  assert.equal(calls.some((c) => c.sql.startsWith("UPDATE tenant.contacts")), false);
});

test("createBusinessDataRecord demotes the previous primary address scoped to the same address_type", async () => {
  const calls = [];
  const client = {
    async query(sql, values) {
      calls.push({ sql, values });
      if (sql.startsWith("UPDATE tenant.addresses")) return { rows: [] };
      return { rows: [{ id: "address-2", organization_id: context.organizationId, party_id: "party-1", address_type: "billing", is_primary: true, status: "active" }] };
    },
  };
  await createBusinessDataRecord(client, context, "addresses", { partyId: "party-1", addressType: "billing", line1: "1 MG Road", city: "Bengaluru", state: "Karnataka", postalCode: "560001", countryCode: "IN", isPrimary: true, status: "active" });
  const demote = calls.find((c) => c.sql.startsWith("UPDATE tenant.addresses"));
  assert.ok(demote, "expected a demote UPDATE to run before the insert");
  assert.match(demote.sql, /address_type = \$3/);
  assert.deepEqual(demote.values.slice(0, 3), [context.organizationId, "party-1", "billing"]);
});

test("updateBusinessDataRecord's primary-contact demote excludes the record being updated", async () => {
  const calls = [];
  const existingRow = { id: "contact-1", organization_id: context.organizationId, party_id: "party-1", first_name: "Existing", is_primary: false, status: "active" };
  const client = {
    async query(sql, values) {
      calls.push({ sql, values });
      if (calls.length === 1) return { rows: [existingRow] }; // assertExistingRecord
      if (sql.startsWith("UPDATE tenant.contacts SET is_primary")) return { rows: [] };
      return { rows: [{ ...existingRow, is_primary: true }] };
    },
  };
  await updateBusinessDataRecord(client, context, "contacts", "contact-1", { isPrimary: true });
  const demote = calls.find((c) => c.sql.startsWith("UPDATE tenant.contacts SET is_primary"));
  assert.ok(demote, "expected a demote UPDATE");
  assert.match(demote.sql, /id <> \$\d+/);
  assert.ok(demote.values.includes("contact-1"));
});

// F031: business_parties writes had no optimistic concurrency, unlike CRM's
// identical updateCrmAccount/archiveCrmAccount on the same table. The guard
// is additive -- omitted entirely unless a caller supplies expectedUpdatedAt.
test("updateBusinessDataRecord omits the version guard when no expectedUpdatedAt is supplied", async () => {
  const calls = [];
  const existingRow = { id: "id-1", organization_id: context.organizationId, display_name: "Old Name", party_type: "customer", status: "active", code: "C-1" };
  const client = {
    async query(sql, values) {
      calls.push({ sql, values });
      return { rows: [calls.length === 1 ? existingRow : { ...existingRow, display_name: "New Name" }] };
    },
  };
  await updateBusinessDataRecord(client, context, "parties", "id-1", { displayName: "New Name" });
  assert.doesNotMatch(calls[1].sql, /AND updated_at = \$/);
});

test("updateBusinessDataRecord's version guard surfaces a 409 STALE_WRITE on a zero-row update", async () => {
  const calls = [];
  const existingRow = { id: "id-1", organization_id: context.organizationId, display_name: "Old Name", party_type: "customer", status: "active", code: "C-1" };
  const client = {
    async query(sql, values) {
      calls.push({ sql, values });
      return { rows: calls.length === 1 ? [existingRow] : [] };
    },
  };
  await assert.rejects(
    () =>
      updateBusinessDataRecord(
        client,
        context,
        "parties",
        "id-1",
        { displayName: "New Name" },
        { expectedUpdatedAt: "2020-01-01T00:00:00.000Z" },
      ),
    (error) => error instanceof BusinessDataError && error.status === 409 && error.code === "STALE_WRITE",
  );
  assert.match(calls[1].sql, /AND updated_at = \$\d+/);
  assert.ok(calls[1].values.includes("2020-01-01T00:00:00.000Z"));
});

test("archiveBusinessDataRecord's version guard surfaces a 409 STALE_WRITE on a zero-row update", async () => {
  const calls = [];
  const existingRow = { id: "id-1", organization_id: context.organizationId, display_name: "Old Name", party_type: "customer", status: "active", code: "C-1" };
  const client = {
    async query(sql, values) {
      calls.push({ sql, values });
      return { rows: calls.length === 1 ? [existingRow] : [] };
    },
  };
  await assert.rejects(
    () => archiveBusinessDataRecord(client, context, "parties", "id-1", { expectedUpdatedAt: "2020-01-01T00:00:00.000Z" }),
    (error) => error instanceof BusinessDataError && error.status === 409 && error.code === "STALE_WRITE",
  );
  assert.match(calls[1].sql, /AND updated_at = \$\d+/);
});

// F031: the customer list route used to filter supplier rows out of the page
// AFTER listBusinessDataRecords had already applied LIMIT/OFFSET/total, so a
// page could come back short and total could overstate what's shown. The
// filter now runs in SQL via partyTypes.
test("listBusinessDataRecords filters by party_type in SQL when partyTypes is supplied", async () => {
  const calls = [];
  await listBusinessDataRecords(
    { query: async (text, values) => (calls.push({ text, values }), { rows: [] }) },
    context,
    "parties",
    { partyTypes: ["customer", "prospect", "both"] },
  );
  const [countCall, listCall] = calls;
  assert.match(countCall.text, /party_type = ANY\(\$\d+::text\[\]\)/);
  assert.match(listCall.text, /party_type = ANY\(\$\d+::text\[\]\)/);
  // Index 1 (after organizationId): the count and list queries share the
  // same parameters array by reference, so a later push (limit/offset, added
  // only before the list query runs) mutates what calls[0].values looks like
  // by the time this assertion runs -- position 1 is stable regardless.
  assert.deepEqual(countCall.values[1], ["customer", "prospect", "both"]);
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
