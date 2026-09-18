import {
  ACCOUNTING_PERMISSIONS,
  AccountingError,
  decimal,
  event,
  hashPayload,
  requirePermission,
  uuid,
} from "./core.js";

const CONFIG = Object.freeze({
  customer_invoice: {
    table: "accounting_customer_invoices",
    lineTable: "accounting_customer_invoice_lines",
    lineForeignKey: "customer_invoice_id",
    entityType: "accounting_customer_invoice",
    commandKey: "accounting.customer_invoice.approve",
    numberColumn: "invoice_number",
    permission: ACCOUNTING_PERMISSIONS.receivablesApprove,
    submitPermission: ACCOUNTING_PERMISSIONS.receivablesManage,
    requiredColumn: "customer_invoice_approval_required",
    thresholdColumn: "customer_invoice_approval_threshold",
  },
  vendor_bill: {
    table: "accounting_vendor_bills",
    lineTable: "accounting_vendor_bill_lines",
    lineForeignKey: "vendor_bill_id",
    entityType: "accounting_vendor_bill",
    commandKey: "accounting.vendor_bill.approve",
    numberColumn: "bill_number",
    permission: ACCOUNTING_PERMISSIONS.payablesApprove,
    submitPermission: ACCOUNTING_PERMISSIONS.payablesManage,
    requiredColumn: "vendor_bill_approval_required",
    thresholdColumn: "vendor_bill_approval_threshold",
  },
  vendor_payment: {
    table: "accounting_vendor_payments",
    lineTable: null,
    lineForeignKey: null,
    entityType: "accounting_vendor_payment",
    commandKey: "accounting.vendor_payment.approve",
    numberColumn: "payment_number",
    permission: ACCOUNTING_PERMISSIONS.paymentsApprove,
    submitPermission: ACCOUNTING_PERMISSIONS.paymentsManage,
    requiredColumn: "vendor_payment_approval_required",
    thresholdColumn: "vendor_payment_approval_threshold",
  },
});

function configFor(kind) {
  const config = CONFIG[kind];
  if (!config) throw new AccountingError(400, "Unsupported Accounting approval document.");
  return config;
}

async function lockDocument(client, context, kind, idValue) {
  const config = configFor(kind);
  const id = uuid(idValue, "Accounting document");
  const result = await client.query(
    `SELECT * FROM tenant.${config.table} WHERE organization_id=$1 AND id=$2 FOR UPDATE`,
    [context.organizationId, id],
  );
  const document = result.rows[0];
  if (!document) throw new AccountingError(404, "Accounting document not found.");
  if (!context.allowAllCompanies && context.activeCompanyId && document.company_id !== context.activeCompanyId) {
    throw new AccountingError(403, "Switch to the document company before changing it.");
  }
  return { config, document };
}

async function contentHash(client, context, config, document) {
  let lines = [];
  if (config.lineTable) {
    const result = await client.query(
      `SELECT * FROM tenant.${config.lineTable}
        WHERE organization_id=$1 AND ${config.lineForeignKey}=$2 ORDER BY sequence,id`,
      [context.organizationId, document.id],
    );
    lines = result.rows;
  }
  const commercial = { ...document };
  for (const key of [
    "status", "approval_request_id", "content_hash", "submitted_at", "submitted_by", "approved_at", "approved_by",
    "journal_entry_id", "posted_at", "posted_by", "updated_at", "updated_by", "outstanding_amount",
  ]) delete commercial[key];
  return hashPayload({ document: commercial, lines });
}

async function approvalPolicy(client, context, document, config) {
  const result = await client.query(
    `SELECT ${config.requiredColumn} AS required,${config.thresholdColumn} AS threshold
       FROM tenant.accounting_settings WHERE organization_id=$1 AND company_id=$2`,
    [context.organizationId, document.company_id],
  );
  const policy = result.rows[0] || { required: false, threshold: 0 };
  const amount = decimal(document.base_currency_total ?? document.base_amount ?? document.grand_total ?? document.amount ?? 0);
  const threshold = decimal(policy.threshold || 0);
  return Boolean(policy.required) || (threshold > 0n && amount >= threshold);
}

