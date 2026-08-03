import {
  ACCOUNTING_PERMISSIONS,
  AccountingError,
  asDatabaseDecimal,
  decimal,
  event,
  hasPermission,
  hashPayload,
  requirePermission,
  text,
  uuid,
} from "./core.js";
import { getAccountingReport } from "./reports.js";

export class TaxReportingGovernanceError extends AccountingError {
  constructor(status, message, code = "TAX_REPORTING_GOVERNANCE_ERROR") {
    super(status, message, code);
    this.name = "TaxReportingGovernanceError";
  }
}

const DAY_MS = 86_400_000;
const CASE_STATUSES = new Set([
  "open",
  "under_review",
  "waiting_documents",
  "provider_query",
  "resolved",
  "closed",
]);
const CASE_PRIORITIES = new Set(["low", "normal", "high", "urgent"]);
const CASE_REASONS = new Set([
  "missing_registration",
  "ledger_mismatch",
  "ineligible_itc",
  "missing_hsn_sac",
  "place_of_supply",
  "reverse_charge",
  "filing_reference",
  "compliance_failure",
  "subledger_mismatch",
  "other",
]);
const REPORT_TYPES = new Set([
  "trial-balance",
  "profit-and-loss",
  "balance-sheet",
  "cash-flow",
  "tax-summary",
  "subledger-reconciliation",
  "close-pack",
]);

const string = (value) => String(value ?? "").trim();
const number = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const object = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};
const absoluteDecimal = (value) => {
  const parsed = decimal(value || 0);
  return parsed < 0n ? -parsed : parsed;
};
const dateTime = (value, label) => {
  if (value === undefined || value === null || value === "") return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new TaxReportingGovernanceError(400, `${label} is invalid.`);
  }
  return parsed.toISOString();
};

function requireAnyPermission(context, permissions) {
  if (!permissions.some((permission) => hasPermission(context, permission))) {
    throw new TaxReportingGovernanceError(
      403,
      "You do not have permission to manage tax and reporting governance.",
      "TAX_REPORTING_GOVERNANCE_PERMISSION_DENIED",
    );
  }
}

function defaultPolicy(policy = {}) {
  return {
    filingWarningDays: Math.max(
      0,
      number(policy.filing_warning_days ?? policy.filingWarningDays ?? 7),
    ),
    exceptionEscalationDays: Math.max(
      1,
      number(
        policy.exception_escalation_days ?? policy.exceptionEscalationDays ?? 3,
      ),
    ),
    reportingTolerance:
      policy.reporting_tolerance ?? policy.reportingTolerance ?? "0.01",
    requireTaxRegistration:
      policy.require_tax_registration ?? policy.requireTaxRegistration ?? true,
    requireExternalReference:
      policy.require_external_reference ??
      policy.requireExternalReference ??
      true,
    blockOpenExceptions:
      policy.block_open_exceptions ?? policy.blockOpenExceptions ?? true,
    blockFailedCompliance:
      policy.block_failed_compliance ?? policy.blockFailedCompliance ?? true,
    requireSubledgerReconciliation:
      policy.require_subledger_reconciliation ??
      policy.requireSubledgerReconciliation ??
      true,
  };
}

