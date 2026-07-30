import test from "node:test";
import assert from "node:assert/strict";

import {
  ProcurementError,
  allocate,
  contentHash,
  createProcurementRecord,
  evaluateSupplierScore,
  getProcurementReport,
  listProcurementRecords,
  runProcurementMatch,
  transitionProcurementRecord,
} from "../src/procurement/index.js";

const ORGANIZATION = "11111111-1111-4111-8111-111111111111";
const COMPANY = "22222222-2222-4222-8222-222222222222";
const OTHER_COMPANY = "33333333-3333-4333-8333-333333333333";
const USER = "44444444-4444-4444-8444-444444444444";
const RECORD = "55555555-5555-4555-8555-555555555555";
const SUPPLIER = "66666666-6666-4666-8666-666666666666";

function context(permissions = []) {
  return {
    organizationId: ORGANIZATION,
    userId: USER,
    activeCompanyId: COMPANY,
    activeBranchId: null,
    allowAllCompanies: false,
    permissions,
    roleSlugs: [],
  };
}

test("procurement allocation preserves exact scaled totals", () => {
  const parts = allocate("100.00", ["1", "1", "1"]);
  assert.equal(parts.reduce((a, b) => a + b, 0n), 100000000n);
});

test("supplier score is deterministic", () =>
  assert.equal(
    evaluateSupplierScore(
      { price: 40, quality: 30, delivery: 30 },
      { price: 80, quality: 90, delivery: 70 },
    ),
    "80.00",
  ));

test("procurement error exposes stable contract", () => {
  const error = new ProcurementError(409, "Blocked");
  assert.equal(error.status, 409);
  assert.equal(error.code, "PROCUREMENT_ERROR");
});

test("content hashes are stable across object key order", () => {
  assert.equal(contentHash({ b: 2, a: 1 }), contentHash({ a: 1, b: 2 }));
});

test("released resources fail closed on missing permissions", async () => {
  const client = { query: async () => ({ rows: [] }) };
  await assert.rejects(
    listProcurementRecords(client, context(), "purchase-orders"),
    (error) => error instanceof ProcurementError && error.status === 403,
  );
});

test("company scope is embedded in procurement list queries", async () => {
  const calls = [];
  const client = {
    async query(text, values) {
      calls.push({ text, values });
      return text.includes("count(*)")
        ? { rows: [{ total: 0 }] }
        : { rows: [] };
    },
  };
  await listProcurementRecords(
    client,
    context(["procurement.view"]),
    "purchase-orders",
  );
  assert.equal(calls.length, 2);
  assert.match(calls[0].text, /company_id=\$2 OR company_id IS NULL/);
  assert.deepEqual(calls[0].values, [ORGANIZATION, COMPANY]);
});

test("requisitions require line-level business data", async () => {
  const client = { query: async () => ({ rows: [] }) };
  await assert.rejects(
    createProcurementRecord(
      client,
      context(["procurement.requisition.create"]),
      "requisitions",
      { title: "Laptop", needByDate: "2026-08-10", currencyCode: "INR" },
    ),
    (error) =>
      error instanceof ProcurementError &&
      error.code === "PROCUREMENT_LINES_REQUIRED",
  );
});

test("procurement writes reject a company outside active scope", async () => {
  const client = { query: async () => ({ rows: [] }) };
  await assert.rejects(
    createProcurementRecord(
      client,
      context(["procurement.po.create"]),
      "purchase-orders",
      {
        companyId: OTHER_COMPANY,
        supplierId: SUPPLIER,
        title: "Unauthorized PO",
        expectedDeliveryDate: "2026-08-10",
        currencyCode: "INR",
        lines: [{ description: "Item", quantity: 1, unitPrice: 100 }],
      },
    ),
    (error) =>
      error instanceof ProcurementError &&
      error.code === "PROCUREMENT_COMPANY_SCOPE",
  );
});

test("self approval is rejected before a purchase order changes", async () => {
  const calls = [];
  const client = {
    async query(text, values) {
      calls.push({ text, values });
      if (text.includes("FROM tenant.procurement_purchase_orders")) {
        return {
          rows: [
            {
              id: RECORD,
              organization_id: ORGANIZATION,
              company_id: COMPANY,
              branch_id: null,
              status: "submitted",
              version: 1,
              created_by: USER,
              data: {
                companyId: COMPANY,
                supplierId: SUPPLIER,
                title: "PO",
                expectedDeliveryDate: "2026-08-10",
                currencyCode: "INR",
                lines: [],
              },
            },
          ],
        };
      }
      if (text.includes("FROM tenant.procurement_purchase_order_") || text.includes("FROM tenant.procurement_advance_shipping_notices")) {
        return { rows: [] };
      }
      throw new Error(`Unexpected SQL: ${text}`);
    },
  };
  await assert.rejects(
    transitionProcurementRecord(
      client,
      context(["procurement.view", "procurement.po.approve"]),
      "purchase-orders",
      RECORD,
      "approve",
      { expectedVersion: 1 },
    ),
    (error) =>
      error instanceof ProcurementError &&
      error.code === "PROCUREMENT_SELF_APPROVAL",
  );
  assert.equal(
    calls.some((call) => call.text.includes("UPDATE tenant.procurement_purchase_orders")),
    false,
  );
});

