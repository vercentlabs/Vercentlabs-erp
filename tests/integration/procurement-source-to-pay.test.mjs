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

    // ---- sourcing: RFQ -> invitations -> bids -> evaluations -> award -> PO ----
    async function activeSupplier(code) {
      let sup = await tx((c) => createProcurementRecord(c, ctx.buyer, "suppliers", { supplierCode: code, legalName: `${code} Ltd`, currencyCode: "INR" }));
      sup = await tx((c) => transitionProcurementRecord(c, ctx.buyer, "suppliers", sup.id, "submit", { expectedVersion: sup.version }));
      sup = await tx((c) => transitionProcurementRecord(c, ctx.manager, "suppliers", sup.id, "qualify", { expectedVersion: sup.version }));
      return tx((c) => transitionProcurementRecord(c, ctx.manager, "suppliers", sup.id, "activate", { expectedVersion: sup.version }));
    }
    const lines = (quantity, price) => [{ itemId, description: "Raw Widget", quantity, unitPrice: price, warehouseId }];
    let rfq;
    let supplierB;
    let bidA;
    let bidB;
    let award;
    await t.test("F069/F070: an RFQ is created, approved by someone else, activated and invited to several suppliers", async () => {
      supplierB = await activeSupplier("SUP-002");
      rfq = await tx((c) => createProcurementRecord(c, ctx.buyer, "sourcing-events", { title: "Widget RFQ", eventType: "rfq", bidCloseAt: "2026-12-01", requisitionId: requisition.id, lines: lines("10", "0") }));
      assert.match(rfq.eventNumber, /^RFQ-/);
      await assert.rejects(() => tx((c) => createProcurementRecord(c, ctx.requester, "sourcing-events", { title: "x", bidCloseAt: "2026-12-01" })), forbidden);
      let r = await tx((c) => transitionProcurementRecord(c, ctx.buyer, "sourcing-events", rfq.id, "submit", { expectedVersion: rfq.version }));
      await assert.rejects(() => tx((c) => transitionProcurementRecord(c, ctx.buyer, "sourcing-events", rfq.id, "approve", { expectedVersion: r.version })), (e) => e.code === "PROCUREMENT_SELF_APPROVAL");
      r = await tx((c) => transitionProcurementRecord(c, ctx.manager, "sourcing-events", rfq.id, "approve", { expectedVersion: r.version }));
      r = await tx((c) => transitionProcurementRecord(c, ctx.buyer, "sourcing-events", rfq.id, "activate", { expectedVersion: r.version }));
      assert.equal(r.status, "active");
      rfq = r;
      for (const sup of [supplier, supplierB]) {
        await tx((c) => createProcurementRecord(c, ctx.buyer, "sourcing-invitations", { parentId: rfq.id, supplierId: sup.id }));
      }
      const invitations = await tx((c) => listProcurementRecords(c, ctx.viewer, "sourcing-invitations", { parentId: rfq.id }));
      assert.equal(invitations.total, 2, "the same RFQ went to multiple vendors");
    });

    await t.test("F071/F072: supplier quotations are captured as bids; evaluations score them", async () => {
      bidA = await tx((c) => createProcurementRecord(c, ctx.buyer, "sourcing-bids", { parentId: rfq.id, supplierId: supplier.id, quotationNumber: "Q-A", currencyCode: "INR", leadTimeDays: 14, lines: lines("10", "100") }));
      bidB = await tx((c) => createProcurementRecord(c, ctx.buyer, "sourcing-bids", { parentId: rfq.id, supplierId: supplierB.id, quotationNumber: "Q-B", currencyCode: "INR", leadTimeDays: 7, lines: lines("10", "110") }));
      await tx((c) => createProcurementRecord(c, ctx.manager, "sourcing-evaluations", { parentId: rfq.id, bidId: bidA.id, criterion: "price", score: 90, weight: 50 }));
      await tx((c) => createProcurementRecord(c, ctx.manager, "sourcing-evaluations", { parentId: rfq.id, bidId: bidB.id, criterion: "delivery", score: 95, weight: 50 }));
      await assert.rejects(() => tx((c) => createProcurementRecord(c, ctx.viewer, "sourcing-bids", { parentId: rfq.id, supplierId: supplier.id })), forbidden);
      await assert.rejects(() => tx((c) => createProcurementRecord(c, ctx.requester, "sourcing-evaluations", { parentId: rfq.id, bidId: bidA.id, criterion: "price", score: 1 })), forbidden);
      const detail = await tx((c) => getProcurementRecord(c, ctx.viewer, "sourcing-events", rfq.id));
      assert.equal(detail.bids.length, 2);
      assert.equal(detail.evaluations.length, 2);
    });

    await t.test("F073: only a holder of sourcing.award can award; the award creates a draft PO and closes the RFQ, once", async () => {
      const input = { expectedVersion: rfq.version, selectedBidId: bidB.id, awardType: "purchase-order", expectedDeliveryDate: "2026-12-20", lines: lines("10", "110") };
      await assert.rejects(() => tx((c) => proc.awardSourcingEvent(c, ctx.buyer, rfq.id, input)), forbidden);
      award = await tx((c) => proc.awardSourcingEvent(c, ctx.manager, rfq.id, input));
      assert.equal(award.sourceEvent.status, "closed");
      assert.equal(award.award.status, "draft");
      assert.equal(award.award.supplierId, supplierB.id, "the PO goes to the winning bidder");
      assert.equal(award.award.totals.grandTotal, "1100.00");
      await assert.rejects(() => tx((c) => proc.awardSourcingEvent(c, ctx.manager, rfq.id, { ...input, expectedVersion: award.sourceEvent.version })), (e) => e.status === 409, "an RFQ is awarded once");
    });

    let order;
    await t.test("F074/F075: PO submit -> approve (not by its creator) -> dispatch -> acknowledge", async () => {
      order = award.award;
      let o = await tx((c) => transitionProcurementRecord(c, ctx.manager, "purchase-orders", order.id, "submit", { expectedVersion: order.version }));
      await assert.rejects(() => tx((c) => transitionProcurementRecord(c, ctx.manager, "purchase-orders", order.id, "approve", { expectedVersion: o.version })), (e) => e.code === "PROCUREMENT_SELF_APPROVAL");
      await assert.rejects(() => tx((c) => transitionProcurementRecord(c, ctx.buyer, "purchase-orders", order.id, "approve", { expectedVersion: o.version })), forbidden);
      o = await tx((c) => transitionProcurementRecord(c, ctx.approver, "purchase-orders", order.id, "approve", { expectedVersion: o.version }));
      await assert.rejects(() => tx((c) => transitionProcurementRecord(c, ctx.approver, "purchase-orders", order.id, "dispatch", { expectedVersion: o.version })), forbidden, "dispatch needs po.dispatch");
      o = await tx((c) => transitionProcurementRecord(c, ctx.buyer, "purchase-orders", order.id, "dispatch", { expectedVersion: o.version }));
      o = await tx((c) => transitionProcurementRecord(c, ctx.buyer, "purchase-orders", order.id, "acknowledge", { expectedVersion: o.version }));
      assert.equal(o.status, "acknowledged");
      order = o;
    });

    await t.test("F076: amending an issued PO is a versioned change approved by a different person", async () => {
      await assert.rejects(() => tx((c) => transitionProcurementRecord(c, ctx.buyer, "purchase-orders", order.id, "amend", { expectedVersion: order.version, title: order.title, supplierId: order.supplierId, expectedDeliveryDate: order.expectedDeliveryDate, lines: lines("8", "110") })), (e) => /reason/i.test(e.message));
      const amended = await tx((c) => transitionProcurementRecord(c, ctx.buyer, "purchase-orders", order.id, "amend", { expectedVersion: order.version, reason: "Customer needs fewer", title: order.title, supplierId: order.supplierId, expectedDeliveryDate: order.expectedDeliveryDate, lines: lines("8", "110") }));
      assert.equal(amended.status, "pending_amendment_approval");
      assert.equal(amended.totals.grandTotal, "880.00");
      await assert.rejects(() => tx((c) => transitionProcurementRecord(c, ctx.buyer, "purchase-orders", order.id, "approve-amendment", { expectedVersion: amended.version })), forbidden);
      // a manager who holds both amend and approve cannot approve their OWN amendment
      const amendSelf = await tx((c) => transitionProcurementRecord(c, ctx.manager, "purchase-orders", order.id, "reject-amendment", { expectedVersion: amended.version, reason: "Try again" }));
      assert.equal(amendSelf.status, "acknowledged", "rejecting restores the original");
      assert.equal(amendSelf.totals.grandTotal, "1100.00");
      const second = await tx((c) => transitionProcurementRecord(c, ctx.manager, "purchase-orders", order.id, "amend", { expectedVersion: amendSelf.version, reason: "Reduce quantity", title: order.title, supplierId: order.supplierId, expectedDeliveryDate: order.expectedDeliveryDate, lines: lines("8", "110") }));
      await assert.rejects(() => tx((c) => transitionProcurementRecord(c, ctx.manager, "purchase-orders", order.id, "approve-amendment", { expectedVersion: second.version })), (e) => e.code === "PROCUREMENT_SELF_APPROVAL");
      const approved = await tx((c) => transitionProcurementRecord(c, ctx.approver, "purchase-orders", order.id, "approve-amendment", { expectedVersion: second.version, reason: "OK" }));
      assert.equal(approved.status, "acknowledged");
      assert.equal(approved.totals.grandTotal, "880.00");
      assert.ok(approved.amendments.length >= 2, "amendment history is kept");
      order = approved;
    });

    await t.test("F074: cancelling needs a reason and the po.cancel permission; a received PO cannot be cancelled", async () => {
      const spare = await tx((c) => createProcurementRecord(c, ctx.buyer, "purchase-orders", { title: "Spare PO", supplierId: supplier.id, expectedDeliveryDate: "2026-12-30", lines: lines("1", "50") }));
      await assert.rejects(() => tx((c) => transitionProcurementRecord(c, ctx.buyer, "purchase-orders", spare.id, "cancel", { expectedVersion: spare.version })), (e) => /reason/i.test(e.message));
      await assert.rejects(() => tx((c) => transitionProcurementRecord(c, ctx.approver, "purchase-orders", spare.id, "cancel", { expectedVersion: spare.version, reason: "x" })), forbidden);
      const cancelled = await tx((c) => transitionProcurementRecord(c, ctx.buyer, "purchase-orders", spare.id, "cancel", { expectedVersion: spare.version, reason: "Not needed" }));
      assert.equal(cancelled.status, "cancelled");
      await assert.rejects(() => tx((c) => transitionProcurementRecord(c, ctx.buyer, "purchase-orders", order.id, "cancel", { expectedVersion: order.version, reason: "x" })), (e) => e.code === "PROCUREMENT_INVALID_TRANSITION", "an acknowledged PO cannot simply be cancelled");
    });

    await t.test("F077/F078: agreements need approval by a contracts approver, then bind a PO to the contract", async () => {
      let a = await tx((c) => createProcurementRecord(c, ctx.buyer, "agreements", { title: "Annual widget contract", supplierId: supplier.id, validFrom: "2026-01-01", validUntil: "2026-12-31", agreementType: "blanket", lines: lines("1000", "95") }));
      assert.match(a.agreementNumber, /^AGR-/);
      a = await tx((c) => transitionProcurementRecord(c, ctx.buyer, "agreements", a.id, "submit", { expectedVersion: a.version }));
      await assert.rejects(() => tx((c) => transitionProcurementRecord(c, ctx.buyer, "agreements", a.id, "approve", { expectedVersion: a.version })), forbidden, "buyers hold contracts.manage, not contracts.approve");
      a = await tx((c) => transitionProcurementRecord(c, ctx.approver, "agreements", a.id, "approve", { expectedVersion: a.version }));
      a = await tx((c) => transitionProcurementRecord(c, ctx.buyer, "agreements", a.id, "activate", { expectedVersion: a.version }));
      assert.equal(a.status, "active");
      const call = await tx((c) => createProcurementRecord(c, ctx.buyer, "purchase-orders", { title: "Call-off", supplierId: supplier.id, agreementId: a.id, expectedDeliveryDate: "2026-11-01", lines: lines("50", "95") }));
      assert.equal(call.agreementId, a.id);
      const report = await tx((c) => proc.getProcurementReport(c, ctx.buyer, "agreement-consumption"));
      assert.ok(report.rows.some((row) => row.dimension_value === a.id), "consumption against the agreement is reported");
      await assert.rejects(() => tx((c) => transitionProcurementRecord(c, ctx.buyer, "agreements", a.id, "cancel", { expectedVersion: a.version })), (e) => /reason|Cannot/i.test(e.message));
    });

    // -- later slices append here --
  } finally {
    await admin.end();
  }
});