function daysFrom(dateValue, now) {
  if (!dateValue) return null;
  const parsed = new Date(`${String(dateValue).slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  const today = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  return Math.ceil((parsed.getTime() - today.getTime()) / DAY_MS);
}

function companyScope(context, values, alias) {
  if (!context.allowAllCompanies && context.activeCompanyId) {
    values.push(context.activeCompanyId);
    return ` AND ${alias}.company_id=$${values.length}`;
  }
  return "";
}

export function evaluateTaxReturnHealth(
  row,
  policyInput = {},
  now = new Date(),
) {
  const policy = defaultPolicy(policyInput);
  const blockers = [];
  const warnings = [];
  const status = string(row.status);
  const returnType = string(row.return_type || row.returnType).toUpperCase();
  const lineCount = number(row.line_count ?? row.lineCount);
  const openExceptionCount = number(
    row.open_exception_count ?? row.openExceptionCount,
  );
  const failedComplianceCount = number(
    row.failed_compliance_count ?? row.failedComplianceCount,
  );
  const pendingComplianceCount = number(
    row.pending_compliance_count ?? row.pendingComplianceCount,
  );
  const reportedComponentTotal =
    absoluteDecimal(row.output_tax ?? row.outputTax) +
    absoluteDecimal(row.input_tax_credit ?? row.inputTaxCredit) +
    absoluteDecimal(row.withholding_tax ?? row.withholdingTax);
  const ledgerComponentTotal = absoluteDecimal(
    row.return_line_total ?? row.returnLineTotal,
  );
  const discrepancy =
    reportedComponentTotal >= ledgerComponentTotal
      ? reportedComponentTotal - ledgerComponentTotal
      : ledgerComponentTotal - reportedComponentTotal;
  const tolerance = absoluteDecimal(policy.reportingTolerance);
  const dueInDays = daysFrom(row.filing_due_date || row.filingDueDate, now);
  const exceptionUpdated = new Date(
    row.exception_updated_at || row.exceptionUpdatedAt || now,
  );
  const exceptionAgeDays = Number.isNaN(exceptionUpdated.getTime())
    ? 0
    : Math.max(
        0,
        Math.floor((now.getTime() - exceptionUpdated.getTime()) / DAY_MS),
      );

  if (!row.period_start && !row.periodStart) {
    blockers.push("Tax-return period start is missing.");
  }
  if (!row.period_end && !row.periodEnd) {
    blockers.push("Tax-return period end is missing.");
  }
  if (
    row.period_start &&
    row.period_end &&
    String(row.period_start).slice(0, 10) > String(row.period_end).slice(0, 10)
  ) {
    blockers.push("Tax-return period is invalid.");
  }
  if (status !== "cancelled" && lineCount < 1) {
    blockers.push("Tax return has no source-ledger lines.");
  }
  if (
    policy.requireTaxRegistration &&
    returnType.includes("GST") &&
    ["review", "filed", "paid", "amended"].includes(status) &&
    !string(row.tax_registration || row.taxRegistration)
  ) {
    blockers.push("GST registration is required before filing.");
  }
  if (
    policy.requireExternalReference &&
    ["filed", "paid", "amended"].includes(status) &&
    !string(row.external_reference || row.externalReference)
  ) {
    blockers.push("Filed tax return requires an external filing reference.");
  }
  if (["filed", "paid"].includes(status) && !row.filed_at && !row.filedAt) {
    blockers.push("Filed tax return is missing filing evidence.");
  }
  if (discrepancy > tolerance) {
    blockers.push(
      "Tax-return totals do not reconcile to included ledger lines.",
    );
  }
  if (policy.blockOpenExceptions && openExceptionCount > 0) {
    blockers.push("Open tax exceptions must be resolved before filing.");
  }
  if (policy.blockFailedCompliance && failedComplianceCount > 0) {
    blockers.push("Failed statutory requests must be resolved before filing.");
  }

  if (
    dueInDays !== null &&
    dueInDays < 0 &&
    !["filed", "paid"].includes(status)
  ) {
    warnings.push("Tax return is overdue for filing.");
  } else if (
    dueInDays !== null &&
    dueInDays <= policy.filingWarningDays &&
    !["filed", "paid", "cancelled"].includes(status)
  ) {
    warnings.push("Tax return is approaching its filing due date.");
  }
  if (pendingComplianceCount > 0) {
    warnings.push(
      `${pendingComplianceCount} statutory request(s) are still pending.`,
    );
  }
  if (
    openExceptionCount > 0 &&
    exceptionAgeDays >= policy.exceptionEscalationDays
  ) {
    warnings.push("Tax exception case requires escalation.");
  }
  if (status === "amended") {
    warnings.push("Amended return requires preserved amendment evidence.");
  }

  const readiness = blockers.length
    ? "blocked"
    : warnings.length
      ? "attention"
      : "ready";
  const riskBand =
    blockers.length || (dueInDays !== null && dueInDays < 0)
      ? "high"
      : warnings.length
        ? "medium"
        : "low";

  return {
    readiness,
    riskBand,
    blockers,
    warnings,
    reviewEligible: !blockers.length && ["draft", "review"].includes(status),
    filingEligible: !blockers.length && status === "review",
    metrics: {
      lineCount,
      openExceptionCount,
      failedComplianceCount,
      pendingComplianceCount,
      dueInDays: dueInDays ?? 0,
      exceptionAgeDays,
      discrepancy: Number(asDatabaseDecimal(discrepancy)),
    },
  };
}

export function buildTaxGovernanceSummary(
  rows,
  policyInput = {},
  now = new Date(),
) {
  const summary = {
    totalReturns: rows.length,
    ready: 0,
    attention: 0,
    blocked: 0,
    overdue: 0,
    highRisk: 0,
    openExceptions: 0,
    failedCompliance: 0,
    netTaxPayable: 0,
  };
  for (const row of rows) {
    const health = evaluateTaxReturnHealth(
      row,
      Object.keys(policyInput).length ? policyInput : row,
      now,
    );
    summary[health.readiness] += 1;
    if (health.riskBand === "high") summary.highRisk += 1;
    if (
      health.metrics.dueInDays < 0 &&
      !["filed", "paid"].includes(row.status)
    ) {
      summary.overdue += 1;
    }
    summary.openExceptions += health.metrics.openExceptionCount;
    summary.failedCompliance += health.metrics.failedComplianceCount;
    summary.netTaxPayable += number(row.net_tax_payable ?? row.netTaxPayable);
  }
  return summary;
}

async function getPolicy(client, context, companyIdValue) {
  const companyId = uuid(companyIdValue || context.activeCompanyId, "Company");
  if (
    !context.allowAllCompanies &&
    context.activeCompanyId &&
    context.activeCompanyId !== companyId
  ) {
    throw new TaxReportingGovernanceError(403, "Switch to this company first.");
  }
  const company = (
    await client.query(
      `SELECT id FROM public.companies
        WHERE organization_id=$1 AND id=$2`,
      [context.organizationId, companyId],
    )
  ).rows[0];
  if (!company) {
    throw new TaxReportingGovernanceError(404, "Company was not found.");
  }
  const result = await client.query(
    `INSERT INTO tenant.accounting_tax_reporting_policies (
       organization_id,company_id,created_by,updated_by
     ) VALUES ($1,$2,$3,$3)
     ON CONFLICT (organization_id,company_id)
     DO UPDATE SET updated_at=tenant.accounting_tax_reporting_policies.updated_at
     RETURNING *`,
    [context.organizationId, companyId, context.userId],
  );
  return result.rows[0];
}

async function loadTaxReturnRows(client, context, taxReturnId = null) {
  const values = [context.organizationId];
  let where = companyScope(context, values, "tax_return");
  if (taxReturnId) {
    values.push(uuid(taxReturnId, "Tax return"));
    where += ` AND tax_return.id=$${values.length}`;
  }
  const result = await client.query(
    `SELECT tax_return.*,company.name AS company_name,
            COALESCE(return_lines.line_count,0)::int AS line_count,
            COALESCE(return_lines.return_line_total,0) AS return_line_total,
            COALESCE(exception_case.open_exception_count,0)::int AS open_exception_count,
            exception_case.status AS exception_case_status,
            exception_case.priority AS exception_case_priority,
            exception_case.owner_user_id AS exception_owner_user_id,
            exception_case.updated_at AS exception_updated_at,
            COALESCE(compliance.pending_compliance_count,0)::int AS pending_compliance_count,
            COALESCE(compliance.failed_compliance_count,0)::int AS failed_compliance_count,
            policy.filing_warning_days,policy.exception_escalation_days,
            policy.reporting_tolerance,policy.require_tax_registration,
            policy.require_external_reference,policy.block_open_exceptions,
            policy.block_failed_compliance,
            policy.require_subledger_reconciliation
       FROM tenant.accounting_tax_returns tax_return
       JOIN public.companies company
         ON company.organization_id=tax_return.organization_id
        AND company.id=tax_return.company_id
       LEFT JOIN tenant.accounting_tax_reporting_policies policy
         ON policy.organization_id=tax_return.organization_id
        AND policy.company_id=tax_return.company_id
       LEFT JOIN LATERAL (
         SELECT count(*)::int AS line_count,
                COALESCE(sum(abs(line.included_amount)),0) AS return_line_total
           FROM tenant.accounting_tax_return_lines line
          WHERE line.organization_id=tax_return.organization_id
            AND line.tax_return_id=tax_return.id
       ) return_lines ON true
       LEFT JOIN LATERAL (
         SELECT count(*) FILTER (
                  WHERE candidate.status NOT IN ('resolved','closed')
                )::int AS open_exception_count,
                max(candidate.status) AS status,
                max(candidate.priority) AS priority,
                max(candidate.owner_user_id::text)::uuid AS owner_user_id,
                max(candidate.updated_at) AS updated_at
           FROM tenant.accounting_tax_exception_cases candidate
          WHERE candidate.organization_id=tax_return.organization_id
            AND candidate.tax_return_id=tax_return.id
       ) exception_case ON true
       LEFT JOIN LATERAL (
         SELECT count(*) FILTER (
                  WHERE request.status IN ('pending','processing')
                )::int AS pending_compliance_count,
                count(*) FILTER (WHERE request.status='failed')::int
                  AS failed_compliance_count
           FROM tenant.accounting_compliance_requests request
          WHERE request.organization_id=tax_return.organization_id
            AND request.source_type='tax_return'
            AND request.source_id=tax_return.id
       ) compliance ON true
      WHERE tax_return.organization_id=$1${where}
      ORDER BY tax_return.period_end DESC,tax_return.return_type`,
    values,
  );
  return result.rows;
}

export async function getTaxReportingGovernanceDashboard(client, context) {
  requireAnyPermission(context, [
    ACCOUNTING_PERMISSIONS.view,
    ACCOUNTING_PERMISSIONS.taxManage,
    ACCOUNTING_PERMISSIONS.reportsView,
  ]);
  const rows = await loadTaxReturnRows(client, context);
  const assessed = rows.map((row) => ({
    ...row,
    health: evaluateTaxReturnHealth(row, row),
  }));

  const exceptionValues = [context.organizationId];
  const exceptionScope = companyScope(
    context,
    exceptionValues,
    "exception_case",
  );
  const exceptions = await client.query(
    `SELECT exception_case.*,tax_return.return_type,
            tax_return.period_start,tax_return.period_end,
            company.name AS company_name
       FROM tenant.accounting_tax_exception_cases exception_case
       JOIN tenant.accounting_tax_returns tax_return
         ON tax_return.organization_id=exception_case.organization_id
        AND tax_return.id=exception_case.tax_return_id
       JOIN public.companies company
         ON company.organization_id=exception_case.organization_id
        AND company.id=exception_case.company_id
      WHERE exception_case.organization_id=$1${exceptionScope}
        AND exception_case.status NOT IN ('resolved','closed')
      ORDER BY
        CASE exception_case.priority
          WHEN 'urgent' THEN 1 WHEN 'high' THEN 2
          WHEN 'normal' THEN 3 ELSE 4 END,
        exception_case.next_action_at NULLS LAST,
        exception_case.updated_at
      LIMIT 100`,
    exceptionValues,
  );

  const complianceValues = [context.organizationId];
  const complianceScope = companyScope(context, complianceValues, "request");
  const compliance = await client.query(
    `SELECT request.*,company.name AS company_name
       FROM tenant.accounting_compliance_requests request
       JOIN public.companies company
         ON company.organization_id=request.organization_id
        AND company.id=request.company_id
      WHERE request.organization_id=$1${complianceScope}
        AND request.status IN ('pending','processing','failed')
      ORDER BY CASE request.status WHEN 'failed' THEN 1 ELSE 2 END,
               request.next_retry_at NULLS LAST,request.requested_at
      LIMIT 100`,
    complianceValues,
  );

  const snapshotValues = [context.organizationId];
  const snapshotScope = companyScope(context, snapshotValues, "snapshot");
  const snapshots = await client.query(
    `SELECT snapshot.*,company.name AS company_name,period.name AS period_name
       FROM tenant.accounting_financial_reporting_snapshots snapshot
       JOIN public.companies company
         ON company.organization_id=snapshot.organization_id
        AND company.id=snapshot.company_id
       LEFT JOIN tenant.fiscal_periods period
         ON period.organization_id=snapshot.organization_id
        AND period.id=snapshot.fiscal_period_id
      WHERE snapshot.organization_id=$1${snapshotScope}
      ORDER BY snapshot.captured_at DESC
      LIMIT 50`,
    snapshotValues,
  );

  return {
    summary: buildTaxGovernanceSummary(rows),
    returns: assessed,
    exceptionCases: exceptions.rows,
    complianceRequests: compliance.rows,
    reportingSnapshots: snapshots.rows,
  };
}

export async function assessTaxReturnReadiness(client, context, taxReturnId) {
  requireAnyPermission(context, [
    ACCOUNTING_PERMISSIONS.view,
    ACCOUNTING_PERMISSIONS.taxManage,
    ACCOUNTING_PERMISSIONS.reportsView,
  ]);
  const rows = await loadTaxReturnRows(client, context, taxReturnId);
  const taxReturn = rows[0];
  if (!taxReturn) {
    throw new TaxReportingGovernanceError(404, "Tax return was not found.");
  }
  const policy = await getPolicy(client, context, taxReturn.company_id);
  return {
    taxReturn,
    policy,
    health: evaluateTaxReturnHealth(taxReturn, policy),
  };
}

export async function captureTaxGovernanceSnapshot(
  client,
  context,
  taxReturnId,
  capturedFor = "manual",
) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.taxManage);
  const assessment = await assessTaxReturnReadiness(
    client,
    context,
    taxReturnId,
  );
  const { taxReturn, health } = assessment;
  const result = await client.query(
    `INSERT INTO tenant.accounting_tax_governance_snapshots (
       organization_id,company_id,tax_return_id,return_status,
       readiness_status,risk_band,blockers,warnings,metrics,
       captured_for,captured_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10,$11)
     RETURNING *`,
    [
      context.organizationId,
      taxReturn.company_id,
      taxReturn.id,
      taxReturn.status,
      health.readiness,
      health.riskBand,
      JSON.stringify(health.blockers),
      JSON.stringify(health.warnings),
      JSON.stringify(health.metrics),
      text(capturedFor, 80) || "manual",
      context.userId,
    ],
  );
  await event(
    client,
    context,
    "tax_return",
    taxReturn.id,
    "accounting.tax_governance.snapshot_captured",
    taxReturn.status,
    health.readiness,
    { capturedFor, riskBand: health.riskBand },
  );
  return result.rows[0];
}

export async function getTaxReturnGovernanceTimeline(
  client,
  context,
  taxReturnId,
) {
  requireAnyPermission(context, [
    ACCOUNTING_PERMISSIONS.view,
    ACCOUNTING_PERMISSIONS.taxManage,
    ACCOUNTING_PERMISSIONS.reportsView,
  ]);
  const id = uuid(taxReturnId, "Tax return");
  const exists = await client.query(
    `SELECT id FROM tenant.accounting_tax_returns
      WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, id],
  );
  if (!exists.rows[0]) {
    throw new TaxReportingGovernanceError(404, "Tax return was not found.");
  }
  const result = await client.query(
    `SELECT * FROM (
       SELECT snapshot.id,'governance_snapshot'::text AS timeline_type,
              snapshot.readiness_status AS status,snapshot.captured_at AS occurred_at,
              jsonb_build_object(
                'riskBand',snapshot.risk_band,
                'blockers',snapshot.blockers,
                'warnings',snapshot.warnings,
                'metrics',snapshot.metrics,
                'capturedFor',snapshot.captured_for
              ) AS metadata
         FROM tenant.accounting_tax_governance_snapshots snapshot
        WHERE snapshot.organization_id=$1 AND snapshot.tax_return_id=$2
       UNION ALL
       SELECT exception_case.id,'exception_case'::text,
              exception_case.status,exception_case.updated_at,
              jsonb_build_object(
                'priority',exception_case.priority,
                'reasonCode',exception_case.reason_code,
                'ownerUserId',exception_case.owner_user_id,
                'nextActionAt',exception_case.next_action_at,
                'note',exception_case.note
              )
         FROM tenant.accounting_tax_exception_cases exception_case
        WHERE exception_case.organization_id=$1
          AND exception_case.tax_return_id=$2
       UNION ALL
       SELECT request.id,'compliance_request'::text,
              request.status,request.updated_at,
              jsonb_build_object(
                'requestNumber',request.request_number,
                'complianceType',request.compliance_type,
                'externalReference',request.external_reference,
                'lastError',request.last_error
              )
         FROM tenant.accounting_compliance_requests request
        WHERE request.organization_id=$1
          AND request.source_type='tax_return' AND request.source_id=$2
       UNION ALL
       SELECT accounting_event.id,'accounting_event'::text,
              COALESCE(accounting_event.to_status,accounting_event.event_type),
              accounting_event.occurred_at,
              accounting_event.metadata
         FROM tenant.accounting_events accounting_event
        WHERE accounting_event.organization_id=$1
          AND accounting_event.entity_type='tax_return'
          AND accounting_event.entity_id=$2
     ) timeline
     ORDER BY occurred_at DESC`,
    [context.organizationId, id],
  );
  return result.rows;
}

