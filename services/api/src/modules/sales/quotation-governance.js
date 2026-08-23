import { SalesError } from "./index.js";

export class QuotationGovernanceError extends SalesError {
  constructor(status, message, code = "SALES_QUOTATION_GOVERNANCE_ERROR") {
    super(status, message, code);
    this.name = "QuotationGovernanceError";
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
const dateOnly = (value) => {
  const result = string(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(result) ? result : null;
};
const uuid = (value, label) => {
  const result = string(value);
  if (!UUID_PATTERN.test(result)) {
    throw new QuotationGovernanceError(
      400,
      `${label} is invalid.`,
      "SALES_QUOTATION_IDENTIFIER_INVALID",
    );
  }
  return result;
};

function hasPermission(context, permission) {
  return (
    context.permissions?.includes(permission) ||
    context.roleSlugs?.includes("organization_owner")
  );
}

function requirePermission(context, permission) {
  if (!hasPermission(context, permission)) {
    throw new QuotationGovernanceError(
      403,
      "You do not have permission to perform this action.",
      "SALES_QUOTATION_PERMISSION_DENIED",
    );
  }
}

function defaultPolicy(policy = {}) {
  return {
    approvalSlaHours: Math.max(
      1,
      number(policy.approval_sla_hours ?? policy.approvalSlaHours ?? 24),
    ),
    sentFollowUpDays: Math.max(
      1,
      number(policy.sent_follow_up_days ?? policy.sentFollowUpDays ?? 3),
    ),
    expiryWarningDays: Math.max(
      1,
      number(policy.expiry_warning_days ?? policy.expiryWarningDays ?? 7),
    ),
    staleAfterDays: Math.max(
      1,
      number(policy.stale_after_days ?? policy.staleAfterDays ?? 14),
    ),
    requirePaymentTerms:
      policy.require_payment_terms ?? policy.requirePaymentTerms ?? true,
    requireBillingAddress:
      policy.require_billing_address ?? policy.requireBillingAddress ?? true,
    requireContact: policy.require_contact ?? policy.requireContact ?? false,
  };
}

function dateDistanceInDays(value, now) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return Math.ceil((parsed.getTime() - now.getTime()) / DAY_MS);
}

export function evaluateQuotationHealth(
  row,
  policyInput = {},
  now = new Date(),
) {
  const policy = defaultPolicy(policyInput);
  const warnings = [];
  const blockers = [];
  const lifecycleStatus = string(row.lifecycle_status || row.lifecycleStatus);
  const approvalStatus = string(row.approval_status || row.approvalStatus);
  const acceptanceStatus = string(
    row.acceptance_status || row.acceptanceStatus,
  );
  const grandTotal = number(row.grand_total ?? row.grandTotal);
  const lineCount = number(row.line_count ?? row.lineCount);
  const marginPercent = number(row.margin_percent ?? row.marginPercent);
  const minimumMargin = number(
    row.minimum_margin_percent ?? row.minimumMarginPercent,
  );
  const maximumDiscount = number(
    row.maximum_discount_percent ?? row.maximumDiscountPercent,
  );
  const approvalDiscount = number(
    row.quotation_approval_discount ?? row.quotationApprovalDiscount ?? 100,
  );
  const validUntil = row.valid_until || row.validUntil;
  const validForDays = dateDistanceInDays(validUntil, now);
  const updatedAt = new Date(
    row.quotation_updated_at ||
      row.updated_at ||
      row.updatedAt ||
      row.created_at ||
      now,
  );
  const ageMs = Number.isNaN(updatedAt.getTime())
    ? 0
    : Math.max(0, now.getTime() - updatedAt.getTime());
  const inactiveDays = Math.floor(ageMs / DAY_MS);

  if (lineCount < 1) blockers.push("Quotation requires at least one line.");
  if (grandTotal <= 0)
    blockers.push("Quotation total must be greater than zero.");
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
    policy.requireBillingAddress &&
    !row.billing_address_id &&
    !hasKeys(row.billing_address_snapshot ?? row.billingAddressSnapshot)
  )
    blockers.push("Billing address is required.");
  if (
    policy.requireContact &&
    !row.contact_id &&
    !hasKeys(row.contact_snapshot ?? row.contactSnapshot)
  )
    blockers.push("Customer contact is required.");

  if (validForDays === null) blockers.push("Quotation validity is missing.");
  else if (
    validForDays < 0 &&
    !["expired", "rejected", "converted", "cancelled", "withdrawn"].includes(
      lifecycleStatus,
    )
  )
    blockers.push("Quotation validity has expired.");
  else if (
    validForDays <= policy.expiryWarningDays &&
    !["accepted", "converted", "cancelled", "withdrawn"].includes(
      lifecycleStatus,
    )
  )
    warnings.push(`Quotation expires in ${Math.max(0, validForDays)} day(s).`);

  if (
    lifecycleStatus === "pending_approval" &&
    ageMs > policy.approvalSlaHours * HOUR_MS
  )
    warnings.push("Commercial approval is outside its SLA.");
  if (
    ["sent", "viewed"].includes(lifecycleStatus) &&
    ageMs > policy.sentFollowUpDays * DAY_MS
  )
    warnings.push("Customer follow-up is overdue.");
  if (
    ["draft", "approved", "sent", "viewed"].includes(lifecycleStatus) &&
    inactiveDays > policy.staleAfterDays
  )
    warnings.push("Quotation has had no recent progress.");
  if (marginPercent < minimumMargin)
    warnings.push("Margin is below the configured minimum.");
  if (maximumDiscount > approvalDiscount)
    warnings.push("Discount exceeds the approval threshold.");
  if (
    lifecycleStatus === "approved" &&
    !["approved", "not_required"].includes(approvalStatus)
  )
    blockers.push("Quotation approval state is inconsistent.");
  if (
    lifecycleStatus === "converted" &&
    !string(row.converted_order_id || row.convertedOrderId)
  )
    blockers.push("Converted quotation is missing its sales order.");
  if (lifecycleStatus === "accepted" && acceptanceStatus !== "accepted")
    warnings.push("Customer acceptance status is inconsistent.");

  const readiness =
    blockers.length > 0
      ? "blocked"
      : warnings.length > 0
        ? "attention"
        : "ready";

  return {
    healthy: readiness === "ready",
    readiness,
    blockers,
    warnings,
    validForDays,
    inactiveDays,
    grandTotal,
    marginPercent,
    maximumDiscount,
    readyToSubmit: lifecycleStatus === "draft" && blockers.length === 0,
    readyToSend:
      lifecycleStatus === "approved" &&
      blockers.length === 0 &&
      ["approved", "not_required"].includes(approvalStatus),
    readyToConvert:
      lifecycleStatus === "accepted" &&
      blockers.length === 0 &&
      acceptanceStatus === "accepted",
  };
}

export function buildQuotationGovernanceSummary(
  rows,
  policyInput = {},
  now = new Date(),
) {
  const summary = {
    total: rows.length,
    active: 0,
    activeValue: 0,
    pendingApproval: 0,
    expiring: 0,
    expired: 0,
    accepted: 0,
    converted: 0,
    healthy: 0,
    attention: 0,
    blocked: 0,
    byStatus: {},
  };

  for (const row of rows) {
    const status =
      string(row.lifecycle_status || row.lifecycleStatus) || "draft";
    const health = evaluateQuotationHealth(row, policyInput, now);
    summary.byStatus[status] = (summary.byStatus[status] || 0) + 1;
    if (
      ["draft", "pending_approval", "approved", "sent", "viewed"].includes(
        status,
      )
    ) {
      summary.active += 1;
      summary.activeValue += number(
        row.base_currency_total ??
          row.baseCurrencyTotal ??
          row.grand_total ??
          row.grandTotal,
      );
    }
    if (status === "pending_approval") summary.pendingApproval += 1;
    if (
      health.validForDays !== null &&
      health.validForDays >= 0 &&
      health.validForDays <= defaultPolicy(policyInput).expiryWarningDays
    )
      summary.expiring += 1;
    if (status === "expired" || (health.validForDays ?? 0) < 0)
      summary.expired += 1;
    if (status === "accepted") summary.accepted += 1;
    if (status === "converted") summary.converted += 1;
    if (health.readiness === "ready") summary.healthy += 1;
    else summary[health.readiness] += 1;
  }

  summary.activeValue = Math.round(summary.activeValue * 100) / 100;
  return summary;
}

async function loadPolicy(client, organizationId) {
  const result = await client.query(
    `SELECT approval_sla_hours,sent_follow_up_days,expiry_warning_days,
            stale_after_days,require_payment_terms,require_billing_address,
            require_contact
       FROM tenant.sales_quotation_governance_policies
      WHERE organization_id=$1`,
    [organizationId],
  );
  return defaultPolicy(result.rows[0] || {});
}

function companyScope(context, values, alias = "quotation") {
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

async function loadQuotationForAssessment(client, context, quotationId) {
  const values = [context.organizationId, uuid(quotationId, "Quotation")];
  const scope = companyScope(context, values);
  const result = await client.query(
    `SELECT quotation.id AS quotation_id,quotation.company_id,
            quotation.quotation_number,quotation.lifecycle_status,
            quotation.approval_status,quotation.acceptance_status,
            quotation.valid_until,quotation.contact_id,
            quotation.converted_order_id,
            quotation.created_at,quotation.updated_at AS quotation_updated_at,
            version.id AS quotation_version_id,version.version_number,
            version.grand_total,version.base_currency_total,version.margin_percent,
            version.maximum_discount_percent,version.payment_term_id,
            version.billing_address_id,version.customer_snapshot,
            version.contact_snapshot,version.payment_term_snapshot,
            version.billing_address_snapshot,
            settings.minimum_margin_percent,
            settings.quotation_approval_discount,
            (SELECT count(*)::int
               FROM tenant.sales_quotation_lines line
              WHERE line.organization_id=quotation.organization_id
                AND line.quotation_version_id=version.id) AS line_count
       FROM tenant.sales_quotations quotation
       JOIN tenant.sales_quotation_versions version
         ON version.organization_id=quotation.organization_id
        AND version.id=quotation.current_version_id
       LEFT JOIN tenant.sales_settings settings
         ON settings.organization_id=quotation.organization_id
      WHERE quotation.organization_id=$1 AND quotation.id=$2${scope}`,
    values,
  );
  if (!result.rows[0]) {
    throw new QuotationGovernanceError(
      404,
      "Quotation not found.",
      "SALES_QUOTATION_NOT_FOUND",
    );
  }
  return result.rows[0];
}

export async function getQuotationGovernanceDashboard(client, context) {
  requirePermission(context, "sales.view");
  const policy = await loadPolicy(client, context.organizationId);
  const values = [context.organizationId];
  const scope = companyScope(context, values);
  const result = await client.query(
    `SELECT quotation.id,quotation.quotation_number,
            quotation.lifecycle_status,quotation.approval_status,
            quotation.acceptance_status,quotation.valid_until,
            quotation.converted_order_id,
            quotation.updated_at AS quotation_updated_at,
            version.grand_total,version.base_currency_total,version.margin_percent,
            version.maximum_discount_percent,version.payment_term_id,
            version.billing_address_id,version.customer_snapshot,
            version.contact_snapshot,version.payment_term_snapshot,
            version.billing_address_snapshot,
            settings.minimum_margin_percent,
            settings.quotation_approval_discount,
            (SELECT count(*)::int
               FROM tenant.sales_quotation_lines line
              WHERE line.organization_id=quotation.organization_id
                AND line.quotation_version_id=version.id) AS line_count
       FROM tenant.sales_quotations quotation
       JOIN tenant.sales_quotation_versions version
         ON version.organization_id=quotation.organization_id
        AND version.id=quotation.current_version_id
       LEFT JOIN tenant.sales_settings settings
         ON settings.organization_id=quotation.organization_id
      WHERE quotation.organization_id=$1
        AND quotation.lifecycle_status <> 'cancelled'${scope}
      ORDER BY quotation.updated_at DESC
      LIMIT 500`,
    values,
  );
  const evaluated = result.rows.map((row) => ({
    ...row,
    health: redactHealth(evaluateQuotationHealth(row, policy), context),
  }));
  return {
    policy,
    summary: buildQuotationGovernanceSummary(result.rows, policy),
    attention: evaluated
      .filter((row) => row.health.readiness !== "ready")
      .slice(0, 25),
  };
}

export async function assessQuotationReadiness(client, context, quotationId) {
  requirePermission(context, "sales.view");
  const [row, policy] = await Promise.all([
    loadQuotationForAssessment(client, context, quotationId),
    loadPolicy(client, context.organizationId),
  ]);
  return {
    quotationId: row.quotation_id,
    quotationNumber: row.quotation_number,
    versionId: row.quotation_version_id,
    versionNumber: row.version_number,
    lifecycleStatus: row.lifecycle_status,
    policy,
    health: redactHealth(evaluateQuotationHealth(row, policy), context),
  };
}

export async function captureQuotationGovernanceSnapshot(
  client,
  context,
  quotationId,
  capturedFor = "manual",
) {
  const row = await loadQuotationForAssessment(client, context, quotationId);
  const policy = await loadPolicy(client, context.organizationId);
  const health = evaluateQuotationHealth(row, policy);
  const result = await client.query(
    `INSERT INTO tenant.sales_quotation_governance_snapshots (
       organization_id,quotation_id,quotation_version_id,lifecycle_status,
       approval_status,acceptance_status,readiness_status,blockers,warnings,
       metrics,captured_for,captured_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11,$12)
     RETURNING id,quotation_id,quotation_version_id,readiness_status,
               captured_for,captured_at`,
    [
      context.organizationId,
      row.quotation_id,
      row.quotation_version_id,
      row.lifecycle_status,
      row.approval_status,
      row.acceptance_status,
      health.readiness,
      JSON.stringify(health.blockers),
      JSON.stringify(health.warnings),
      JSON.stringify({
        validForDays: health.validForDays,
        inactiveDays: health.inactiveDays,
        grandTotal: health.grandTotal,
        marginPercent: health.marginPercent,
        maximumDiscount: health.maximumDiscount,
      }),
      string(capturedFor).slice(0, 40) || "manual",
      context.userId,
    ],
  );
  return result.rows[0];
}

export async function getQuotationGovernanceTimeline(
  client,
  context,
  quotationId,
) {
  requirePermission(context, "sales.view");
  const id = uuid(quotationId, "Quotation");
  await loadQuotationForAssessment(client, context, id);
  const [versions, events, decisions, approvals, snapshots] = await Promise.all(
    [
      client.query(
        `SELECT id,version_number,revision_reason,grand_total,currency_code,
                margin_percent,maximum_discount_percent,content_hash,
                created_at,created_by
           FROM tenant.sales_quotation_versions
          WHERE organization_id=$1 AND quotation_id=$2
          ORDER BY version_number DESC`,
        [context.organizationId, id],
      ),
      client.query(
        `SELECT id,event_type,from_status,to_status,metadata,actor_user_id,
                occurred_at
           FROM tenant.sales_document_events
          WHERE organization_id=$1 AND entity_type='quotation' AND entity_id=$2
          ORDER BY occurred_at DESC LIMIT 200`,
        [context.organizationId, id],
      ),
      client.query(
        `SELECT id,quotation_version_id,decision,customer_name,customer_email,
                note,decided_at
           FROM tenant.sales_quote_decisions
          WHERE organization_id=$1 AND quotation_id=$2
          ORDER BY decided_at DESC LIMIT 100`,
        [context.organizationId, id],
      ),
      client.query(
        `SELECT id,status,requested_at,decided_at,decision_note,assigned_to
           FROM public.approval_requests
          WHERE organization_id=$1 AND entity_type='sales_quotation'
            AND entity_id=$2
          ORDER BY requested_at DESC LIMIT 100`,
        [context.organizationId, id],
      ),
      client.query(
        `SELECT id,quotation_version_id,lifecycle_status,approval_status,
                acceptance_status,readiness_status,blockers,warnings,metrics,
                captured_for,captured_by,captured_at
           FROM tenant.sales_quotation_governance_snapshots
          WHERE organization_id=$1 AND quotation_id=$2
          ORDER BY captured_at DESC LIMIT 200`,
        [context.organizationId, id],
      ),
    ],
  );
  return {
    quotationId: id,
    versions: versions.rows,
    events: events.rows,
    decisions: decisions.rows,
    approvals: approvals.rows,
    snapshots: snapshots.rows.map((row) =>
      canViewMargin(context)
        ? row
        : {
            ...row,
            metrics: {
              ...object(row.metrics),
              marginPercent: undefined,
            },
          },
    ),
  };
}

export async function compareQuotationVersions(
  client,
  context,
  quotationId,
  leftVersionId,
  rightVersionId,
) {
  requirePermission(context, "sales.view");
  const id = uuid(quotationId, "Quotation");
  const left = uuid(leftVersionId, "Left quotation version");
  const right = uuid(rightVersionId, "Right quotation version");
  if (left === right) {
    throw new QuotationGovernanceError(
      400,
      "Select two different quotation versions.",
      "SALES_QUOTATION_VERSION_COMPARISON_IDENTICAL",
    );
  }
  await loadQuotationForAssessment(client, context, id);
  const versions = await client.query(
    `SELECT id,version_number,revision_reason,currency_code,exchange_rate,
            payment_term_id,billing_address_id,shipping_address_id,
            subtotal,discount_total,charge_total,tax_total,
            rounding_adjustment,grand_total,base_currency_total,
            margin_amount,margin_percent,maximum_discount_percent,
            customer_snapshot,contact_snapshot,payment_term_snapshot,
            billing_address_snapshot,shipping_address_snapshot,content_hash
       FROM tenant.sales_quotation_versions
      WHERE organization_id=$1 AND quotation_id=$2 AND id=ANY($3::uuid[])`,
    [context.organizationId, id, [left, right]],
  );
  if (versions.rows.length !== 2) {
    throw new QuotationGovernanceError(
      404,
      "One or both quotation versions were not found.",
      "SALES_QUOTATION_VERSION_NOT_FOUND",
    );
  }
  const lineResult = await client.query(
    `SELECT quotation_version_id,sequence,item_id,item_code_snapshot,
            item_name_snapshot,quantity,unit_price,discount_percent,
            discount_amount,tax_amount,line_total
       FROM tenant.sales_quotation_lines
      WHERE organization_id=$1 AND quotation_version_id=ANY($2::uuid[])
      ORDER BY quotation_version_id,sequence`,
    [context.organizationId, [left, right]],
  );
  const byId = new Map(versions.rows.map((row) => [row.id, row]));
  const fields = [
    "currency_code",
    "exchange_rate",
    "payment_term_id",
    "billing_address_id",
    "shipping_address_id",
    "subtotal",
    "discount_total",
    "charge_total",
    "tax_total",
    "rounding_adjustment",
    "grand_total",
    "base_currency_total",
    "margin_amount",
    "margin_percent",
    "maximum_discount_percent",
    "customer_snapshot",
    "contact_snapshot",
    "payment_term_snapshot",
    "billing_address_snapshot",
    "shipping_address_snapshot",
    "content_hash",
  ];
  const leftRow = byId.get(left);
  const rightRow = byId.get(right);
  const changedFields = fields.filter(
    (field) =>
      JSON.stringify(leftRow[field] ?? null) !==
      JSON.stringify(rightRow[field] ?? null),
  );
  const lineGroups = { left: [], right: [] };
  for (const row of lineResult.rows) {
    lineGroups[row.quotation_version_id === left ? "left" : "right"].push(row);
  }
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
    delete leftRow.margin_amount;
    delete leftRow.margin_percent;
    delete rightRow.margin_amount;
    delete rightRow.margin_percent;
    delete totals.marginPercent;
  }
  return {
    quotationId: id,
    left: leftRow,
    right: rightRow,
    changedFields: canViewMargin(context)
      ? changedFields
      : changedFields.filter(
          (field) => !["margin_amount", "margin_percent"].includes(field),
        ),
    totals,
    lines: lineGroups,
  };
}

export async function bulkUpdateQuotations(client, context, input = {}) {
  requirePermission(context, "sales.quotation.create");
  const ids = Array.isArray(input.ids)
    ? [...new Set(input.ids.map((value) => uuid(value, "Quotation")))]
    : [];
  if (!ids.length || ids.length > 200) {
    throw new QuotationGovernanceError(
      400,
      "Select between 1 and 200 quotations.",
      "SALES_QUOTATION_BULK_SELECTION_INVALID",
    );
  }
  const changes = object(input.changes);
  const sets = [];
  const values = [context.organizationId, ids];
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
      throw new QuotationGovernanceError(
        409,
        "The selected owner is not an active organisation member.",
        "SALES_QUOTATION_OWNER_INVALID",
      );
    }
    values.push(ownerUserId);
    sets.push(`owner_user_id=$${values.length}`);
  }
  if (Object.prototype.hasOwnProperty.call(changes, "validUntil")) {
    const validUntil = dateOnly(changes.validUntil);
    if (!validUntil) {
      throw new QuotationGovernanceError(
        400,
        "Valid until must be a date.",
        "SALES_QUOTATION_VALIDITY_INVALID",
      );
    }
    values.push(validUntil);
    sets.push(`valid_until=$${values.length}`);
  }
  if (!sets.length) {
    throw new QuotationGovernanceError(
      400,
      "No supported quotation changes were supplied.",
      "SALES_QUOTATION_BULK_CHANGES_EMPTY",
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
    `UPDATE tenant.sales_quotations
        SET ${sets.join(",")}
      WHERE organization_id=$1
        AND id=ANY($2::uuid[])
        AND lifecycle_status='draft'${scope}
      RETURNING id,quotation_number,owner_user_id,valid_until,updated_at`,
    values,
  );
  return {
    requested: ids.length,
    updated: result.rowCount ?? result.rows.length,
    skipped: ids.length - (result.rowCount ?? result.rows.length),
    rows: result.rows,
  };
}

