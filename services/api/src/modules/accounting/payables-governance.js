import { randomUUID } from "node:crypto";

import {
  ACCOUNTING_PERMISSIONS,
  AccountingError,
  asDatabaseDecimal,
  decimal,
  event,
  hasPermission,
  requirePermission,
  text,
  uuid,
} from "./core.js";
import { createVendorPayment } from "./payables.js";

export class PayablesGovernanceError extends AccountingError {
  constructor(status, message, code = "PAYABLES_GOVERNANCE_ERROR") {
    super(status, message, code);
    this.name = "PayablesGovernanceError";
  }
}

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const OPEN_BILL_STATUSES = new Set([
  "posted",
  "partially_paid",
  "overdue",
  "disputed",
]);
const EXCEPTION_STATUSES = new Set([
  "open",
  "under_review",
  "supplier_query",
  "approved_override",
  "resolved",
  "closed",
]);
const EXCEPTION_PRIORITIES = new Set(["low", "normal", "high", "urgent"]);
const EXCEPTION_REASONS = new Set([
  "duplicate_invoice",
  "amount_variance",
  "quantity_variance",
  "missing_receipt",
  "missing_purchase_order",
  "tax_variance",
  "supplier_dispute",
  "payment_hold",
  "other",
]);
const PROPOSAL_TRANSITIONS = {
  draft: new Set(["submitted", "cancelled"]),
  submitted: new Set(["approved", "rejected", "cancelled"]),
  approved: new Set(["prepared", "cancelled"]),
  rejected: new Set(),
  prepared: new Set(),
  cancelled: new Set(),
};

const number = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const string = (value) => String(value ?? "").trim();
const object = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};
const hasKeys = (value) => Object.keys(object(value)).length > 0;
const dateOnly = (value) => {
  const result = string(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(result) &&
    !Number.isNaN(Date.parse(`${result}T00:00:00Z`))
    ? result
    : null;
};
const dateTime = (value, label) => {
  if (value === undefined || value === null || value === "") return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new PayablesGovernanceError(400, `${label} is invalid.`);
  }
  return parsed.toISOString();
};

function defaultPolicy(policy = {}) {
  return {
    approvalSlaHours: Math.max(
      1,
      number(policy.approval_sla_hours ?? policy.approvalSlaHours ?? 24),
    ),
    dueSoonDays: Math.max(
      1,
      number(policy.due_soon_days ?? policy.dueSoonDays ?? 7),
    ),
    staleAfterDays: Math.max(
      1,
      number(policy.stale_after_days ?? policy.staleAfterDays ?? 14),
    ),
    exceptionEscalationDays: Math.max(
      1,
      number(
        policy.exception_escalation_days ?? policy.exceptionEscalationDays ?? 7,
      ),
    ),
    paymentHorizonDays: Math.max(
      0,
      number(policy.payment_horizon_days ?? policy.paymentHorizonDays ?? 14),
    ),
    highRiskDays: Math.max(
      1,
      number(policy.high_risk_days ?? policy.highRiskDays ?? 60),
    ),
    requireSupplierInvoiceNumber:
      policy.require_supplier_invoice_number ??
      policy.requireSupplierInvoiceNumber ??
      true,
    blockDuplicateSupplierInvoice:
      policy.block_duplicate_supplier_invoice ??
      policy.blockDuplicateSupplierInvoice ??
      true,
    requireMatchingForSourcedBills:
      policy.require_matching_for_sourced_bills ??
      policy.requireMatchingForSourcedBills ??
      true,
    requirePaymentSchedule:
      policy.require_payment_schedule ?? policy.requirePaymentSchedule ?? true,
  };
}

function age(value, now) {
  const parsed = new Date(value || now);
  if (Number.isNaN(parsed.getTime())) return { hours: 0, days: 0 };
  const milliseconds = Math.max(0, now.getTime() - parsed.getTime());
  return {
    hours: Math.floor(milliseconds / HOUR_MS),
    days: Math.floor(milliseconds / DAY_MS),
  };
}

function daysFromToday(value, now) {
  if (!value) return null;
  const parsed = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  const today = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  return Math.floor((today - parsed.getTime()) / DAY_MS);
}

function moneyEqual(left, right) {
  try {
    return decimal(left || 0) === decimal(right || 0);
  } catch {
    return Math.abs(number(left) - number(right)) < 0.000001;
  }
}

function requireAnyPermission(context, permissions) {
  if (!permissions.some((permission) => hasPermission(context, permission))) {
    throw new PayablesGovernanceError(
      403,
      "You do not have permission to manage payables governance.",
      "PAYABLES_GOVERNANCE_PERMISSION_DENIED",
    );
  }
}

