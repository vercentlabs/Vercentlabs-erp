import {
  ACCOUNTING_PERMISSIONS,
  AccountingError,
  allocateNumber,
  event,
  hashPayload,
  loadCompany,
  requirePermission,
  text,
  uuid,
} from "./core.js";

const TYPES = new Set(["gst_einvoice", "gst_eway_bill", "tds_statement", "tax_payment", "statutory_report", "other"]);

async function validateSource(client, context, companyId, sourceType, sourceId) {
  const sources = {
    customer_invoice: ["tenant.accounting_customer_invoices", "id"],
    vendor_bill: ["tenant.accounting_vendor_bills", "id"],
    tax_return: ["tenant.accounting_tax_returns", "id"],
    journal_entry: ["tenant.accounting_journal_entries", "id"],
  };
  const source = sources[sourceType];
  if (!source) throw new AccountingError(400, "Compliance source type is unsupported.");
  const result = await client.query(
    `SELECT ${source[1]} AS id FROM ${source[0]} WHERE organization_id=$1 AND company_id=$2 AND ${source[1]}=$3`,
    [context.organizationId, companyId, sourceId],
  );
  if (!result.rows[0]) throw new AccountingError(409, "Compliance source is outside the selected company.");
}

export async function createComplianceRequest(client, context, input) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.taxManage);
  const company = await loadCompany(client, context, input.companyId || context.activeCompanyId);
  const complianceType = TYPES.has(input.complianceType) ? input.complianceType : "other";
  const sourceType = text(input.sourceType, 80);
  const sourceId = uuid(input.sourceId, "Compliance source");
  await validateSource(client, context, company.id, sourceType, sourceId);
  const payload = input.payload && typeof input.payload === "object" ? input.payload : {};
  const idempotencyKey = text(input.idempotencyKey, 200) || hashPayload({ complianceType, sourceType, sourceId, payload });
  const existing = await client.query(`SELECT * FROM tenant.accounting_compliance_requests WHERE organization_id=$1 AND idempotency_key=$2`, [context.organizationId, idempotencyKey]);
  if (existing.rows[0]) return existing.rows[0];
  const requestNumber = await allocateNumber(client, context.organizationId, "accounting_compliance_request");
  const result = await client.query(
    `INSERT INTO tenant.accounting_compliance_requests (
      organization_id,company_id,request_number,compliance_type,source_type,source_id,idempotency_key,status,payload,requested_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',$8::jsonb,$9) RETURNING *`,
    [context.organizationId, company.id, requestNumber, complianceType, sourceType, sourceId, idempotencyKey, JSON.stringify(payload), context.userId],
  );
  await event(client, context, "compliance_request", result.rows[0].id, "accounting.compliance.requested", null, "pending", { complianceType, sourceType, sourceId });
  return result.rows[0];
}

export async function listComplianceRequests(client, context, filters = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.view);
  const values = [context.organizationId];
  let where = "";
  if (!context.allowAllCompanies && context.activeCompanyId) { values.push(context.activeCompanyId); where += ` AND request.company_id=$${values.length}`; }
  if (filters.status && filters.status !== "all") { values.push(text(filters.status, 30)); where += ` AND request.status=$${values.length}`; }
  if (filters.complianceType) { values.push(text(filters.complianceType, 50)); where += ` AND request.compliance_type=$${values.length}`; }
  const result = await client.query(
    `SELECT request.*,company.name AS company_name FROM tenant.accounting_compliance_requests request
     JOIN public.companies company ON company.id=request.company_id
     WHERE request.organization_id=$1${where} ORDER BY request.requested_at DESC LIMIT 500`, values);
  return result.rows;
}

export async function updateComplianceRequest(client, context, idValue, input) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.taxManage);
  const id = uuid(idValue, "Compliance request");
  const status = text(input.status, 30);
  if (!["processing", "completed", "failed", "cancelled"].includes(status)) throw new AccountingError(400, "Compliance request status is invalid.");
  const current = await client.query(`SELECT * FROM tenant.accounting_compliance_requests WHERE organization_id=$1 AND id=$2 FOR UPDATE`, [context.organizationId, id]);
  const request = current.rows[0];
  if (!request) throw new AccountingError(404, "Compliance request was not found.");
  if (["completed", "cancelled"].includes(request.status)) throw new AccountingError(409, "Completed or cancelled compliance requests are immutable.");
  const result = await client.query(
    `UPDATE tenant.accounting_compliance_requests SET status=$3,response_payload=COALESCE($4::jsonb,response_payload),
      external_reference=COALESCE($5,external_reference),last_error=$6,retry_count=retry_count+CASE WHEN $3='failed' THEN 1 ELSE 0 END,
      next_retry_at=$7,completed_at=CASE WHEN $3='completed' THEN now() ELSE completed_at END,updated_at=now()
     WHERE organization_id=$1 AND id=$2 RETURNING *`,
    [context.organizationId, id, status, input.responsePayload ? JSON.stringify(input.responsePayload) : null,
      text(input.externalReference, 200) || null, status === "failed" ? text(input.error, 1000) || "Compliance provider failed." : null,
      input.nextRetryAt || null],
  );
  if (request.compliance_type === "gst_einvoice" && request.source_type === "customer_invoice") {
    await client.query(
      `UPDATE tenant.accounting_customer_invoices SET e_invoice_status=$3,e_invoice_reference=COALESCE($4,e_invoice_reference),updated_at=now()
       WHERE organization_id=$1 AND id=$2`,
      [context.organizationId, request.source_id, status === "completed" ? "generated" : status === "failed" ? "failed" : "pending", text(input.externalReference, 200) || null],
    );
  }
  await event(client, context, "compliance_request", request.id, "accounting.compliance.status_changed", request.status, status, { externalReference: text(input.externalReference, 200) || null });
  return result.rows[0];
}
