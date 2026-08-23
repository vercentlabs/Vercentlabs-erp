import { createHash } from "node:crypto";

export class ProcurementGovernanceError extends Error {
  constructor(status, message, code = "PROCUREMENT_GOVERNANCE_ERROR") {
    super(message);
    this.name = "ProcurementGovernanceError";
    this.status = status;
    this.code = code;
  }
}

const DAY_MS = 86_400_000;
const ENTITY_TABLES = Object.freeze({
  suppliers: "procurement_suppliers",
  requisitions: "procurement_requisitions",
  "sourcing-events": "procurement_sourcing_events",
  agreements: "procurement_agreements",
  "purchase-orders": "procurement_purchase_orders",
  receipts: "procurement_receipts",
});
const CASE_STATUSES = new Set([
  "open",
  "under_review",
  "waiting_supplier",
  "waiting_internal",
  "resolved",
  "closed",
]);
const CASE_PRIORITIES = new Set(["low", "normal", "high", "urgent"]);
const CASE_REASONS = new Set([
  "supplier_compliance",
  "qualification",
  "sourcing_competition",
  "approval_delay",
  "delivery_risk",
  "receipt_variance",
  "contract_compliance",
  "budget_control",
  "other",
]);
const string = (value) => String(value ?? "").trim();
const number = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const object = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};
const hashPayload = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

function hasPermission(context, permission) {
  const roles = new Set(
    Array.isArray(context.roleSlugs) ? context.roleSlugs : [],
  );
  if (roles.has("organization_owner") || roles.has("super_admin")) return true;
  return new Set(
    Array.isArray(context.permissions) ? context.permissions : [],
  ).has(permission);
}

function requireAnyPermission(context, permissions) {
  if (!permissions.some((permission) => hasPermission(context, permission))) {
    throw new ProcurementGovernanceError(
      403,
      "You do not have permission to access Procurement governance.",
      "PROCUREMENT_GOVERNANCE_PERMISSION_DENIED",
    );
  }
}

function requireManagePermission(context) {
  requireAnyPermission(context, [
    "procurement.settings.manage",
    "procurement.suppliers.qualify",
    "procurement.requisition.manage",
    "procurement.sourcing.manage",
    "procurement.po.manage",
    "procurement.receipts.manage",
  ]);
}

function uuid(value, label) {
  const normalized = string(value);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      normalized,
    )
  ) {
    throw new ProcurementGovernanceError(400, `${label} is invalid.`);
  }
  return normalized;
}

function dateTime(value, label) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()))
    throw new ProcurementGovernanceError(400, `${label} is invalid.`);
  return parsed.toISOString();
}