export function evaluatePayableHealth(row, policyInput = {}, now = new Date()) {
  const policy = defaultPolicy(policyInput);
  const blockers = [];
  const warnings = [];
  const billType = string(row.bill_type || row.billType || "bill");
  const status = string(row.status);
  const matchingStatus = string(
    row.matching_status || row.matchingStatus || "not_required",
  );
  const supplierStatus = string(row.supplier_status || row.supplierStatus);
  const grandTotal = number(row.grand_total ?? row.grandTotal);
  const outstandingAmount = number(
    row.outstanding_amount ?? row.outstandingAmount,
  );
  const lineCount = number(row.line_count ?? row.lineCount);
  const scheduleCount = number(row.schedule_count ?? row.scheduleCount);
  const scheduleTotal = number(row.schedule_total ?? row.scheduleTotal);
  const scheduleOutstanding = number(
    row.schedule_outstanding ?? row.scheduleOutstanding,
  );
  const duplicateCount = number(
    row.duplicate_supplier_invoice_count ?? row.duplicateSupplierInvoiceCount,
  );
  const exceptionStatus = string(
    row.exception_case_status || row.exceptionCaseStatus,
  );
  const exceptionAge = age(
    row.exception_updated_at || row.exceptionUpdatedAt || row.updated_at,
    now,
  );
  const updatedAge = age(
    row.updated_at || row.updatedAt || row.created_at,
    now,
  );
  const dueDays = daysFromToday(row.due_date || row.dueDate, now);
  const isOpen = OPEN_BILL_STATUSES.has(status) && outstandingAmount > 0;
  const daysOverdue = isOpen && dueDays !== null ? Math.max(0, dueDays) : 0;
  const daysUntilDue =
    isOpen && dueDays !== null ? Math.max(0, -dueDays) : null;
  const sourcedFromProcurement = Boolean(
    row.source_purchase_order_id ||
    row.sourcePurchaseOrderId ||
    row.source_goods_receipt_id ||
    row.sourceGoodsReceiptId,
  );

  if (lineCount < 1) blockers.push("Vendor bill requires at least one line.");
  if (grandTotal <= 0)
    blockers.push("Vendor bill total must be greater than zero.");
  if (supplierStatus && supplierStatus !== "active")
    blockers.push("Supplier is inactive.");
  if (!hasKeys(row.supplier_snapshot ?? row.supplierSnapshot))
    blockers.push("Supplier snapshot is missing.");
  if (!hasKeys(row.payment_term_snapshot ?? row.paymentTermSnapshot))
    blockers.push("Payment-term snapshot is missing.");
  if (
    policy.requireSupplierInvoiceNumber &&
    billType !== "opening" &&
    !string(row.supplier_invoice_number || row.supplierInvoiceNumber)
  ) {
    blockers.push("Supplier invoice number is required.");
  }
  if (policy.blockDuplicateSupplierInvoice && duplicateCount > 0) {
    blockers.push("A duplicate supplier invoice number already exists.");
  }
  if (
    policy.requirePaymentSchedule &&
    billType !== "credit_note" &&
    scheduleCount < 1
  ) {
    blockers.push("A vendor payment schedule is required.");
  }
  if (scheduleCount > 0 && !moneyEqual(scheduleTotal, grandTotal)) {
    blockers.push("Payment schedule does not reconcile to the bill total.");
  }
  if (
    scheduleCount > 0 &&
    !["draft", "pending_approval", "approved"].includes(status) &&
    !moneyEqual(scheduleOutstanding, outstandingAmount)
  ) {
    blockers.push("Payment schedule outstanding amount is inconsistent.");
  }
  if (
    policy.requireMatchingForSourcedBills &&
    sourcedFromProcurement &&
    !["matched", "overridden"].includes(matchingStatus)
  ) {
    blockers.push("Procurement-sourced bill requires a resolved match.");
  }
  if (matchingStatus === "exception") {
    blockers.push("Matching exception must be resolved or overridden.");
  }
  if (
    ["posted", "partially_paid", "paid", "overdue", "disputed"].includes(
      status,
    ) &&
    !row.journal_entry_id &&
    !row.journalEntryId
  ) {
    blockers.push("Posted payable is missing its accounting journal.");
  }
  if (status === "paid" && outstandingAmount > 0) {
    blockers.push("Paid vendor bill still has an outstanding balance.");
  }
  if (outstandingAmount < 0 || outstandingAmount > grandTotal) {
    blockers.push("Outstanding balance is outside the vendor bill total.");
  }

  if (
    status === "pending_approval" &&
    updatedAge.hours > policy.approvalSlaHours
  ) {
    warnings.push("Vendor bill approval is outside its SLA.");
  }
  if (
    ["draft", "pending_approval", "approved"].includes(status) &&
    updatedAge.days > policy.staleAfterDays
  ) {
    warnings.push("Vendor bill has had no recent progress.");
  }
  if (isOpen && dueDays !== null && dueDays > 0) {
    warnings.push(`Vendor bill is ${dueDays} day(s) overdue.`);
  } else if (
    isOpen &&
    daysUntilDue !== null &&
    daysUntilDue <= policy.dueSoonDays
  ) {
    warnings.push(`Vendor bill is due in ${daysUntilDue} day(s).`);
  }
  if (matchingStatus === "pending") {
    warnings.push("Vendor bill match is still pending.");
  }
  if (["exception", "pending"].includes(matchingStatus) && !exceptionStatus) {
    warnings.push("Matching issue has no owned exception case.");
  }
  if (
    exceptionStatus &&
    !["resolved", "closed", "approved_override"].includes(exceptionStatus) &&
    exceptionAge.days >= policy.exceptionEscalationDays
  ) {
    warnings.push("Payables exception case requires escalation.");
  }
  if (status === "disputed" || exceptionStatus === "supplier_query") {
    warnings.push("Payable is under supplier dispute or query.");
  }
  if (number(row.unapplied_payment_amount ?? row.unappliedPaymentAmount) > 0) {
    warnings.push("Supplier has unapplied payments available for allocation.");
  }
  if (number(row.active_proposal_amount ?? row.activeProposalAmount) > 0) {
    warnings.push(
      "Outstanding balance is already included in a payment proposal.",
    );
  }

  const paymentEligible =
    billType !== "credit_note" &&
    isOpen &&
    blockers.length === 0 &&
    status !== "disputed" &&
    !["open", "under_review", "supplier_query"].includes(exceptionStatus) &&
    daysUntilDue !== null &&
    daysUntilDue <= policy.paymentHorizonDays;
  const readiness = blockers.length
    ? "blocked"
    : warnings.length
      ? "attention"
      : "ready";
  const riskBand =
    daysOverdue >= policy.highRiskDays
      ? "high"
      : daysOverdue >= policy.exceptionEscalationDays
        ? "elevated"
        : daysOverdue > 0
          ? "overdue"
          : matchingStatus === "exception"
            ? "exception"
            : "current";

  return {
    readiness,
    blockers,
    warnings,
    isOpen,
    isOverdue: daysOverdue > 0,
    isDueSoon:
      isOpen &&
      daysOverdue === 0 &&
      daysUntilDue !== null &&
      daysUntilDue <= policy.dueSoonDays,
    paymentEligible,
    riskBand,
    metrics: {
      grandTotal,
      outstandingAmount,
      daysOverdue,
      daysUntilDue,
      ageDays: updatedAge.days,
      lineCount,
      scheduleCount,
      scheduleTotal,
      scheduleOutstanding,
      duplicateCount,
      unappliedPaymentAmount: number(
        row.unapplied_payment_amount ?? row.unappliedPaymentAmount,
      ),
      activeProposalAmount: number(
        row.active_proposal_amount ?? row.activeProposalAmount,
      ),
    },
  };
}

