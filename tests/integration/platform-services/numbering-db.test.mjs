// One numbering system: tenant.document_sequences + policies via
// nextDocumentNumber(), against real PostgreSQL. Includes an upgrade test that
// replays tenant migration 181 over legacy public.numbering_series state.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { advanceNumberingCounter, getNumberingOverview, nextDocumentNumber, setNumberingPolicy } from "../../../services/api/src/core/platform/numbering/index.js";
import { createRuntimeKit, expectCode } from "../shared-runtime/runtime-kit.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const MIGRATION = fs.readFileSync(path.join(root, "database/tenant/migrations/181_document_numbering_unification.sql"), "utf8");

test("numbering: allocation, scope, policies, periods and forward-only counters", async (t) => {
  const kit = await createRuntimeKit();
  try {
    const org = await kit.organization(["admin"]);
    const secondCompanyId = randomUUID();
    await kit.owner.query(`INSERT INTO companies(id,organization_id,name,legal_name,code,base_currency,country_code,is_primary,status) VALUES($1,$2,'RT Co 2','RT Co 2','RTC2','INR','IN',false,'active')`, [secondCompanyId, org.organizationId]);
    const admin = org.session("admin", ["numbering.manage"]);
    const allocate = (documentType, extra = {}, companyId = org.companyId) =>
      kit.tenant(org.organizationId, (client) => nextDocumentNumber(client, { organizationId: org.organizationId, companyId }, { documentType, ...extra }));

    await t.test("concurrent allocations never collide", async () => {
      const numbers = await Promise.all(Array.from({ length: 16 }, () => allocate("support_ticket", { prefix: "TKT" })));
      assert.equal(new Set(numbers).size, 16);
      assert.ok(numbers.every((number) => /^TKT-\d{6}$/.test(number)));
    });

    await t.test("company-scoped types count per company; organisation-scoped types are shared", async () => {
      assert.equal(await allocate("stock_transfer", { prefix: "TRF" }), "TRF-000001");
      assert.equal(await allocate("stock_transfer", { prefix: "TRF" }, secondCompanyId), "TRF-000001");
      assert.equal(await allocate("crm_lead"), "LEAD-00001");
      assert.equal(await allocate("crm_lead", {}, secondCompanyId), "LEAD-00002", "organisation-wide identifiers never repeat across companies");
    });

    await t.test("unregistered document types fail closed", async () => {
      await assert.rejects(allocate("made_up_type", { prefix: "X" }), expectCode("DOCUMENT_NUMBER_TYPE_UNREGISTERED"));
    });

    await t.test("a policy changes prefix and digits for future numbers only", async () => {
      await kit.tenant(org.organizationId, (client) => setNumberingPolicy(client, admin, { documentType: "sales_order", prefix: "SO/", padding: 3, resetPolicy: "never" }));
      assert.equal(await allocate("sales_order"), "SO/001");
      await assert.rejects(
        kit.tenant(org.organizationId, (client) => setNumberingPolicy(client, admin, { documentType: "sales_order", prefix: "SO-", padding: 5, resetPolicy: "never", expectedVersion: 0 })),
        expectCode("DOCUMENT_NUMBER_VERSION_CONFLICT"),
      );
      await assert.rejects(
        kit.tenant(org.organizationId, (client) => setNumberingPolicy(client, admin, { documentType: "pos_receipt", companyId: org.companyId, prefix: "R-", padding: 5, resetPolicy: "never" })),
        expectCode("DOCUMENT_NUMBER_MODULE_MANAGED"),
      );
      await assert.rejects(
        kit.tenant(org.organizationId, (client) => setNumberingPolicy(client, admin, { documentType: "sales_order", prefix: "bad prefix!", padding: 5, resetPolicy: "never" })),
        expectCode("DOCUMENT_NUMBER_PREFIX_INVALID"),
      );
      const audit = await kit.owner.query(`SELECT count(*)::int AS n FROM audit_events WHERE organization_id=$1 AND event_type='numbering.policy_changed'`, [org.organizationId]);
      assert.equal(audit.rows[0].n, 1);
    });

    await t.test("fiscal-year reset uses the organisation's fiscal start and puts the period in the number", async () => {
      await kit.owner.query(`UPDATE organizations SET fiscal_year_start_month=7 WHERE id=$1`, [org.organizationId]);
      await kit.tenant(org.organizationId, (client) => setNumberingPolicy(client, admin, { documentType: "customer_invoice", prefix: "INV-", padding: 4, resetPolicy: "fiscal_year" }));
      assert.equal(await allocate("customer_invoice", { at: new Date("2026-06-30T12:00:00Z") }), "INV-2025-26-0001");
      assert.equal(await allocate("customer_invoice", { at: new Date("2026-07-01T12:00:00Z") }), "INV-2026-27-0001");
      assert.equal(await allocate("customer_invoice", { at: new Date("2026-08-01T12:00:00Z") }), "INV-2026-27-0002");
      await kit.tenant(org.organizationId, (client) => setNumberingPolicy(client, admin, { documentType: "journal_entry", prefix: "JV", padding: 3, resetPolicy: "calendar_year" }));
      assert.equal(await allocate("journal_entry", { at: new Date("2027-01-02T00:00:00Z") }), "JV2027-001");
    });

    await t.test("counters only move forward", async () => {
      await assert.rejects(
        kit.tenant(org.organizationId, (client) => advanceNumberingCounter(client, admin, { documentType: "crm_lead", nextValue: 1 })),
        expectCode("DOCUMENT_NUMBER_DECREMENT_REFUSED"),
      );
      await kit.tenant(org.organizationId, (client) => advanceNumberingCounter(client, admin, { documentType: "crm_lead", nextValue: 500 }));
      assert.equal(await allocate("crm_lead"), "LEAD-00500");
      const overview = await kit.tenant(org.organizationId, (client) => getNumberingOverview(client, org.organizationId, org.companyId));
      const lead = overview.types.find((type) => type.documentType === "crm_lead");
      assert.equal(lead.nextNumberPreview, "LEAD-00501");
      assert.equal(overview.types.find((type) => type.documentType === "pos_receipt").configurable, false);
    });

    await t.test("another organisation's counters are invisible", async () => {
      const other = await kit.organization(["x"]);
      assert.equal(await kit.tenant(other.organizationId, (client) => nextDocumentNumber(client, { organizationId: other.organizationId, companyId: other.companyId }, { documentType: "crm_lead" })), "LEAD-00001");
    });
  } finally {
    await kit.close();
  }
});

