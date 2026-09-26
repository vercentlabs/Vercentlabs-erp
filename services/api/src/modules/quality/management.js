// F334-F342: supplier quality scorecards, quality audits and findings, calibration of measuring
// equipment, certificates of analysis, controlled quality documents, customer quality complaints
// (optionally linked to a real Support ticket), lot/batch traceability, cost reporting and the KPI
// dashboard.
import { QualityError, dateOrNull, dateRequired, has, need, needAny, oneOf, qx, recordEvent, round2, seq, text, textOrNull, uuid, uuidOrNull } from "./common.js";
import { nextDocumentNumber } from "../../core/platform/numbering/index.js";

const MANAGE = "quality.manage";
const VIEW = ["quality.view", MANAGE];
const REPORTS = ["quality.reports.view", MANAGE];

// ---------------------------------------------------------------- F334: supplier quality
export async function listSupplierQualityRecords(client, c, filters = {}) {
  needAny(c, VIEW);
  const params = [c.organizationId, c.companyId];
  let where = "";
  if (filters.supplierId) { params.push(uuid(filters.supplierId, "Supplier")); where += ` AND supplier_id=$${params.length}`; }
  const { rows } = await qx(client, `SELECT r.*, party.display_name AS supplier_name FROM tenant.quality_supplier_records r LEFT JOIN tenant.business_parties party ON party.id=r.supplier_id WHERE r.organization_id=$1 AND r.company_id=$2${where} ORDER BY r.period_start DESC LIMIT 500`, params);
  return rows;
}
// Recomputes (or creates) a supplier's scorecard for a period from real inspection/non-conformance
// data -- never entered by hand, so the score always reconciles to the records behind it.
export async function recomputeSupplierQualityRecord(client, c, input) {
  need(c, "quality.supplier.manage");
  const supplierId = uuid(input.supplierId, "Supplier");
  const periodStart = dateRequired(input.periodStart, "Period start");
  const periodEnd = dateRequired(input.periodEnd, "Period end");
  if (periodEnd < periodStart) throw new QualityError(400, "The period end is before its start.", "QUALITY_PERIOD_INVALID");
  const insp = await qx(client, `SELECT count(*)::int AS inspected_count, coalesce(sum(accepted_quantity),0) AS accepted, coalesce(sum(rejected_quantity),0) AS rejected
    FROM tenant.quality_inspections WHERE organization_id=$1 AND company_id=$2 AND supplier_id=$3 AND created_at::date BETWEEN $4 AND $5 AND status IN ('passed','failed','conditionally_accepted')`, [c.organizationId, c.companyId, supplierId, periodStart, periodEnd]);
  const nc = await qx(client, `SELECT count(*)::int AS n, count(*) FILTER (WHERE severity='critical')::int AS critical FROM tenant.quality_nonconformances WHERE organization_id=$1 AND company_id=$2 AND supplier_id=$3 AND created_at::date BETWEEN $4 AND $5`, [c.organizationId, c.companyId, supplierId, periodStart, periodEnd]);
  const accepted = Number(insp.rows[0].accepted);
  const rejected = Number(insp.rows[0].rejected);
  const total = accepted + rejected;
  const acceptanceScore = total > 0 ? (accepted / total) * 100 : 100;
  const ncPenalty = Math.min(Number(nc.rows[0].n) * 2 + Number(nc.rows[0].critical) * 5, 40);
  const score = round2(Math.max(acceptanceScore - ncPenalty, 0));
  const status = score >= 90 ? "qualified" : score >= 70 ? "conditional" : "blocked";
  const { rows } = await qx(client, `INSERT INTO tenant.quality_supplier_records(organization_id,company_id,supplier_id,period_start,period_end,receipts_count,inspected_count,accepted_quantity,rejected_quantity,nonconformance_count,critical_nonconformance_count,quality_score,status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
    ON CONFLICT (organization_id,supplier_id,period_start,period_end) DO UPDATE SET receipts_count=EXCLUDED.receipts_count,inspected_count=EXCLUDED.inspected_count,accepted_quantity=EXCLUDED.accepted_quantity,rejected_quantity=EXCLUDED.rejected_quantity,nonconformance_count=EXCLUDED.nonconformance_count,critical_nonconformance_count=EXCLUDED.critical_nonconformance_count,quality_score=EXCLUDED.quality_score,status=EXCLUDED.status RETURNING *`,
    [c.organizationId, c.companyId, supplierId, periodStart, periodEnd, Number(insp.rows[0].inspected_count), Number(insp.rows[0].inspected_count), String(accepted), String(rejected), Number(nc.rows[0].n), Number(nc.rows[0].critical), String(score), status]);
  return rows[0];
}