export function buildPayablesGovernanceSummary(
  rows,
  policyInput = {},
  now = new Date(),
) {
  const paymentKeys = new Set();
  const summary = {
    total: rows.length,
    draft: 0,
    pendingApproval: 0,
    open: 0,
    overdue: 0,
    dueSoon: 0,
    disputed: 0,
    paid: 0,
    matched: 0,
    matchingExceptions: 0,
    ready: 0,
    attention: 0,
    blocked: 0,
    paymentEligible: 0,
    totalBilled: 0,
    outstanding: 0,
    overdueOutstanding: 0,
    dueSoonOutstanding: 0,
    paymentEligibleAmount: 0,
    unappliedPayments: 0,
    proposedAmount: 0,
    aging: {
      current: 0,
      days1To30: 0,
      days31To60: 0,
      days61To90: 0,
      daysOver90: 0,
    },
  };

  for (const row of rows) {
    const status = string(row.status);
    const health = evaluatePayableHealth(row, policyInput, now);
    const outstanding = number(row.outstanding_amount ?? row.outstandingAmount);
    summary.totalBilled += number(row.grand_total ?? row.grandTotal);
    summary.outstanding += outstanding;
    const paymentKey = `${string(row.party_id || row.partyId)}:${string(
      row.currency_code || row.currencyCode,
    )}`;
    if (!paymentKeys.has(paymentKey)) {
      paymentKeys.add(paymentKey);
      summary.unappliedPayments += number(
        row.unapplied_payment_amount ?? row.unappliedPaymentAmount,
      );
    }
    summary.proposedAmount += number(
      row.active_proposal_amount ?? row.activeProposalAmount,
    );
    if (status === "draft") summary.draft += 1;
    if (status === "pending_approval") summary.pendingApproval += 1;
    if (status === "disputed") summary.disputed += 1;
    if (status === "paid") summary.paid += 1;
    if (
      ["matched", "overridden", "not_required"].includes(
        string(row.matching_status),
      )
    ) {
      summary.matched += 1;
    }
    if (string(row.matching_status) === "exception") {
      summary.matchingExceptions += 1;
    }
    if (health.isOpen) summary.open += 1;
    if (health.isOverdue) {
      summary.overdue += 1;
      summary.overdueOutstanding += outstanding;
    }
    if (health.isDueSoon) {
      summary.dueSoon += 1;
      summary.dueSoonOutstanding += outstanding;
    }
    if (health.paymentEligible) {
      summary.paymentEligible += 1;
      summary.paymentEligibleAmount += outstanding;
    }
    summary[health.readiness] += 1;
    const days = health.metrics.daysOverdue;
    if (days <= 0) summary.aging.current += outstanding;
    else if (days <= 30) summary.aging.days1To30 += outstanding;
    else if (days <= 60) summary.aging.days31To60 += outstanding;
    else if (days <= 90) summary.aging.days61To90 += outstanding;
    else summary.aging.daysOver90 += outstanding;
  }

  return summary;
}

async function loadPolicy(client, context) {
  const result = await client.query(
    `SELECT *
       FROM tenant.accounting_payables_governance_policies
      WHERE organization_id=$1`,
    [context.organizationId],
  );
  return result.rows[0] || {};
}

async function loadPayableRows(client, context, billId = null) {
  const values = [context.organizationId];
  let where = "";
  if (!context.allowAllCompanies && context.activeCompanyId) {
    values.push(context.activeCompanyId);
    where += ` AND bill.company_id=$${values.length}`;
  }
  if (billId) {
    values.push(uuid(billId, "Vendor bill"));
    where += ` AND bill.id=$${values.length}`;
  }
  const result = await client.query(
    `SELECT bill.*,
            party.display_name AS supplier_name,
            party.status AS supplier_status,
            company.name AS company_name,
            COALESCE(line_summary.line_count,0)::int AS line_count,
            COALESCE(schedule_summary.schedule_count,0)::int AS schedule_count,
            COALESCE(schedule_summary.schedule_total,0) AS schedule_total,
            COALESCE(schedule_summary.schedule_outstanding,0) AS schedule_outstanding,
            match.match_type,
            match.status AS match_record_status,
            match.exceptions AS matching_exceptions,
            match.amount_variance,
            match.quantity_variance,
            exception_case.id AS exception_case_id,
            exception_case.status AS exception_case_status,
            exception_case.priority AS exception_priority,
            exception_case.reason_code AS exception_reason_code,
            exception_case.next_action_at AS exception_next_action_at,
            exception_case.updated_at AS exception_updated_at,
            COALESCE(duplicate_summary.duplicate_count,0)::int
              AS duplicate_supplier_invoice_count,
            COALESCE(payment_summary.unapplied_payment_amount,0)
              AS unapplied_payment_amount,
            COALESCE(proposal_summary.active_proposal_amount,0)
              AS active_proposal_amount
       FROM tenant.accounting_vendor_bills bill
       JOIN tenant.business_parties party
         ON party.organization_id=bill.organization_id
        AND party.id=bill.party_id
       JOIN public.companies company
         ON company.organization_id=bill.organization_id
        AND company.id=bill.company_id
       LEFT JOIN LATERAL (
         SELECT count(*) AS line_count
           FROM tenant.accounting_vendor_bill_lines line
          WHERE line.organization_id=bill.organization_id
            AND line.vendor_bill_id=bill.id
       ) line_summary ON true
       LEFT JOIN LATERAL (
         SELECT count(*) AS schedule_count,
                COALESCE(sum(amount),0) AS schedule_total,
                COALESCE(sum(outstanding_amount),0) AS schedule_outstanding
           FROM tenant.accounting_vendor_bill_schedules schedule
          WHERE schedule.organization_id=bill.organization_id
            AND schedule.vendor_bill_id=bill.id
       ) schedule_summary ON true
       LEFT JOIN tenant.accounting_vendor_bill_matches match
         ON match.organization_id=bill.organization_id
        AND match.vendor_bill_id=bill.id
       LEFT JOIN tenant.accounting_payables_exception_cases exception_case
         ON exception_case.organization_id=bill.organization_id
        AND exception_case.vendor_bill_id=bill.id
       LEFT JOIN LATERAL (
         SELECT count(*) AS duplicate_count
           FROM tenant.accounting_vendor_bills duplicate_bill
          WHERE duplicate_bill.organization_id=bill.organization_id
            AND duplicate_bill.party_id=bill.party_id
            AND duplicate_bill.id<>bill.id
            AND duplicate_bill.supplier_invoice_number IS NOT NULL
            AND duplicate_bill.supplier_invoice_number<>''
            AND lower(duplicate_bill.supplier_invoice_number)=
                lower(bill.supplier_invoice_number)
            AND duplicate_bill.status<>'cancelled'
       ) duplicate_summary ON true
       LEFT JOIN LATERAL (
         SELECT COALESCE(sum(payment.unapplied_amount),0)
                  AS unapplied_payment_amount
           FROM tenant.accounting_vendor_payments payment
          WHERE payment.organization_id=bill.organization_id
            AND payment.company_id=bill.company_id
            AND payment.party_id=bill.party_id
            AND payment.currency_code=bill.currency_code
            AND payment.status IN ('posted','partially_applied')
            AND payment.unapplied_amount>0
       ) payment_summary ON true
       LEFT JOIN LATERAL (
         SELECT COALESCE(sum(item.proposed_amount),0) AS active_proposal_amount
           FROM tenant.accounting_vendor_payment_proposal_items item
           JOIN tenant.accounting_vendor_payment_proposals proposal
             ON proposal.organization_id=item.organization_id
            AND proposal.id=item.proposal_id
          WHERE item.organization_id=bill.organization_id
            AND item.vendor_bill_id=bill.id
            AND item.status='selected'
            AND proposal.status IN ('draft','submitted','approved')
       ) proposal_summary ON true
      WHERE bill.organization_id=$1${where}
      ORDER BY bill.due_date,bill.created_at DESC`,
    values,
  );
  return result.rows;
}