function daysFrom(value, now) {
  if (!value) return null;
  const parsed = new Date(`${String(value).slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  const today = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  return Math.ceil((parsed.getTime() - today.getTime()) / DAY_MS);
}

function defaultPolicy(policy = {}) {
  return {
    certificationWarningDays: Math.max(
      0,
      number(
        policy.certification_warning_days ??
          policy.certificationWarningDays ??
          30,
      ),
    ),
    sourcingMinimumBids: Math.max(
      1,
      number(policy.sourcing_minimum_bids ?? policy.sourcingMinimumBids ?? 2),
    ),
    requisitionSlaDays: Math.max(
      1,
      number(policy.requisition_sla_days ?? policy.requisitionSlaDays ?? 3),
    ),
    purchaseOrderAckDays: Math.max(
      1,
      number(
        policy.purchase_order_ack_days ?? policy.purchaseOrderAckDays ?? 3,
      ),
    ),
    deliveryWarningDays: Math.max(
      0,
      number(policy.delivery_warning_days ?? policy.deliveryWarningDays ?? 5),
    ),
    receiptVarianceTolerance: Math.max(
      0,
      number(
        policy.receipt_variance_tolerance ??
          policy.receiptVarianceTolerance ??
          0,
      ),
    ),
    blockExpiredCertifications:
      policy.block_expired_certifications ??
      policy.blockExpiredCertifications ??
      true,
    requireQualifiedSupplier:
      policy.require_qualified_supplier ??
      policy.requireQualifiedSupplier ??
      true,
    requireCompetitiveBids:
      policy.require_competitive_bids ?? policy.requireCompetitiveBids ?? true,
  };
}

function finishHealth(blockers, warnings, metrics = {}) {
  const readiness = blockers.length
    ? "blocked"
    : warnings.length
      ? "attention"
      : "ready";
  const riskBand = blockers.length
    ? "high"
    : warnings.length
      ? "medium"
      : "low";
  return { readiness, riskBand, blockers, warnings, metrics };
}

export function evaluateSupplierGovernance(
  row,
  policyInput = {},
  now = new Date(),
) {
  const policy = defaultPolicy(policyInput);
  const blockers = [];
  const warnings = [];
  const status = string(row.status);
  const legalName = string(
    row.legal_name ?? row.legalName ?? row.data?.legalName,
  );
  const currency = string(
    row.currency_code ?? row.currencyCode ?? row.data?.currencyCode,
  );
  const qualificationCount = number(
    row.qualification_count ?? row.qualificationCount,
  );
  const certificationCount = number(
    row.certification_count ?? row.certificationCount,
  );
  const expiredCertifications = number(
    row.expired_certification_count ?? row.expiredCertificationCount,
  );
  const expiringCertifications = number(
    row.expiring_certification_count ?? row.expiringCertificationCount,
  );
  const score = number(row.latest_score ?? row.latestScore);
  if (!legalName) blockers.push("Supplier legal name is missing.");
  if (!currency) blockers.push("Supplier currency is missing.");
  if (["blocked", "suspended", "cancelled"].includes(status))
    blockers.push(`Supplier status is ${status}.`);
  if (
    policy.requireQualifiedSupplier &&
    !["qualified", "active"].includes(status)
  )
    blockers.push(
      "Supplier must be qualified and active before award or ordering.",
    );
  if (qualificationCount < 1)
    blockers.push("Supplier qualification evidence is missing.");
  if (policy.blockExpiredCertifications && expiredCertifications > 0)
    blockers.push("Supplier has expired compliance certifications.");
  if (certificationCount < 1)
    warnings.push("No supplier certification records are available.");
  if (expiringCertifications > 0)
    warnings.push(
      `${expiringCertifications} supplier certification(s) expire soon.`,
    );
  if (score > 0 && score < 60)
    warnings.push(
      "Supplier performance score is below the preferred threshold.",
    );
  return finishHealth(blockers, warnings, {
    qualificationCount,
    certificationCount,
    expiredCertifications,
    expiringCertifications,
    score,
    certificationWarningDays: policy.certificationWarningDays,
  });
}

export function evaluateRequisitionHealth(
  row,
  policyInput = {},
  now = new Date(),
) {
  const policy = defaultPolicy(policyInput);
  const blockers = [];
  const warnings = [];
  const status = string(row.status);
  const data = object(row.data);
  const lineCount = number(row.line_count ?? row.lineCount);
  const needByDate = row.need_by_date ?? row.needByDate ?? data.needByDate;
  const ageDays = Math.max(
    0,
    Math.floor(
      (now.getTime() -
        new Date(row.created_at ?? row.createdAt ?? now).getTime()) /
        DAY_MS,
    ),
  );
  const dueInDays = daysFrom(needByDate, now);
  if (!string(data.title ?? row.title))
    blockers.push("Requisition business requirement is missing.");
  if (lineCount < 1) blockers.push("Requisition has no line items.");
  if (!needByDate) blockers.push("Requisition need-by date is missing.");
  if (
    ["submitted", "pending_approval"].includes(status) &&
    ageDays > policy.requisitionSlaDays
  )
    warnings.push("Requisition approval is outside the configured SLA.");
  if (
    dueInDays !== null &&
    dueInDays < 0 &&
    !["approved", "closed", "cancelled"].includes(status)
  )
    warnings.push("Requisition need-by date has passed.");
  return finishHealth(blockers, warnings, { lineCount, ageDays, dueInDays });
}

export function evaluateSourcingHealth(
  row,
  policyInput = {},
  now = new Date(),
) {
  const policy = defaultPolicy(policyInput);
  const blockers = [];
  const warnings = [];
  const status = string(row.status);
  const data = object(row.data);
  const invitations = number(row.invitation_count ?? row.invitationCount);
  const bids = number(row.bid_count ?? row.bidCount);
  const evaluations = number(row.evaluation_count ?? row.evaluationCount);
  const awards = number(row.award_count ?? row.awardCount);
  const closesInDays = daysFrom(
    row.bid_close_at ?? row.bidCloseAt ?? data.bidCloseAt,
    now,
  );
  if (!string(data.title ?? row.title))
    blockers.push("Sourcing event title is missing.");
  if (invitations < 1)
    blockers.push("No suppliers have been invited to the sourcing event.");
  if (
    policy.requireCompetitiveBids &&
    ["active", "closed", "awarded"].includes(status) &&
    bids < policy.sourcingMinimumBids
  )
    blockers.push(
      `At least ${policy.sourcingMinimumBids} valid supplier bids are required.`,
    );
  if (["closed", "awarded"].includes(status) && evaluations < bids)
    warnings.push("Not all supplier bids have completed evaluation evidence.");
  if (status === "awarded" && awards !== 1)
    blockers.push(
      "Awarded sourcing events require exactly one governed award record.",
    );
  if (closesInDays !== null && closesInDays < 0 && status === "active")
    warnings.push(
      "Sourcing event bid deadline has passed and the event remains active.",
    );
  return finishHealth(blockers, warnings, {
    invitations,
    bids,
    evaluations,
    awards,
    closesInDays,
    minimumBids: policy.sourcingMinimumBids,
  });
}

export function evaluatePurchaseOrderHealth(
  row,
  policyInput = {},
  now = new Date(),
) {
  const policy = defaultPolicy(policyInput);
  const blockers = [];
  const warnings = [];
  const status = string(row.status);
  const data = object(row.data);
  const lineCount = number(row.line_count ?? row.lineCount);
  const receivedQuantity = number(
    row.received_quantity ?? row.receivedQuantity,
  );
  const orderedQuantity = number(row.ordered_quantity ?? row.orderedQuantity);
  const supplierStatus = string(row.supplier_status ?? row.supplierStatus);
  const expectedDeliveryDate =
    row.expected_delivery_date ??
    row.expectedDeliveryDate ??
    data.expectedDeliveryDate;
  const dueInDays = daysFrom(expectedDeliveryDate, now);
  const ageDays = Math.max(
    0,
    Math.floor(
      (now.getTime() -
        new Date(row.created_at ?? row.createdAt ?? now).getTime()) /
        DAY_MS,
    ),
  );
  if (!row.supplier_id && !row.supplierId && !data.supplierId)
    blockers.push("Purchase order supplier is missing.");
  if (
    policy.requireQualifiedSupplier &&
    supplierStatus &&
    !["qualified", "active"].includes(supplierStatus)
  )
    blockers.push("Purchase order supplier is not qualified and active.");
  if (lineCount < 1) blockers.push("Purchase order has no lines.");
  if (!expectedDeliveryDate)
    blockers.push("Expected delivery date is missing.");
  if (status === "dispatched" && ageDays > policy.purchaseOrderAckDays)
    warnings.push("Supplier acknowledgement is outside the configured SLA.");
  if (
    dueInDays !== null &&
    dueInDays < 0 &&
    !["received", "closed", "cancelled"].includes(status)
  )
    warnings.push("Purchase order delivery is overdue.");
  if (orderedQuantity > 0 && receivedQuantity > orderedQuantity)
    blockers.push("Received quantity exceeds the ordered quantity.");
  if (
    orderedQuantity > 0 &&
    receivedQuantity > 0 &&
    receivedQuantity < orderedQuantity
  )
    warnings.push("Purchase order is only partially received.");
  return finishHealth(blockers, warnings, {
    lineCount,
    orderedQuantity,
    receivedQuantity,
    dueInDays,
    ageDays,
  });
}

export function evaluateReceiptHealth(row, policyInput = {}) {
  const policy = defaultPolicy(policyInput);
  const blockers = [];
  const warnings = [];
  const data = object(row.data);
  const status = string(row.status);
  const lineCount = number(row.line_count ?? row.lineCount);
  const accepted = number(row.accepted_quantity ?? row.acceptedQuantity);
  const rejected = number(row.rejected_quantity ?? row.rejectedQuantity);
  if (!row.purchase_order_id && !row.purchaseOrderId && !data.purchaseOrderId)
    blockers.push("Receipt is not linked to a purchase order.");
  if (lineCount < 1) blockers.push("Receipt has no receipt lines.");
  if (accepted <= 0 && rejected <= 0)
    blockers.push("Receipt quantities have not been recorded.");
  if (rejected > policy.receiptVarianceTolerance)
    warnings.push("Receipt contains rejected quantity requiring follow-up.");
  if (status === "approved" && rejected > 0)
    warnings.push("Approved receipt still has rejected quantity.");
  return finishHealth(blockers, warnings, {
    lineCount,
    acceptedQuantity: accepted,
    rejectedQuantity: rejected,
  });
}

export function buildProcurementGovernanceSummary(groups) {
  const rows = Object.values(groups || {}).flatMap((value) =>
    Array.isArray(value) ? value : [],
  );
  const health = rows.map(
    (row) => row.health || { readiness: "ready", riskBand: "low" },
  );
  return {
    totalRecords: rows.length,
    ready: health.filter((item) => item.readiness === "ready").length,
    attention: health.filter((item) => item.readiness === "attention").length,
    blocked: health.filter((item) => item.readiness === "blocked").length,
    highRisk: health.filter((item) => item.riskBand === "high").length,
  };
}

function companyScope(context, values, alias) {
  if (context.activeCompanyId) {
    values.push(context.activeCompanyId);
    return ` AND ${alias}.company_id=$${values.length}`;
  }
  return "";
}

async function getPolicy(client, context, companyId = null) {
  const selectedCompany = companyId || context.activeCompanyId;
  const values = [context.organizationId];
  let where = "";
  if (selectedCompany) {
    values.push(selectedCompany);
    where = ` AND company_id=$${values.length}`;
  }
  const result = await client.query(
    `SELECT * FROM tenant.procurement_governance_policies WHERE organization_id=$1${where} ORDER BY company_id LIMIT 1`,
    values,
  );
  return result.rows[0] || defaultPolicy();
}

async function loadSuppliers(client, context, policy) {
  const values = [context.organizationId, policy.certificationWarningDays];
  const scope = companyScope(context, values, "supplier");
  const result = await client.query(
    `SELECT supplier.*,supplier.data->>'legalName' AS legal_name,supplier.data->>'currencyCode' AS currency_code,company.name AS company_name,
    COALESCE(qualification.count,0)::int AS qualification_count,COALESCE(certification.count,0)::int AS certification_count,
    COALESCE(certification.expired,0)::int AS expired_certification_count,COALESCE(certification.expiring,0)::int AS expiring_certification_count,
    COALESCE(score.latest_score,0)::numeric AS latest_score
    FROM tenant.procurement_suppliers supplier
    JOIN public.companies company ON company.organization_id=supplier.organization_id AND company.id=supplier.company_id
    LEFT JOIN LATERAL (SELECT count(*) FROM tenant.procurement_supplier_qualifications q WHERE q.organization_id=supplier.organization_id AND q.parent_id=supplier.id AND q.status='active') qualification ON true
    LEFT JOIN LATERAL (SELECT count(*) AS count,
      count(*) FILTER (WHERE NULLIF(c.data->>'expiryDate','')::date < current_date) AS expired,
      count(*) FILTER (WHERE NULLIF(c.data->>'expiryDate','')::date BETWEEN current_date AND current_date+$2::int) AS expiring
      FROM tenant.procurement_supplier_certifications c WHERE c.organization_id=supplier.organization_id AND c.parent_id=supplier.id AND c.status='active') certification ON true
    LEFT JOIN LATERAL (SELECT NULLIF(s.data->>'overallScore','')::numeric AS latest_score FROM tenant.procurement_supplier_scorecards s WHERE s.organization_id=supplier.organization_id AND s.parent_id=supplier.id ORDER BY s.created_at DESC LIMIT 1) score ON true
    WHERE supplier.organization_id=$1${scope} ORDER BY supplier.updated_at DESC LIMIT 100`,
    values,
  );
  return result.rows.map((row) => ({
    ...row,
    health: evaluateSupplierGovernance(row, policy),
  }));
}

async function loadRequisitions(client, context, policy) {
  const values = [context.organizationId];
  const scope = companyScope(context, values, "record");
  const result = await client.query(
    `SELECT record.*,company.name AS company_name,COALESCE(lines.count,0)::int AS line_count
    FROM tenant.procurement_requisitions record JOIN public.companies company ON company.organization_id=record.organization_id AND company.id=record.company_id
    LEFT JOIN LATERAL (SELECT count(*) FROM tenant.procurement_requisition_lines line WHERE line.organization_id=record.organization_id AND line.parent_id=record.id) lines ON true
    WHERE record.organization_id=$1${scope} AND record.status NOT IN ('closed','cancelled') ORDER BY record.updated_at DESC LIMIT 100`,
    values,
  );
  return result.rows.map((row) => ({
    ...row,
    health: evaluateRequisitionHealth(row, policy),
  }));
}

async function loadSourcing(client, context, policy) {
  const values = [context.organizationId];
  const scope = companyScope(context, values, "record");
  const result = await client.query(
    `SELECT record.*,company.name AS company_name,
    COALESCE(invitation.count,0)::int AS invitation_count,COALESCE(bid.count,0)::int AS bid_count,
    COALESCE(evaluation.count,0)::int AS evaluation_count,COALESCE(award.count,0)::int AS award_count
    FROM tenant.procurement_sourcing_events record JOIN public.companies company ON company.organization_id=record.organization_id AND company.id=record.company_id
    LEFT JOIN LATERAL (SELECT count(*) FROM tenant.procurement_sourcing_invitations item WHERE item.organization_id=record.organization_id AND item.parent_id=record.id) invitation ON true
    LEFT JOIN LATERAL (SELECT count(*) FROM tenant.procurement_sourcing_bids item WHERE item.organization_id=record.organization_id AND item.parent_id=record.id AND item.status NOT IN ('withdrawn','rejected')) bid ON true
    LEFT JOIN LATERAL (SELECT count(*) FROM tenant.procurement_sourcing_evaluations item WHERE item.organization_id=record.organization_id AND item.parent_id=record.id) evaluation ON true
    LEFT JOIN LATERAL (SELECT count(*) FROM tenant.procurement_sourcing_awards item WHERE item.organization_id=record.organization_id AND item.source_event_id=record.id) award ON true
    WHERE record.organization_id=$1${scope} AND record.status NOT IN ('cancelled') ORDER BY record.updated_at DESC LIMIT 100`,
    values,
  );
  return result.rows.map((row) => ({
    ...row,
    health: evaluateSourcingHealth(row, policy),
  }));
}

async function loadPurchaseOrders(client, context, policy) {
  const values = [context.organizationId];
  const scope = companyScope(context, values, "record");
  const result = await client.query(
    `SELECT record.*,company.name AS company_name,supplier.status AS supplier_status,supplier.data->>'legalName' AS supplier_name,
    COALESCE(lines.count,0)::int AS line_count,COALESCE(lines.ordered_quantity,0)::numeric AS ordered_quantity,COALESCE(lines.received_quantity,0)::numeric AS received_quantity,
    COALESCE(lines.invoiced_quantity,0)::numeric AS invoiced_quantity
    FROM tenant.procurement_purchase_orders record JOIN public.companies company ON company.organization_id=record.organization_id AND company.id=record.company_id
    LEFT JOIN tenant.procurement_suppliers supplier ON supplier.organization_id=record.organization_id AND supplier.id=record.supplier_id
    LEFT JOIN LATERAL (SELECT count(*) AS count,
      COALESCE(sum(NULLIF(line.data->>'quantity','')::numeric),0) AS ordered_quantity,
      COALESCE(sum(line.received_quantity),0) AS received_quantity,COALESCE(sum(line.invoiced_quantity),0) AS invoiced_quantity
      FROM tenant.procurement_purchase_order_lines line WHERE line.organization_id=record.organization_id AND line.parent_id=record.id) lines ON true
    WHERE record.organization_id=$1${scope} AND record.status NOT IN ('closed','cancelled') ORDER BY record.updated_at DESC LIMIT 100`,
    values,
  );
  return result.rows.map((row) => ({
    ...row,
    health: evaluatePurchaseOrderHealth(row, policy),
  }));
}

async function loadReceipts(client, context, policy) {
  const values = [context.organizationId];
  const scope = companyScope(context, values, "record");
  const result = await client.query(
    `SELECT record.*,company.name AS company_name,
    COALESCE(lines.count,0)::int AS line_count,COALESCE(lines.accepted_quantity,0)::numeric AS accepted_quantity,COALESCE(lines.rejected_quantity,0)::numeric AS rejected_quantity
    FROM tenant.procurement_receipts record JOIN public.companies company ON company.organization_id=record.organization_id AND company.id=record.company_id
    LEFT JOIN LATERAL (SELECT count(*) AS count,COALESCE(sum(line.accepted_quantity),0) AS accepted_quantity,COALESCE(sum(line.rejected_quantity),0) AS rejected_quantity
      FROM tenant.procurement_receipt_lines line WHERE line.organization_id=record.organization_id AND line.parent_id=record.id) lines ON true
    WHERE record.organization_id=$1${scope} ORDER BY record.updated_at DESC LIMIT 100`,
    values,
  );
  return result.rows.map((row) => ({
    ...row,
    health: evaluateReceiptHealth(row, policy),
  }));
}

export async function getProcurementGovernanceDashboard(client, context) {
  requireAnyPermission(context, [
    "procurement.view",
    "procurement.suppliers.view",
  ]);
  const policy = defaultPolicy(await getPolicy(client, context));
  // These loaders share the transaction's single pg PoolClient. Execute them
  // in sequence; overlapping client.query() calls are deprecated and will be
  // unsupported in pg 9.
  const suppliers = await loadSuppliers(client, context, policy);
  const requisitions = await loadRequisitions(client, context, policy);
  const sourcingEvents = await loadSourcing(client, context, policy);
  const purchaseOrders = await loadPurchaseOrders(client, context, policy);
  const receipts = await loadReceipts(client, context, policy);
  const exceptionValues = [context.organizationId];
  const exceptionScope = companyScope(
    context,
    exceptionValues,
    "exception_case",
  );
  const exceptionResult = await client.query(
    `SELECT exception_case.*,company.name AS company_name FROM tenant.procurement_governance_exception_cases exception_case
    LEFT JOIN public.companies company ON company.organization_id=exception_case.organization_id AND company.id=exception_case.company_id
    WHERE exception_case.organization_id=$1${exceptionScope} AND exception_case.status NOT IN ('resolved','closed')
    ORDER BY CASE exception_case.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 ELSE 4 END,exception_case.next_action_at NULLS LAST LIMIT 100`,
    exceptionValues,
  );
  const groups = {
    suppliers,
    requisitions,
    sourcingEvents,
    purchaseOrders,
    receipts,
  };
  return {
    policy,
    summary: {
      ...buildProcurementGovernanceSummary(groups),
      openExceptions: exceptionResult.rows.length,
    },
    ...groups,
    exceptionCases: exceptionResult.rows,
  };
}

async function loadEntity(
  client,
  context,
  entityType,
  entityId,
  forUpdate = false,
) {
  const table = ENTITY_TABLES[entityType];
  if (!table)
    throw new ProcurementGovernanceError(
      400,
      "Unsupported Procurement governance entity type.",
    );
  const id = uuid(entityId, "Procurement record");
  const values = [context.organizationId, id];
  const scope = companyScope(context, values, "record");
  const result = await client.query(
    `SELECT record.* FROM tenant.${table} record WHERE record.organization_id=$1 AND record.id=$2${scope}${forUpdate ? " FOR UPDATE" : ""}`,
    values,
  );
  if (!result.rows[0])
    throw new ProcurementGovernanceError(
      404,
      "Procurement record was not found.",
    );
  return result.rows[0];
}

async function enrichEntity(client, context, entityType, row, policy) {
  if (entityType === "suppliers") {
    const result = await client.query(
      `SELECT
      (SELECT count(*) FROM tenant.procurement_supplier_qualifications q WHERE q.organization_id=$1 AND q.parent_id=$2 AND q.status='active')::int AS qualification_count,
      (SELECT count(*) FROM tenant.procurement_supplier_certifications c WHERE c.organization_id=$1 AND c.parent_id=$2 AND c.status='active')::int AS certification_count,
      (SELECT count(*) FROM tenant.procurement_supplier_certifications c WHERE c.organization_id=$1 AND c.parent_id=$2 AND c.status='active' AND NULLIF(c.data->>'expiryDate','')::date<current_date)::int AS expired_certification_count,
      (SELECT count(*) FROM tenant.procurement_supplier_certifications c WHERE c.organization_id=$1 AND c.parent_id=$2 AND c.status='active' AND NULLIF(c.data->>'expiryDate','')::date BETWEEN current_date AND current_date+$3::int)::int AS expiring_certification_count,
      COALESCE((SELECT NULLIF(s.data->>'overallScore','')::numeric FROM tenant.procurement_supplier_scorecards s WHERE s.organization_id=$1 AND s.parent_id=$2 ORDER BY s.created_at DESC LIMIT 1),0) AS latest_score`,
      [context.organizationId, row.id, policy.certificationWarningDays],
    );
    return {
      ...row,
      ...result.rows[0],
      legal_name: row.data?.legalName,
      currency_code: row.data?.currencyCode,
    };
  }
  if (entityType === "requisitions") {
    const result = await client.query(
      `SELECT count(*)::int AS line_count FROM tenant.procurement_requisition_lines WHERE organization_id=$1 AND parent_id=$2`,
      [context.organizationId, row.id],
    );
    return { ...row, ...result.rows[0] };
  }
  if (entityType === "sourcing-events") {
    const result = await client.query(
      `SELECT
      (SELECT count(*) FROM tenant.procurement_sourcing_invitations WHERE organization_id=$1 AND parent_id=$2)::int AS invitation_count,
      (SELECT count(*) FROM tenant.procurement_sourcing_bids WHERE organization_id=$1 AND parent_id=$2 AND status NOT IN ('withdrawn','rejected'))::int AS bid_count,
      (SELECT count(*) FROM tenant.procurement_sourcing_evaluations WHERE organization_id=$1 AND parent_id=$2)::int AS evaluation_count,
      (SELECT count(*) FROM tenant.procurement_sourcing_awards WHERE organization_id=$1 AND source_event_id=$2)::int AS award_count`,
      [context.organizationId, row.id],
    );
    return { ...row, ...result.rows[0] };
  }
  if (entityType === "purchase-orders") {
    const result = await client.query(
      `SELECT supplier.status AS supplier_status,lines.* FROM tenant.procurement_purchase_orders purchase_order
      LEFT JOIN tenant.procurement_suppliers supplier ON supplier.organization_id=purchase_order.organization_id AND supplier.id=purchase_order.supplier_id
      LEFT JOIN LATERAL (SELECT count(*)::int AS line_count,COALESCE(sum(NULLIF(line.data->>'quantity','')::numeric),0) AS ordered_quantity,COALESCE(sum(line.received_quantity),0) AS received_quantity,COALESCE(sum(line.invoiced_quantity),0) AS invoiced_quantity FROM tenant.procurement_purchase_order_lines line WHERE line.organization_id=purchase_order.organization_id AND line.parent_id=purchase_order.id) lines ON true
      WHERE purchase_order.organization_id=$1 AND purchase_order.id=$2`,
      [context.organizationId, row.id],
    );
    return { ...row, ...result.rows[0] };
  }
  if (entityType === "receipts") {
    const result = await client.query(
      `SELECT count(*)::int AS line_count,COALESCE(sum(accepted_quantity),0) AS accepted_quantity,COALESCE(sum(rejected_quantity),0) AS rejected_quantity FROM tenant.procurement_receipt_lines WHERE organization_id=$1 AND parent_id=$2`,
      [context.organizationId, row.id],
    );
    return { ...row, ...result.rows[0] };
  }
  return row;
}

function evaluateEntity(entityType, row, policy) {
  if (entityType === "suppliers")
    return evaluateSupplierGovernance(row, policy);
  if (entityType === "requisitions")
    return evaluateRequisitionHealth(row, policy);
  if (entityType === "sourcing-events")
    return evaluateSourcingHealth(row, policy);
  if (entityType === "purchase-orders")
    return evaluatePurchaseOrderHealth(row, policy);
  if (entityType === "receipts") return evaluateReceiptHealth(row, policy);
  return finishHealth([], [], { status: row.status });
}

export async function assessProcurementRecordReadiness(
  client,
  context,
  entityType,
  entityId,
) {
  requireAnyPermission(context, [
    "procurement.view",
    "procurement.suppliers.view",
  ]);
  const row = await loadEntity(client, context, entityType, entityId);
  const policy = defaultPolicy(
    await getPolicy(client, context, row.company_id),
  );
  const enriched = await enrichEntity(client, context, entityType, row, policy);
  return {
    record: enriched,
    health: evaluateEntity(entityType, enriched, policy),
    policy,
  };
}

export async function captureProcurementGovernanceSnapshot(
  client,
  context,
  entityType,
  entityId,
  capturedFor = "manual",
) {
  requireManagePermission(context);
  const row = await loadEntity(client, context, entityType, entityId);
  const policy = defaultPolicy(
    await getPolicy(client, context, row.company_id),
  );
  const enriched = await enrichEntity(client, context, entityType, row, policy);
  const health = evaluateEntity(entityType, enriched, policy);
  const evidence = {
    status: row.status,
    version: row.version,
    data: object(row.data),
    contentHash: row.content_hash || null,
    metrics: health.metrics,
  };
  const contentHash = hashPayload({
    entityType,
    entityId: row.id,
    health,
    evidence,
  });
  const result = await client.query(
    `INSERT INTO tenant.procurement_governance_snapshots (
    organization_id,company_id,entity_type,entity_id,entity_status,readiness_status,risk_band,blockers,warnings,metrics,evidence,content_hash,captured_for,captured_by
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb,$12,$13,$14) RETURNING *`,
    [
      context.organizationId,
      row.company_id,
      entityType,
      row.id,
      row.status,
      health.readiness,
      health.riskBand,
      JSON.stringify(health.blockers),
      JSON.stringify(health.warnings),
      JSON.stringify(health.metrics),
      JSON.stringify(evidence),
      contentHash,
      string(capturedFor).slice(0, 80) || "manual",
      context.userId,
    ],
  );
  return result.rows[0];
}

export async function getProcurementGovernanceTimeline(
  client,
  context,
  entityType,
  entityId,
) {
  requireAnyPermission(context, [
    "procurement.view",
    "procurement.suppliers.view",
  ]);
  await loadEntity(client, context, entityType, entityId);
  const result = await client.query(
    `SELECT * FROM (
    SELECT event.id,'event'::text AS entry_type,event.event_type AS label,event.payload,event.actor_user_id AS actor_user_id,event.created_at AS occurred_at
      FROM tenant.procurement_events event WHERE event.organization_id=$1 AND event.entity_type=$2 AND event.entity_id=$3
    UNION ALL
    SELECT snapshot.id,'snapshot',snapshot.captured_for,jsonb_build_object('readiness',snapshot.readiness_status,'riskBand',snapshot.risk_band,'blockers',snapshot.blockers,'warnings',snapshot.warnings),snapshot.captured_by,snapshot.captured_at
      FROM tenant.procurement_governance_snapshots snapshot WHERE snapshot.organization_id=$1 AND snapshot.entity_type=$2 AND snapshot.entity_id=$3
    UNION ALL
    SELECT exception_case.id,'exception',exception_case.reason_code,jsonb_build_object('status',exception_case.status,'priority',exception_case.priority,'note',exception_case.note),exception_case.updated_by,exception_case.updated_at
      FROM tenant.procurement_governance_exception_cases exception_case WHERE exception_case.organization_id=$1 AND exception_case.entity_type=$2 AND exception_case.entity_id=$3
    ) timeline ORDER BY occurred_at DESC LIMIT 200`,
    [context.organizationId, entityType, uuid(entityId, "Procurement record")],
  );
  return result.rows;
}

export async function listProcurementSavedViews(client, context) {
  requireAnyPermission(context, [
    "procurement.view",
    "procurement.suppliers.view",
  ]);
  const result = await client.query(
    `SELECT * FROM tenant.procurement_governance_saved_views WHERE organization_id=$1 AND (owner_user_id=$2 OR is_shared=true) ORDER BY is_shared DESC,updated_at DESC`,
    [context.organizationId, context.userId],
  );
  return result.rows;
}

export async function saveProcurementView(client, context, input = {}) {
  requireAnyPermission(context, [
    "procurement.view",
    "procurement.suppliers.view",
  ]);
  const name = string(input.name).slice(0, 120);
  if (!name)
    throw new ProcurementGovernanceError(400, "Saved view name is required.");
  const entityType = string(input.entityType || "purchase-orders");
  if (!ENTITY_TABLES[entityType])
    throw new ProcurementGovernanceError(
      400,
      "Saved view entity type is invalid.",
    );
  const isShared = Boolean(input.isShared);
  if (isShared) requireManagePermission(context);
  const filters = object(input.filters);
  const columns = Array.isArray(input.columns)
    ? input.columns.slice(0, 40)
    : [];
  const sort = Array.isArray(input.sort) ? input.sort.slice(0, 10) : [];
  const result = await client.query(
    `INSERT INTO tenant.procurement_governance_saved_views (organization_id,owner_user_id,entity_type,name,filters,columns,sort,is_shared)
    VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8)
    ON CONFLICT (organization_id,owner_user_id,entity_type,name) DO UPDATE SET filters=EXCLUDED.filters,columns=EXCLUDED.columns,sort=EXCLUDED.sort,is_shared=EXCLUDED.is_shared,updated_at=now() RETURNING *`,
    [
      context.organizationId,
      context.userId,
      entityType,
      name,
      JSON.stringify(filters),
      JSON.stringify(columns),
      JSON.stringify(sort),
      isShared,
    ],
  );
  return result.rows[0];
}

export async function deleteProcurementSavedView(client, context, viewId) {
  requireAnyPermission(context, [
    "procurement.view",
    "procurement.suppliers.view",
  ]);
  const id = uuid(viewId, "Saved view");
  const result = await client.query(
    `DELETE FROM tenant.procurement_governance_saved_views WHERE organization_id=$1 AND owner_user_id=$2 AND id=$3 RETURNING id`,
    [context.organizationId, context.userId, id],
  );
  if (!result.rows[0])
    throw new ProcurementGovernanceError(
      404,
      "Saved Procurement view was not found.",
    );
  return { deleted: true, id };
}

export async function upsertProcurementExceptionCase(
  client,
  context,
  entityType,
  entityId,
  input = {},
) {
  requireManagePermission(context);
  const row = await loadEntity(client, context, entityType, entityId, true);
  const status = CASE_STATUSES.has(string(input.status))
    ? string(input.status)
    : "open";
  const priority = CASE_PRIORITIES.has(string(input.priority))
    ? string(input.priority)
    : "normal";
  const reasonCode = CASE_REASONS.has(string(input.reasonCode))
    ? string(input.reasonCode)
    : "other";
  const ownerUserId = input.ownerUserId
    ? uuid(input.ownerUserId, "Exception owner")
    : null;
  const nextActionAt = dateTime(input.nextActionAt, "Next action");
  const note = string(input.note).slice(0, 2000) || null;
  const result = await client.query(
    `INSERT INTO tenant.procurement_governance_exception_cases (
    organization_id,company_id,entity_type,entity_id,status,priority,reason_code,owner_user_id,next_action_at,note,created_by,updated_by,resolved_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11,CASE WHEN $5 IN ('resolved','closed') THEN now() ELSE NULL END)
    ON CONFLICT (organization_id,entity_type,entity_id) DO UPDATE SET status=EXCLUDED.status,priority=EXCLUDED.priority,reason_code=EXCLUDED.reason_code,owner_user_id=EXCLUDED.owner_user_id,next_action_at=EXCLUDED.next_action_at,note=EXCLUDED.note,updated_by=EXCLUDED.updated_by,updated_at=now(),resolved_at=EXCLUDED.resolved_at RETURNING *`,
    [
      context.organizationId,
      row.company_id,
      entityType,
      row.id,
      status,
      priority,
      reasonCode,
      ownerUserId,
      nextActionAt,
      note,
      context.userId,
    ],
  );
  return result.rows[0];
}

export async function bulkManageProcurementExceptions(
  client,
  context,
  input = {},
) {
  requireManagePermission(context);
  const records = Array.isArray(input.records) ? input.records : [];
  if (!records.length)
    throw new ProcurementGovernanceError(
      400,
      "Select at least one Procurement record.",
    );
  if (records.length > 200)
    throw new ProcurementGovernanceError(
      400,
      "Bulk Procurement governance actions are limited to 200 records.",
    );
  const updated = [];
  for (const record of records) {
    const value = object(record);
    updated.push(
      await upsertProcurementExceptionCase(
        client,
        context,
        string(value.entityType),
        value.entityId,
        object(input.case),
      ),
    );
  }
  return { updated: updated.length, records: updated };
}
