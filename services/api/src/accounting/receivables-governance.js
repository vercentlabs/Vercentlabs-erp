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

export class ReceivablesGovernanceError extends AccountingError {
  constructor(status, message, code = "RECEIVABLES_GOVERNANCE_ERROR") {
    super(status, message, code);
    this.name = "ReceivablesGovernanceError";
  }
}

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const OPEN_INVOICE_STATUSES = new Set([
  "posted",
  "partially_paid",
  "overdue",
  "disputed",
]);
const COLLECTION_STATUSES = new Set([
  "open",
  "promise_to_pay",
  "disputed",
  "escalated",
  "resolved",
  "closed",
]);
const COLLECTION_PRIORITIES = new Set(["low", "normal", "high", "urgent"]);

const number = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const string = (value) => String(value ?? "").trim();
const object = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};
const hasKeys = (value) => Object.keys(object(value)).length > 0;
const dateOnly = (value) => {
  const result = string(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(result) ? result : null;
};
const dateTime = (value, label) => {
  if (value === undefined || value === null || value === "") return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new ReceivablesGovernanceError(400, `${label} is invalid.`);
  }
  return parsed.toISOString();
};

function requireAnyPermission(context, permissions) {
  if (!permissions.some((permission) => hasPermission(context, permission))) {
    throw new ReceivablesGovernanceError(
      403,
      "You do not have permission to manage receivables governance.",
      "RECEIVABLES_GOVERNANCE_PERMISSION_DENIED",
    );
  }
}

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
    collectionStartDays: Math.max(
      0,
      number(policy.collection_start_days ?? policy.collectionStartDays ?? 1),
    ),
    escalationDays: Math.max(
      1,
      number(policy.escalation_days ?? policy.escalationDays ?? 30),
    ),
    highRiskDays: Math.max(
      1,
      number(policy.high_risk_days ?? policy.highRiskDays ?? 60),
    ),
    requireBillingAddress:
      policy.require_billing_address ?? policy.requireBillingAddress ?? true,
    requirePaymentTerms:
      policy.require_payment_terms ?? policy.requirePaymentTerms ?? true,
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