export async function listTaxSavedViews(client, context) {
  requireAnyPermission(context, [
    ACCOUNTING_PERMISSIONS.view,
    ACCOUNTING_PERMISSIONS.taxManage,
    ACCOUNTING_PERMISSIONS.reportsView,
  ]);
  const result = await client.query(
    `SELECT * FROM tenant.accounting_tax_saved_views
      WHERE organization_id=$1
        AND (owner_user_id=$2 OR is_shared=true)
      ORDER BY is_shared DESC,updated_at DESC,name`,
    [context.organizationId, context.userId],
  );
  return result.rows;
}

export async function saveTaxView(client, context, input = {}) {
  requireAnyPermission(context, [
    ACCOUNTING_PERMISSIONS.view,
    ACCOUNTING_PERMISSIONS.taxManage,
    ACCOUNTING_PERMISSIONS.reportsView,
  ]);
  const name = text(input.name, 120);
  if (!name) {
    throw new TaxReportingGovernanceError(400, "Saved-view name is required.");
  }
  const filters = object(input.filters);
  const columns = Array.isArray(input.columns)
    ? input.columns.slice(0, 40)
    : [];
  const sort = Array.isArray(input.sort) ? input.sort.slice(0, 10) : [];
  const isShared = Boolean(input.isShared);
  if (isShared && !hasPermission(context, ACCOUNTING_PERMISSIONS.taxManage)) {
    throw new TaxReportingGovernanceError(
      403,
      "Tax management permission is required to share a view.",
    );
  }
  const id = input.id ? uuid(input.id, "Saved view") : null;
  const result = id
    ? await client.query(
        `UPDATE tenant.accounting_tax_saved_views
            SET name=$4,filters=$5::jsonb,columns=$6::jsonb,sort=$7::jsonb,
                is_shared=$8,updated_at=now()
          WHERE organization_id=$1 AND owner_user_id=$2 AND id=$3
          RETURNING *`,
        [
          context.organizationId,
          context.userId,
          id,
          name,
          JSON.stringify(filters),
          JSON.stringify(columns),
          JSON.stringify(sort),
          isShared,
        ],
      )
    : await client.query(
        `INSERT INTO tenant.accounting_tax_saved_views (
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
  if (!result.rows[0]) {
    throw new TaxReportingGovernanceError(404, "Saved tax view was not found.");
  }
  return result.rows[0];
}

export async function deleteTaxSavedView(client, context, viewId) {
  requireAnyPermission(context, [
    ACCOUNTING_PERMISSIONS.view,
    ACCOUNTING_PERMISSIONS.taxManage,
    ACCOUNTING_PERMISSIONS.reportsView,
  ]);
  const id = uuid(viewId, "Saved view");
  const result = await client.query(
    `DELETE FROM tenant.accounting_tax_saved_views
      WHERE organization_id=$1 AND owner_user_id=$2 AND id=$3
      RETURNING id`,
    [context.organizationId, context.userId, id],
  );
  if (!result.rows[0]) {
    throw new TaxReportingGovernanceError(404, "Saved tax view was not found.");
  }
  return { deleted: true, id };
}

export async function upsertTaxExceptionCase(
  client,
  context,
  taxReturnId,
  input = {},
) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.taxManage);
  const id = uuid(taxReturnId, "Tax return");
  const taxReturn = (
    await client.query(
      `SELECT id,company_id,status FROM tenant.accounting_tax_returns
        WHERE organization_id=$1 AND id=$2 FOR UPDATE`,
      [context.organizationId, id],
    )
  ).rows[0];
  if (!taxReturn) {
    throw new TaxReportingGovernanceError(404, "Tax return was not found.");
  }
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
  const note = text(input.note, 2000) || null;
  const result = await client.query(
    `INSERT INTO tenant.accounting_tax_exception_cases (
       organization_id,company_id,tax_return_id,status,priority,reason_code,
       owner_user_id,next_action_at,note,created_by,updated_by,resolved_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10,
       CASE WHEN $4 IN ('resolved','closed') THEN now() ELSE NULL END)
     ON CONFLICT (organization_id,tax_return_id)
     DO UPDATE SET status=EXCLUDED.status,priority=EXCLUDED.priority,
                   reason_code=EXCLUDED.reason_code,
                   owner_user_id=EXCLUDED.owner_user_id,
                   next_action_at=EXCLUDED.next_action_at,note=EXCLUDED.note,
                   updated_by=EXCLUDED.updated_by,updated_at=now(),
                   resolved_at=EXCLUDED.resolved_at
     RETURNING *`,
    [
      context.organizationId,
      taxReturn.company_id,
      taxReturn.id,
      status,
      priority,
      reasonCode,
      ownerUserId,
      nextActionAt,
      note,
      context.userId,
    ],
  );
  await event(
    client,
    context,
    "tax_return",
    taxReturn.id,
    "accounting.tax_exception.updated",
    taxReturn.status,
    status,
    { priority, reasonCode, ownerUserId, nextActionAt },
  );
  return result.rows[0];
}

export async function bulkManageTaxExceptions(client, context, input = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.taxManage);
  const taxReturnIds = Array.isArray(input.taxReturnIds)
    ? [...new Set(input.taxReturnIds.map((value) => uuid(value, "Tax return")))]
    : [];
  if (!taxReturnIds.length) {
    throw new TaxReportingGovernanceError(
      400,
      "Select at least one tax return.",
    );
  }
  if (taxReturnIds.length > 200) {
    throw new TaxReportingGovernanceError(
      400,
      "Bulk tax actions are limited to 200 returns.",
    );
  }
  const records = [];
  for (const taxReturnId of taxReturnIds) {
    records.push(
      await upsertTaxExceptionCase(
        client,
        context,
        taxReturnId,
        object(input.case),
      ),
    );
  }
  return { updated: records.length, records };
}

function summarizeNumericRows(rows) {
  const totals = new Map();
  for (const row of rows) {
    for (const [key, value] of Object.entries(row)) {
      if (
        value === null ||
        value === undefined ||
        typeof value === "boolean" ||
        /(^id$|_id$|code$|year$|period$)/i.test(key)
      ) {
        continue;
      }
      const normalized = String(value).trim();
      if (!/^-?\d+(\.\d+)?$/.test(normalized)) continue;
      try {
        totals.set(key, (totals.get(key) || 0n) + decimal(normalized));
      } catch {
        // Non-financial numeric output is intentionally omitted.
      }
    }
  }
  return Object.fromEntries(
    [...totals.entries()].map(([key, value]) => [
      key,
      asDatabaseDecimal(value),
    ]),
  );
}

export async function captureFinancialReportingSnapshot(
  client,
  context,
  input = {},
) {
  requireAnyPermission(context, [
    ACCOUNTING_PERMISSIONS.reportsView,
    ACCOUNTING_PERMISSIONS.closeManage,
  ]);
  const companyId = uuid(input.companyId || context.activeCompanyId, "Company");
  if (
    !context.allowAllCompanies &&
    context.activeCompanyId &&
    context.activeCompanyId !== companyId
  ) {
    throw new TaxReportingGovernanceError(403, "Switch to this company first.");
  }
  const company = (
    await client.query(
      `SELECT id FROM public.companies
        WHERE organization_id=$1 AND id=$2`,
      [context.organizationId, companyId],
    )
  ).rows[0];
  if (!company) {
    throw new TaxReportingGovernanceError(404, "Company was not found.");
  }
  const reportType = REPORT_TYPES.has(string(input.reportType))
    ? string(input.reportType)
    : "trial-balance";
  const fiscalPeriodId = input.fiscalPeriodId
    ? uuid(input.fiscalPeriodId, "Fiscal period")
    : null;
  let period = null;
  if (fiscalPeriodId) {
    period = (
      await client.query(
        `SELECT id,start_date,end_date,status
           FROM tenant.fiscal_periods
          WHERE organization_id=$1 AND company_id=$2 AND id=$3`,
        [context.organizationId, companyId, fiscalPeriodId],
      )
    ).rows[0];
    if (!period) {
      throw new TaxReportingGovernanceError(
        404,
        "Fiscal period was not found.",
      );
    }
  }
  const filters = {
    ...object(input.filters),
    companyId,
    ...(period ? { from: period.start_date, to: period.end_date } : {}),
  };
  const reportKeys =
    reportType === "close-pack"
      ? [
          "trial-balance",
          "profit-and-loss",
          "balance-sheet",
          "cash-flow",
          "tax-summary",
          "subledger-reconciliation",
        ]
      : [reportType];
  const reports = {};
  const combinedRows = [];
  for (const key of reportKeys) {
    const rows = await getAccountingReport(client, context, key, filters);
    reports[key] = {
      rowCount: rows.length,
      totals: summarizeNumericRows(rows),
    };
    combinedRows.push(...rows.map((row) => ({ reportType: key, ...row })));
  }
  const subledgerRows =
    reportType === "close-pack"
      ? await getAccountingReport(
          client,
          context,
          "subledger-reconciliation",
          filters,
        )
      : reportType === "subledger-reconciliation"
        ? combinedRows
        : [];
  const policy = await getPolicy(client, context, companyId);
  const tolerance = absoluteDecimal(policy.reporting_tolerance);
  const reconciliationBlocked = subledgerRows.some(
    (row) =>
      absoluteDecimal(row.receivable_difference || 0) > tolerance ||
      absoluteDecimal(row.payable_difference || 0) > tolerance,
  );
  const readinessStatus =
    reconciliationBlocked && policy.require_subledger_reconciliation
      ? "blocked"
      : reconciliationBlocked
        ? "attention"
        : "captured";
  const evidence = {
    filters,
    reports,
    fiscalPeriodStatus: period?.status || null,
    subledgerReconciled: !reconciliationBlocked,
  };
  const contentHash = hashPayload({ reportType, companyId, evidence });
  const result = await client.query(
    `INSERT INTO tenant.accounting_financial_reporting_snapshots (
       organization_id,company_id,fiscal_period_id,report_type,as_of_date,
       readiness_status,row_count,totals,evidence,content_hash,captured_by
     ) VALUES ($1,$2,$3,$4,COALESCE($5::date,current_date),$6,$7,$8::jsonb,
               $9::jsonb,$10,$11)
     RETURNING *`,
    [
      context.organizationId,
      companyId,
      fiscalPeriodId,
      reportType,
      input.asOfDate ? String(input.asOfDate).slice(0, 10) : null,
      readinessStatus,
      combinedRows.length,
      JSON.stringify(summarizeNumericRows(combinedRows)),
      JSON.stringify(evidence),
      contentHash,
      context.userId,
    ],
  );
  await event(
    client,
    context,
    "financial_reporting_snapshot",
    result.rows[0].id,
    "accounting.financial_reporting.snapshot_captured",
    null,
    readinessStatus,
    { reportType, companyId, fiscalPeriodId, contentHash },
  );
  return result.rows[0];
}