// ---------------------------------------------------------------- F337: quality audits
export async function listAudits(client, c, filters = {}) {
  needAny(c, VIEW);
  const params = [c.organizationId, c.companyId];
  let where = "";
  if (filters.status) { params.push(String(filters.status)); where += ` AND status=$${params.length}`; }
  const { rows } = await qx(client, `SELECT a.*, (SELECT count(*)::int FROM tenant.quality_audit_findings f WHERE f.audit_id=a.id) AS finding_total FROM tenant.quality_audits a WHERE a.organization_id=$1 AND a.company_id=$2${where} ORDER BY a.planned_date DESC NULLS LAST LIMIT 500`, params);
  return rows;
}
export async function getAudit(client, c, id) {
  needAny(c, VIEW);
  const audit = (await qx(client, `SELECT * FROM tenant.quality_audits WHERE organization_id=$1 AND company_id=$2 AND id=$3`, [c.organizationId, c.companyId, uuid(id, "Audit")])).rows[0];
  if (!audit) throw new QualityError(404, "Audit was not found.", "QUALITY_AUDIT_NOT_FOUND");
  const findings = await qx(client, `SELECT * FROM tenant.quality_audit_findings WHERE organization_id=$1 AND audit_id=$2 ORDER BY finding_number`, [c.organizationId, audit.id]);
  return { ...audit, findings: findings.rows };
}
const AUDIT_TYPES = ["internal", "supplier", "process", "product", "system", "compliance"];
export async function saveAudit(client, c, input) {
  need(c, "quality.audit.manage");
  const title = text(input.title, 200);
  const scope = text(input.scope, 1000);
  if (!title || !scope) throw new QualityError(400, "An audit needs a title and a scope.", "QUALITY_AUDIT_INVALID");
  const auditType = oneOf(String(input.auditType ?? "internal"), AUDIT_TYPES, "Audit type");
  if (input.id) {
    const { rows } = await qx(client, `UPDATE tenant.quality_audits SET title=$4,scope=$5,audit_type=$6,planned_date=$7,lead_auditor_user_id=$8,updated_at=now() WHERE organization_id=$1 AND company_id=$2 AND id=$3 AND status='planned' RETURNING *`,
      [c.organizationId, c.companyId, uuid(input.id, "Audit"), title, scope, auditType, dateOrNull(input.plannedDate, "Planned date"), uuidOrNull(input.leadAuditorUserId, "Lead auditor")]);
    if (!rows[0]) throw new QualityError(409, "Only a planned audit can be edited.", "QUALITY_AUDIT_STATE");
    return rows[0];
  }
  const number = await nextDocumentNumber(client, c, { documentType: "quality_audit", prefix: "QA" });
  const { rows } = await qx(client, `INSERT INTO tenant.quality_audits(organization_id,company_id,audit_number,audit_type,title,scope,planned_date,lead_auditor_user_id,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [c.organizationId, c.companyId, number, auditType, title, scope, dateOrNull(input.plannedDate, "Planned date"), uuidOrNull(input.leadAuditorUserId, "Lead auditor"), c.userId]);
  return rows[0];
}
export async function startAudit(client, c, id) {
  need(c, "quality.audit.manage");
  const { rows } = await qx(client, `UPDATE tenant.quality_audits SET status='in_progress',updated_at=now() WHERE organization_id=$1 AND company_id=$2 AND id=$3 AND status='planned' RETURNING *`, [c.organizationId, c.companyId, uuid(id, "Audit")]);
  if (!rows[0]) throw new QualityError(409, "Only a planned audit can start.", "QUALITY_AUDIT_STATE");
  return rows[0];
}
export async function addAuditFinding(client, c, auditId, input) {
  need(c, "quality.audit.manage");
  const description = text(input.description, 2000);
  if (!description) throw new QualityError(400, "Describe the finding.", "QUALITY_FINDING_INVALID");
  const audit = (await qx(client, `SELECT * FROM tenant.quality_audits WHERE organization_id=$1 AND company_id=$2 AND id=$3 FOR UPDATE`, [c.organizationId, c.companyId, uuid(auditId, "Audit")])).rows[0];
  if (!audit) throw new QualityError(404, "Audit was not found.", "QUALITY_AUDIT_NOT_FOUND");
  if (audit.status !== "in_progress") throw new QualityError(409, "Findings are added while the audit is in progress.", "QUALITY_AUDIT_STATE");
  const findingType = oneOf(String(input.findingType ?? "observation"), ["observation", "minor", "major", "opportunity"], "Finding type");
  const seqNo = (await qx(client, `SELECT count(*)::int + 1 AS n FROM tenant.quality_audit_findings WHERE audit_id=$1`, [audit.id])).rows[0].n;
  const { rows } = await qx(client, `INSERT INTO tenant.quality_audit_findings(organization_id,audit_id,finding_number,finding_type,clause_reference,description,owner_user_id,due_date) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [c.organizationId, audit.id, `${audit.audit_number}-F${seqNo}`, findingType, textOrNull(input.clauseReference, 60), description, uuidOrNull(input.ownerUserId, "Owner"), dateOrNull(input.dueDate, "Due date")]);
  await qx(client, `UPDATE tenant.quality_audits SET findings_count=findings_count+1,major_findings_count=major_findings_count+CASE WHEN $2='major' THEN 1 ELSE 0 END WHERE id=$1`, [audit.id, findingType]);
  return rows[0];
}
export async function linkFindingCapa(client, c, findingId, capaId) {
  need(c, "quality.audit.manage");
  const { rows } = await qx(client, `UPDATE tenant.quality_audit_findings SET capa_id=$2,status='action_in_progress' WHERE organization_id=$1 AND id=$3 RETURNING *`, [c.organizationId, uuid(capaId, "CAPA"), uuid(findingId, "Finding")]);
  if (!rows[0]) throw new QualityError(404, "Finding was not found.", "QUALITY_FINDING_NOT_FOUND");
  return rows[0];
}
export async function closeAuditFinding(client, c, findingId) {
  need(c, "quality.audit.manage");
  const { rows } = await qx(client, `UPDATE tenant.quality_audit_findings SET status='closed' WHERE organization_id=$1 AND id=$2 RETURNING *`, [c.organizationId, uuid(findingId, "Finding")]);
  if (!rows[0]) throw new QualityError(404, "Finding was not found.", "QUALITY_FINDING_NOT_FOUND");
  return rows[0];
}
export async function completeAudit(client, c, id, input = {}) {
  need(c, "quality.audit.manage");
  const audit = (await qx(client, `SELECT * FROM tenant.quality_audits WHERE organization_id=$1 AND company_id=$2 AND id=$3 FOR UPDATE`, [c.organizationId, c.companyId, uuid(id, "Audit")])).rows[0];
  if (!audit) throw new QualityError(404, "Audit was not found.", "QUALITY_AUDIT_NOT_FOUND");
  if (audit.status !== "in_progress") throw new QualityError(409, "Only an in-progress audit can be completed.", "QUALITY_AUDIT_STATE");
  const open = await qx(client, `SELECT count(*)::int AS n FROM tenant.quality_audit_findings WHERE audit_id=$1 AND finding_type='major' AND status<>'closed'`, [audit.id]);
  if (open.rows[0].n > 0 && input.force !== true) throw new QualityError(409, `${open.rows[0].n} major finding(s) are still open. Close them, or force-complete with a reason.`, "QUALITY_AUDIT_OPEN_FINDINGS");
  const { rows } = await qx(client, `UPDATE tenant.quality_audits SET status='completed',completed_date=current_date,summary=$2,updated_at=now() WHERE id=$1 RETURNING *`, [audit.id, textOrNull(input.summary, 4000)]);
  await recordEvent(client, c, "audit", audit.id, "quality.audit.completed", {});
  return rows[0];
}