export async function listQuotationSavedViews(client, context) {
  requirePermission(context, "sales.view");
  const result = await client.query(
    `SELECT id,name,filters,columns,sort,is_shared,owner_user_id,
            created_at,updated_at
       FROM tenant.sales_quotation_saved_views
      WHERE organization_id=$1
        AND (owner_user_id=$2 OR is_shared=true)
      ORDER BY is_shared DESC,name`,
    [context.organizationId, context.userId],
  );
  return result.rows;
}

export async function saveQuotationView(client, context, input = {}) {
  requirePermission(context, "sales.view");
  if (!context.userId) {
    throw new QuotationGovernanceError(
      401,
      "A signed-in user is required.",
      "SALES_QUOTATION_USER_REQUIRED",
    );
  }
  const name = string(input.name).slice(0, 120);
  if (!name) {
    throw new QuotationGovernanceError(
      400,
      "Saved view name is required.",
      "SALES_QUOTATION_VIEW_NAME_REQUIRED",
    );
  }
  const isShared = input.isShared === true;
  if (isShared && !hasPermission(context, "sales.settings.manage")) {
    throw new QuotationGovernanceError(
      403,
      "Sales settings permission is required to share a view.",
      "SALES_QUOTATION_VIEW_SHARE_DENIED",
    );
  }
  const result = await client.query(
    `INSERT INTO tenant.sales_quotation_saved_views (
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

export async function deleteQuotationSavedView(client, context, savedViewId) {
  requirePermission(context, "sales.view");
  const id = uuid(savedViewId, "Saved view");
  const values = [context.organizationId, id, context.userId];
  const canManage = hasPermission(context, "sales.settings.manage");
  const result = await client.query(
    `DELETE FROM tenant.sales_quotation_saved_views
      WHERE organization_id=$1 AND id=$2
        AND (owner_user_id=$3 OR $4::boolean)
      RETURNING id`,
    [...values, canManage],
  );
  if (!result.rows[0]) {
    throw new QuotationGovernanceError(
      404,
      "Saved quotation view not found.",
      "SALES_QUOTATION_VIEW_NOT_FOUND",
    );
  }
  return { id: result.rows[0].id, deleted: true };
}