export async function submitSubledgerDocument(client, context, kind, idValue, assignedTo = null, options = {}) {
  const { config, document } = await lockDocument(client, context, kind, idValue);
  if (!options.internal) requirePermission(context, config.submitPermission);
  if (document.status !== "draft") throw new AccountingError(409, "Only a draft Accounting document can be submitted.");
  const hash = await contentHash(client, context, config, document);
  // A trusted internal caller (e.g. POS posting an already-completed,
  // already-paid retail sale's invoice) has no interactive human
  // maker-checker step to route through -- the transaction it documents
  // already happened at checkout. Skip the approval-request detour
  // entirely for internal callers; the source module's own authorization
  // (e.g. assertPosStoreAccess) and this function's still-real audit event
  // are the control, not a second human sign-off on a fact already
  // settled at the till.
  const approvalRequired = options.internal ? false : await approvalPolicy(client, context, document, config);
  if (!approvalRequired) {
    await client.query(
      `UPDATE tenant.${config.table}
        SET status='approved',content_hash=$3,submitted_at=now(),submitted_by=$4,
            approved_at=now(),approved_by=$4,updated_by=$4,updated_at=now()
        WHERE organization_id=$1 AND id=$2`,
      [context.organizationId, document.id, hash, context.userId],
    );
    await event(client, context, kind, document.id, `accounting.${kind}.auto_approved`, "draft", "approved", {});
    return { id: document.id, status: "approved", approvalRequired: false, contentHash: hash };
  }
  const approval = await client.query(
    `INSERT INTO public.approval_requests (
      organization_id,entity_type,entity_id,title,status,requested_by,assigned_to,command_key,command_payload
    ) VALUES ($1,$2,$3,$4,'pending',$5,$6,$7,$8::jsonb)
    RETURNING id,status,version`,
    [context.organizationId, config.entityType, document.id,
      `Approve ${String(document[config.numberColumn])}`, context.userId,
      assignedTo ? uuid(assignedTo, "Approver") : null, config.commandKey,
      JSON.stringify({ documentId: document.id, contentHash: hash })],
  );
  await client.query(
    `UPDATE tenant.${config.table}
      SET status='pending_approval',approval_request_id=$3,content_hash=$4,
          submitted_at=now(),submitted_by=$5,updated_by=$5,updated_at=now()
      WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, document.id, approval.rows[0].id, hash, context.userId],
  );
  await event(client, context, kind, document.id, `accounting.${kind}.submitted`, "draft", "pending_approval", {
    approvalRequestId: approval.rows[0].id,
  });
  return { id: document.id, status: "pending_approval", approvalRequired: true, contentHash: hash, approvalRequest: approval.rows[0] };
}

export async function approveSubledgerDocument(client, context, kind, idValue, expectedHash) {
  const { config, document } = await lockDocument(client, context, kind, idValue);
  requirePermission(context, config.permission);
  if (document.status !== "pending_approval") throw new AccountingError(409, "Accounting document is not awaiting approval.");
  if (document.submitted_by && document.submitted_by === context.userId) {
    throw new AccountingError(409, "The submitter cannot approve the same Accounting document.");
  }
  const currentHash = await contentHash(client, context, config, document);
  if (!expectedHash || expectedHash !== document.content_hash || currentHash !== document.content_hash) {
    throw new AccountingError(409, "Accounting document content changed after approval was requested.");
  }
  await client.query(
    `UPDATE tenant.${config.table}
      SET status='approved',approved_at=now(),approved_by=$3,updated_by=$3,updated_at=now()
      WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, document.id, context.userId],
  );
  await event(client, context, kind, document.id, `accounting.${kind}.approved`, "pending_approval", "approved", {});
  return { id: document.id, status: "approved" };
}

export async function rejectSubledgerDocument(client, context, kind, idValue) {
  const { config, document } = await lockDocument(client, context, kind, idValue);
  requirePermission(context, config.permission);
  if (document.status !== "pending_approval") return { id: document.id, status: document.status };
  await client.query(
    `UPDATE tenant.${config.table}
      SET status='draft',approval_request_id=NULL,content_hash=NULL,approved_at=NULL,approved_by=NULL,
          updated_by=$3,updated_at=now() WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, document.id, context.userId],
  );
  await event(client, context, kind, document.id, `accounting.${kind}.rejected`, "pending_approval", "draft", {});
  return { id: document.id, status: "draft" };
}

export const submitCustomerInvoice = (client, context, id, assignedTo = null) =>
  submitSubledgerDocument(client, context, "customer_invoice", id, assignedTo);
export const approveCustomerInvoice = (client, context, id, hash) =>
  approveSubledgerDocument(client, context, "customer_invoice", id, hash);
export const rejectCustomerInvoiceApproval = (client, context, id) =>
  rejectSubledgerDocument(client, context, "customer_invoice", id);
export const submitVendorBill = (client, context, id, assignedTo = null) =>
  submitSubledgerDocument(client, context, "vendor_bill", id, assignedTo);
export const approveVendorBill = (client, context, id, hash) =>
  approveSubledgerDocument(client, context, "vendor_bill", id, hash);
export const rejectVendorBillApproval = (client, context, id) =>
  rejectSubledgerDocument(client, context, "vendor_bill", id);
export const submitVendorPayment = (client, context, id, assignedTo = null) =>
  submitSubledgerDocument(client, context, "vendor_payment", id, assignedTo);
export const approveVendorPayment = (client, context, id, hash) =>
  approveSubledgerDocument(client, context, "vendor_payment", id, hash);
export const rejectVendorPaymentApproval = (client, context, id) =>
  rejectSubledgerDocument(client, context, "vendor_payment", id);