export async function getPayablesGovernanceDashboard(client, context) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.view);
  const scopedValues = [context.organizationId];
  let companyScope = "";
  if (!context.allowAllCompanies && context.activeCompanyId) {
    scopedValues.push(context.activeCompanyId);
    companyScope = ` AND bill.company_id=$${scopedValues.length}`;
  }
  const procurementValues = [context.organizationId];
  let procurementScope = "";
  if (!context.allowAllCompanies && context.activeCompanyId) {
    procurementValues.push(context.activeCompanyId);
    procurementScope = ` AND purchase_order.company_id=$${procurementValues.length}`;
  }
  // A transaction-bound pg PoolClient must execute its query stream in order.
  // Parallel reads here trigger pg's "client is already executing" warning.
  const policy = await loadPolicy(client, context);
  const bills = await loadPayableRows(client, context);
  const exceptionCases = await client.query(
    `SELECT exception_case.*,bill.bill_number,bill.supplier_invoice_number,
                bill.currency_code,bill.outstanding_amount,bill.due_date,
                party.display_name AS supplier_name
           FROM tenant.accounting_payables_exception_cases exception_case
           JOIN tenant.accounting_vendor_bills bill
             ON bill.organization_id=exception_case.organization_id
            AND bill.id=exception_case.vendor_bill_id
           JOIN tenant.business_parties party
             ON party.organization_id=bill.organization_id
            AND party.id=bill.party_id
          WHERE exception_case.organization_id=$1
            AND exception_case.status NOT IN ('resolved','closed')${companyScope}
          ORDER BY exception_case.priority='urgent' DESC,
                   exception_case.priority='high' DESC,
                   exception_case.next_action_at NULLS FIRST,
                   exception_case.updated_at
          LIMIT 200`,
    scopedValues,
  );
  const proposals = await listVendorPaymentProposals(client, context);
  const importQueue = await client.query(
    `SELECT matching.id,matching.status,matching.updated_at,
                purchase_order.id AS purchase_order_id,
                purchase_order.data->>'orderNumber' AS purchase_order_number,
                purchase_order.data->>'supplierName' AS supplier_name,
                matching.data->>'invoiceNumber' AS supplier_invoice_number,
                matching.data->>'invoiceTotal' AS invoice_total
           FROM tenant.procurement_matching_records matching
           JOIN tenant.procurement_purchase_orders purchase_order
             ON purchase_order.organization_id=matching.organization_id
            AND purchase_order.id=matching.parent_id
          WHERE matching.organization_id=$1
            AND matching.status='matched'
            AND COALESCE(matching.data->>'accountingVendorBillId','')=''${procurementScope}
          ORDER BY matching.updated_at
          LIMIT 100`,
    procurementValues,
  );
  const summary = buildPayablesGovernanceSummary(bills, policy);
  const assessed = bills.map((bill) => ({
    ...bill,
    health: evaluatePayableHealth(bill, policy),
  }));
  const suppliers = new Map();
  for (const row of assessed) {
    const current = suppliers.get(row.party_id) || {
      partyId: row.party_id,
      supplierName: row.supplier_name,
      outstanding: 0,
      overdueOutstanding: 0,
      billCount: 0,
      exceptionCount: 0,
    };
    const outstanding = number(row.outstanding_amount);
    current.outstanding += outstanding;
    current.billCount += 1;
    if (row.health.isOverdue) current.overdueOutstanding += outstanding;
    if (row.matching_status === "exception") current.exceptionCount += 1;
    suppliers.set(row.party_id, current);
  }
  return {
    policy: defaultPolicy(policy),
    summary,
    bills: assessed,
    exceptionCases: exceptionCases.rows,
    paymentProposals: proposals,
    importQueue: importQueue.rows,
    topSuppliers: [...suppliers.values()]
      .sort((left, right) => right.outstanding - left.outstanding)
      .slice(0, 20),
  };
}

export async function assessVendorBillReadiness(client, context, billIdValue) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.view);
  const rows = await loadPayableRows(client, context, billIdValue);
  if (!rows[0])
    throw new PayablesGovernanceError(404, "Vendor bill not found.");
  const policy = await loadPolicy(client, context);
  return {
    bill: rows[0],
    health: evaluatePayableHealth(rows[0], policy),
    policy: defaultPolicy(policy),
  };
}

