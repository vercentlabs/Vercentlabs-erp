// Real PostgreSQL integration test -- the Procurement source-to-pay domain as the
// web app drives it. Contexts carry the exact permission sets the seeded roles
// (purchase_requester, buyer, purchase_approver, goods_receipt_user, ...) hold, NOT
// the owner bypass, so permission boundaries and segregation of duties are tested
// as they ship. Runs against real RLS; nothing is mocked.
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";

import { Client } from "pg";

const adminConnectionString = process.env.MIGRATION_DATABASE_URL || "";

async function connectOrNull(connectionString) {
  if (!connectionString) return null;
  const client = new Client({ connectionString });
  try {
    await client.connect();
    return client;
  } catch {
    return null;
  }
}

const ROLE_PERMISSIONS = {
  requester: ["procurement.view", "procurement.requisition.create", "procurement.suppliers.view", "procurement.reports.view"],
  buyer: ["procurement.view", "procurement.catalog.manage", "procurement.contracts.manage", "procurement.po.amend", "procurement.po.cancel", "procurement.po.create", "procurement.po.dispatch", "procurement.po.manage", "procurement.reports.view", "procurement.requisition.manage", "procurement.sourcing.evaluate", "procurement.sourcing.manage", "procurement.supplier_portal.manage", "procurement.suppliers.manage", "procurement.suppliers.qualify", "procurement.suppliers.view"],
  approver: ["procurement.view", "procurement.contracts.approve", "procurement.po.approve", "procurement.receipts.approve", "procurement.reports.view", "procurement.requisition.approve", "procurement.suppliers.view"],
  receiver: ["procurement.view", "procurement.inspection.manage", "procurement.receipts.manage", "procurement.reports.view", "procurement.returns.manage", "procurement.suppliers.view"],
  manager: ["procurement.view", "procurement.audit.view", "procurement.catalog.manage", "procurement.contracts.approve", "procurement.contracts.manage", "procurement.matching.override", "procurement.po.amend", "procurement.po.approve", "procurement.po.cancel", "procurement.po.manage", "procurement.receipts.approve", "procurement.reports.view", "procurement.requisition.approve", "procurement.requisition.manage", "procurement.settings.manage", "procurement.sourcing.award", "procurement.sourcing.evaluate", "procurement.sourcing.manage", "procurement.supplier_portal.manage", "procurement.suppliers.manage", "procurement.suppliers.qualify", "procurement.suppliers.sensitive", "procurement.suppliers.view"],
  viewer: ["procurement.view", "procurement.suppliers.view"],
};