export function evaluateReceivableHealth(
  row,
  policyInput = {},
  now = new Date(),
) {
  const policy = defaultPolicy(policyInput);
  const blockers = [];
  const warnings = [];
  const invoiceType = string(row.invoice_type || row.invoiceType || "invoice");
  const status = string(row.status);
  const customerStatus = string(row.customer_status || row.customerStatus);
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
  const collectionCaseStatus = string(
    row.collection_case_status || row.collectionCaseStatus,
  );
  const failedDunningActions = number(
    row.failed_dunning_actions ?? row.failedDunningActions,
  );
  const unappliedReceiptAmount = number(
    row.unapplied_receipt_amount ?? row.unappliedReceiptAmount,
  );
  const dueDays = daysFromToday(row.due_date || row.dueDate, now);
  const updatedAge = age(
    row.updated_at || row.updatedAt || row.created_at,
    now,
  );
  const isOpen = OPEN_INVOICE_STATUSES.has(status) && outstandingAmount > 0;
  const daysOverdue = isOpen && dueDays !== null ? Math.max(0, dueDays) : 0;
  const daysUntilDue =
    isOpen && dueDays !== null ? Math.max(0, -dueDays) : null;

  if (lineCount < 1)
    blockers.push("Customer invoice requires at least one line.");
  if (grandTotal <= 0)
    blockers.push("Customer invoice total must be greater than zero.");
  if (customerStatus && customerStatus !== "active")
    blockers.push("Customer is inactive.");
  if (!hasKeys(row.customer_snapshot ?? row.customerSnapshot))
    blockers.push("Customer snapshot is missing.");
  if (
    policy.requireBillingAddress &&
    !hasKeys(row.billing_address_snapshot ?? row.billingAddressSnapshot)
  )
    blockers.push("Billing-address snapshot is required.");
  if (
    policy.requirePaymentTerms &&
    !hasKeys(row.payment_term_snapshot ?? row.paymentTermSnapshot)
  )
    blockers.push("Payment-term snapshot is required.");
  if (
    policy.requirePaymentSchedule &&
    invoiceType !== "credit_note" &&
    scheduleCount < 1
  )
    blockers.push("A payment schedule is required.");
  if (scheduleCount > 0 && !moneyEqual(scheduleTotal, grandTotal))
    blockers.push("Payment schedule does not reconcile to the invoice total.");
  if (
    scheduleCount > 0 &&
    !["draft", "pending_approval", "approved"].includes(status) &&
    !moneyEqual(scheduleOutstanding, outstandingAmount)
  )
    blockers.push("Payment schedule outstanding amount is inconsistent.");
  if (
    ["posted", "partially_paid", "paid", "overdue", "disputed"].includes(
      status,
    ) &&
    !row.journal_entry_id &&
    !row.journalEntryId
  )
    blockers.push("Posted receivable is missing its accounting journal.");
  if (status === "paid" && outstandingAmount > 0)
    blockers.push("Paid invoice still has an outstanding balance.");
  if (outstandingAmount < 0 || outstandingAmount > grandTotal)
    blockers.push("Outstanding balance is outside the invoice total.");

  if (
    status === "pending_approval" &&
    updatedAge.hours > policy.approvalSlaHours
  )
    warnings.push("Invoice approval is outside its SLA.");
  if (
    ["draft", "pending_approval", "approved"].includes(status) &&
    updatedAge.days > policy.staleAfterDays
  )
    warnings.push("Invoice has had no recent progress.");
  if (isOpen && dueDays !== null && dueDays > 0)
    warnings.push(`Invoice is ${dueDays} day(s) overdue.`);
  else if (
    isOpen &&
    daysUntilDue !== null &&
    daysUntilDue <= policy.dueSoonDays
  )
    warnings.push(`Invoice is due in ${daysUntilDue} day(s).`);
  if (daysOverdue >= policy.collectionStartDays && !collectionCaseStatus)
    warnings.push("Overdue invoice has no active collection case.");
  if (
    daysOverdue >= policy.escalationDays &&
    !["escalated", "resolved", "closed"].includes(collectionCaseStatus)
  )
    warnings.push("Collection case requires escalation.");
  if (status === "disputed" || collectionCaseStatus === "disputed")
    warnings.push("Receivable is under dispute.");
  if (failedDunningActions > 0)
    warnings.push("One or more collection actions failed.");
  if (unappliedReceiptAmount > 0 && isOpen)
    warnings.push("Customer has unapplied receipts available for allocation.");
  if (string(row.source_request_status) === "failed")
    warnings.push("The originating Sales invoice request failed previously.");

  const readiness = blockers.length
    ? "blocked"
    : warnings.length
      ? "attention"
      : "ready";
  const riskBand =
    daysOverdue >= policy.highRiskDays
      ? "high"
      : daysOverdue >= policy.escalationDays
        ? "elevated"
        : daysOverdue > 0
          ? "overdue"
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
    collectionRequired:
      daysOverdue >= policy.collectionStartDays && outstandingAmount > 0,
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
      unappliedReceiptAmount,
      failedDunningActions,
    },
  };
}

