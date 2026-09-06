import { SalesError } from "./index.js";
import { asDatabaseDecimal, decimal, sub } from "./money.js";

export class SalesOrderGovernanceError extends SalesError {
  constructor(status, message, code = "SALES_ORDER_GOVERNANCE_ERROR") {
    super(status, message, code);
    this.name = "SalesOrderGovernanceError";
  }
}

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const number = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const string = (value) => String(value ?? "").trim();
const object = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};
const hasKeys = (value) => Object.keys(object(value)).length > 0;
const uuid = (value, label) => {
  const result = string(value);
  if (!UUID_PATTERN.test(result)) {
    throw new SalesOrderGovernanceError(
      400,
      `${label} is invalid.`,
      "SALES_ORDER_IDENTIFIER_INVALID",
    );
  }
  return result;
};
const dateOnly = (value) => {
  const result = string(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(result) ? result : null;
};

function hasPermission(context, permission) {
  return (
    context.permissions?.includes(permission) ||
    context.roleSlugs?.includes("organization_owner")
  );
}

function requirePermission(context, permission) {
  if (!hasPermission(context, permission)) {
    throw new SalesOrderGovernanceError(
      403,
      "You do not have permission to perform this action.",
      "SALES_ORDER_PERMISSION_DENIED",
    );
  }
}

function defaultPolicy(policy = {}) {
  return {
    approvalSlaHours: Math.max(
      1,
      number(policy.approval_sla_hours ?? policy.approvalSlaHours ?? 24),
    ),
    fulfillmentSlaDays: Math.max(
      1,
      number(policy.fulfillment_sla_days ?? policy.fulfillmentSlaDays ?? 7),
    ),
    deliveryWarningDays: Math.max(
      1,
      number(policy.delivery_warning_days ?? policy.deliveryWarningDays ?? 3),
    ),
    staleAfterDays: Math.max(
      1,
      number(policy.stale_after_days ?? policy.staleAfterDays ?? 14),
    ),
    invoiceHandoffSlaHours: Math.max(
      1,
      number(
        policy.invoice_handoff_sla_hours ?? policy.invoiceHandoffSlaHours ?? 24,
      ),
    ),
    requireCustomerPo:
      policy.require_customer_po ?? policy.requireCustomerPo ?? false,
    requirePaymentTerms:
      policy.require_payment_terms ?? policy.requirePaymentTerms ?? true,
    requireShippingAddress:
      policy.require_shipping_address ?? policy.requireShippingAddress ?? true,
    requireLineWarehouse:
      policy.require_line_warehouse ?? policy.requireLineWarehouse ?? true,
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

function daysUntil(value, now) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return Math.ceil((parsed.getTime() - now.getTime()) / DAY_MS);
}

export function evaluateSalesOrderHealth(
  row,
  policyInput = {},
  now = new Date(),
) {
  const policy = defaultPolicy(policyInput);
  const blockers = [];
  const warnings = [];
  const lifecycleStatus = string(row.lifecycle_status || row.lifecycleStatus);
  const approvalStatus = string(row.approval_status || row.approvalStatus);
  const creditStatus = string(row.credit_status || row.creditStatus);
  const fulfillmentStatus = string(
    row.fulfillment_status || row.fulfillmentStatus,
  );
  const billingStatus = string(row.billing_status || row.billingStatus);
  const customerStatus = string(row.customer_status || row.customerStatus);
  const lineCount = number(row.line_count ?? row.lineCount);
  const grandTotal = number(row.grand_total ?? row.grandTotal);
  const activeHoldCount = number(row.active_hold_count ?? row.activeHoldCount);
  const missingWarehouseCount = number(
    row.missing_warehouse_count ?? row.missingWarehouseCount,
  );
  const remainingToFulfill = number(
    row.remaining_to_fulfill ?? row.remainingToFulfill,
  );
  const remainingToInvoice = number(
    row.remaining_to_invoice ?? row.remainingToInvoice,
  );
  const reservedQuantity = number(
    row.reserved_quantity ?? row.reservedQuantity,
  );
  const confirmedQuantity = number(
    row.confirmed_quantity ?? row.confirmedQuantity,
  );
  const fulfilledQuantity = number(
    row.fulfilled_quantity ?? row.fulfilledQuantity,
  );
  const failedFulfillmentRequests = number(
    row.failed_fulfillment_requests ?? row.failedFulfillmentRequests,
  );
  const pendingFulfillmentRequests = number(
    row.pending_fulfillment_requests ?? row.pendingFulfillmentRequests,
  );
  const failedInvoiceRequests = number(
    row.failed_invoice_requests ?? row.failedInvoiceRequests,
  );
  const pendingInvoiceRequests = number(
    row.pending_invoice_requests ?? row.pendingInvoiceRequests,
  );
  const pendingReturnRequests = number(
    row.pending_return_requests ?? row.pendingReturnRequests,
  );
  const updatedAge = age(
    row.order_updated_at || row.updated_at || row.updatedAt || row.created_at,
    now,
  );
  const confirmedAge = age(row.confirmed_at || row.confirmedAt, now);
  const deliveryDays = daysUntil(
    row.requested_delivery_date || row.requestedDeliveryDate,
    now,
  );

  if (lineCount < 1) blockers.push("Sales order requires at least one line.");
  if (grandTotal <= 0)
    blockers.push("Sales order total must be greater than zero.");
  if (customerStatus && customerStatus !== "active")
    blockers.push("Customer is not active.");
  if (
    !hasKeys(row.customer_snapshot ?? row.customerSnapshot) &&
    !string(row.customer_name || row.customerName)
  )
    blockers.push("Customer snapshot is missing.");
  if (
    policy.requirePaymentTerms &&
    !row.payment_term_id &&
    !hasKeys(row.payment_term_snapshot ?? row.paymentTermSnapshot)
  )
    blockers.push("Payment terms are required.");
  if (
    policy.requireShippingAddress &&
    !row.shipping_address_id &&
    !hasKeys(row.shipping_address_snapshot ?? row.shippingAddressSnapshot)
  )
    blockers.push("Shipping address is required.");
  if (
    policy.requireCustomerPo &&
    !string(row.customer_po_number || row.customerPoNumber)
  )
    blockers.push("Customer purchase-order number is required.");
  if (policy.requireLineWarehouse && missingWarehouseCount > 0)
    blockers.push(
      `${missingWarehouseCount} order line(s) require a warehouse.`,
    );
  if (lifecycleStatus === "confirmed" && creditStatus === "blocked")
    blockers.push("Customer credit is blocked.");
  if (activeHoldCount > 0)
    blockers.push(`${activeHoldCount} active order hold(s) must be resolved.`);
  if (confirmedQuantity < 0 || reservedQuantity < 0 || fulfilledQuantity < 0)
    blockers.push("Order quantity progress is inconsistent.");
  if (reservedQuantity > confirmedQuantity)
    blockers.push("Reserved quantity exceeds confirmed quantity.");
  if (fulfilledQuantity > confirmedQuantity)
    blockers.push("Fulfilled quantity exceeds confirmed quantity.");

  if (
    lifecycleStatus === "pending_approval" &&
    updatedAge.hours > policy.approvalSlaHours
  )
    warnings.push("Sales-order approval is outside its SLA.");
  if (
    ["draft", "pending_approval", "confirmed", "on_hold"].includes(
      lifecycleStatus,
    ) &&
    updatedAge.days > policy.staleAfterDays
  )
    warnings.push("Sales order has had no recent progress.");
  if (
    ["confirmed", "on_hold"].includes(lifecycleStatus) &&
    deliveryDays !== null &&
    deliveryDays < 0 &&
    remainingToFulfill > 0
  )
    warnings.push("Requested delivery date is overdue.");
  else if (
    ["confirmed", "on_hold"].includes(lifecycleStatus) &&
    deliveryDays !== null &&
    deliveryDays <= policy.deliveryWarningDays &&
    remainingToFulfill > 0
  )
    warnings.push(`Delivery is due in ${Math.max(0, deliveryDays)} day(s).`);
  if (
    lifecycleStatus === "confirmed" &&
    remainingToFulfill > 0 &&
    confirmedAge.days > policy.fulfillmentSlaDays
  )
    warnings.push("Fulfilment has exceeded the configured SLA.");
  if (
    lifecycleStatus === "confirmed" &&
    confirmedQuantity > 0 &&
    reservedQuantity < confirmedQuantity - fulfilledQuantity
  )
    warnings.push("Some confirmed quantity is not reserved for fulfilment.");
  if (failedFulfillmentRequests > 0)
    warnings.push("One or more fulfilment handoffs have failed.");
  if (failedInvoiceRequests > 0)
    warnings.push("One or more invoice handoffs have failed.");
  if (
    billingStatus === "ready" &&
    remainingToInvoice > 0 &&
    confirmedAge.hours > policy.invoiceHandoffSlaHours &&
    pendingInvoiceRequests === 0
  )
    warnings.push("Invoice handoff is overdue.");
  if (pendingFulfillmentRequests > 0)
    warnings.push("A fulfilment handoff is still pending.");
  if (pendingInvoiceRequests > 0)
    warnings.push("An invoice handoff is still pending.");
  if (pendingReturnRequests > 0)
    warnings.push("A sales return request is awaiting a decision.");
  if (
    fulfillmentStatus === "partially_fulfilled" ||
    fulfillmentStatus === "partially_allocated"
  )
    warnings.push("Sales order is only partially fulfilled or allocated.");

  const readiness =
    blockers.length > 0
      ? "blocked"
      : warnings.length > 0
        ? "attention"
        : "ready";
  const approvalSatisfied = ["approved", "not_required"].includes(
    approvalStatus,
  );
  const canOperate = lifecycleStatus === "confirmed" && blockers.length === 0;

  return {
    healthy: readiness === "ready",
    readiness,
    blockers,
    warnings,
    deliveryDays,
    inactiveDays: updatedAge.days,
    confirmedAgeHours: confirmedAge.hours,
    grandTotal,
    remainingToFulfill,
    remainingToInvoice,
    reservedQuantity,
    fulfilledQuantity,
    readyToSubmit: lifecycleStatus === "draft" && blockers.length === 0,
    readyToConfirm:
      ["draft", "approved"].includes(lifecycleStatus) &&
      blockers.length === 0 &&
      (lifecycleStatus === "draft" || approvalSatisfied),
    readyToFulfill: canOperate && remainingToFulfill > 0,
    readyToInvoice:
      canOperate &&
      billingStatus !== "blocked" &&
      remainingToInvoice > 0 &&
      failedInvoiceRequests === 0,
    readyToClose:
      ["confirmed", "on_hold"].includes(lifecycleStatus) &&
      remainingToFulfill <= 0 &&
      remainingToInvoice <= 0 &&
      activeHoldCount === 0 &&
      pendingReturnRequests === 0,
  };
}

export function buildSalesOrderGovernanceSummary(
  rows,
  policyInput = {},
  now = new Date(),
) {
  const summary = {
    total: rows.length,
    active: 0,
    activeValue: 0,
    pendingApproval: 0,
    confirmed: 0,
    onHold: 0,
    overdueDelivery: 0,
    readyToFulfill: 0,
    readyToInvoice: 0,
    failedHandoffs: 0,
    healthy: 0,
    attention: 0,
    blocked: 0,
    byStatus: {},
  };

  for (const row of rows) {
    const status =
      string(row.lifecycle_status || row.lifecycleStatus) || "draft";
    const health = evaluateSalesOrderHealth(row, policyInput, now);
    summary.byStatus[status] = (summary.byStatus[status] || 0) + 1;
    if (
      ["draft", "pending_approval", "confirmed", "on_hold"].includes(status)
    ) {
      summary.active += 1;
      summary.activeValue += number(
        row.base_currency_total ?? row.baseCurrencyTotal ?? row.grand_total,
      );
    }
    if (status === "pending_approval") summary.pendingApproval += 1;
    if (status === "confirmed") summary.confirmed += 1;
    if (status === "on_hold") summary.onHold += 1;
    if ((health.deliveryDays ?? 0) < 0 && health.remainingToFulfill > 0)
      summary.overdueDelivery += 1;
    if (health.readyToFulfill) summary.readyToFulfill += 1;
    if (health.readyToInvoice) summary.readyToInvoice += 1;
    if (
      number(row.failed_fulfillment_requests) > 0 ||
      number(row.failed_invoice_requests) > 0
    )
      summary.failedHandoffs += 1;
    if (health.readiness === "ready") summary.healthy += 1;
    else summary[health.readiness] += 1;
  }

  summary.activeValue = Math.round(summary.activeValue * 100) / 100;
  return summary;
}

async function loadPolicy(client, organizationId) {
  const result = await client.query(
    `SELECT approval_sla_hours,fulfillment_sla_days,delivery_warning_days,
            stale_after_days,invoice_handoff_sla_hours,require_customer_po,
            require_payment_terms,require_shipping_address,
            require_line_warehouse
       FROM tenant.sales_order_governance_policies
      WHERE organization_id=$1`,
    [organizationId],
  );
  return defaultPolicy(result.rows[0] || {});
}

function companyScope(context, values, alias = "sales_order") {
  if (!context.allowAllCompanies && context.activeCompanyId) {
    values.push(context.activeCompanyId);
    return ` AND ${alias}.company_id=$${values.length}`;
  }
  return "";
}

function canViewMargin(context) {
  return hasPermission(context, "sales.margin.view");
}

function redactHealth(health, context) {
  if (canViewMargin(context)) return health;
  const copy = { ...health };
  delete copy.marginPercent;
  return copy;
}

async function loadOrderForAssessment(client, context, orderId) {
  const values = [context.organizationId, uuid(orderId, "Sales order")];
  const scope = companyScope(context, values);
  const result = await client.query(
    `SELECT sales_order.id,sales_order.company_id,sales_order.sales_order_number,
            sales_order.party_id,sales_order.current_version_id,
            sales_order.lifecycle_status,sales_order.approval_status,
            sales_order.credit_status,sales_order.fulfillment_status,
            sales_order.billing_status,sales_order.payment_status,
            sales_order.requested_delivery_date,sales_order.confirmed_at,
            sales_order.created_at,sales_order.updated_at AS order_updated_at,
            version.version_number,version.grand_total,
            version.base_currency_total,version.margin_percent,
            version.payment_term_id,version.shipping_address_id,
            version.customer_po_number,version.customer_snapshot,
            version.payment_term_snapshot,version.shipping_address_snapshot,
            party.status AS customer_status,party.credit_limit,
            policy.*,
            COALESCE(metrics.line_count,0)::int AS line_count,
            COALESCE(metrics.missing_warehouse_count,0)::int AS missing_warehouse_count,
            COALESCE(metrics.confirmed_quantity,0) AS confirmed_quantity,
            COALESCE(metrics.reserved_quantity,0) AS reserved_quantity,
            COALESCE(metrics.fulfilled_quantity,0) AS fulfilled_quantity,
            COALESCE(metrics.invoiced_quantity,0) AS invoiced_quantity,
            COALESCE(metrics.returned_quantity,0) AS returned_quantity,
            COALESCE(metrics.cancelled_quantity,0) AS cancelled_quantity,
            COALESCE(metrics.remaining_to_fulfill,0) AS remaining_to_fulfill,
            COALESCE(metrics.remaining_to_invoice,0) AS remaining_to_invoice,
            COALESCE(holds.active_hold_count,0)::int AS active_hold_count,
            COALESCE(requests.pending_fulfillment_requests,0)::int AS pending_fulfillment_requests,
            COALESCE(requests.failed_fulfillment_requests,0)::int AS failed_fulfillment_requests,
            COALESCE(requests.pending_invoice_requests,0)::int AS pending_invoice_requests,
            COALESCE(requests.failed_invoice_requests,0)::int AS failed_invoice_requests,
            COALESCE(returns.pending_return_requests,0)::int AS pending_return_requests
       FROM tenant.sales_orders sales_order
       JOIN tenant.sales_order_versions version
         ON version.organization_id=sales_order.organization_id
        AND version.id=sales_order.current_version_id
       JOIN tenant.business_parties party
         ON party.organization_id=sales_order.organization_id
        AND party.id=sales_order.party_id
       LEFT JOIN tenant.sales_order_governance_policies policy
         ON policy.organization_id=sales_order.organization_id
       LEFT JOIN LATERAL (
         SELECT count(*) AS line_count,
                count(*) FILTER (WHERE line.warehouse_id IS NULL) AS missing_warehouse_count,
                COALESCE(sum(progress.confirmed_quantity),0) AS confirmed_quantity,
                COALESCE(sum(progress.reserved_quantity),0) AS reserved_quantity,
                COALESCE(sum(progress.fulfilled_quantity),0) AS fulfilled_quantity,
                COALESCE(sum(progress.invoiced_quantity),0) AS invoiced_quantity,
                COALESCE(sum(progress.returned_quantity),0) AS returned_quantity,
                COALESCE(sum(progress.cancelled_quantity),0) AS cancelled_quantity,
                COALESCE(sum(GREATEST(
                  progress.confirmed_quantity-progress.fulfilled_quantity-
                  progress.cancelled_quantity,0
                )),0) AS remaining_to_fulfill,
                COALESCE(sum(GREATEST(
                  progress.confirmed_quantity-progress.invoiced_quantity-
                  progress.cancelled_quantity,0
                )),0) AS remaining_to_invoice
           FROM tenant.sales_order_lines line
           JOIN tenant.sales_order_line_progress progress
             ON progress.organization_id=line.organization_id
            AND progress.sales_order_line_id=line.id
          WHERE line.organization_id=sales_order.organization_id
            AND line.sales_order_version_id=sales_order.current_version_id
       ) metrics ON true
       LEFT JOIN LATERAL (
         SELECT count(*) FILTER (WHERE status='active') AS active_hold_count
           FROM tenant.sales_order_holds hold
          WHERE hold.organization_id=sales_order.organization_id
            AND hold.sales_order_id=sales_order.id
       ) holds ON true
       LEFT JOIN LATERAL (
         SELECT
           count(*) FILTER (WHERE request_kind='fulfillment' AND status IN ('pending','processing')) AS pending_fulfillment_requests,
           count(*) FILTER (WHERE request_kind='fulfillment' AND status='failed') AS failed_fulfillment_requests,
           count(*) FILTER (WHERE request_kind='invoice' AND status IN ('pending','processing')) AS pending_invoice_requests,
           count(*) FILTER (WHERE request_kind='invoice' AND status='failed') AS failed_invoice_requests
         FROM (
           SELECT 'fulfillment'::text AS request_kind,status
             FROM tenant.sales_fulfillment_requests
            WHERE organization_id=sales_order.organization_id
              AND sales_order_id=sales_order.id
           UNION ALL
           SELECT 'invoice'::text AS request_kind,status
             FROM tenant.sales_invoice_requests
            WHERE organization_id=sales_order.organization_id
              AND sales_order_id=sales_order.id
         ) handoff
       ) requests ON true
       LEFT JOIN LATERAL (
         SELECT count(*) FILTER (WHERE status IN ('pending','approved')) AS pending_return_requests
           FROM tenant.sales_return_requests return_request
          WHERE return_request.organization_id=sales_order.organization_id
            AND return_request.sales_order_id=sales_order.id
       ) returns ON true
      WHERE sales_order.organization_id=$1 AND sales_order.id=$2${scope}`,
    values,
  );
  if (!result.rows[0]) {
    throw new SalesOrderGovernanceError(
      404,
      "Sales order not found.",
      "SALES_ORDER_NOT_FOUND",
    );
  }
  return result.rows[0];
}

export async function getSalesOrderGovernanceDashboard(client, context) {
  requirePermission(context, "sales.view");
  const policy = await loadPolicy(client, context.organizationId);
  const values = [context.organizationId];
  const scope = companyScope(context, values);
  const result = await client.query(
    `SELECT sales_order.id,sales_order.lifecycle_status,
            sales_order.approval_status,sales_order.credit_status,
            sales_order.fulfillment_status,sales_order.billing_status,
            sales_order.requested_delivery_date,sales_order.confirmed_at,
            sales_order.updated_at AS order_updated_at,
            version.grand_total,version.base_currency_total,
            version.payment_term_id,version.shipping_address_id,
            version.customer_po_number,version.customer_snapshot,
            version.payment_term_snapshot,version.shipping_address_snapshot,
            party.status AS customer_status,
            COALESCE(metrics.line_count,0)::int AS line_count,
            COALESCE(metrics.missing_warehouse_count,0)::int AS missing_warehouse_count,
            COALESCE(metrics.confirmed_quantity,0) AS confirmed_quantity,
            COALESCE(metrics.reserved_quantity,0) AS reserved_quantity,
            COALESCE(metrics.fulfilled_quantity,0) AS fulfilled_quantity,
            COALESCE(metrics.remaining_to_fulfill,0) AS remaining_to_fulfill,
            COALESCE(metrics.remaining_to_invoice,0) AS remaining_to_invoice,
            COALESCE(holds.active_hold_count,0)::int AS active_hold_count,
            COALESCE(requests.pending_fulfillment_requests,0)::int AS pending_fulfillment_requests,
            COALESCE(requests.failed_fulfillment_requests,0)::int AS failed_fulfillment_requests,
            COALESCE(requests.pending_invoice_requests,0)::int AS pending_invoice_requests,
            COALESCE(requests.failed_invoice_requests,0)::int AS failed_invoice_requests,
            COALESCE(returns.pending_return_requests,0)::int AS pending_return_requests
       FROM tenant.sales_orders sales_order
       JOIN tenant.sales_order_versions version
         ON version.organization_id=sales_order.organization_id
        AND version.id=sales_order.current_version_id
       JOIN tenant.business_parties party
         ON party.organization_id=sales_order.organization_id
        AND party.id=sales_order.party_id
       LEFT JOIN LATERAL (
         SELECT count(*) AS line_count,
                count(*) FILTER (WHERE line.warehouse_id IS NULL) AS missing_warehouse_count,
                COALESCE(sum(progress.confirmed_quantity),0) AS confirmed_quantity,
                COALESCE(sum(progress.reserved_quantity),0) AS reserved_quantity,
                COALESCE(sum(progress.fulfilled_quantity),0) AS fulfilled_quantity,
                COALESCE(sum(GREATEST(progress.confirmed_quantity-progress.fulfilled_quantity-progress.cancelled_quantity,0)),0) AS remaining_to_fulfill,
                COALESCE(sum(GREATEST(progress.confirmed_quantity-progress.invoiced_quantity-progress.cancelled_quantity,0)),0) AS remaining_to_invoice
           FROM tenant.sales_order_lines line
           JOIN tenant.sales_order_line_progress progress
             ON progress.organization_id=line.organization_id
            AND progress.sales_order_line_id=line.id
          WHERE line.organization_id=sales_order.organization_id
            AND line.sales_order_version_id=sales_order.current_version_id
       ) metrics ON true
       LEFT JOIN LATERAL (
         SELECT count(*) FILTER (WHERE status='active') AS active_hold_count
           FROM tenant.sales_order_holds hold
          WHERE hold.organization_id=sales_order.organization_id
            AND hold.sales_order_id=sales_order.id
       ) holds ON true
       LEFT JOIN LATERAL (
         SELECT
           count(*) FILTER (WHERE request_kind='fulfillment' AND status IN ('pending','processing')) AS pending_fulfillment_requests,
           count(*) FILTER (WHERE request_kind='fulfillment' AND status='failed') AS failed_fulfillment_requests,
           count(*) FILTER (WHERE request_kind='invoice' AND status IN ('pending','processing')) AS pending_invoice_requests,
           count(*) FILTER (WHERE request_kind='invoice' AND status='failed') AS failed_invoice_requests
         FROM (
           SELECT 'fulfillment'::text AS request_kind,status
             FROM tenant.sales_fulfillment_requests
            WHERE organization_id=sales_order.organization_id AND sales_order_id=sales_order.id
           UNION ALL
           SELECT 'invoice'::text AS request_kind,status
             FROM tenant.sales_invoice_requests
            WHERE organization_id=sales_order.organization_id AND sales_order_id=sales_order.id
         ) handoff
       ) requests ON true
       LEFT JOIN LATERAL (
         SELECT count(*) FILTER (WHERE status IN ('pending','approved')) AS pending_return_requests
           FROM tenant.sales_return_requests return_request
          WHERE return_request.organization_id=sales_order.organization_id
            AND return_request.sales_order_id=sales_order.id
       ) returns ON true
      WHERE sales_order.organization_id=$1${scope}
      ORDER BY sales_order.updated_at DESC
      LIMIT 500`,
    values,
  );
  return {
    policy,
    summary: buildSalesOrderGovernanceSummary(result.rows, policy),
    queues: result.rows
      .map((row) => ({
        id: row.id,
        lifecycleStatus: row.lifecycle_status,
        health: redactHealth(evaluateSalesOrderHealth(row, policy), context),
      }))
      .filter((row) => row.health.readiness !== "ready")
      .slice(0, 100),
  };
}

export async function assessSalesOrderReadiness(client, context, orderId) {
  requirePermission(context, "sales.view");
  const row = await loadOrderForAssessment(client, context, orderId);
  const policy = defaultPolicy(row);
  return {
    orderId: row.id,
    orderNumber: row.sales_order_number,
    versionId: row.current_version_id,
    policy,
    health: redactHealth(evaluateSalesOrderHealth(row, policy), context),
  };
}

export async function closeSalesOrder(client, context, orderId) {
  requirePermission(context, "sales.order.confirm");
  const row = await loadOrderForAssessment(client, context, orderId);
  const policy = defaultPolicy(row);
  const health = evaluateSalesOrderHealth(row, policy);
  if (!health.readyToClose) {
    throw new SalesOrderGovernanceError(
      409,
      "This order is not ready to close: fulfilment, invoicing, holds or returns are still outstanding.",
      "SALES_ORDER_NOT_READY_TO_CLOSE",
    );
  }
  const result = await client.query(
    `UPDATE tenant.sales_orders
        SET lifecycle_status='closed',closed_at=now(),updated_by=$1,updated_at=now()
      WHERE organization_id=$2 AND id=$3
        AND lifecycle_status IN ('confirmed','on_hold')
        AND current_version_id=$4
      RETURNING id`,
    [context.userId, context.organizationId, row.id, row.current_version_id],
  );
  if (!result.rows[0]) {
    throw new SalesOrderGovernanceError(
      409,
      "The order changed before it could be closed.",
      "SALES_ORDER_VERSION_CONFLICT",
    );
  }
  await client.query(
    `INSERT INTO tenant.sales_document_events (organization_id,entity_type,entity_id,event_type,from_status,to_status,metadata,actor_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`,
    [
      context.organizationId,
      "sales_order",
      row.id,
      "sales_order.closed",
      row.lifecycle_status,
      "closed",
      JSON.stringify({ versionId: row.current_version_id }),
      context.userId || null,
    ],
  );
  return { orderId: row.id, status: "closed" };
}

export async function captureSalesOrderGovernanceSnapshot(
  client,
  context,
  orderId,
  capturedFor = "manual",
) {
  requirePermission(context, "sales.view");
  const row = await loadOrderForAssessment(client, context, orderId);
  const policy = defaultPolicy(row);
  const health = evaluateSalesOrderHealth(row, policy);
  const metrics = {
    deliveryDays: health.deliveryDays,
    inactiveDays: health.inactiveDays,
    confirmedAgeHours: health.confirmedAgeHours,
    grandTotal: health.grandTotal,
    remainingToFulfill: health.remainingToFulfill,
    remainingToInvoice: health.remainingToInvoice,
    reservedQuantity: health.reservedQuantity,
    fulfilledQuantity: health.fulfilledQuantity,
    readyToFulfill: health.readyToFulfill,
    readyToInvoice: health.readyToInvoice,
    readyToClose: health.readyToClose,
  };
  const result = await client.query(
    `INSERT INTO tenant.sales_order_governance_snapshots (
       organization_id,sales_order_id,sales_order_version_id,
       lifecycle_status,credit_status,fulfillment_status,billing_status,
       readiness_status,blockers,warnings,metrics,captured_for,captured_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb,$12,$13)
     RETURNING id,readiness_status,blockers,warnings,metrics,captured_for,captured_at`,
    [
      context.organizationId,
      row.id,
      row.current_version_id,
      row.lifecycle_status,
      row.credit_status,
      row.fulfillment_status,
      row.billing_status,
      health.readiness,
      JSON.stringify(health.blockers),
      JSON.stringify(health.warnings),
      JSON.stringify(metrics),
      string(capturedFor).slice(0, 120) || "manual",
      context.userId,
    ],
  );
  return result.rows[0];
}

export async function getSalesOrderGovernanceTimeline(
  client,
  context,
  orderId,
) {
  requirePermission(context, "sales.view");
  const row = await loadOrderForAssessment(client, context, orderId);
  const [
    versions,
    amendments,
    holds,
    fulfillment,
    invoices,
    returns,
    events,
    snapshots,
  ] = await Promise.all([
    client.query(
      `SELECT id,version_number,amendment_reason,grand_total,currency_code,created_at,created_by
           FROM tenant.sales_order_versions
          WHERE organization_id=$1 AND sales_order_id=$2
          ORDER BY version_number DESC`,
      [context.organizationId, row.id],
    ),
    client.query(
      `SELECT id,from_version_id,to_version_id,reason,approval_request_id,created_by,created_at
           FROM tenant.sales_order_amendments
          WHERE organization_id=$1 AND sales_order_id=$2
          ORDER BY created_at DESC`,
      [context.organizationId, row.id],
    ),
    client.query(
      `SELECT id,hold_type,reason,status,placed_by,placed_at,released_by,released_at,release_note
           FROM tenant.sales_order_holds
          WHERE organization_id=$1 AND sales_order_id=$2
          ORDER BY placed_at DESC`,
      [context.organizationId, row.id],
    ),
    client.query(
      `SELECT id,request_number,status,retry_count,last_error,requested_by,requested_at,completed_at
           FROM tenant.sales_fulfillment_requests
          WHERE organization_id=$1 AND sales_order_id=$2
          ORDER BY requested_at DESC`,
      [context.organizationId, row.id],
    ),
    client.query(
      `SELECT id,request_number,quantity_basis,status,retry_count,last_error,requested_by,requested_at,completed_at
           FROM tenant.sales_invoice_requests
          WHERE organization_id=$1 AND sales_order_id=$2
          ORDER BY requested_at DESC`,
      [context.organizationId, row.id],
    ),
    client.query(
      `SELECT id,request_number,reason,lines,status,requested_by,requested_at,decided_by,decided_at,decision_note,completed_at
           FROM tenant.sales_return_requests
          WHERE organization_id=$1 AND sales_order_id=$2
          ORDER BY requested_at DESC`,
      [context.organizationId, row.id],
    ),
    client.query(
      `SELECT id,event_type,from_status,to_status,metadata,actor_user_id,occurred_at
           FROM tenant.sales_document_events
          WHERE organization_id=$1 AND entity_type='sales_order' AND entity_id=$2
          ORDER BY occurred_at DESC LIMIT 500`,
      [context.organizationId, row.id],
    ),
    client.query(
      `SELECT id,sales_order_version_id,lifecycle_status,credit_status,
                fulfillment_status,billing_status,readiness_status,
                blockers,warnings,metrics,captured_for,captured_by,captured_at
           FROM tenant.sales_order_governance_snapshots
          WHERE organization_id=$1 AND sales_order_id=$2
          ORDER BY captured_at DESC LIMIT 200`,
      [context.organizationId, row.id],
    ),
  ]);
  return {
    orderId: row.id,
    versions: versions.rows,
    amendments: amendments.rows,
    holds: holds.rows,
    fulfillmentRequests: fulfillment.rows,
    invoiceRequests: invoices.rows,
    returnRequests: returns.rows,
    events: events.rows,
    snapshots: snapshots.rows,
  };
}

export async function compareSalesOrderVersions(
  client,
  context,
  orderId,
  leftVersionId,
  rightVersionId,
) {
  requirePermission(context, "sales.view");
  const id = uuid(orderId, "Sales order");
  const left = uuid(leftVersionId, "Left sales-order version");
  const right = uuid(rightVersionId, "Right sales-order version");
  if (left === right) {
    throw new SalesOrderGovernanceError(
      400,
      "Select two different sales-order versions.",
      "SALES_ORDER_VERSION_COMPARISON_IDENTICAL",
    );
  }
  await loadOrderForAssessment(client, context, id);
  const versions = await client.query(
    `SELECT id,version_number,amendment_reason,currency_code,exchange_rate,
            payment_term_id,billing_address_id,shipping_address_id,
            customer_po_number,customer_po_date,priority,delivery_terms,
            shipping_method,incoterm,place_of_supply,supply_type,
            subtotal,discount_total,charge_total,tax_total,
            rounding_adjustment,grand_total,base_currency_total,
            margin_amount,margin_percent,customer_snapshot,
            payment_term_snapshot,shipping_address_snapshot,content_hash
       FROM tenant.sales_order_versions
      WHERE organization_id=$1 AND sales_order_id=$2 AND id=ANY($3::uuid[])`,
    [context.organizationId, id, [left, right]],
  );
  if (versions.rows.length !== 2) {
    throw new SalesOrderGovernanceError(
      404,
      "One or both sales-order versions were not found.",
      "SALES_ORDER_VERSION_NOT_FOUND",
    );
  }
  const lines = await client.query(
    `SELECT sales_order_version_id,sequence,item_id,item_code_snapshot,
            item_name_snapshot,quantity,unit_price,discount_percent,
            discount_amount,tax_amount,line_total,warehouse_id,
            requested_delivery_date,promised_delivery_date
       FROM tenant.sales_order_lines
      WHERE organization_id=$1 AND sales_order_version_id=ANY($2::uuid[])
      ORDER BY sales_order_version_id,sequence`,
    [context.organizationId, [left, right]],
  );
  const byId = new Map(versions.rows.map((row) => [row.id, { ...row }]));
  const leftRow = byId.get(left);
  const rightRow = byId.get(right);
  const fields = Object.keys(leftRow).filter(
    (field) =>
      !["id", "version_number"].includes(field) &&
      JSON.stringify(leftRow[field] ?? null) !==
        JSON.stringify(rightRow[field] ?? null),
  );
  const lineGroups = { left: [], right: [] };
  for (const line of lines.rows)
    lineGroups[line.sales_order_version_id === left ? "left" : "right"].push(
      line,
    );
  const totals = {
    grandTotal: number(rightRow.grand_total) - number(leftRow.grand_total),
    discountTotal:
      number(rightRow.discount_total) - number(leftRow.discount_total),
    taxTotal: number(rightRow.tax_total) - number(leftRow.tax_total),
    marginPercent:
      number(rightRow.margin_percent) - number(leftRow.margin_percent),
    lineCount: lineGroups.right.length - lineGroups.left.length,
  };
  if (!canViewMargin(context)) {
    for (const row of [leftRow, rightRow]) {
      delete row.margin_amount;
      delete row.margin_percent;
    }
    delete totals.marginPercent;
  }
  return {
    orderId: id,
    left: leftRow,
    right: rightRow,
    changedFields: canViewMargin(context)
      ? fields
      : fields.filter(
          (field) => !["margin_amount", "margin_percent"].includes(field),
        ),
    totals,
    lines: lineGroups,
  };
}

export async function bulkUpdateSalesOrders(client, context, input = {}) {
  requirePermission(context, "sales.order.create");
  const ids = Array.isArray(input.ids)
    ? [...new Set(input.ids.map((value) => uuid(value, "Sales order")))]
    : [];
  if (!ids.length || ids.length > 200) {
    throw new SalesOrderGovernanceError(
      400,
      "Select between 1 and 200 sales orders.",
      "SALES_ORDER_BULK_SELECTION_INVALID",
    );
  }
  const changes = object(input.changes);
  const values = [context.organizationId, ids];
  const sets = [];
  if (Object.prototype.hasOwnProperty.call(changes, "ownerUserId")) {
    const ownerUserId = uuid(changes.ownerUserId, "Owner");
    const owner = await client.query(
      `SELECT 1
         FROM public.organization_memberships membership
         JOIN public.users users ON users.id=membership.user_id
        WHERE membership.organization_id=$1
          AND membership.user_id=$2
          AND membership.status='active'
          AND users.status='active'`,
      [context.organizationId, ownerUserId],
    );
    if (!owner.rows[0]) {
      throw new SalesOrderGovernanceError(
        409,
        "The selected owner is not an active organisation member.",
        "SALES_ORDER_OWNER_INVALID",
      );
    }
    values.push(ownerUserId);
    sets.push(`owner_user_id=$${values.length}`);
  }
  if (Object.prototype.hasOwnProperty.call(changes, "requestedDeliveryDate")) {
    const requestedDeliveryDate = dateOnly(changes.requestedDeliveryDate);
    if (!requestedDeliveryDate) {
      throw new SalesOrderGovernanceError(
        400,
        "Requested delivery date must be a date.",
        "SALES_ORDER_DELIVERY_DATE_INVALID",
      );
    }
    values.push(requestedDeliveryDate);
    sets.push(`requested_delivery_date=$${values.length}`);
  }
  if (!sets.length) {
    throw new SalesOrderGovernanceError(
      400,
      "No supported sales-order changes were supplied.",
      "SALES_ORDER_BULK_CHANGES_EMPTY",
    );
  }
  values.push(context.userId);
  sets.push(`updated_by=$${values.length}`, "updated_at=now()");
  let scope = "";
  if (!context.allowAllCompanies && context.activeCompanyId) {
    values.push(context.activeCompanyId);
    scope = ` AND company_id=$${values.length}`;
  }
  const result = await client.query(
    `UPDATE tenant.sales_orders
        SET ${sets.join(",")}
      WHERE organization_id=$1
        AND id=ANY($2::uuid[])
        AND lifecycle_status='draft'${scope}
      RETURNING id,sales_order_number,owner_user_id,
                requested_delivery_date,updated_at`,
    values,
  );
  return {
    requested: ids.length,
    updated: result.rowCount ?? result.rows.length,
    skipped: ids.length - (result.rowCount ?? result.rows.length),
    rows: result.rows,
  };
}

// Local bookkeeping only - does not touch tenant.stock_balances. Only call
// this after a real reservation succeeds via Stock's canonical reserveStock
// (see orchestration/sales-stock-reservation.js's reserveSalesOrderLineFromStock).
// Never expose this directly on a route - a caller could believe stock was
// actually reserved when only this local mirror was updated.
export async function reserveSalesOrderLines(
  client,
  context,
  orderId,
  input = {},
) {
  requirePermission(context, "sales.fulfillment.request");
  const row = await loadOrderForAssessment(client, context, orderId);
  if (row.lifecycle_status !== "confirmed") {
    throw new SalesOrderGovernanceError(
      409,
      "Only confirmed sales orders can record fulfilment reservations.",
      "SALES_ORDER_RESERVATION_STATE_INVALID",
    );
  }
  if (number(row.remaining_to_fulfill) <= 0) {
    throw new SalesOrderGovernanceError(
      409,
      "No confirmed quantity remains to reserve for fulfilment.",
      "SALES_ORDER_RESERVATION_NOT_REQUIRED",
    );
  }
  const lines = Array.isArray(input.lines) ? input.lines : [];
  if (!lines.length || lines.length > 500) {
    throw new SalesOrderGovernanceError(
      400,
      "Select between 1 and 500 sales-order lines.",
      "SALES_ORDER_RESERVATION_LINES_INVALID",
    );
  }
  const updated = [];
  for (const [index, lineInput] of lines.entries()) {
    const lineId = uuid(lineInput.salesOrderLineId, `Line ${index + 1}`);
    let reservedQuantity;
    try {
      reservedQuantity = decimal(lineInput.reservedQuantity);
    } catch {
      reservedQuantity = -1n;
    }
    if (reservedQuantity < 0n) {
      throw new SalesOrderGovernanceError(
        400,
        `Line ${index + 1} reserved quantity is invalid.`,
        "SALES_ORDER_RESERVATION_QUANTITY_INVALID",
      );
    }
    const current = await client.query(
      `SELECT progress.confirmed_quantity,progress.fulfilled_quantity,
              progress.cancelled_quantity,line.sales_order_version_id
         FROM tenant.sales_order_line_progress progress
         JOIN tenant.sales_order_lines line
           ON line.organization_id=progress.organization_id
          AND line.id=progress.sales_order_line_id
        WHERE progress.organization_id=$1
          AND progress.sales_order_line_id=$2
          AND line.sales_order_version_id=$3
        FOR UPDATE`,
      [context.organizationId, lineId, row.current_version_id],
    );
    const progress = current.rows[0];
    if (!progress) {
      throw new SalesOrderGovernanceError(
        404,
        `Line ${index + 1} was not found in the current order version.`,
        "SALES_ORDER_LINE_NOT_FOUND",
      );
    }
    const maximum = sub(
      sub(
        decimal(progress.confirmed_quantity),
        decimal(progress.fulfilled_quantity),
      ),
      decimal(progress.cancelled_quantity),
    );
    if (reservedQuantity > maximum) {
      throw new SalesOrderGovernanceError(
        409,
        `Line ${index + 1} reservation exceeds the unfulfilled confirmed quantity.`,
        "SALES_ORDER_RESERVATION_EXCEEDS_REMAINING",
      );
    }
    const result = await client.query(
      `UPDATE tenant.sales_order_line_progress
          SET reserved_quantity=$3,updated_by=$4,updated_at=now()
        WHERE organization_id=$1 AND sales_order_line_id=$2
        RETURNING sales_order_line_id,reserved_quantity,updated_at`,
      [
        context.organizationId,
        lineId,
        asDatabaseDecimal(reservedQuantity),
        context.userId,
      ],
    );
    updated.push(result.rows[0]);
  }
  await client.query(
    `UPDATE tenant.sales_orders
        SET fulfillment_status=CASE
          WHEN EXISTS (
            SELECT 1 FROM tenant.sales_order_lines line
            JOIN tenant.sales_order_line_progress progress
              ON progress.organization_id=line.organization_id
             AND progress.sales_order_line_id=line.id
            WHERE line.organization_id=$1
              AND line.sales_order_version_id=$3
              AND progress.reserved_quantity <
                  progress.confirmed_quantity-progress.fulfilled_quantity-progress.cancelled_quantity
          ) THEN 'partially_allocated'
          ELSE 'allocated'
        END,
        updated_by=$4,updated_at=now()
      WHERE organization_id=$1 AND id=$2 AND lifecycle_status='confirmed'`,
    [context.organizationId, row.id, row.current_version_id, context.userId],
  );
  return { orderId: row.id, updated: updated.length, lines: updated };
}

export async function createSalesReturnRequest(
  client,
  context,
  orderId,
  input = {},
) {
  requirePermission(context, "sales.order.amend");
  const row = await loadOrderForAssessment(client, context, orderId);
  if (!["confirmed", "on_hold", "closed"].includes(row.lifecycle_status)) {
    throw new SalesOrderGovernanceError(
      409,
      "Returns require a confirmed, held or closed sales order.",
      "SALES_RETURN_ORDER_STATE_INVALID",
    );
  }
  const idempotencyKey = string(input.idempotencyKey).slice(0, 200);
  const reason = string(input.reason).slice(0, 2000);
  const lines = Array.isArray(input.lines) ? input.lines : [];
  if (idempotencyKey.length < 8) {
    throw new SalesOrderGovernanceError(
      400,
      "A return idempotency key of at least 8 characters is required.",
      "SALES_RETURN_IDEMPOTENCY_REQUIRED",
    );
  }
  if (!reason) {
    throw new SalesOrderGovernanceError(
      400,
      "A sales return reason is required.",
      "SALES_RETURN_REASON_REQUIRED",
    );
  }
  if (!lines.length || lines.length > 500) {
    throw new SalesOrderGovernanceError(
      400,
      "Select between 1 and 500 returned lines.",
      "SALES_RETURN_LINES_INVALID",
    );
  }
  const existing = await client.query(
    `SELECT id,request_number,status
       FROM tenant.sales_return_requests
      WHERE organization_id=$1 AND idempotency_key=$2`,
    [context.organizationId, idempotencyKey],
  );
  if (existing.rows[0]) return { ...existing.rows[0], idempotent: true };

  const normalized = [];
  for (const [index, lineInput] of lines.entries()) {
    const lineId = uuid(lineInput.salesOrderLineId, `Line ${index + 1}`);
    let quantity;
    try {
      quantity = decimal(lineInput.quantity);
    } catch {
      quantity = 0n;
    }
    if (quantity <= 0n) {
      throw new SalesOrderGovernanceError(
        400,
        `Line ${index + 1} return quantity must be greater than zero.`,
        "SALES_RETURN_QUANTITY_INVALID",
      );
    }
    const result = await client.query(
      `SELECT line.id,line.item_id,line.item_code_snapshot,
              progress.fulfilled_quantity,progress.returned_quantity
         FROM tenant.sales_order_lines line
         JOIN tenant.sales_order_line_progress progress
           ON progress.organization_id=line.organization_id
          AND progress.sales_order_line_id=line.id
        WHERE line.organization_id=$1 AND line.id=$2
          AND line.sales_order_version_id=$3`,
      [context.organizationId, lineId, row.current_version_id],
    );
    const line = result.rows[0];
    if (!line) {
      throw new SalesOrderGovernanceError(
        404,
        `Line ${index + 1} was not found in the current order version.`,
        "SALES_RETURN_LINE_NOT_FOUND",
      );
    }
    const available = sub(
      decimal(line.fulfilled_quantity),
      decimal(line.returned_quantity),
    );
    if (quantity > available) {
      throw new SalesOrderGovernanceError(
        409,
        `Line ${index + 1} return quantity exceeds fulfilled quantity available to return.`,
        "SALES_RETURN_EXCEEDS_FULFILLED",
      );
    }
    normalized.push({
      salesOrderLineId: line.id,
      itemId: line.item_id,
      itemCode: line.item_code_snapshot,
      quantity: asDatabaseDecimal(quantity),
    });
  }
  const result = await client.query(
    `INSERT INTO tenant.sales_return_requests (
       organization_id,request_number,sales_order_id,sales_order_version_id,
       idempotency_key,reason,lines,requested_by
     ) VALUES (
       $1,
       'RET-' || to_char(clock_timestamp(),'YYYYMMDDHH24MISSMS') || '-' ||
         upper(substr(gen_random_uuid()::text,1,8)),
       $2,$3,$4,$5,$6::jsonb,$7
     )
     RETURNING id,request_number,status,requested_at`,
    [
      context.organizationId,
      row.id,
      row.current_version_id,
      idempotencyKey,
      reason,
      JSON.stringify(normalized),
      context.userId,
    ],
  );
  return { ...result.rows[0], idempotent: false };
}

export async function listSalesOrderSavedViews(client, context) {
  requirePermission(context, "sales.view");
  const result = await client.query(
    `SELECT id,name,filters,columns,sort,is_shared,owner_user_id,
            created_at,updated_at
       FROM tenant.sales_order_saved_views
      WHERE organization_id=$1
        AND (owner_user_id=$2 OR is_shared=true)
      ORDER BY is_shared DESC,name`,
    [context.organizationId, context.userId],
  );
  return result.rows;
}

export async function saveSalesOrderView(client, context, input = {}) {
  requirePermission(context, "sales.view");
  if (!context.userId) {
    throw new SalesOrderGovernanceError(
      401,
      "A signed-in user is required.",
      "SALES_ORDER_USER_REQUIRED",
    );
  }
  const name = string(input.name).slice(0, 120);
  if (!name) {
    throw new SalesOrderGovernanceError(
      400,
      "Saved view name is required.",
      "SALES_ORDER_VIEW_NAME_REQUIRED",
    );
  }
  const isShared = input.isShared === true;
  if (isShared && !hasPermission(context, "sales.settings.manage")) {
    throw new SalesOrderGovernanceError(
      403,
      "Sales settings permission is required to share a view.",
      "SALES_ORDER_VIEW_SHARE_DENIED",
    );
  }
  const result = await client.query(
    `INSERT INTO tenant.sales_order_saved_views (
       organization_id,owner_user_id,name,filters,columns,sort,is_shared
     ) VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7)
     ON CONFLICT (organization_id,owner_user_id,name)
     DO UPDATE SET filters=EXCLUDED.filters,columns=EXCLUDED.columns,
                   sort=EXCLUDED.sort,is_shared=EXCLUDED.is_shared,
                   updated_at=now()
     RETURNING id,name,filters,columns,sort,is_shared,created_at,updated_at`,
    [
      context.organizationId,
      context.userId,
      name,
      JSON.stringify(object(input.filters)),
      JSON.stringify(Array.isArray(input.columns) ? input.columns : []),
      JSON.stringify(Array.isArray(input.sort) ? input.sort : []),
      isShared,
    ],
  );
  return result.rows[0];
}

export async function deleteSalesOrderSavedView(client, context, savedViewId) {
  requirePermission(context, "sales.view");
  const id = uuid(savedViewId, "Saved view");
  const result = await client.query(
    `DELETE FROM tenant.sales_order_saved_views
      WHERE organization_id=$1 AND id=$2
        AND (owner_user_id=$3 OR $4::boolean)
      RETURNING id`,
    [
      context.organizationId,
      id,
      context.userId,
      hasPermission(context, "sales.settings.manage"),
    ],
  );
  if (!result.rows[0]) {
    throw new SalesOrderGovernanceError(
      404,
      "Saved sales-order view not found.",
      "SALES_ORDER_VIEW_NOT_FOUND",
    );
  }
  return { id: result.rows[0].id, deleted: true };
}
