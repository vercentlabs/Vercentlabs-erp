import assert from "node:assert/strict";
import test from "node:test";

import { ACCOUNTING_PERMISSIONS } from "@vercentlabs/permissions";
import {
  buildReceivablesGovernanceSummary,
  bulkManageReceivablesCollections,
  evaluateReceivableHealth,
} from "../src/accounting/receivables-governance.js";

const context = {
  organizationId: "00000000-0000-4000-8000-000000000001",
  userId: "00000000-0000-4000-8000-000000000002",
  activeCompanyId: null,
  activeBranchId: null,
  allowAllCompanies: true,
  permissions: [
    ACCOUNTING_PERMISSIONS.view,
    ACCOUNTING_PERMISSIONS.collectionsManage,
  ],
  roleSlugs: [],
};

function openInvoice(overrides = {}) {
  return {
    id: "00000000-0000-4000-8000-000000000003",
    invoice_type: "invoice",
    status: "posted",
    customer_status: "active",
    grand_total: "1000.000000",
    outstanding_amount: "1000.000000",
    line_count: 1,
    schedule_count: 1,
    schedule_total: "1000.000000",
    schedule_outstanding: "1000.000000",
    customer_snapshot: { displayName: "Acme" },
    billing_address_snapshot: { city: "Pune" },
    payment_term_snapshot: { code: "NET-30" },
    journal_entry_id: "00000000-0000-4000-8000-000000000004",
    due_date: "2026-01-01",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

test("receivable health flags overdue invoices without collection ownership", () => {
  const health = evaluateReceivableHealth(
    openInvoice(),
    { collectionStartDays: 1, escalationDays: 30, highRiskDays: 60 },
    new Date("2026-03-15T00:00:00Z"),
  );
  assert.equal(health.isOverdue, true);
  assert.equal(health.collectionRequired, true);
  assert.equal(health.riskBand, "high");
  assert.equal(health.readiness, "attention");
  assert.match(health.warnings.join(" "), /no active collection case/i);
});

test("receivables summary preserves aging and outstanding totals", () => {
  const summary = buildReceivablesGovernanceSummary(
    [
      openInvoice({
        id: "00000000-0000-4000-8000-000000000005",
        due_date: "2026-03-20",
        outstanding_amount: "400.000000",
        grand_total: "400.000000",
        schedule_total: "400.000000",
        schedule_outstanding: "400.000000",
      }),
      openInvoice({
        id: "00000000-0000-4000-8000-000000000006",
        due_date: "2026-01-15",
        outstanding_amount: "600.000000",
        grand_total: "600.000000",
        schedule_total: "600.000000",
        schedule_outstanding: "600.000000",
        collection_case_status: "escalated",
      }),
    ],
    {},
    new Date("2026-03-15T00:00:00Z"),
  );
  assert.equal(summary.open, 2);
  assert.equal(summary.overdue, 1);
  assert.equal(summary.dueSoon, 1);
  assert.equal(summary.outstanding, 1000);
  assert.equal(summary.aging.current, 400);
  assert.equal(summary.aging.days31To60, 600);
});

test("bulk collections reject an empty invoice selection before mutation", async () => {
  const queries = [];
  await assert.rejects(
    () =>
      bulkManageReceivablesCollections(
        {
          query: async (sql) => {
            queries.push(sql);
            return { rows: [] };
          },
        },
        context,
        { ids: [], changes: { priority: "high" } },
      ),
    /Select between 1 and 200 customer invoices/,
  );
  assert.equal(queries.length, 0);
});