export async function capturePayablesGovernanceSnapshot(
  client,
  context,
  billIdValue,
  capturedFor = "manual",
) {
  requireAnyPermission(context, [
    ACCOUNTING_PERMISSIONS.payablesManage,
    ACCOUNTING_PERMISSIONS.payablesApprove,
    ACCOUNTING_PERMISSIONS.paymentsManage,
  ]);
  const assessment = await assessVendorBillReadiness(
    client,
    context,
    billIdValue,
  );
  const result = await client.query(
    `INSERT INTO tenant.accounting_payables_governance_snapshots (
       organization_id,vendor_bill_id,bill_type,bill_status,matching_status,
       outstanding_amount,readiness_status,blockers,warnings,metrics,
       captured_for,captured_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11,$12)
     RETURNING *`,
    [
      context.organizationId,
      assessment.bill.id,
      assessment.bill.bill_type,
      assessment.bill.status,
      assessment.bill.matching_status,
      assessment.bill.outstanding_amount,
      assessment.health.readiness,
      JSON.stringify(assessment.health.blockers),
      JSON.stringify(assessment.health.warnings),
      JSON.stringify(assessment.health.metrics),
      text(capturedFor, 120) || "manual",
      context.userId,
    ],
  );
  return result.rows[0];
}

export async function getVendorBillGovernanceTimeline(
  client,
  context,
  billIdValue,
) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.view);
  const billId = uuid(billIdValue, "Vendor bill");
  const visible = await loadPayableRows(client, context, billId);
  if (!visible[0])
    throw new PayablesGovernanceError(404, "Vendor bill not found.");
  const result = await client.query(
    `SELECT * FROM (
       SELECT accounting_event.id,accounting_event.occurred_at AS happened_at,
              accounting_event.event_type AS kind,
              accounting_event.from_status,accounting_event.to_status,
              accounting_event.metadata
         FROM tenant.accounting_events accounting_event
        WHERE accounting_event.organization_id=$1
          AND accounting_event.entity_type='vendor_bill'
          AND accounting_event.entity_id=$2
       UNION ALL
       SELECT snapshot.id,snapshot.captured_at,'payables.snapshot',
              NULL,snapshot.readiness_status,
              jsonb_build_object(
                'capturedFor',snapshot.captured_for,
                'blockers',snapshot.blockers,
                'warnings',snapshot.warnings,
                'metrics',snapshot.metrics
              )
         FROM tenant.accounting_payables_governance_snapshots snapshot
        WHERE snapshot.organization_id=$1
          AND snapshot.vendor_bill_id=$2
       UNION ALL
       SELECT match.id,COALESCE(match.overridden_at,match.matched_at,match.updated_at),
              'payables.match',NULL,match.status,
              jsonb_build_object(
                'matchType',match.match_type,
                'amountVariance',match.amount_variance,
                'quantityVariance',match.quantity_variance,
                'exceptions',match.exceptions,
                'overrideReason',match.override_reason
              )
         FROM tenant.accounting_vendor_bill_matches match
        WHERE match.organization_id=$1
          AND match.vendor_bill_id=$2
       UNION ALL
       SELECT exception_case.id,exception_case.updated_at,'payables.exception',
              NULL,exception_case.status,
              jsonb_build_object(
                'priority',exception_case.priority,
                'reasonCode',exception_case.reason_code,
                'nextActionAt',exception_case.next_action_at,
                'note',exception_case.note
              )
         FROM tenant.accounting_payables_exception_cases exception_case
        WHERE exception_case.organization_id=$1
          AND exception_case.vendor_bill_id=$2
       UNION ALL
       SELECT allocation.id,allocation.allocated_at,'vendor_payment.allocated',
              NULL,'allocated',
              jsonb_build_object(
                'paymentId',allocation.payment_id,
                'allocatedAmount',allocation.allocated_amount,
                'discountTaken',allocation.discount_taken,
                'writeoffAmount',allocation.writeoff_amount
              )
         FROM tenant.accounting_vendor_payment_allocations allocation
        WHERE allocation.organization_id=$1
          AND allocation.vendor_bill_id=$2
       UNION ALL
       SELECT item.id,item.updated_at,'vendor_payment.proposed',
              NULL,proposal.status,
              jsonb_build_object(
                'proposalId',proposal.id,
                'proposalCode',proposal.proposal_code,
                'proposedAmount',item.proposed_amount,
                'paymentDate',proposal.payment_date,
                'vendorPaymentId',item.vendor_payment_id
              )
         FROM tenant.accounting_vendor_payment_proposal_items item
         JOIN tenant.accounting_vendor_payment_proposals proposal
           ON proposal.organization_id=item.organization_id
          AND proposal.id=item.proposal_id
        WHERE item.organization_id=$1
          AND item.vendor_bill_id=$2
     ) timeline
     ORDER BY happened_at DESC
     LIMIT 300`,
    [context.organizationId, billId],
  );
  return result.rows;
}

export async function listPayablesSavedViews(client, context) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.view);
  const result = await client.query(
    `SELECT *
       FROM tenant.accounting_payables_saved_views
      WHERE organization_id=$1
        AND (owner_user_id=$2 OR is_shared=true)
      ORDER BY is_shared DESC,updated_at DESC,name`,
    [context.organizationId, context.userId],
  );
  return result.rows;
}

export async function savePayablesView(client, context, input = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.view);
  const name = text(input.name, 120);
  if (!name)
    throw new PayablesGovernanceError(400, "Saved-view name is required.");
  const filters = object(input.filters);
  const columns = Array.isArray(input.columns)
    ? input.columns.slice(0, 30)
    : [];
  const sort = Array.isArray(input.sort) ? input.sort.slice(0, 10) : [];
  const isShared = Boolean(input.isShared);
  if (
    isShared &&
    !hasPermission(context, ACCOUNTING_PERMISSIONS.payablesManage)
  ) {
    throw new PayablesGovernanceError(
      403,
      "Payables permission is required to share payables views.",
    );
  }
  const result = await client.query(
    `INSERT INTO tenant.accounting_payables_saved_views (
       organization_id,owner_user_id,name,filters,columns,sort,is_shared
     ) VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7)
     ON CONFLICT (organization_id,owner_user_id,name)
     DO UPDATE SET filters=EXCLUDED.filters,columns=EXCLUDED.columns,
                   sort=EXCLUDED.sort,is_shared=EXCLUDED.is_shared,
                   updated_at=now()
     RETURNING *`,
    [
      context.organizationId,
      context.userId,
      name,
      JSON.stringify(filters),
      JSON.stringify(columns),
      JSON.stringify(sort),
      isShared,
    ],
  );
  return result.rows[0];
}