test("three-way matching creates a governed exception for quantity variance", async () => {
  const calls = [];
  const client = {
    async query(text, values) {
      calls.push({ text, values });
      if (text.includes("FROM tenant.procurement_purchase_orders")) {
        return {
          rows: [
            {
              id: RECORD,
              organization_id: ORGANIZATION,
              company_id: COMPANY,
              branch_id: null,
              status: "acknowledged",
              version: 2,
              created_by: "77777777-7777-4777-8777-777777777777",
              data: {
                companyId: COMPANY,
                supplierId: SUPPLIER,
                purchaseOrderNumber: "PO-000001",
                title: "PO",
                expectedDeliveryDate: "2026-08-10",
                currencyCode: "INR",
              },
            },
          ],
        };
      }
      if (text.includes("FROM tenant.procurement_suppliers")) {
        return { rows: [{ id: SUPPLIER, company_id: COMPANY, status: "active", data: {} }] };
      }
      if (text.includes("FROM tenant.procurement_policies")) {
        return { rows: [] };
      }
      if (text.includes("FROM tenant.procurement_invoice_matches")) {
        return { rows: [] };
      }
      if (text.includes("FROM tenant.procurement_purchase_order_lines")) {
        return {
          rows: [
            {
              id: "88888888-8888-4888-8888-888888888888",
              status: "active",
              data: {
                description: "Bearing",
                quantity: "10.000000",
                receivedQuantity: "2.000000",
                unitPrice: "100.000000",
                taxAmount: "0.000000",
              },
            },
          ],
        };
      }
      if (text.includes("FROM tenant.procurement_purchase_order_schedules") || text.includes("FROM tenant.procurement_advance_shipping_notices")) {
        return { rows: [] };
      }
      if (text.includes("INSERT INTO tenant.procurement_matching_records")) {
        return { rows: [{ id: "99999999-9999-4999-8999-999999999999", status: "exception" }] };
      }
      if (text.includes("INSERT INTO tenant.procurement_invoice_matches")) {
        return { rows: [{ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }] };
      }
      if (text.includes("UPDATE public.numbering_series")) {
        return { rows: [{ prefix: "PME-", number: 1, padding: 6 }] };
      }
      if (text.includes("INSERT INTO tenant.procurement_match_exceptions")) {
        return {
          rows: [
            {
              id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
              organization_id: ORGANIZATION,
              company_id: COMPANY,
              branch_id: null,
              status: "open",
              version: 1,
              content_hash: "hash",
              data: values ? JSON.parse(String(values[5])) : {},
            },
          ],
        };
      }
      if (text.includes("INSERT INTO tenant.procurement_matching_records(") || text.includes("INSERT INTO tenant.procurement_events") || text.includes("INSERT INTO tenant.procurement_outbox") || text.includes("UPDATE tenant.procurement_match_exceptions")) {
        return { rows: [] };
      }
      if (text.includes("FROM tenant.procurement_match_exceptions")) {
        return {
          rows: [
            {
              id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
              organization_id: ORGANIZATION,
              company_id: COMPANY,
              status: "open",
              version: 1,
              data: { invoiceNumber: "INV-1" },
            },
          ],
        };
      }
      if (text.includes("FROM tenant.procurement_matching_records")) return { rows: [] };
      throw new Error(`Unexpected SQL: ${text}`);
    },
  };
  const result = await runProcurementMatch(
    client,
    context(["procurement.view", "procurement.matching.manage"]),
    {
      purchaseOrderId: RECORD,
      invoiceNumber: "INV-1",
      matchMode: "three-way",
      invoiceLines: [
        {
          purchaseOrderLineId: "88888888-8888-4888-8888-888888888888",
          description: "Bearing",
          quantity: "5",
          unitPrice: "100",
        },
      ],
    },
  );
  assert.ok(result.exception);
  assert.equal(result.matchingRecord.status, "exception");
  assert.ok(
    result.matchingRecord.issues.some(
      (issue) => issue.type === "receipt-quantity-variance",
    ),
  );
});


test("Procurement reports fail closed without an active company", async () => {
  let queried = false;
  const client = { query: async () => { queried = true; return { rows: [] }; } };
  const scoped = context(["procurement.reports.view"]);
  scoped.activeCompanyId = null;
  const result = await getProcurementReport(client, scoped, "spend-analysis");
  assert.deepEqual(result.rows, []);
  assert.equal(queried, false);
});

test("Procurement reports bind the active company to live and materialized queries", async () => {
  const calls = [];
  const client = {
    query: async (text, values) => {
      calls.push({ text, values });
      return { rows: [] };
    },
  };
  await getProcurementReport(
    client,
    context(["procurement.reports.view"]),
    "spend-analysis",
  );
  assert.equal(calls.length, 2);
  assert.match(calls[0].text, /\$2::uuid IS NULL OR record\.company_id=\$2/);
  assert.deepEqual(calls[0].values, [ORGANIZATION, COMPANY]);
  assert.deepEqual(calls[1].values, [ORGANIZATION, "spend-analysis", COMPANY]);
});