// ---------------------------------------------------------------- F336: calibration
export async function listCalibrationRecords(client, c, filters = {}) {
  needAny(c, VIEW);
  const params = [c.organizationId, c.companyId];
  let where = "";
  if (filters.status) { params.push(String(filters.status)); where += ` AND status=$${params.length}`; }
  const { rows } = await qx(client, `SELECT * FROM tenant.quality_calibration_records WHERE organization_id=$1 AND company_id=$2${where} ORDER BY due_date LIMIT 1000`, params);
  return rows;
}
export async function recordCalibration(client, c, input) {
  need(c, "quality.manage");
  const equipmentName = text(input.equipmentName, 200);
  if (!equipmentName) throw new QualityError(400, "Name the equipment calibrated.", "QUALITY_CALIBRATION_INVALID");
  const calibrationDate = dateRequired(input.calibrationDate, "Calibration date");
  const dueDate = dateRequired(input.dueDate, "Next due date");
  if (dueDate < calibrationDate) throw new QualityError(400, "The next due date is before the calibration date.", "QUALITY_CALIBRATION_INVALID");
  const number = await nextDocumentNumber(client, c, { documentType: "quality_calibration", prefix: "CAL" });
  // supersede any earlier still-valid record for the same equipment
  await qx(client, `UPDATE tenant.quality_calibration_records SET status='superseded' WHERE organization_id=$1 AND company_id=$2 AND status='valid' AND ((asset_id IS NOT NULL AND asset_id=$3) OR (asset_id IS NULL AND equipment_identifier=$4 AND equipment_identifier IS NOT NULL))`,
    [c.organizationId, c.companyId, uuidOrNull(input.assetId, "Asset"), textOrNull(input.equipmentIdentifier, 100)]);
  const { rows } = await qx(client, `INSERT INTO tenant.quality_calibration_records(organization_id,company_id,calibration_number,asset_id,equipment_name,equipment_identifier,calibration_date,due_date,standard_used,performed_by_text,result,certificate_reference,notes,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
    [c.organizationId, c.companyId, number, uuidOrNull(input.assetId, "Asset"), equipmentName, textOrNull(input.equipmentIdentifier, 100), calibrationDate, dueDate, textOrNull(input.standardUsed, 200), textOrNull(input.performedByText, 200), oneOf(String(input.result ?? "pass"), ["pass", "fail", "adjusted"], "Result"), textOrNull(input.certificateReference, 200), textOrNull(input.notes, 1000), c.userId]);
  await recordEvent(client, c, "calibration", rows[0].id, "quality.calibration.recorded", { equipmentName });
  return rows[0];
}
// A sweep marking valid records past their due date as expired -- idempotent, run on demand.
export async function markOverdueCalibrations(client, c) {
  need(c, MANAGE);
  const { rows } = await qx(client, `UPDATE tenant.quality_calibration_records SET status='expired' WHERE organization_id=$1 AND company_id=$2 AND status='valid' AND due_date < current_date RETURNING id`, [c.organizationId, c.companyId]);
  return { expired: rows.length };
}

// ---------------------------------------------------------------- F338: certificates of analysis
export async function listCertificates(client, c, filters = {}) {
  needAny(c, VIEW);
  const params = [c.organizationId, c.companyId];
  let where = "";
  if (filters.status) { params.push(String(filters.status)); where += ` AND status=$${params.length}`; }
  const { rows } = await qx(client, `SELECT * FROM tenant.quality_certificates WHERE organization_id=$1 AND company_id=$2${where} ORDER BY created_at DESC LIMIT 500`, params);
  return rows;
}
export async function saveCertificate(client, c, input) {
  need(c, MANAGE);
  const summary = text(input.summary, 500);
  if (!summary) throw new QualityError(400, "Summarise the certificate.", "QUALITY_CERTIFICATE_INVALID");
  if (input.id) {
    const { rows } = await qx(client, `UPDATE tenant.quality_certificates SET summary=$4,content=$5,item_id=$6,batch_id=$7,serial_id=$8,party_id=$9 WHERE organization_id=$1 AND company_id=$2 AND id=$3 AND status='draft' RETURNING *`,
      [c.organizationId, c.companyId, uuid(input.id, "Certificate"), summary, textOrNull(input.content, 8000), uuidOrNull(input.itemId, "Item"), uuidOrNull(input.batchId, "Batch"), uuidOrNull(input.serialId, "Serial"), uuidOrNull(input.partyId, "Party")]);
    if (!rows[0]) throw new QualityError(409, "Only a draft certificate can be edited.", "QUALITY_CERTIFICATE_STATE");
    return rows[0];
  }
  const number = await nextDocumentNumber(client, c, { documentType: "quality_certificate", prefix: "COA" });
  const { rows } = await qx(client, `INSERT INTO tenant.quality_certificates(organization_id,company_id,certificate_number,inspection_id,item_id,batch_id,serial_id,party_id,summary,content,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [c.organizationId, c.companyId, number, uuidOrNull(input.inspectionId, "Inspection"), uuidOrNull(input.itemId, "Item"), uuidOrNull(input.batchId, "Batch"), uuidOrNull(input.serialId, "Serial"), uuidOrNull(input.partyId, "Party"), summary, textOrNull(input.content, 8000), c.userId]);
  return rows[0];
}
export async function issueCertificate(client, c, id) {
  need(c, MANAGE);
  const { rows } = await qx(client, `UPDATE tenant.quality_certificates SET status='issued',issued_by=$2,issued_at=now() WHERE organization_id=$1 AND company_id=$3 AND id=$4 AND status='draft' RETURNING *`, [c.organizationId, c.userId, c.companyId, uuid(id, "Certificate")]);
  if (!rows[0]) throw new QualityError(409, "Only a draft certificate can be issued.", "QUALITY_CERTIFICATE_STATE");
  return rows[0];
}
export async function voidCertificate(client, c, id, reason) {
  need(c, MANAGE);
  if (!text(reason)) throw new QualityError(400, "Give a reason for voiding this certificate.", "QUALITY_REASON_REQUIRED");
  const { rows } = await qx(client, `UPDATE tenant.quality_certificates SET status='void',voided_reason=$2 WHERE organization_id=$1 AND id=$3 AND status='issued' RETURNING *`, [c.organizationId, text(reason, 500), uuid(id, "Certificate")]);
  if (!rows[0]) throw new QualityError(409, "Only an issued certificate can be voided.", "QUALITY_CERTIFICATE_STATE");
  return rows[0];
}

// ---------------------------------------------------------------- F340: quality documents
export async function listQualityDocuments(client, c, filters = {}) {
  needAny(c, VIEW);
  const params = [c.organizationId, c.companyId];
  let where = "";
  if (filters.status) { params.push(String(filters.status)); where += ` AND status=$${params.length}`; }
  const { rows } = await qx(client, `SELECT * FROM tenant.quality_documents WHERE organization_id=$1 AND company_id=$2${where} ORDER BY document_number, version DESC LIMIT 500`, params);
  return rows;
}
export async function saveQualityDocument(client, c, input) {
  need(c, MANAGE);
  const title = text(input.title, 200);
  if (!title) throw new QualityError(400, "A document needs a title.", "QUALITY_DOCUMENT_INVALID");
  const docType = oneOf(String(input.documentType ?? "procedure"), ["procedure", "work_instruction", "form", "specification", "policy", "other"], "Document type");
  if (input.id) {
    const cur = (await qx(client, `SELECT * FROM tenant.quality_documents WHERE organization_id=$1 AND company_id=$2 AND id=$3`, [c.organizationId, c.companyId, uuid(input.id, "Document")])).rows[0];
    if (!cur) throw new QualityError(404, "Document was not found.", "QUALITY_DOCUMENT_NOT_FOUND");
    if (cur.status === "approved") throw new QualityError(409, "An approved document is edited through a new version.", "QUALITY_DOCUMENT_STATE");
    const { rows } = await qx(client, `UPDATE tenant.quality_documents SET title=$2,document_type=$3,category=$4,content=$5,linked_plan_id=$6,updated_at=now() WHERE id=$1 RETURNING *`, [cur.id, title, docType, textOrNull(input.category, 100), textOrNull(input.content, 20000), uuidOrNull(input.linkedPlanId, "Plan")]);
    return rows[0];
  }
  const number = await nextDocumentNumber(client, c, { documentType: "quality_document", prefix: "QD" });
  const { rows } = await qx(client, `INSERT INTO tenant.quality_documents(organization_id,company_id,document_number,title,document_type,category,version,status,content,linked_plan_id,created_by) VALUES ($1,$2,$3,$4,$5,$6,1,'draft',$7,$8,$9) RETURNING *`,
    [c.organizationId, c.companyId, number, title, docType, textOrNull(input.category, 100), textOrNull(input.content, 20000), uuidOrNull(input.linkedPlanId, "Plan"), c.userId]);
  return rows[0];
}
export async function submitQualityDocument(client, c, id) {
  need(c, MANAGE);
  const { rows } = await qx(client, `UPDATE tenant.quality_documents SET status='review',updated_at=now() WHERE organization_id=$1 AND company_id=$2 AND id=$3 AND status='draft' RETURNING *`, [c.organizationId, c.companyId, uuid(id, "Document")]);
  if (!rows[0]) throw new QualityError(409, "Only a draft document can be submitted for review.", "QUALITY_DOCUMENT_STATE");
  return rows[0];
}
export async function approveQualityDocument(client, c, id) {
  need(c, MANAGE);
  const doc = (await qx(client, `SELECT * FROM tenant.quality_documents WHERE organization_id=$1 AND company_id=$2 AND id=$3 FOR UPDATE`, [c.organizationId, c.companyId, uuid(id, "Document")])).rows[0];
  if (!doc) throw new QualityError(404, "Document was not found.", "QUALITY_DOCUMENT_NOT_FOUND");
  if (doc.status !== "review") throw new QualityError(409, "Only a document submitted for review can be approved.", "QUALITY_DOCUMENT_STATE");
  if (doc.created_by === c.userId && !has(c, "quality.settings.manage")) throw new QualityError(403, "You cannot approve your own document.", "SELF_APPROVAL_BLOCKED");
  const { rows } = await qx(client, `UPDATE tenant.quality_documents SET status='approved',approved_by=$2,approved_at=now(),updated_at=now() WHERE id=$1 RETURNING *`, [doc.id, c.userId]);
  return rows[0];
}
export async function reviseQualityDocument(client, c, id) {
  need(c, MANAGE);
  const doc = (await qx(client, `SELECT * FROM tenant.quality_documents WHERE organization_id=$1 AND company_id=$2 AND id=$3`, [c.organizationId, c.companyId, uuid(id, "Document")])).rows[0];
  if (!doc) throw new QualityError(404, "Document was not found.", "QUALITY_DOCUMENT_NOT_FOUND");
  const { rows } = await qx(client, `INSERT INTO tenant.quality_documents(organization_id,company_id,document_number,title,document_type,category,version,status,content,linked_plan_id,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,'draft',$8,$9,$10) RETURNING *`,
    [c.organizationId, c.companyId, doc.document_number, doc.title, doc.document_type, doc.category, doc.version + 1, doc.content, doc.linked_plan_id, c.userId]);
  return rows[0];
}
export async function obsoleteQualityDocument(client, c, id, reason) {
  need(c, MANAGE);
  if (!text(reason)) throw new QualityError(400, "Give a reason.", "QUALITY_REASON_REQUIRED");
  const { rows } = await qx(client, `UPDATE tenant.quality_documents SET status='obsolete',updated_at=now() WHERE organization_id=$1 AND company_id=$2 AND id=$3 AND status='approved' RETURNING *`, [c.organizationId, c.companyId, uuid(id, "Document")]);
  if (!rows[0]) throw new QualityError(409, "Only an approved document can be made obsolete.", "QUALITY_DOCUMENT_STATE");
  return rows[0];
}

// ---------------------------------------------------------------- F335: customer quality complaints
export async function listCustomerComplaints(client, c, filters = {}) {
  needAny(c, VIEW);
  const params = [c.organizationId, c.companyId];
  let where = "";
  if (filters.status) { params.push(String(filters.status)); where += ` AND status=$${params.length}`; }
  const { rows } = await qx(client, `SELECT cc.*, party.display_name AS party_name FROM tenant.quality_customer_complaints cc LEFT JOIN tenant.business_parties party ON party.id=cc.party_id WHERE cc.organization_id=$1 AND cc.company_id=$2${where} ORDER BY cc.received_at DESC LIMIT 500`, params);
  return rows;
}
export async function getCustomerComplaint(client, c, id) {
  needAny(c, VIEW);
  const { rows } = await qx(client, `SELECT cc.*, party.display_name AS party_name FROM tenant.quality_customer_complaints cc LEFT JOIN tenant.business_parties party ON party.id=cc.party_id WHERE cc.organization_id=$1 AND cc.company_id=$2 AND cc.id=$3`, [c.organizationId, c.companyId, uuid(id, "Complaint")]);
  if (!rows[0]) throw new QualityError(404, "Complaint was not found.", "QUALITY_COMPLAINT_NOT_FOUND");
  return rows[0];
}
export async function createCustomerComplaint(client, c, input) {
  need(c, "quality.nonconformance.manage");
  const description = text(input.description, 4000);
  if (!description) throw new QualityError(400, "Describe the complaint.", "QUALITY_COMPLAINT_INVALID");
  const number = await nextDocumentNumber(client, c, { documentType: "quality_complaint", prefix: "CC" });
  const { rows } = await qx(client, `INSERT INTO tenant.quality_customer_complaints(organization_id,company_id,complaint_number,party_id,contact_id,support_ticket_id,item_id,batch_id,serial_id,severity,description,status,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'open',$12) RETURNING *`,
    [c.organizationId, c.companyId, number, uuidOrNull(input.partyId, "Customer"), uuidOrNull(input.contactId, "Contact"), uuidOrNull(input.supportTicketId, "Support ticket"), uuidOrNull(input.itemId, "Item"), uuidOrNull(input.batchId, "Batch"), uuidOrNull(input.serialId, "Serial"), oneOf(String(input.severity ?? "minor"), ["minor", "major", "critical"], "Severity"), description, c.userId]);
  await recordEvent(client, c, "complaint", rows[0].id, "quality.complaint.created", {});
  return rows[0];
}
// Opens (or links) the investigating non-conformance for a complaint -- the complaint and the NC then
// track together; closing the complaint does not require the NC to be closed first (the complaint can
// close once the customer is satisfied, even while CAPA work continues).
export async function investigateComplaint(client, c, id, input = {}) {
  need(c, "quality.nonconformance.manage");
  const complaint = (await qx(client, `SELECT * FROM tenant.quality_customer_complaints WHERE organization_id=$1 AND company_id=$2 AND id=$3 FOR UPDATE`, [c.organizationId, c.companyId, uuid(id, "Complaint")])).rows[0];
  if (!complaint) throw new QualityError(404, "Complaint was not found.", "QUALITY_COMPLAINT_NOT_FOUND");
  if (complaint.status !== "open") throw new QualityError(409, "Only an open complaint can move into investigation.", "QUALITY_COMPLAINT_STATE");
  const { rows } = await qx(client, `UPDATE tenant.quality_customer_complaints SET status='investigating',nonconformance_id=coalesce($2,nonconformance_id),updated_at=now() WHERE id=$1 RETURNING *`, [complaint.id, uuidOrNull(input.nonconformanceId, "Non-conformance")]);
  return rows[0];
}
export async function resolveComplaint(client, c, id, input) {
  need(c, "quality.nonconformance.manage");
  const resolution = text(input.resolution, 2000);
  if (!resolution) throw new QualityError(400, "Describe the resolution.", "QUALITY_COMPLAINT_INVALID");
  const { rows } = await qx(client, `UPDATE tenant.quality_customer_complaints SET status='resolved',resolution=$2,updated_at=now() WHERE organization_id=$1 AND id=$3 AND status IN ('open','investigating') RETURNING *`, [c.organizationId, resolution, uuid(id, "Complaint")]);
  if (!rows[0]) throw new QualityError(409, "Only an open or investigating complaint can be resolved.", "QUALITY_COMPLAINT_STATE");
  return rows[0];
}
export async function closeComplaint(client, c, id) {
  need(c, "quality.nonconformance.manage");
  const { rows } = await qx(client, `UPDATE tenant.quality_customer_complaints SET status='closed',closed_by=$2,closed_at=now(),updated_at=now() WHERE organization_id=$1 AND id=$3 AND status='resolved' RETURNING *`, [c.organizationId, c.userId, uuid(id, "Complaint")]);
  if (!rows[0]) throw new QualityError(409, "Only a resolved complaint can be closed.", "QUALITY_COMPLAINT_STATE");
  return rows[0];
}

// ---------------------------------------------------------------- F339: lot/batch traceability
// A read-through view: every quality event that touched a given batch/serial (inspections, holds,
// non-conformances, certificates) in one timeline. Quality does not own the batch/serial record
// itself (Stock does); this is traceability of QUALITY history for it.
export async function getBatchTraceability(client, c, { batchId, serialId }) {
  needAny(c, VIEW);
  const bId = uuidOrNull(batchId, "Batch");
  const sId = uuidOrNull(serialId, "Serial");
  if (!bId && !sId) throw new QualityError(400, "Give a batch or a serial to trace.", "QUALITY_TRACE_INPUT_REQUIRED");
  const match = bId ? "batch_id=$3" : "serial_id=$3";
  const key = bId ?? sId;
  const [inspections, holds, ncs, certs] = await seq([
    () => qx(client, `SELECT id,inspection_number,status,overall_result,created_at FROM tenant.quality_inspections WHERE organization_id=$1 AND company_id=$2 AND ${match} ORDER BY created_at`, [c.organizationId, c.companyId, key]),
    () => qx(client, `SELECT id,hold_number,status,reason,placed_at FROM tenant.quality_holds WHERE organization_id=$1 AND company_id=$2 AND ${match} ORDER BY placed_at`, [c.organizationId, c.companyId, key]),
    () => qx(client, `SELECT id,nonconformance_number,severity,status,disposition,created_at FROM tenant.quality_nonconformances WHERE organization_id=$1 AND company_id=$2 AND ${match} ORDER BY created_at`, [c.organizationId, c.companyId, key]),
    () => qx(client, `SELECT id,certificate_number,status,issued_at FROM tenant.quality_certificates WHERE organization_id=$1 AND company_id=$2 AND ${match} ORDER BY created_at`, [c.organizationId, c.companyId, key]),
  ]);
  return { inspections: inspections.rows, holds: holds.rows, nonconformances: ncs.rows, certificates: certs.rows };
}

// ---------------------------------------------------------------- F341/F342: cost reporting and KPI dashboard
export async function getQualityCostReport(client, c, filters = {}) {
  needAny(c, REPORTS);
  const params = [c.organizationId, c.companyId];
  let where = "";
  if (filters.from) { params.push(dateRequired(filters.from, "From")); where += ` AND created_at >= $${params.length}`; }
  if (filters.to) { params.push(dateRequired(filters.to, "To")); where += ` AND created_at <= $${params.length}::date + 1`; }
  const nc = await qx(client, `SELECT severity, count(*)::int AS n, coalesce(sum(estimated_cost),0) AS cost FROM tenant.quality_nonconformances WHERE organization_id=$1 AND company_id=$2${where} GROUP BY severity`, params);
  const disposition = await qx(client, `SELECT disposition, count(*)::int AS n FROM tenant.quality_nonconformances WHERE organization_id=$1 AND company_id=$2 AND disposition IS NOT NULL${where} GROUP BY disposition`, params);
  const totalCost = nc.rows.reduce((sum, r) => sum + Number(r.cost), 0);
  return { bySeverity: nc.rows, byDisposition: disposition.rows, totalEstimatedCost: round2(totalCost) };
}
export async function getQualityKpiDashboard(client, c) {
  needAny(c, VIEW);
  const [inspections, issues, capa, calibration, complaints] = await seq([
    () => qx(client, `SELECT count(*) FILTER (WHERE status IN ('draft','in_progress'))::int AS open_inspections, count(*) FILTER (WHERE status='failed')::int AS failed_inspections, count(*) FILTER (WHERE created_at::date=current_date)::int AS inspections_today,
        round(100.0 * count(*) FILTER (WHERE status IN ('passed','conditionally_accepted')) / NULLIF(count(*) FILTER (WHERE status IN ('passed','failed','conditionally_accepted')),0), 2) AS first_pass_yield
      FROM tenant.quality_inspections WHERE organization_id=$1 AND company_id=$2`, [c.organizationId, c.companyId]),
    () => qx(client, `SELECT count(*) FILTER (WHERE status='active')::int AS active_holds,
        (SELECT count(*)::int FROM tenant.quality_nonconformances WHERE organization_id=$1 AND company_id=$2 AND status NOT IN ('closed','cancelled')) AS open_nonconformances,
        (SELECT count(*)::int FROM tenant.quality_nonconformances WHERE organization_id=$1 AND company_id=$2 AND severity='critical' AND status NOT IN ('closed','cancelled')) AS open_critical_nonconformances
      FROM tenant.quality_holds WHERE organization_id=$1 AND company_id=$2`, [c.organizationId, c.companyId]),
    () => qx(client, `SELECT count(*) FILTER (WHERE status NOT IN ('closed','cancelled'))::int AS open_capa, count(*) FILTER (WHERE status NOT IN ('closed','cancelled') AND due_date < current_date)::int AS overdue_capa FROM tenant.quality_capa WHERE organization_id=$1 AND company_id=$2`, [c.organizationId, c.companyId]),
    () => qx(client, `SELECT count(*)::int AS overdue_calibrations FROM tenant.quality_calibration_records WHERE organization_id=$1 AND company_id=$2 AND (status='expired' OR (status='valid' AND due_date < current_date))`, [c.organizationId, c.companyId]),
    () => qx(client, `SELECT count(*) FILTER (WHERE status NOT IN ('closed','cancelled'))::int AS open_complaints FROM tenant.quality_customer_complaints WHERE organization_id=$1 AND company_id=$2`, [c.organizationId, c.companyId]),
  ]);
  return { ...inspections.rows[0], ...issues.rows[0], ...capa.rows[0], ...calibration.rows[0], ...complaints.rows[0] };
}

// ---------------------------------------------------------------- picker options for the web forms
export async function listQualityOptions(client, c) {
  needAny(c, ["quality.view", "quality.inspect", MANAGE]);
  const p = [c.organizationId, c.companyId];
  const [items, suppliers, warehouses, plans, samplingPlans, nonconformances, capas, customers] = await seq([
    () => qx(client, `SELECT id, code, name FROM tenant.items WHERE organization_id=$1 AND company_id=$2 ORDER BY code LIMIT 2000`, p).catch(() => ({ rows: [] })),
    () => qx(client, `SELECT id, code, display_name AS name FROM tenant.business_parties WHERE organization_id=$1 AND party_type IN ('supplier','both') AND status='active' ORDER BY display_name LIMIT 2000`, [c.organizationId]),
    () => qx(client, `SELECT id, code, name FROM tenant.warehouses WHERE organization_id=$1 AND company_id=$2 ORDER BY code LIMIT 500`, p).catch(() => ({ rows: [] })),
    () => qx(client, `SELECT id, code || ' v' || version AS code, name FROM tenant.quality_plans WHERE organization_id=$1 AND company_id=$2 AND status='active' ORDER BY code LIMIT 500`, p),
    () => qx(client, `SELECT id, code, name FROM tenant.quality_sampling_plans WHERE organization_id=$1 AND company_id=$2 AND active ORDER BY code LIMIT 200`, p),
    () => qx(client, `SELECT id, nonconformance_number AS code, description AS name FROM tenant.quality_nonconformances WHERE organization_id=$1 AND company_id=$2 AND status NOT IN ('closed','cancelled') ORDER BY created_at DESC LIMIT 500`, p),
    () => qx(client, `SELECT id, capa_number AS code, title AS name FROM tenant.quality_capa WHERE organization_id=$1 AND company_id=$2 AND status NOT IN ('closed','cancelled') ORDER BY created_at DESC LIMIT 500`, p),
    () => qx(client, `SELECT id, code, display_name AS name FROM tenant.business_parties WHERE organization_id=$1 AND party_type IN ('customer','both') AND status='active' ORDER BY display_name LIMIT 2000`, [c.organizationId]),
  ]);
  return { items: items.rows, suppliers: suppliers.rows, warehouses: warehouses.rows, plans: plans.rows, samplingPlans: samplingPlans.rows, nonconformances: nonconformances.rows, capas: capas.rows, customers: customers.rows };
}