export async function deletePayablesSavedView(client, context, viewIdValue) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.view);
  const viewId = uuid(viewIdValue, "Saved payables view");
  const result = await client.query(
    `DELETE FROM tenant.accounting_payables_saved_views
      WHERE organization_id=$1 AND id=$2
        AND (owner_user_id=$3 OR $4::boolean=true)
      RETURNING id`,
    [
      context.organizationId,
      viewId,
      context.userId,
      hasPermission(context, ACCOUNTING_PERMISSIONS.payablesManage),
    ],
  );
  if (!result.rows[0])
    throw new PayablesGovernanceError(404, "Saved view was not found.");
  return { deleted: true, id: result.rows[0].id };
}

async function validateOwner(client, context, ownerUserId) {
  if (!ownerUserId) return null;
  const ownerId = uuid(ownerUserId, "Payables owner");
  const result = await client.query(
    `SELECT user_id
       FROM public.organization_memberships
      WHERE organization_id=$1 AND user_id=$2 AND status='active'`,
    [context.organizationId, ownerId],
  );
  if (!result.rows[0]) {
    throw new PayablesGovernanceError(
      409,
      "Payables owner is not an active organisation member.",
    );
  }
  return ownerId;
}

export async function upsertPayablesExceptionCase(
  client,
  context,
  billIdValue,
  input = {},
) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.payablesManage);
  const billId = uuid(billIdValue, "Vendor bill");
  const rows = await loadPayableRows(client, context, billId);
  const bill = rows[0];
  if (!bill) throw new PayablesGovernanceError(404, "Vendor bill not found.");
  const status = string(input.status || "open");
  if (!EXCEPTION_STATUSES.has(status)) {
    throw new PayablesGovernanceError(400, "Exception-case status is invalid.");
  }
  const priority = string(input.priority || "normal");
  if (!EXCEPTION_PRIORITIES.has(priority)) {
    throw new PayablesGovernanceError(400, "Exception priority is invalid.");
  }
  const reasonCode = string(input.reasonCode || "other");
  if (!EXCEPTION_REASONS.has(reasonCode)) {
    throw new PayablesGovernanceError(400, "Exception reason is invalid.");
  }
  const ownerUserId = await validateOwner(
    client,
    context,
    input.ownerUserId || null,
  );
  const result = await client.query(
    `INSERT INTO tenant.accounting_payables_exception_cases (
       organization_id,vendor_bill_id,company_id,party_id,status,priority,
       reason_code,owner_user_id,next_action_at,note,created_by,updated_by,
       resolved_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11,
       CASE WHEN $5 IN ('resolved','closed') THEN now() ELSE NULL END)
     ON CONFLICT (organization_id,vendor_bill_id)
     DO UPDATE SET status=EXCLUDED.status,priority=EXCLUDED.priority,
                   reason_code=EXCLUDED.reason_code,
                   owner_user_id=EXCLUDED.owner_user_id,
                   next_action_at=EXCLUDED.next_action_at,
                   note=EXCLUDED.note,updated_by=EXCLUDED.updated_by,
                   updated_at=now(),
                   resolved_at=CASE
                     WHEN EXCLUDED.status IN ('resolved','closed') THEN now()
                     ELSE NULL
                   END
     RETURNING *`,
    [
      context.organizationId,
      bill.id,
      bill.company_id,
      bill.party_id,
      status,
      priority,
      reasonCode,
      ownerUserId,
      dateTime(input.nextActionAt, "Next action"),
      text(input.note, 2000) || null,
      context.userId,
    ],
  );
  await event(
    client,
    context,
    "vendor_bill",
    bill.id,
    "accounting.payables.exception_case_updated",
    bill.exception_case_status || null,
    status,
    {
      exceptionCaseId: result.rows[0].id,
      priority,
      reasonCode,
      ownerUserId,
      nextActionAt: result.rows[0].next_action_at,
    },
  );
  return result.rows[0];
}

export async function bulkManagePayablesExceptions(
  client,
  context,
  input = {},
) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.payablesManage);
  const ids = [
    ...new Set(Array.isArray(input.ids) ? input.ids.map(String) : []),
  ];
  if (ids.length < 1 || ids.length > 200) {
    throw new PayablesGovernanceError(
      400,
      "Select between 1 and 200 vendor bills.",
    );
  }
  for (const id of ids) uuid(id, "Vendor bill");
  const changes = object(input.changes);
  if (!Object.keys(changes).length) {
    throw new PayablesGovernanceError(400, "Exception changes are required.");
  }
  const results = [];
  for (const id of ids) {
    results.push(
      await upsertPayablesExceptionCase(client, context, id, changes),
    );
  }
  return { updated: results.length, cases: results };
}

export async function listVendorPaymentProposals(client, context) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.view);
  const values = [context.organizationId];
  let where = "";
  if (!context.allowAllCompanies && context.activeCompanyId) {
    values.push(context.activeCompanyId);
    where = ` AND proposal.company_id=$${values.length}`;
  }
  const result = await client.query(
    `SELECT proposal.*,company.name AS company_name,
            bank.bank_name,bank.masked_account_number,
            COALESCE(item_summary.selected_count,0)::int AS selected_count,
            COALESCE(item_summary.prepared_count,0)::int AS prepared_count,
            COALESCE(item_summary.selected_amount,0) AS selected_amount
       FROM tenant.accounting_vendor_payment_proposals proposal
       JOIN public.companies company
         ON company.organization_id=proposal.organization_id
        AND company.id=proposal.company_id
       LEFT JOIN tenant.accounting_bank_accounts bank
         ON bank.organization_id=proposal.organization_id
        AND bank.id=proposal.bank_account_id
       LEFT JOIN LATERAL (
         SELECT count(*) FILTER (WHERE item.status='selected') AS selected_count,
                count(*) FILTER (WHERE item.status='prepared') AS prepared_count,
                COALESCE(sum(item.proposed_amount)
                  FILTER (WHERE item.status='selected'),0) AS selected_amount
           FROM tenant.accounting_vendor_payment_proposal_items item
          WHERE item.organization_id=proposal.organization_id
            AND item.proposal_id=proposal.id
       ) item_summary ON true
      WHERE proposal.organization_id=$1${where}
      ORDER BY proposal.created_at DESC
      LIMIT 200`,
    values,
  );
  return result.rows;
}