export function buildReceivablesGovernanceSummary(
  rows,
  policyInput = {},
  now = new Date(),
) {
  const receiptKeys = new Set();
  const summary = {
    total: rows.length,
    draft: 0,
    pendingApproval: 0,
    open: 0,
    overdue: 0,
    dueSoon: 0,
    disputed: 0,
    paid: 0,
    ready: 0,
    attention: 0,
    blocked: 0,
    collectionRequired: 0,
    totalInvoiced: 0,
    outstanding: 0,
    overdueOutstanding: 0,
    dueSoonOutstanding: 0,
    unappliedReceipts: 0,
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
    const health = evaluateReceivableHealth(row, policyInput, now);
    const outstanding = number(row.outstanding_amount ?? row.outstandingAmount);
    summary.totalInvoiced += number(row.grand_total ?? row.grandTotal);
    summary.outstanding += outstanding;
    const receiptKey = `${string(row.party_id || row.partyId)}:${string(
      row.currency_code || row.currencyCode,
    )}`;
    if (!receiptKeys.has(receiptKey)) {
      receiptKeys.add(receiptKey);
      summary.unappliedReceipts += number(
        row.unapplied_receipt_amount ?? row.unappliedReceiptAmount,
      );
    }
    if (status === "draft") summary.draft += 1;
    if (status === "pending_approval") summary.pendingApproval += 1;
    if (status === "disputed") summary.disputed += 1;
    if (status === "paid") summary.paid += 1;
    if (health.isOpen) summary.open += 1;
    if (health.isOverdue) {
      summary.overdue += 1;
      summary.overdueOutstanding += outstanding;
    }
    if (health.isDueSoon) {
      summary.dueSoon += 1;
      summary.dueSoonOutstanding += outstanding;
    }
    if (health.collectionRequired) summary.collectionRequired += 1;
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
       FROM tenant.accounting_receivables_governance_policies
      WHERE organization_id=$1`,
    [context.organizationId],
  );
  return result.rows[0] || {};
}

async function loadReceivableRows(client, context, invoiceId = null) {
  const values = [context.organizationId];
  let where = "";
  if (!context.allowAllCompanies && context.activeCompanyId) {
    values.push(context.activeCompanyId);
    where += ` AND invoice.company_id=$${values.length}`;
  }
  if (invoiceId) {
    values.push(uuid(invoiceId, "Customer invoice"));
    where += ` AND invoice.id=$${values.length}`;
  }
  const result = await client.query(
    `SELECT invoice.*,
            party.display_name AS customer_name,
            party.status AS customer_status,
            company.name AS company_name,
            COALESCE(line_summary.line_count,0)::int AS line_count,
            COALESCE(schedule_summary.schedule_count,0)::int AS schedule_count,
            COALESCE(schedule_summary.schedule_total,0) AS schedule_total,
            COALESCE(schedule_summary.schedule_outstanding,0) AS schedule_outstanding,
            collection.status AS collection_case_status,
            collection.priority AS collection_priority,
            collection.next_action_at AS collection_next_action_at,
            collection.promised_date AS collection_promised_date,
            collection.promised_amount AS collection_promised_amount,
            COALESCE(dunning.failed_actions,0)::int AS failed_dunning_actions,
            COALESCE(receipt_summary.unapplied_receipt_amount,0) AS unapplied_receipt_amount,
            request.status AS source_request_status,
            request.last_error AS source_request_error
       FROM tenant.accounting_customer_invoices invoice
       JOIN tenant.business_parties party
         ON party.organization_id=invoice.organization_id
        AND party.id=invoice.party_id
       JOIN public.companies company
         ON company.organization_id=invoice.organization_id
        AND company.id=invoice.company_id
       LEFT JOIN LATERAL (
         SELECT count(*) AS line_count
           FROM tenant.accounting_customer_invoice_lines line
          WHERE line.organization_id=invoice.organization_id
            AND line.customer_invoice_id=invoice.id
       ) line_summary ON true
       LEFT JOIN LATERAL (
         SELECT count(*) AS schedule_count,
                COALESCE(sum(amount),0) AS schedule_total,
                COALESCE(sum(outstanding_amount),0) AS schedule_outstanding
           FROM tenant.accounting_customer_invoice_schedules schedule
          WHERE schedule.organization_id=invoice.organization_id
            AND schedule.customer_invoice_id=invoice.id
       ) schedule_summary ON true
       LEFT JOIN tenant.accounting_collection_cases collection
         ON collection.organization_id=invoice.organization_id
        AND collection.customer_invoice_id=invoice.id
       LEFT JOIN LATERAL (
         SELECT count(*) FILTER (WHERE action.status='failed') AS failed_actions
           FROM tenant.accounting_dunning_actions action
          WHERE action.organization_id=invoice.organization_id
            AND action.invoice_id=invoice.id
       ) dunning ON true
       LEFT JOIN LATERAL (
         SELECT COALESCE(sum(receipt.unapplied_amount),0) AS unapplied_receipt_amount
           FROM tenant.accounting_customer_receipts receipt
          WHERE receipt.organization_id=invoice.organization_id
            AND receipt.company_id=invoice.company_id
            AND receipt.party_id=invoice.party_id
            AND receipt.currency_code=invoice.currency_code
            AND receipt.status IN ('posted','partially_applied')
            AND receipt.unapplied_amount>0
       ) receipt_summary ON true
       LEFT JOIN tenant.sales_invoice_requests request
         ON request.organization_id=invoice.organization_id
        AND request.id=invoice.source_sales_invoice_request_id
      WHERE invoice.organization_id=$1${where}
      ORDER BY invoice.due_date,invoice.created_at DESC`,
    values,
  );
  return result.rows;
}

export async function getReceivablesGovernanceDashboard(client, context) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.view);
  const scopedValues = [context.organizationId];
  let companyScope = "";
  if (!context.allowAllCompanies && context.activeCompanyId) {
    scopedValues.push(context.activeCompanyId);
    companyScope = ` AND invoice.company_id=$${scopedValues.length}`;
  }
  const requestValues = [context.organizationId];
  let requestCompanyScope = "";
  if (!context.allowAllCompanies && context.activeCompanyId) {
    requestValues.push(context.activeCompanyId);
    requestCompanyScope = ` AND sales_order.company_id=$${requestValues.length}`;
  }
  const [policy, invoices, importQueue, collectionCases] = await Promise.all([
    loadPolicy(client, context),
    loadReceivableRows(client, context),
    client.query(
      `SELECT request.id,request.request_number,request.status,request.retry_count,
              request.last_error,request.requested_at,sales_order.sales_order_number
         FROM tenant.sales_invoice_requests request
         JOIN tenant.sales_orders sales_order
           ON sales_order.organization_id=request.organization_id
          AND sales_order.id=request.sales_order_id
        WHERE request.organization_id=$1
          AND request.status IN ('pending','processing','failed')${requestCompanyScope}
        ORDER BY request.status='failed' DESC,request.requested_at
        LIMIT 100`,
      requestValues,
    ),
    client.query(
      `SELECT collection.*,invoice.invoice_number,invoice.currency_code,
              invoice.outstanding_amount,invoice.due_date,
              party.display_name AS customer_name
         FROM tenant.accounting_collection_cases collection
         JOIN tenant.accounting_customer_invoices invoice
           ON invoice.organization_id=collection.organization_id
          AND invoice.id=collection.customer_invoice_id
         JOIN tenant.business_parties party
           ON party.organization_id=invoice.organization_id
          AND party.id=invoice.party_id
        WHERE collection.organization_id=$1
          AND collection.status NOT IN ('resolved','closed')${companyScope}
        ORDER BY collection.priority='urgent' DESC,
                 collection.priority='high' DESC,
                 collection.next_action_at NULLS FIRST,
                 invoice.due_date
        LIMIT 200`,
      scopedValues,
    ),
  ]);
  const summary = buildReceivablesGovernanceSummary(invoices, policy);
  const assessed = invoices.map((invoice) => ({
    ...invoice,
    health: evaluateReceivableHealth(invoice, policy),
  }));
  const customers = new Map();
  for (const row of assessed) {
    const key = row.party_id;
    const current = customers.get(key) || {
      partyId: row.party_id,
      customerName: row.customer_name,
      outstanding: 0,
      overdueOutstanding: 0,
      invoiceCount: 0,
    };
    current.outstanding += number(row.outstanding_amount);
    current.invoiceCount += 1;
    if (row.health.isOverdue)
      current.overdueOutstanding += number(row.outstanding_amount);
    customers.set(key, current);
  }
  return {
    policy: defaultPolicy(policy),
    summary,
    invoices: assessed,
    importQueue: importQueue.rows,
    collectionCases: collectionCases.rows,
    topCustomers: [...customers.values()]
      .sort((left, right) => right.overdueOutstanding - left.overdueOutstanding)
      .slice(0, 10),
  };
}

export async function assessCustomerInvoiceReadiness(
  client,
  context,
  invoiceId,
) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.view);
  const [policy, rows] = await Promise.all([
    loadPolicy(client, context),
    loadReceivableRows(client, context, invoiceId),
  ]);
  const invoice = rows[0];
  if (!invoice)
    throw new ReceivablesGovernanceError(404, "Customer invoice not found.");
  return {
    invoice,
    policy: defaultPolicy(policy),
    health: evaluateReceivableHealth(invoice, policy),
  };
}

export async function captureReceivablesGovernanceSnapshot(
  client,
  context,
  invoiceId,
  capturedFor = "manual",
) {
  requireAnyPermission(context, [
    ACCOUNTING_PERMISSIONS.receivablesManage,
    ACCOUNTING_PERMISSIONS.collectionsManage,
  ]);
  const assessment = await assessCustomerInvoiceReadiness(
    client,
    {
      ...context,
      permissions: [
        ...(context.permissions || []),
        ACCOUNTING_PERMISSIONS.view,
      ],
    },
    invoiceId,
  );
  const result = await client.query(
    `INSERT INTO tenant.accounting_receivables_governance_snapshots (
       organization_id,customer_invoice_id,invoice_type,invoice_status,
       outstanding_amount,readiness_status,blockers,warnings,metrics,
       captured_for,captured_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10,$11)
     RETURNING *`,
    [
      context.organizationId,
      assessment.invoice.id,
      assessment.invoice.invoice_type,
      assessment.invoice.status,
      assessment.invoice.outstanding_amount,
      assessment.health.readiness,
      JSON.stringify(assessment.health.blockers),
      JSON.stringify(assessment.health.warnings),
      JSON.stringify(assessment.health.metrics),
      text(capturedFor, 80) || "manual",
      context.userId || null,
    ],
  );
  return result.rows[0];
}

export async function getCustomerInvoiceGovernanceTimeline(
  client,
  context,
  invoiceIdValue,
) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.view);
  const invoiceId = uuid(invoiceIdValue, "Customer invoice");
  const exists = await loadReceivableRows(client, context, invoiceId);
  if (!exists[0])
    throw new ReceivablesGovernanceError(404, "Customer invoice not found.");
  const result = await client.query(
    `SELECT * FROM (
       SELECT event.id,event.occurred_at AS happened_at,event.event_type AS kind,
              event.from_status,event.to_status,event.metadata
         FROM tenant.accounting_events event
        WHERE event.organization_id=$1
          AND event.entity_type='customer_invoice'
          AND event.entity_id=$2
       UNION ALL
       SELECT snapshot.id,snapshot.captured_at,'governance.snapshot',
              snapshot.invoice_status,snapshot.readiness_status,
              jsonb_build_object(
                'capturedFor',snapshot.captured_for,
                'blockers',snapshot.blockers,
                'warnings',snapshot.warnings,
                'metrics',snapshot.metrics
              )
         FROM tenant.accounting_receivables_governance_snapshots snapshot
        WHERE snapshot.organization_id=$1
          AND snapshot.customer_invoice_id=$2
       UNION ALL
       SELECT collection.id,collection.updated_at,'collection.case',
              NULL,collection.status,
              jsonb_build_object(
                'priority',collection.priority,
                'nextActionAt',collection.next_action_at,
                'promisedDate',collection.promised_date,
                'promisedAmount',collection.promised_amount,
                'note',collection.note
              )
         FROM tenant.accounting_collection_cases collection
        WHERE collection.organization_id=$1
          AND collection.customer_invoice_id=$2
       UNION ALL
       SELECT allocation.id,allocation.allocated_at,'receipt.allocated',
              NULL,'allocated',
              jsonb_build_object(
                'receiptId',allocation.receipt_id,
                'allocatedAmount',allocation.allocated_amount,
                'discountTaken',allocation.discount_taken,
                'writeoffAmount',allocation.writeoff_amount
              )
         FROM tenant.accounting_customer_receipt_allocations allocation
        WHERE allocation.organization_id=$1
          AND allocation.customer_invoice_id=$2
       UNION ALL
       SELECT action.id,COALESCE(action.completed_at,run.created_at),
              'collection.dunning',NULL,action.status,
              jsonb_build_object(
                'level',action.level,
                'actionType',action.action_type,
                'overdueAmount',action.overdue_amount,
                'note',action.note
              )
         FROM tenant.accounting_dunning_actions action
         JOIN tenant.accounting_dunning_runs run
           ON run.organization_id=action.organization_id
          AND run.id=action.dunning_run_id
        WHERE action.organization_id=$1
          AND action.invoice_id=$2
     ) timeline
     ORDER BY happened_at DESC
     LIMIT 300`,
    [context.organizationId, invoiceId],
  );
  return result.rows;
}

export async function listReceivablesSavedViews(client, context) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.view);
  const result = await client.query(
    `SELECT *
       FROM tenant.accounting_receivables_saved_views
      WHERE organization_id=$1
        AND (owner_user_id=$2 OR is_shared=true)
      ORDER BY is_shared DESC,updated_at DESC,name`,
    [context.organizationId, context.userId],
  );
  return result.rows;
}

export async function saveReceivablesView(client, context, input = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.view);
  const name = text(input.name, 120);
  if (!name)
    throw new ReceivablesGovernanceError(400, "Saved-view name is required.");
  const filters = object(input.filters);
  const columns = Array.isArray(input.columns)
    ? input.columns.slice(0, 30)
    : [];
  const sort = Array.isArray(input.sort) ? input.sort.slice(0, 10) : [];
  const isShared = Boolean(input.isShared);
  if (
    isShared &&
    !hasPermission(context, ACCOUNTING_PERMISSIONS.collectionsManage)
  ) {
    throw new ReceivablesGovernanceError(
      403,
      "Collections permission is required to share receivables views.",
    );
  }
  const result = await client.query(
    `INSERT INTO tenant.accounting_receivables_saved_views (
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

export async function deleteReceivablesSavedView(client, context, viewIdValue) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.view);
  const viewId = uuid(viewIdValue, "Saved receivables view");
  const result = await client.query(
    `DELETE FROM tenant.accounting_receivables_saved_views
      WHERE organization_id=$1 AND id=$2
        AND (owner_user_id=$3 OR $4::boolean=true)
      RETURNING id`,
    [
      context.organizationId,
      viewId,
      context.userId,
      hasPermission(context, ACCOUNTING_PERMISSIONS.collectionsManage),
    ],
  );
  if (!result.rows[0])
    throw new ReceivablesGovernanceError(404, "Saved view was not found.");
  return { deleted: true, id: result.rows[0].id };
}

async function validateCollectionOwner(client, context, ownerUserId) {
  if (!ownerUserId) return null;
  const ownerId = uuid(ownerUserId, "Collection owner");
  const result = await client.query(
    `SELECT user_id
       FROM public.organization_memberships
      WHERE organization_id=$1 AND user_id=$2 AND status='active'`,
    [context.organizationId, ownerId],
  );
  if (!result.rows[0])
    throw new ReceivablesGovernanceError(
      409,
      "Collection owner is not an active organisation member.",
    );
  return ownerId;
}

export async function upsertReceivablesCollectionCase(
  client,
  context,
  invoiceIdValue,
  input = {},
) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.collectionsManage);
  const invoiceId = uuid(invoiceIdValue, "Customer invoice");
  const rows = await loadReceivableRows(client, context, invoiceId);
  const invoice = rows[0];
  if (!invoice)
    throw new ReceivablesGovernanceError(404, "Customer invoice not found.");
  if (number(invoice.outstanding_amount) <= 0)
    throw new ReceivablesGovernanceError(
      409,
      "A collection case requires an outstanding balance.",
    );
  const status = string(input.status || "open");
  if (!COLLECTION_STATUSES.has(status))
    throw new ReceivablesGovernanceError(
      400,
      "Collection-case status is invalid.",
    );
  const priority = string(input.priority || "normal");
  if (!COLLECTION_PRIORITIES.has(priority))
    throw new ReceivablesGovernanceError(
      400,
      "Collection priority is invalid.",
    );
  const ownerUserId = await validateCollectionOwner(
    client,
    context,
    input.ownerUserId || null,
  );
  const promisedDate = input.promisedDate ? dateOnly(input.promisedDate) : null;
  if (input.promisedDate && !promisedDate)
    throw new ReceivablesGovernanceError(400, "Promised date is invalid.");
  let promisedAmount = null;
  if (
    input.promisedAmount !== undefined &&
    input.promisedAmount !== null &&
    input.promisedAmount !== ""
  ) {
    promisedAmount = decimal(input.promisedAmount);
    if (promisedAmount < 0n)
      throw new ReceivablesGovernanceError(
        400,
        "Promised amount cannot be negative.",
      );
    if (promisedAmount > decimal(invoice.outstanding_amount))
      throw new ReceivablesGovernanceError(
        409,
        "Promised amount exceeds the outstanding balance.",
      );
  }
  const result = await client.query(
    `INSERT INTO tenant.accounting_collection_cases (
       organization_id,customer_invoice_id,company_id,party_id,status,priority,
       owner_user_id,next_action_at,promised_date,promised_amount,
       dispute_reason,note,created_by,updated_by,resolved_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13,
       CASE WHEN $5 IN ('resolved','closed') THEN now() ELSE NULL END)
     ON CONFLICT (organization_id,customer_invoice_id)
     DO UPDATE SET status=EXCLUDED.status,priority=EXCLUDED.priority,
                   owner_user_id=EXCLUDED.owner_user_id,
                   next_action_at=EXCLUDED.next_action_at,
                   promised_date=EXCLUDED.promised_date,
                   promised_amount=EXCLUDED.promised_amount,
                   dispute_reason=EXCLUDED.dispute_reason,
                   note=EXCLUDED.note,updated_by=EXCLUDED.updated_by,
                   updated_at=now(),
                   resolved_at=CASE
                     WHEN EXCLUDED.status IN ('resolved','closed') THEN now()
                     ELSE NULL
                   END
     RETURNING *`,
    [
      context.organizationId,
      invoice.id,
      invoice.company_id,
      invoice.party_id,
      status,
      priority,
      ownerUserId,
      dateTime(input.nextActionAt, "Next action"),
      promisedDate,
      promisedAmount === null ? null : asDatabaseDecimal(promisedAmount),
      text(input.disputeReason, 1000) || null,
      text(input.note, 2000) || null,
      context.userId,
    ],
  );
  await event(
    client,
    context,
    "customer_invoice",
    invoice.id,
    "accounting.receivables.collection_case_updated",
    invoice.collection_case_status || null,
    status,
    {
      collectionCaseId: result.rows[0].id,
      priority,
      ownerUserId,
      nextActionAt: result.rows[0].next_action_at,
      promisedDate,
      promisedAmount:
        promisedAmount === null ? null : asDatabaseDecimal(promisedAmount),
    },
  );
  return result.rows[0];
}