test("Procurement source-to-pay against real PostgreSQL", async (t) => {
  const admin = await connectOrNull(adminConnectionString);
  if (!admin) {
    t.skip("No reachable Postgres connection (MIGRATION_DATABASE_URL) -- run `pnpm infra:up && pnpm db:setup` first.");
    return;
  }

  const proc = await import("../../services/api/src/index.js");
  const { createProcurementRecord, updateProcurementRecord, getProcurementRecord, listProcurementRecords, transitionProcurementRecord, procurementContext, getProcurementDashboard, getProcurementGovernanceTimeline } = proc;
  const { setTenantContext } = await import("../../packages/database/src/index.js");

  const orgId = randomUUID();
  const companyId = randomUUID();
  const users = Object.fromEntries(Object.keys(ROLE_PERMISSIONS).map((role) => [role, randomUUID()]));
  const itemId = randomUUID();
  const uomId = randomUUID();
  const warehouseId = randomUUID();
  const ctx = Object.fromEntries(
    Object.entries(ROLE_PERMISSIONS).map(([role, permissions]) => [
      role,
      procurementContext({ organizationId: orgId, userId: users[role], activeCompanyId: companyId, activeBranchId: null, roleSlugs: [], permissions }),
    ]),
  );

  async function tx(fn) {
    await admin.query("BEGIN");
    try {
      await setTenantContext(admin, orgId);
      const result = await fn(admin);
      await admin.query("COMMIT");
      return result;
    } catch (error) {
      await admin.query("ROLLBACK");
      throw error;
    }
  }
  const forbidden = (e) => e.code === "PROCUREMENT_FORBIDDEN" || e.status === 403;

  try {
    for (const [role, id] of Object.entries(users)) {
      await admin.query(`INSERT INTO public.users(id,email,full_name,password_hash,status,email_verified_at) VALUES ($1,$2,$3,'x','active',now())`, [id, `proc-${role}-${id}@test.invalid`, `Proc ${role}`]);
    }
    await admin.query(`INSERT INTO public.organizations(id,name,slug,country_code,timezone,base_currency,created_by) VALUES ($1,'Proc Test Org',$2,'IN','Asia/Kolkata','INR',$3)`, [orgId, `proc-org-${orgId}`, users.buyer]);
    await admin.query(`INSERT INTO public.companies(id,organization_id,name,legal_name,code,base_currency,country_code,is_primary,status) VALUES ($1,$2,'Proc Co','Proc Co Pvt Ltd','PROCO','INR','IN',true,'active')`, [companyId, orgId]);
    for (const id of Object.values(users)) await admin.query(`INSERT INTO public.organization_memberships(organization_id,user_id,role,status) VALUES ($1,$2,'member','active')`, [orgId, id]);
    await setTenantContext(admin, orgId);
    await admin.query(`INSERT INTO tenant.units_of_measure(id,organization_id,code,name,category,status) VALUES ($1,$2,'EA','Each','quantity','active')`, [uomId, orgId]);
    await admin.query(`INSERT INTO tenant.items(id,organization_id,company_id,code,name,item_type,uom_id,status,track_inventory) VALUES ($1,$2,$3,'RAW-1','Raw Widget','product',$4,'active',true)`, [itemId, orgId, companyId, uomId]);
    await admin.query(`INSERT INTO tenant.warehouses(id,organization_id,company_id,code,name,status) VALUES ($1,$2,$3,'WH1','Main','active')`, [warehouseId, orgId, companyId]);

    let supplier;
    await t.test("F063/F065: a supplier is onboarded by submit -> qualify (a different person) -> activate", async () => {
      await assert.rejects(() => tx((c) => createProcurementRecord(c, ctx.viewer, "suppliers", { supplierCode: "S1", legalName: "Nope" })), forbidden);
      supplier = await tx((c) => createProcurementRecord(c, ctx.buyer, "suppliers", { supplierCode: "sup-001", legalName: "Acme Components Pvt Ltd", displayName: "Acme Components", currencyCode: "INR", paymentTerms: "Net 30", paymentTermDays: 30 }));
      assert.equal(supplier.status, "draft");
      assert.equal(supplier.supplierCode, "SUP-001", "codes are normalised to upper case");
      let s = await tx((c) => transitionProcurementRecord(c, ctx.buyer, "suppliers", supplier.id, "submit", { expectedVersion: supplier.version }));
      await assert.rejects(() => tx((c) => transitionProcurementRecord(c, ctx.buyer, "suppliers", supplier.id, "qualify", { expectedVersion: s.version })), (e) => e.code === "PROCUREMENT_SELF_APPROVAL", "the creator cannot qualify their own supplier");
      await assert.rejects(() => tx((c) => transitionProcurementRecord(c, ctx.requester, "suppliers", supplier.id, "qualify", { expectedVersion: s.version })), forbidden, "a requester holds no qualify permission");
      s = await tx((c) => transitionProcurementRecord(c, ctx.manager, "suppliers", supplier.id, "qualify", { expectedVersion: s.version }));
      assert.equal(s.status, "qualified");
      await assert.rejects(() => tx((c) => transitionProcurementRecord(c, ctx.manager, "suppliers", supplier.id, "activate", { expectedVersion: 1 })), (e) => e.code === "PROCUREMENT_VERSION_CONFLICT", "stale version is refused");
      s = await tx((c) => transitionProcurementRecord(c, ctx.manager, "suppliers", supplier.id, "activate", { expectedVersion: s.version }));
      assert.equal(s.status, "active");
      supplier = s;
    });

    await t.test("F064: sites, contacts, qualifications, certifications and scorecards attach to the supplier", async () => {
      const site = await tx((c) => createProcurementRecord(c, ctx.buyer, "supplier-sites", { parentId: supplier.id, siteName: "Pune Plant", siteType: "plant", contactName: "Ravi", contactEmail: "ravi@acme.test" }));
      assert.equal(site.parent_id, supplier.id);
      await tx((c) => createProcurementRecord(c, ctx.manager, "supplier-qualifications", { parentId: supplier.id, qualificationType: "quality_audit", result: "passed" }));
      await tx((c) => createProcurementRecord(c, ctx.manager, "supplier-certifications", { parentId: supplier.id, certificateType: "ISO 9001", validUntil: "2030-01-01" }));
      await tx((c) => createProcurementRecord(c, ctx.manager, "supplier-scorecards", { parentId: supplier.id, period: "2026-Q3", qualityScore: 90, deliveryScore: 80, priceScore: 70, serviceScore: 60, overallScore: 78.5 }));
      const listed = await tx((c) => listProcurementRecords(c, ctx.viewer, "supplier-sites", { parentId: supplier.id }));
      assert.equal(listed.total, 1);
    });

    await t.test("F064: scorecards are refused for a viewer; sites are refused for a requester", async () => {
      await assert.rejects(() => tx((c) => createProcurementRecord(c, ctx.viewer, "supplier-scorecards", { parentId: supplier.id, period: "2026-Q4" })), forbidden);
      await assert.rejects(() => tx((c) => createProcurementRecord(c, ctx.requester, "supplier-sites", { parentId: supplier.id, siteName: "X" })), forbidden);
    });

    await t.test("F063: blocking needs a reason and a blocked supplier can be reactivated", async () => {
      await assert.rejects(() => tx((c) => transitionProcurementRecord(c, ctx.manager, "suppliers", supplier.id, "block", { expectedVersion: supplier.version })), (e) => /reason/i.test(e.message));
      let s = await tx((c) => transitionProcurementRecord(c, ctx.manager, "suppliers", supplier.id, "block", { expectedVersion: supplier.version, reason: "Failed audit" }));
      assert.equal(s.status, "blocked");
      s = await tx((c) => transitionProcurementRecord(c, ctx.manager, "suppliers", supplier.id, "activate", { expectedVersion: s.version }));
      assert.equal(s.status, "active");
      supplier = s;
    });

    await t.test("F066: categories need the settings permission", async () => {
      await assert.rejects(() => tx((c) => createProcurementRecord(c, ctx.buyer, "categories", { code: "raw", name: "Raw materials" })), forbidden);
      const category = await tx((c) => createProcurementRecord(c, ctx.manager, "categories", { code: "raw", name: "Raw materials" }));
      assert.equal(category.code, "RAW");
    });

    let requisition;
    await t.test("F067/F068: requisition -> submit -> approver rejects with a reason -> requester edits and RESUBMITS -> approved", async () => {
      requisition = await tx((c) => createProcurementRecord(c, ctx.requester, "requisitions", { title: "Widgets for Q4", needByDate: "2026-12-31", requesterDepartment: "Ops", lines: [{ itemId, description: "Raw Widget", quantity: "10", unitPrice: "100", warehouseId }] }));
      assert.match(requisition.requisitionNumber, /^PR-/);
      assert.equal(requisition.totals.grandTotal, "1000.00");
      await assert.rejects(() => tx((c) => createProcurementRecord(c, ctx.viewer, "requisitions", { title: "x", needByDate: "2026-12-31", lines: [{ description: "y", quantity: "1", unitPrice: "1" }] })), forbidden);
      await assert.rejects(() => tx((c) => transitionProcurementRecord(c, ctx.requester, "requisitions", requisition.id, "submit", { expectedVersion: requisition.version })), forbidden, "requesters create; submitting needs requisition.manage");
      let r = await tx((c) => transitionProcurementRecord(c, ctx.buyer, "requisitions", requisition.id, "submit", { expectedVersion: requisition.version }));
      await assert.rejects(() => tx((c) => transitionProcurementRecord(c, ctx.approver, "requisitions", requisition.id, "reject", { expectedVersion: r.version })), (e) => /reason/i.test(e.message));
      r = await tx((c) => transitionProcurementRecord(c, ctx.approver, "requisitions", requisition.id, "reject", { expectedVersion: r.version, reason: "Quantity too high" }));
      assert.equal(r.status, "rejected");
      const edited = await tx((c) => updateProcurementRecord(c, ctx.buyer, "requisitions", requisition.id, { title: "Widgets for Q4", needByDate: "2026-12-31", lines: [{ itemId, description: "Raw Widget", quantity: "5", unitPrice: "100", warehouseId }], expectedVersion: r.version }));
      assert.equal(edited.totals.grandTotal, "500.00");
      r = await tx((c) => transitionProcurementRecord(c, ctx.buyer, "requisitions", requisition.id, "submit", { expectedVersion: edited.version }));
      assert.equal(r.status, "submitted", "a rejected requisition can be revised and resubmitted");
      r = await tx((c) => transitionProcurementRecord(c, ctx.approver, "requisitions", requisition.id, "approve", { expectedVersion: r.version }));
      assert.equal(r.status, "approved");
      requisition = r;
    });

    await t.test("F068: the person who created a requisition cannot approve it, even holding approve", async () => {
      const both = procurementContext({ organizationId: orgId, userId: users.buyer, activeCompanyId: companyId, roleSlugs: [], permissions: [...ROLE_PERMISSIONS.buyer, "procurement.requisition.approve", "procurement.requisition.create"] });
      const own = await tx((c) => createProcurementRecord(c, both, "requisitions", { title: "Own request", needByDate: "2026-12-31", lines: [{ description: "Thing", quantity: "1", unitPrice: "10" }] }));
      const submitted = await tx((c) => transitionProcurementRecord(c, both, "requisitions", own.id, "submit", { expectedVersion: own.version }));
      await assert.rejects(() => tx((c) => transitionProcurementRecord(c, both, "requisitions", own.id, "approve", { expectedVersion: submitted.version })), (e) => e.code === "PROCUREMENT_SELF_APPROVAL");
    });

    await t.test("audit: every action leaves a timeline entry, and the dashboard counts real records", async () => {
      const timeline = await tx((c) => getProcurementGovernanceTimeline(c, ctx.viewer, "requisitions", requisition.id));
      const labels = timeline.map((entry) => entry.label);
      for (const expected of ["submit", "reject", "updated", "approve"]) assert.ok(labels.includes(expected), `timeline has ${expected}`);
      const dashboard = await tx((c) => getProcurementDashboard(c, ctx.viewer));
      assert.ok(Number(dashboard.pending_requisitions) >= 1, "the unapproved own-request counts as pending");
      const rec = await tx((c) => getProcurementRecord(c, ctx.viewer, "requisitions", requisition.id));
      assert.equal(rec.lines.length, 1);
    });

    // -- later slices append here --
  } finally {
    await admin.end();
  }
});