export async function createVendorPaymentProposal(client, context, input = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.paymentsManage);
  const policy = await loadPolicy(client, context);
  const rows = await loadPayableRows(client, context);
  const requestedIds = [
    ...new Set(Array.isArray(input.billIds) ? input.billIds.map(String) : []),
  ];
  if (requestedIds.length > 200) {
    throw new PayablesGovernanceError(
      400,
      "A payment proposal can include at most 200 vendor bills.",
    );
  }
  for (const id of requestedIds) uuid(id, "Vendor bill");
  let candidates = rows.filter((row) => {
    if (requestedIds.length && !requestedIds.includes(String(row.id))) {
      return false;
    }
    const health = evaluatePayableHealth(row, policy);
    return health.paymentEligible && number(row.active_proposal_amount) <= 0;
  });
  if (input.companyId) {
    const companyId = uuid(input.companyId, "Company");
    candidates = candidates.filter((row) => row.company_id === companyId);
  }
  if (input.currencyCode) {
    const currencyCode = string(input.currencyCode).toUpperCase();
    candidates = candidates.filter(
      (row) => string(row.currency_code).toUpperCase() === currencyCode,
    );
  }
  if (!candidates.length) {
    throw new PayablesGovernanceError(
      409,
      "No payment-eligible vendor bills match the proposal selection.",
    );
  }
  const companyIds = new Set(candidates.map((row) => row.company_id));
  const currencyCodes = new Set(candidates.map((row) => row.currency_code));
  if (companyIds.size !== 1 || currencyCodes.size !== 1) {
    throw new PayablesGovernanceError(
      409,
      "A payment proposal must contain one company and one currency.",
    );
  }
  const companyId = candidates[0].company_id;
  const currencyCode = candidates[0].currency_code;
  const paymentDate = dateOnly(input.paymentDate || new Date().toISOString());
  if (!paymentDate) {
    throw new PayablesGovernanceError(400, "Payment date is invalid.");
  }
  const bankAccountId = input.bankAccountId
    ? uuid(input.bankAccountId, "Bank account")
    : null;
  if (bankAccountId) {
    const bank = await client.query(
      `SELECT id
         FROM tenant.accounting_bank_accounts
        WHERE organization_id=$1 AND id=$2 AND company_id=$3
          AND currency_code=$4 AND status='active'`,
      [context.organizationId, bankAccountId, companyId, currencyCode],
    );
    if (!bank.rows[0]) {
      throw new PayablesGovernanceError(
        409,
        "Selected bank account is not active for the proposal company and currency.",
      );
    }
  }
  const proposalCode = `PAYRUN-${paymentDate.replaceAll("-", "")}-${randomUUID()
    .slice(0, 8)
    .toUpperCase()}`;
  const proposal = await client.query(
    `INSERT INTO tenant.accounting_vendor_payment_proposals (
       organization_id,company_id,proposal_code,payment_date,currency_code,
       bank_account_id,status,notes,created_by,updated_by
     ) VALUES ($1,$2,$3,$4,$5,$6,'draft',$7,$8,$8)
     RETURNING *`,
    [
      context.organizationId,
      companyId,
      proposalCode,
      paymentDate,
      currencyCode,
      bankAccountId,
      text(input.notes, 2000) || null,
      context.userId,
    ],
  );
  let total = 0n;
  for (const bill of candidates) {
    const amount = decimal(bill.outstanding_amount);
    total += amount;
    await client.query(
      `INSERT INTO tenant.accounting_vendor_payment_proposal_items (
         organization_id,proposal_id,vendor_bill_id,proposed_amount,
         selection_reason,created_by,updated_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$6)`,
      [
        context.organizationId,
        proposal.rows[0].id,
        bill.id,
        asDatabaseDecimal(amount),
        "Eligible within the configured payment horizon.",
        context.userId,
      ],
    );
  }
  const updated = await client.query(
    `UPDATE tenant.accounting_vendor_payment_proposals
        SET total_amount=$3,item_count=$4,updated_by=$5,updated_at=now()
      WHERE organization_id=$1 AND id=$2
      RETURNING *`,
    [
      context.organizationId,
      proposal.rows[0].id,
      asDatabaseDecimal(total),
      candidates.length,
      context.userId,
    ],
  );
  await event(
    client,
    context,
    "vendor_payment_proposal",
    proposal.rows[0].id,
    "accounting.payables.payment_proposal_created",
    null,
    "draft",
    {
      proposalCode,
      itemCount: candidates.length,
      total: asDatabaseDecimal(total),
    },
  );
  return updated.rows[0];
}

async function lockPaymentProposal(client, context, proposalIdValue) {
  const proposalId = uuid(proposalIdValue, "Vendor payment proposal");
  const values = [context.organizationId, proposalId];
  let companyScope = "";
  if (!context.allowAllCompanies && context.activeCompanyId) {
    values.push(context.activeCompanyId);
    companyScope = ` AND company_id=$${values.length}`;
  }
  const result = await client.query(
    `SELECT *
       FROM tenant.accounting_vendor_payment_proposals
      WHERE organization_id=$1 AND id=$2${companyScope}
      FOR UPDATE`,
    values,
  );
  if (!result.rows[0]) {
    throw new PayablesGovernanceError(404, "Payment proposal was not found.");
  }
  return result.rows[0];
}