export async function bulkManageReceivablesCollections(
  client,
  context,
  input = {},
) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.collectionsManage);
  const ids = [
    ...new Set(Array.isArray(input.ids) ? input.ids.map(String) : []),
  ];
  if (ids.length < 1 || ids.length > 200)
    throw new ReceivablesGovernanceError(
      400,
      "Select between 1 and 200 customer invoices.",
    );
  for (const id of ids) uuid(id, "Customer invoice");
  const changes = object(input.changes);
  if (!Object.keys(changes).length)
    throw new ReceivablesGovernanceError(
      400,
      "Collection changes are required.",
    );
  const ownerUserId = await validateCollectionOwner(
    client,
    context,
    changes.ownerUserId || null,
  );
  const invoiceValues = [context.organizationId, ids];
  let companyScope = "";
  if (!context.allowAllCompanies && context.activeCompanyId) {
    invoiceValues.push(context.activeCompanyId);
    companyScope = ` AND company_id=$${invoiceValues.length}`;
  }
  const rows = await client.query(
    `SELECT id
       FROM tenant.accounting_customer_invoices
      WHERE organization_id=$1 AND id=ANY($2::uuid[])${companyScope}
        AND outstanding_amount>0
        AND status IN ('posted','partially_paid','overdue','disputed')
      FOR UPDATE`,
    invoiceValues,
  );
  if (rows.rows.length !== ids.length)
    throw new ReceivablesGovernanceError(
      409,
      "Every selected invoice must be an open receivable in the active scope.",
    );
  const results = [];
  for (const id of ids) {
    results.push(
      await upsertReceivablesCollectionCase(client, context, id, {
        ...changes,
        ownerUserId,
      }),
    );
  }
  return { updated: results.length, cases: results };
}