test("numbering upgrade: legacy series migrate without re-issuing a number", async () => {
  const kit = await createRuntimeKit();
  try {
    const org = await kit.organization(["owner"]);
    const orgId = org.organizationId;
    // Legacy state: series at 7, but a party already carries PTY-00042 (someone
    // raised it by hand) -> the new counter must start above 42.
    await kit.owner.query(`DELETE FROM numbering_series WHERE organization_id=$1`, [orgId]);
    await kit.owner.query(`INSERT INTO numbering_series(organization_id,entity_type,prefix,next_number,padding,status) VALUES ($1,'business_party','PTY-',7,5,'active'),($1,'sales_order','SORD-',120,6,'active'),($1,'goods_receipt','GRN-',9,5,'active')`, [orgId]);
    await kit.owner.query(`INSERT INTO tenant.business_parties(id,organization_id,company_id,code,party_type,display_name,status,created_by) VALUES ($1,$2,$3,'PTY-00042','customer','Legacy Customer','active',$4)`, [randomUUID(), orgId, org.companyId, org.ids.owner]);
    // Procurement's old per-company fallback counters (no legacy series for sourcing_event).
    await kit.owner.query(
      `INSERT INTO tenant.document_sequences(organization_id,company_id,document_type,period_key,prefix,padding,next_value) VALUES ($1,$2,'procurement:goods_receipt','global','GRN',6,30),($1,$2,'procurement:sourcing_event','global','RFQ',6,4)`,
      [orgId, org.companyId],
    );

    await kit.owner.query(MIGRATION);
    const allocate = (documentType) => kit.tenant(orgId, (client) => nextDocumentNumber(client, { organizationId: orgId, companyId: org.companyId }, { documentType }));
    assert.equal(await allocate("business_party"), "PTY-00043", "starts above the highest number already issued");
    assert.equal(await allocate("sales_order"), "SORD-000120", "custom legacy prefix/padding preserved; legacy next number honoured");
    assert.equal(await allocate("goods_receipt"), "GRN-00030", "floor includes the per-company fallback counter");
    assert.equal(await allocate("sourcing_event"), "RFQ-000004", "fallback-only type keeps the fallback's format");

    // Replaying the migration is harmless: counters never go backwards.
    await kit.owner.query(MIGRATION);
    assert.equal(await allocate("business_party"), "PTY-00044");
  } finally {
    await kit.close();
  }
});
