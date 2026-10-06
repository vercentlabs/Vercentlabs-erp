
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
  "purchase-orders": "procurement_purchase_orders",
  receipts: "procurement_receipts",
});
const string = (value) => String(value ?? "").trim();
const number = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const object = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};
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
  // The Supplier Master's own rule: only an active supplier takes a purchase order forward.
  if (supplierStatus && supplierStatus !== "active")
    blockers.push(`Purchase order supplier is ${supplierStatus}.`);
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

async function getPolicy(client, context) {
  const result = await client.query(
    `SELECT * FROM tenant.procurement_governance_policies WHERE organization_id=$1 LIMIT 1`,
    [context.organizationId],
  );
  return result.rows[0] || defaultPolicy();
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
  const result = await client.query(
    `SELECT record.* FROM tenant.${table} record WHERE record.organization_id=$1 AND record.id=$2${forUpdate ? " FOR UPDATE" : ""}`,
    [context.organizationId, id],
  );
  if (!result.rows[0])
    throw new ProcurementGovernanceError(
      404,
      "Procurement record was not found.",
    );
  return result.rows[0];
}

async function enrichEntity(client, context, entityType, row, policy) {
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
  const policy = defaultPolicy(await getPolicy(client, context));
  const enriched = await enrichEntity(client, context, entityType, row, policy);
  return {
    record: enriched,
    health: evaluateEntity(entityType, enriched, policy),
    policy,
  };
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