export async function refreshReceivablesAging(client, context) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.collectionsManage);
  const scheduleValues = [context.organizationId];
  const invoiceValues = [context.organizationId, context.userId];
  let scheduleCompanyScope = "";
  let invoiceCompanyScope = "";
  if (!context.allowAllCompanies && context.activeCompanyId) {
    scheduleValues.push(context.activeCompanyId);
    invoiceValues.push(context.activeCompanyId);
    scheduleCompanyScope = ` AND invoice.company_id=$${scheduleValues.length}`;
    invoiceCompanyScope = ` AND invoice.company_id=$${invoiceValues.length}`;
  }
  const schedules = await client.query(
    `UPDATE tenant.accounting_customer_invoice_schedules schedule
        SET status='overdue'
       FROM tenant.accounting_customer_invoices invoice
      WHERE schedule.organization_id=$1
        AND invoice.organization_id=schedule.organization_id
        AND invoice.id=schedule.customer_invoice_id${scheduleCompanyScope}
        AND schedule.due_date<current_date
        AND schedule.outstanding_amount>0
        AND schedule.status IN ('open','partially_paid')
      RETURNING schedule.id`,
    scheduleValues,
  );
  const invoices = await client.query(
    `UPDATE tenant.accounting_customer_invoices invoice
        SET status='overdue',updated_by=$2,updated_at=now()
      WHERE invoice.organization_id=$1${invoiceCompanyScope}
        AND invoice.invoice_type IN ('invoice','debit_note','opening')
        AND invoice.due_date<current_date
        AND invoice.outstanding_amount>0
        AND invoice.status IN ('posted','partially_paid')
      RETURNING invoice.id,invoice.invoice_number`,
    invoiceValues,
  );
  for (const invoice of invoices.rows) {
    await event(
      client,
      context,
      "customer_invoice",
      invoice.id,
      "accounting.receivables.marked_overdue",
      null,
      "overdue",
      { invoiceNumber: invoice.invoice_number },
    );
  }
  return {
    updatedInvoices: invoices.rows.length,
    updatedSchedules: schedules.rows.length,
  };
}