export async function changeVendorPaymentProposalStatus(
  client,
  context,
  proposalIdValue,
  input = {},
) {
  const proposal = await lockPaymentProposal(client, context, proposalIdValue);
  const targetStatus = string(input.status);
  const allowed = PROPOSAL_TRANSITIONS[proposal.status] || new Set();
  if (!allowed.has(targetStatus) || targetStatus === "prepared") {
    throw new PayablesGovernanceError(
      409,
      `Payment proposal cannot move from ${proposal.status} to ${targetStatus || "an empty status"}.`,
    );
  }
  if (["approved", "rejected"].includes(targetStatus)) {
    requirePermission(context, ACCOUNTING_PERMISSIONS.paymentsApprove);
    if (
      proposal.created_by === context.userId &&
      !context.roleSlugs?.includes("organization_owner")
    ) {
      throw new PayablesGovernanceError(
        409,
        "Payment proposal creator cannot approve or reject their own proposal.",
      );
    }
  } else {
    requirePermission(context, ACCOUNTING_PERMISSIONS.paymentsManage);
  }
  const result = await client.query(
    `UPDATE tenant.accounting_vendor_payment_proposals
        SET status=$3,
            submitted_at=CASE WHEN $3='submitted' THEN now() ELSE submitted_at END,
            submitted_by=CASE WHEN $3='submitted' THEN $4 ELSE submitted_by END,
            approved_at=CASE WHEN $3='approved' THEN now() ELSE approved_at END,
            approved_by=CASE WHEN $3='approved' THEN $4 ELSE approved_by END,
            updated_by=$4,updated_at=now()
      WHERE organization_id=$1 AND id=$2
      RETURNING *`,
    [context.organizationId, proposal.id, targetStatus, context.userId],
  );
  await event(
    client,
    context,
    "vendor_payment_proposal",
    proposal.id,
    "accounting.payables.payment_proposal_status_changed",
    proposal.status,
    targetStatus,
    { note: text(input.note, 1000) || null },
  );
  return result.rows[0];
}

export async function prepareVendorPaymentsFromProposal(
  client,
  context,
  proposalIdValue,
) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.paymentsManage);
  const proposal = await lockPaymentProposal(client, context, proposalIdValue);
  if (proposal.status !== "approved") {
    throw new PayablesGovernanceError(
      409,
      "Only an approved payment proposal can prepare vendor payments.",
    );
  }
  const items = await client.query(
    `SELECT item.*,bill.party_id,bill.ledger_id,bill.branch_id,
            bill.bill_number,bill.outstanding_amount
       FROM tenant.accounting_vendor_payment_proposal_items item
       JOIN tenant.accounting_vendor_bills bill
         ON bill.organization_id=item.organization_id
        AND bill.id=item.vendor_bill_id
      WHERE item.organization_id=$1 AND item.proposal_id=$2
        AND item.status='selected'
      ORDER BY bill.party_id,bill.due_date,bill.bill_number
      FOR UPDATE OF item`,
    [context.organizationId, proposal.id],
  );
  if (!items.rows.length) {
    throw new PayablesGovernanceError(
      409,
      "Payment proposal has no selected items to prepare.",
    );
  }
  const groups = new Map();
  for (const item of items.rows) {
    if (decimal(item.proposed_amount) > decimal(item.outstanding_amount)) {
      throw new PayablesGovernanceError(
        409,
        `Proposed amount exceeds ${item.bill_number} outstanding balance.`,
      );
    }
    const key = `${item.party_id}:${item.ledger_id}:${item.branch_id || ""}`;
    const group = groups.get(key) || {
      partyId: item.party_id,
      ledgerId: item.ledger_id,
      branchId: item.branch_id,
      amount: 0n,
      items: [],
    };
    group.amount += decimal(item.proposed_amount);
    group.items.push(item);
    groups.set(key, group);
  }
  const payments = [];
  for (const group of groups.values()) {
    const payment = await createVendorPayment(client, context, {
      companyId: proposal.company_id,
      branchId: group.branchId,
      ledgerId: group.ledgerId,
      partyId: group.partyId,
      bankAccountId: proposal.bank_account_id,
      paymentDate: proposal.payment_date,
      accountingDate: proposal.payment_date,
      currencyCode: proposal.currency_code,
      amount: asDatabaseDecimal(group.amount),
      paymentMethod: "bank_transfer",
      externalReference: proposal.proposal_code,
    });
    payments.push(payment);
    await client.query(
      `UPDATE tenant.accounting_vendor_payment_proposal_items
          SET status='prepared',vendor_payment_id=$4,updated_by=$5,updated_at=now()
        WHERE organization_id=$1 AND proposal_id=$2
          AND id=ANY($3::uuid[])`,
      [
        context.organizationId,
        proposal.id,
        group.items.map((item) => item.id),
        payment.id,
        context.userId,
      ],
    );
  }
  const updated = await client.query(
    `UPDATE tenant.accounting_vendor_payment_proposals
        SET status='prepared',prepared_at=now(),prepared_by=$3,
            updated_by=$3,updated_at=now()
      WHERE organization_id=$1 AND id=$2
      RETURNING *`,
    [context.organizationId, proposal.id, context.userId],
  );
  await event(
    client,
    context,
    "vendor_payment_proposal",
    proposal.id,
    "accounting.payables.vendor_payments_prepared",
    proposal.status,
    "prepared",
    { paymentIds: payments.map((payment) => payment.id) },
  );
  return { proposal: updated.rows[0], payments };
}

export async function refreshPayablesAging(client, context) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.payablesManage);
  const values = [context.organizationId, context.userId];
  let companyScope = "";
  if (!context.allowAllCompanies && context.activeCompanyId) {
    values.push(context.activeCompanyId);
    companyScope = ` AND company_id=$${values.length}`;
  }
  const result = await client.query(
    `UPDATE tenant.accounting_vendor_bills
        SET status='overdue',updated_by=$2,updated_at=now()
      WHERE organization_id=$1${companyScope}
        AND status IN ('posted','partially_paid')
        AND outstanding_amount>0
        AND due_date<current_date
      RETURNING id,bill_number`,
    values,
  );
  return { updated: result.rows.length, bills: result.rows };
}
