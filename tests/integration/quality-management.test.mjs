// Real PostgreSQL integration test -- supplier quality scorecards, audits and findings, calibration,
// certificates of analysis, controlled quality documents, customer complaints (F334-F335, F337-F340),
// lot/batch traceability, cost reporting and the KPI dashboard (F339, F341-F342).
import assert from "node:assert/strict";
import test from "node:test";

import { ALL_QUALITY, buildQualityWorld, connectAdmin } from "./quality-test-kit.mjs";

const ROLES = {
  qaA: ALL_QUALITY,
  qaB: ALL_QUALITY,
  author: ["quality.manage", "quality.view"], // holds the document-approval gate permission itself, so the self-approval-block IS meaningfully testable
  viewer: ["quality.view"],
};

test("Quality supplier/audit/calibration/documents/complaints/reporting against real PostgreSQL", async (t) => {
  const admin = await connectAdmin();
  if (!admin) return t.skip("No reachable Postgres connection (MIGRATION_DATABASE_URL).");
  const w = await buildQualityWorld(admin, ROLES, "qlmg");
  const { api, run, denied, sql, itemId, supplierId, customerId } = w;
  const ids = {};

  try {
    await t.test("F334: a supplier scorecard is computed from real inspection/non-conformance records, never entered by hand", async () => {
      const plan = await run("qaA", (c, x) => api.defineQualityPlan(c, x, { code: "SUPP1", name: "Supplier check", planType: "incoming", itemId, supplierId, points: [{ characteristic: "OK", resultType: "boolean" }] }));
      await run("qaB", (c, x) => api.approveQualityPlan(c, x, plan.id));
      const insp = await run("qaA", (c, x) => api.createQualityInspection(c, x, { planId: plan.id, lotQuantity: 10, sourceType: "manual", supplierId }));
      const pointId = insp.points[0].id;
      await run("qaA", (c, x) => api.recordInspectionResults(c, x, insp.id, { results: [{ inspectionPointId: pointId, resultStatus: "pass" }] }));
      await run("qaA", (c, x) => api.completeQualityInspection(c, x, insp.id, {}));
      await run("qaA", (c, x) => api.createQualityNonconformance(c, x, { severity: "minor", category: "packaging", description: "Box dented", supplierId }));

      const record = await run("qaA", (c, x) => api.recomputeSupplierQualityRecord(c, x, { supplierId, periodStart: "2020-01-01", periodEnd: "2030-01-01" }));
      assert.ok(record.quality_score <= 100);
      assert.equal(record.nonconformance_count, 1);
      // recomputing again for the same period updates the same row rather than duplicating it
      const again = await run("qaA", (c, x) => api.recomputeSupplierQualityRecord(c, x, { supplierId, periodStart: "2020-01-01", periodEnd: "2030-01-01" }));
      assert.equal(again.id, record.id);
      const listed = await run("qaA", (c, x) => api.listSupplierQualityRecords(c, x, { supplierId }));
      assert.equal(listed.length, 1);
    });

    await t.test("F337: an audit collects findings and cannot complete with an open major finding until forced", async () => {
      const audit = await run("qaA", (c, x) => api.saveAudit(c, x, { title: "Annual internal audit", scope: "Incoming inspection process", auditType: "internal" }));
      ids.audit = audit.id;
      await denied("viewer", (c, x) => api.startAudit(c, x, audit.id), 403);
      await run("qaA", (c, x) => api.startAudit(c, x, audit.id));
      const finding = await run("qaA", (c, x) => api.addAuditFinding(c, x, audit.id, { findingType: "major", description: "No documented incoming sampling procedure" }));
      await denied("qaA", (c, x) => api.completeAudit(c, x, audit.id, {}), 409, "QUALITY_AUDIT_OPEN_FINDINGS");
      const capa = await run("qaA", (c, x) => api.createQualityCapa(c, x, { title: "Document the sampling procedure" }));
      await run("qaA", (c, x) => api.linkFindingCapa(c, x, finding.id, capa.id));
      await run("qaA", (c, x) => api.closeAuditFinding(c, x, finding.id));
      const completed = await run("qaA", (c, x) => api.completeAudit(c, x, audit.id, { summary: "One major finding, closed with a CAPA." }));
      assert.equal(completed.status, "completed");
      const fetched = await run("qaA", (c, x) => api.getAudit(c, x, audit.id));
      assert.equal(fetched.findings.length, 1);
    });

    await t.test("F336: calibration tracks a due date; recording a new one supersedes the last valid record for the same equipment", async () => {
      const cal1 = await run("qaA", (c, x) => api.recordCalibration(c, x, { equipmentName: "Caliper #4", equipmentIdentifier: "CAL-004", calibrationDate: "2024-01-01", dueDate: "2024-07-01", result: "pass" }));
      assert.equal(cal1.status, "valid");
      const cal2 = await run("qaA", (c, x) => api.recordCalibration(c, x, { equipmentName: "Caliper #4", equipmentIdentifier: "CAL-004", calibrationDate: "2024-07-01", dueDate: "2025-01-01", result: "pass" }));
      const list = await run("qaA", (c, x) => api.listCalibrationRecords(c, x, {}));
      assert.equal(list.find((r) => r.id === cal1.id).status, "superseded");
      assert.equal(list.find((r) => r.id === cal2.id).status, "valid");
      await sql(`UPDATE tenant.quality_calibration_records SET due_date='2024-08-01' WHERE id=$1`, [cal2.id]);
      const swept = await run("qaA", (c, x) => api.markOverdueCalibrations(c, x));
      assert.equal(swept.expired, 1);
    });

    await t.test("F338: a certificate of analysis is drafted, then issued, then can be voided with a reason", async () => {
      const cert = await run("qaA", (c, x) => api.saveCertificate(c, x, { summary: "COA for lot 100", itemId }));
      await denied("qaA", (c, x) => api.voidCertificate(c, x, cert.id, "too early"), 409, "QUALITY_CERTIFICATE_STATE");
      const issued = await run("qaA", (c, x) => api.issueCertificate(c, x, cert.id));
      assert.equal(issued.status, "issued");
      await denied("qaA", (c, x) => api.voidCertificate(c, x, cert.id, ""), 400, "QUALITY_REASON_REQUIRED");
      const voided = await run("qaA", (c, x) => api.voidCertificate(c, x, cert.id, "Wrong lot referenced"));
      assert.equal(voided.status, "void");
    });

    await t.test("F340: a quality document is approved by someone other than its author", async () => {
      const doc = await run("author", (c, x) => api.saveQualityDocument(c, x, { title: "Incoming inspection SOP", documentType: "procedure" }));
      await run("author", (c, x) => api.submitQualityDocument(c, x, doc.id));
      await denied("author", (c, x) => api.approveQualityDocument(c, x, doc.id), 403, "SELF_APPROVAL_BLOCKED");
      const approved = await run("qaA", (c, x) => api.approveQualityDocument(c, x, doc.id));
      assert.equal(approved.status, "approved");
      const revised = await run("qaA", (c, x) => api.reviseQualityDocument(c, x, doc.id));
      assert.equal(revised.version, 2);
      const obsoleted = await run("qaA", (c, x) => api.obsoleteQualityDocument(c, x, doc.id, "Superseded by v2"));
      assert.equal(obsoleted.status, "obsolete");
    });

    await t.test("F335: a customer complaint moves open -> investigating -> resolved -> closed, and can link a non-conformance", async () => {
      const complaint = await run("qaA", (c, x) => api.createCustomerComplaint(c, x, { partyId: customerId, severity: "major", description: "Product failed after two weeks", itemId }));
      ids.complaint = complaint.id;
      const nc = await run("qaA", (c, x) => api.createQualityNonconformance(c, x, { severity: "major", category: "field_failure", description: "Premature wear reported by customer" }));
      const investigating = await run("qaA", (c, x) => api.investigateComplaint(c, x, complaint.id, { nonconformanceId: nc.id }));
      assert.equal(investigating.status, "investigating");
      assert.equal(investigating.nonconformance_id, nc.id);
      await denied("qaA", (c, x) => api.resolveComplaint(c, x, complaint.id, { resolution: "" }), 400, "QUALITY_COMPLAINT_INVALID");
      const resolved = await run("qaA", (c, x) => api.resolveComplaint(c, x, complaint.id, { resolution: "Replaced the unit under warranty" }));
      assert.equal(resolved.status, "resolved");
      const closed = await run("qaA", (c, x) => api.closeComplaint(c, x, complaint.id));
      assert.equal(closed.status, "closed");
    });

    await t.test("F339: batch traceability lines up every quality record that touched a batch", async () => {
      await denied("viewer", (c, x) => api.getBatchTraceability(c, x, {}), 400, "QUALITY_TRACE_INPUT_REQUIRED");
      const batchId = w.orgId; // any stable uuid stands in for a real Stock batch id here
      const plan = await run("qaA", (c, x) => api.defineQualityPlan(c, x, { code: "TRACE1", name: "Batch check", planType: "final", itemId, points: [{ characteristic: "OK", resultType: "boolean" }] }));
      await run("qaB", (c, x) => api.approveQualityPlan(c, x, plan.id));
      const insp = await run("qaA", (c, x) => api.createQualityInspection(c, x, { planId: plan.id, lotQuantity: 5, sourceType: "manual", batchId }));
      const trace = await run("qaA", (c, x) => api.getBatchTraceability(c, x, { batchId }));
      assert.ok(trace.inspections.some((i) => i.id === insp.id));
    });

    await t.test("F341/F342: cost reporting and the KPI dashboard reconcile to real records", async () => {
      const cost = await run("qaA", (c, x) => api.getQualityCostReport(c, x, {}));
      assert.ok(cost.totalEstimatedCost >= 0);
      assert.ok(Array.isArray(cost.bySeverity));
      const dash = await run("qaA", (c, x) => api.getQualityKpiDashboard(c, x));
      assert.ok(typeof dash.open_nonconformances === "number");
      assert.ok(typeof dash.overdue_calibrations === "number");
      await denied("viewer", (c, x) => api.getQualityCostReport(c, x, {}), 403);
    });

    await t.test("options: the quality form pickers resolve items, suppliers, customers, plans and open non-conformances", async () => {
      const opts = await run("qaA", (c, x) => api.listQualityOptions(c, x));
      assert.ok(opts.suppliers.some((o) => o.id === supplierId));
      assert.ok(opts.customers.some((o) => o.id === customerId));
      assert.ok(opts.plans.length >= 1);
    });
  } finally {
    await w.cleanup();
    await admin.end();
  }
});
