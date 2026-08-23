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
import { getPeriodCloseBlockers } from "./close.js";

export class BankingGovernanceError extends AccountingError {
  constructor(status, message, code = "BANKING_GOVERNANCE_ERROR") {
    super(status, message, code);
    this.name = "BankingGovernanceError";
  }
}

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const EXCEPTION_STATUSES = new Set([
  "open",
  "under_review",
  "bank_query",
  "approved_adjustment",
  "resolved",
  "closed",
]);
const EXCEPTION_PRIORITIES = new Set(["low", "normal", "high", "urgent"]);
const EXCEPTION_REASONS = new Set([
  "unmatched_transaction",
  "partial_match",
  "duplicate_transaction",
  "balance_difference",
  "missing_reference",
  "bank_charge",
  "interest",
  "timing_difference",
  "other",
]);

const number = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const string = (value) => String(value ?? "").trim();
const object = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};
const dateTime = (value, label) => {
  if (value === undefined || value === null || value === "") return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new BankingGovernanceError(400, `${label} is invalid.`);
  }
  return parsed.toISOString();
};

function defaultPolicy(policy = {}) {
  return {
    importSlaHours: Math.max(
      1,
      number(policy.import_sla_hours ?? policy.importSlaHours ?? 24),
    ),
    reconciliationSlaDays: Math.max(
      1,
      number(
        policy.reconciliation_sla_days ?? policy.reconciliationSlaDays ?? 5,
      ),
    ),
    staleAfterDays: Math.max(
      1,
      number(policy.stale_after_days ?? policy.staleAfterDays ?? 7),
    ),
    exceptionEscalationDays: Math.max(
      1,
      number(
        policy.exception_escalation_days ?? policy.exceptionEscalationDays ?? 3,
      ),
    ),
    highRiskUnmatchedDays: Math.max(
      1,
      number(
        policy.high_risk_unmatched_days ?? policy.highRiskUnmatchedDays ?? 30,
      ),
    ),
    closeLookbackDays: Math.max(
      1,
      number(policy.close_lookback_days ?? policy.closeLookbackDays ?? 31),
    ),
    cashForecastHorizonDays: Math.max(
      1,
      number(
        policy.cash_forecast_horizon_days ??
          policy.cashForecastHorizonDays ??
          30,
      ),
    ),
    requireSourceHash:
      policy.require_source_hash ?? policy.requireSourceHash ?? true,
    requireCompletedReconciliation:
      policy.require_completed_reconciliation ??
      policy.requireCompletedReconciliation ??
      true,
    blockBalanceDifference:
      policy.block_balance_difference ?? policy.blockBalanceDifference ?? true,
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

function requireAnyPermission(context, permissions) {
  if (!permissions.some((permission) => hasPermission(context, permission))) {
    throw new BankingGovernanceError(
      403,
      "You do not have permission to manage banking governance.",
      "BANKING_GOVERNANCE_PERMISSION_DENIED",
    );
  }
}

function decimalIsZero(value) {
  try {
    return decimal(value || 0) === 0n;
  } catch {
    return Math.abs(number(value)) < 0.000001;
  }
}

export function evaluateBankStatementHealth(
  row,
  policyInput = {},
  now = new Date(),
) {
  const policy = defaultPolicy(policyInput);
  const blockers = [];
  const warnings = [];
  const status = string(row.status);
  const reconciliationStatus = string(
    row.reconciliation_status || row.reconciliationStatus,
  );
  const exceptionStatus = string(
    row.exception_case_status || row.exceptionCaseStatus,
  );
  const lineCount = number(row.line_count ?? row.lineCount);
  const unmatchedLineCount = number(
    row.unmatched_line_count ?? row.unmatchedLineCount,
  );
  const suggestedLineCount = number(
    row.suggested_line_count ?? row.suggestedLineCount,
  );
  const partialLineCount = number(
    row.partial_line_count ?? row.partialLineCount,
  );
  const matchedLineCount = number(
    row.matched_line_count ?? row.matchedLineCount,
  );
  const ignoredLineCount = number(
    row.ignored_line_count ?? row.ignoredLineCount,
  );
  const duplicateLineCount = number(
    row.duplicate_line_count ?? row.duplicateLineCount,
  );
  const statementAge = age(row.period_end || row.periodEnd, now);
  const updatedAge = age(
    row.updated_at || row.updatedAt || row.created_at,
    now,
  );
  const exceptionAge = age(
    row.exception_updated_at || row.exceptionUpdatedAt || row.updated_at,
    now,
  );
  const difference = row.reconciliation_difference ?? row.difference ?? 0;
  const openLineCount =
    unmatchedLineCount + suggestedLineCount + partialLineCount;

  if (status !== "cancelled" && lineCount < 1) {
    blockers.push("Bank statement requires at least one transaction line.");
  }
  if (!row.period_start && !row.periodStart) {
    blockers.push("Statement period start is missing.");
  }
  if (!row.period_end && !row.periodEnd) {
    blockers.push("Statement period end is missing.");
  }
  if (duplicateLineCount > 0) {
    blockers.push("Statement contains duplicate transaction identities.");
  }
  if (
    policy.requireSourceHash &&
    status !== "draft" &&
    !string(row.source_hash || row.sourceHash)
  ) {
    warnings.push("Imported statement has no immutable source hash.");
  }
  if (
    policy.blockBalanceDifference &&
    reconciliationStatus === "completed" &&
    !decimalIsZero(difference)
  ) {
    blockers.push(
      "Completed reconciliation has a non-zero balance difference.",
    );
  }
  if (status === "reconciled" && openLineCount > 0) {
    blockers.push(
      "Reconciled statement still contains open transaction lines.",
    );
  }
  if (
    policy.requireCompletedReconciliation &&
    status === "reconciled" &&
    reconciliationStatus !== "completed"
  ) {
    blockers.push(
      "Reconciled statement is missing a completed reconciliation.",
    );
  }
  if (status === "reconciling" && !reconciliationStatus) {
    blockers.push("Statement is reconciling without a reconciliation record.");
  }

  if (
    ["draft", "imported"].includes(status) &&
    updatedAge.hours > policy.importSlaHours
  ) {
    warnings.push("Statement import or review is outside its SLA.");
  }
  if (
    ["imported", "reconciling"].includes(status) &&
    statementAge.days > policy.reconciliationSlaDays
  ) {
    warnings.push("Bank statement reconciliation is overdue.");
  }
  if (unmatchedLineCount > 0) {
    warnings.push(
      `${unmatchedLineCount} transaction line(s) remain unmatched.`,
    );
  }
  if (partialLineCount > 0) {
    warnings.push(
      `${partialLineCount} transaction line(s) are partially matched.`,
    );
  }
  if (suggestedLineCount > 0) {
    warnings.push(`${suggestedLineCount} suggested match(es) require review.`);
  }
  if (reconciliationStatus === "reopened") {
    warnings.push("Bank reconciliation has been reopened.");
  }
  if (openLineCount > 0 && statementAge.days >= policy.highRiskUnmatchedDays) {
    warnings.push("Long-outstanding unmatched transactions are high risk.");
  }
  if (openLineCount > 0 && !exceptionStatus) {
    warnings.push("Open reconciliation items have no owned exception case.");
  }
  if (
    exceptionStatus &&
    !["resolved", "closed", "approved_adjustment"].includes(exceptionStatus) &&
    exceptionAge.days >= policy.exceptionEscalationDays
  ) {
    warnings.push("Reconciliation exception requires escalation.");
  }

  const readiness = blockers.length
    ? "blocked"
    : warnings.length
      ? "attention"
      : "ready";

  return {
    readiness,
    blockers,
    warnings,
    reconciliationEligible:
      status !== "cancelled" && lineCount > 0 && duplicateLineCount === 0,
    closeEligible:
      status === "reconciled" &&
      reconciliationStatus === "completed" &&
      openLineCount === 0 &&
      decimalIsZero(difference),
    riskBand:
      blockers.length || statementAge.days >= policy.highRiskUnmatchedDays
        ? "high"
        : warnings.length
          ? "medium"
          : "low",
    metrics: {
      lineCount,
      unmatchedLineCount,
      suggestedLineCount,
      partialLineCount,
      matchedLineCount,
      ignoredLineCount,
      openLineCount,
      statementAgeDays: statementAge.days,
      updatedAgeHours: updatedAge.hours,
    },
  };
}

export function buildBankingGovernanceSummary(
  rows,
  policyInput = {},
  now = new Date(),
) {
  const assessed = rows.map((row) => ({
    row,
    health: evaluateBankStatementHealth(row, policyInput, now),
  }));
  return {
    totalStatements: assessed.length,
    ready: assessed.filter(({ health }) => health.readiness === "ready").length,
    attention: assessed.filter(({ health }) => health.readiness === "attention")
      .length,
    blocked: assessed.filter(({ health }) => health.readiness === "blocked")
      .length,
    openLineCount: assessed.reduce(
      (sum, { health }) => sum + Number(health.metrics.openLineCount || 0),
      0,
    ),
    highRisk: assessed.filter(({ health }) => health.riskBand === "high")
      .length,
    closeEligible: assessed.filter(({ health }) => health.closeEligible).length,
  };
}

async function getPolicy(client, context) {
  const result = await client.query(
    `SELECT *
       FROM tenant.accounting_banking_governance_policies
      WHERE organization_id=$1`,
    [context.organizationId],
  );
  return result.rows[0] || {};
}

function companyScope(context, values, alias) {
  if (!context.allowAllCompanies && context.activeCompanyId) {
    values.push(context.activeCompanyId);
    return ` AND ${alias}.company_id=$${values.length}`;
  }
  return "";
}

async function loadStatementRows(client, context, statementId = null) {
  const values = [context.organizationId];
  let where = companyScope(context, values, "statement");
  if (statementId) {
    values.push(uuid(statementId, "Bank statement"));
    where += ` AND statement.id=$${values.length}`;
  }
  const result = await client.query(
    `SELECT statement.*,bank.code AS bank_code,bank.bank_name,
            bank.account_name,bank.masked_account_number,
            COALESCE(lines.line_count,0)::int AS line_count,
            COALESCE(lines.unmatched_line_count,0)::int AS unmatched_line_count,
            COALESCE(lines.suggested_line_count,0)::int AS suggested_line_count,
            COALESCE(lines.partial_line_count,0)::int AS partial_line_count,
            COALESCE(lines.matched_line_count,0)::int AS matched_line_count,
            COALESCE(lines.ignored_line_count,0)::int AS ignored_line_count,
            COALESCE(lines.duplicate_line_count,0)::int AS duplicate_line_count,
            reconciliation.id AS reconciliation_id,
            reconciliation.status AS reconciliation_status,
            reconciliation.difference AS reconciliation_difference,
            reconciliation.created_at AS reconciliation_created_at,
            reconciliation.completed_at AS reconciliation_completed_at,
            exception_case.id AS exception_case_id,
            exception_case.status AS exception_case_status,
            exception_case.priority AS exception_case_priority,
            exception_case.owner_user_id AS exception_owner_user_id,
            exception_case.updated_at AS exception_updated_at
       FROM tenant.accounting_bank_statements statement
       JOIN tenant.accounting_bank_accounts bank
         ON bank.organization_id=statement.organization_id
        AND bank.id=statement.bank_account_id
       LEFT JOIN LATERAL (
         SELECT count(*)::int AS line_count,
                count(*) FILTER (WHERE line.match_status='unmatched')::int AS unmatched_line_count,
                count(*) FILTER (WHERE line.match_status='suggested')::int AS suggested_line_count,
                count(*) FILTER (WHERE line.match_status='partially_matched')::int AS partial_line_count,
                count(*) FILTER (WHERE line.match_status='matched')::int AS matched_line_count,
                count(*) FILTER (WHERE line.match_status='ignored')::int AS ignored_line_count,
                count(*) FILTER (
                  WHERE line.external_id IS NOT NULL
                    AND EXISTS (
                      SELECT 1
                        FROM tenant.accounting_bank_statement_lines duplicate
                       WHERE duplicate.organization_id=line.organization_id
                         AND duplicate.bank_statement_id=line.bank_statement_id
                         AND duplicate.external_id=line.external_id
                         AND duplicate.id<>line.id
                    )
                )::int AS duplicate_line_count
           FROM tenant.accounting_bank_statement_lines line
          WHERE line.organization_id=statement.organization_id
            AND line.bank_statement_id=statement.id
       ) lines ON true
       LEFT JOIN LATERAL (
         SELECT candidate.*
           FROM tenant.accounting_reconciliations candidate
          WHERE candidate.organization_id=statement.organization_id
            AND candidate.bank_statement_id=statement.id
          ORDER BY candidate.created_at DESC
          LIMIT 1
       ) reconciliation ON true
       LEFT JOIN tenant.accounting_reconciliation_exception_cases exception_case
         ON exception_case.organization_id=statement.organization_id
        AND exception_case.bank_statement_id=statement.id
      WHERE statement.organization_id=$1${where}
      ORDER BY statement.period_end DESC,statement.created_at DESC`,
    values,
  );
  return result.rows;
}

export async function getBankingGovernanceDashboard(client, context) {
  requireAnyPermission(context, [
    ACCOUNTING_PERMISSIONS.view,
    ACCOUNTING_PERMISSIONS.reportsView,
    ACCOUNTING_PERMISSIONS.bankReconcile,
  ]);
  const policy = await getPolicy(client, context);
  const statements = await loadStatementRows(client, context);
  const assessed = statements.map((statement) => ({
    ...statement,
    health: evaluateBankStatementHealth(statement, policy),
  }));

  const scopeValues = [context.organizationId];
  const bankScope = companyScope(context, scopeValues, "bank");
  const cash = await client.query(
    `SELECT bank.id,bank.company_id,bank.code,bank.bank_name,bank.account_name,
            bank.currency_code,
            COALESCE(sum(line.debit_amount-line.credit_amount) FILTER (WHERE entry.id IS NOT NULL),0) AS account_balance,
            COALESCE(sum(line.base_debit_amount-line.base_credit_amount) FILTER (WHERE entry.id IS NOT NULL),0) AS base_balance
       FROM tenant.accounting_bank_accounts bank
       LEFT JOIN tenant.accounting_journal_lines line
         ON line.organization_id=bank.organization_id
        AND line.account_id=bank.gl_account_id
       LEFT JOIN tenant.accounting_journal_entries entry
         ON entry.organization_id=line.organization_id
        AND entry.id=line.journal_entry_id
        AND entry.status='posted'
      WHERE bank.organization_id=$1 AND bank.status='active'${bankScope}
      GROUP BY bank.id
      ORDER BY bank.bank_name,bank.account_name`,
    scopeValues,
  );

  const exceptionValues = [context.organizationId];
  const exceptionScope = companyScope(
    context,
    exceptionValues,
    "exception_case",
  );
  const exceptions = await client.query(
    `SELECT exception_case.*,statement.statement_number,bank.bank_name,
            bank.account_name
       FROM tenant.accounting_reconciliation_exception_cases exception_case
       JOIN tenant.accounting_bank_statements statement
         ON statement.organization_id=exception_case.organization_id
        AND statement.id=exception_case.bank_statement_id
       JOIN tenant.accounting_bank_accounts bank
         ON bank.organization_id=statement.organization_id
        AND bank.id=statement.bank_account_id
      WHERE exception_case.organization_id=$1${exceptionScope}
        AND exception_case.status NOT IN ('resolved','closed')
      ORDER BY
        CASE exception_case.priority
          WHEN 'urgent' THEN 1 WHEN 'high' THEN 2
          WHEN 'normal' THEN 3 ELSE 4 END,
        exception_case.next_action_at NULLS LAST,
        exception_case.updated_at`,
    exceptionValues,
  );

  const closeValues = [context.organizationId];
  const periodScope = companyScope(context, closeValues, "period");
  const closeReadiness = await client.query(
    `SELECT period.id,period.company_id,period.name,period.start_date,
            period.end_date,period.status,
            (SELECT count(*)::int
               FROM tenant.accounting_reconciliations reconciliation
              WHERE reconciliation.organization_id=period.organization_id
                AND reconciliation.company_id=period.company_id
                AND reconciliation.reconciliation_date
                    BETWEEN period.start_date AND period.end_date
                AND reconciliation.status IN ('in_progress','reopened'))
              AS open_reconciliations,
            (SELECT count(*)::int
               FROM tenant.accounting_bank_statement_lines line
               JOIN tenant.accounting_bank_statements statement
                 ON statement.organization_id=line.organization_id
                AND statement.id=line.bank_statement_id
              WHERE line.organization_id=period.organization_id
                AND statement.company_id=period.company_id
                AND statement.period_end BETWEEN period.start_date AND period.end_date
                AND line.match_status NOT IN ('matched','ignored'))
              AS unreconciled_lines
       FROM tenant.fiscal_periods period
      WHERE period.organization_id=$1${periodScope}
        AND period.status IN ('open','soft_closed')
      ORDER BY period.end_date DESC
      LIMIT 12`,
    closeValues,
  );

  return {
    policy,
    summary: buildBankingGovernanceSummary(statements, policy),
    statements: assessed,
    cashPositions: cash.rows,
    exceptionCases: exceptions.rows,
    closeReadiness: closeReadiness.rows,
  };
}

export async function assessBankStatementReadiness(
  client,
  context,
  statementId,
) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.view);
  const policy = await getPolicy(client, context);
  const statements = await loadStatementRows(client, context, statementId);
  if (!statements[0]) {
    throw new BankingGovernanceError(404, "Bank statement was not found.");
  }
  return {
    statement: statements[0],
    health: evaluateBankStatementHealth(statements[0], policy),
    policy,
  };
}

export async function captureBankingGovernanceSnapshot(
  client,
  context,
  statementId,
  capturedFor = "manual",
) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.bankReconcile);
  const assessment = await assessBankStatementReadiness(
    client,
    context,
    statementId,
  );
  const { statement, health } = assessment;
  const result = await client.query(
    `INSERT INTO tenant.accounting_banking_governance_snapshots (
       organization_id,bank_statement_id,statement_status,
       reconciliation_status,readiness_status,blockers,warnings,metrics,
       captured_for,captured_by
     ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9,$10)
     RETURNING *`,
    [
      context.organizationId,
      statement.id,
      statement.status,
      statement.reconciliation_status || null,
      health.readiness,
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
    "bank_statement",
    statement.id,
    "accounting.banking_governance.snapshot_captured",
    statement.status,
    statement.status,
    { readiness: health.readiness, capturedFor },
  );
  return result.rows[0];
}

export async function getBankStatementGovernanceTimeline(
  client,
  context,
  statementId,
) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.view);
  const id = uuid(statementId, "Bank statement");
  const statement = await client.query(
    `SELECT id
       FROM tenant.accounting_bank_statements
      WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, id],
  );
  if (!statement.rows[0]) {
    throw new BankingGovernanceError(404, "Bank statement was not found.");
  }
  const [events, snapshots, exceptions] = await Promise.all([
    client.query(
      `SELECT id,'event' AS timeline_type,event_type AS title,
              metadata AS details,occurred_at AS occurred_at,actor_user_id
         FROM tenant.accounting_events
        WHERE organization_id=$1 AND entity_type='bank_statement'
          AND entity_id=$2`,
      [context.organizationId, id],
    ),
    client.query(
      `SELECT id,'snapshot' AS timeline_type,
              'Governance snapshot' AS title,
              jsonb_build_object(
                'readiness',readiness_status,
                'blockers',blockers,
                'warnings',warnings,
                'capturedFor',captured_for
              ) AS details,
              captured_at AS occurred_at,captured_by AS actor_user_id
         FROM tenant.accounting_banking_governance_snapshots
        WHERE organization_id=$1 AND bank_statement_id=$2`,
      [context.organizationId, id],
    ),
    client.query(
      `SELECT id,'exception' AS timeline_type,
              'Reconciliation exception '||status AS title,
              jsonb_build_object(
                'priority',priority,'reasonCode',reason_code,'note',note,
                'ownerUserId',owner_user_id,'nextActionAt',next_action_at
              ) AS details,
              updated_at AS occurred_at,updated_by AS actor_user_id
         FROM tenant.accounting_reconciliation_exception_cases
        WHERE organization_id=$1 AND bank_statement_id=$2`,
      [context.organizationId, id],
    ),
  ]);
  return [...events.rows, ...snapshots.rows, ...exceptions.rows].sort(
    (left, right) =>
      new Date(right.occurred_at).getTime() -
      new Date(left.occurred_at).getTime(),
  );
}

export async function listBankingSavedViews(client, context) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.view);
  const result = await client.query(
    `SELECT *
       FROM tenant.accounting_banking_saved_views
      WHERE organization_id=$1
        AND (owner_user_id=$2 OR is_shared=true)
      ORDER BY is_shared DESC,updated_at DESC,name`,
    [context.organizationId, context.userId],
  );
  return result.rows;
}

export async function saveBankingView(client, context, input = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.view);
  const name = text(input.name, 120);
  if (!name)
    throw new BankingGovernanceError(400, "Saved view name is required.");
  const filters = object(input.filters);
  const columns = Array.isArray(input.columns)
    ? input.columns.slice(0, 40)
    : [];
  const sort = Array.isArray(input.sort) ? input.sort.slice(0, 10) : [];
  const isShared = Boolean(input.isShared);
  const id = input.id ? uuid(input.id, "Saved view") : null;
  const result = id
    ? await client.query(
        `UPDATE tenant.accounting_banking_saved_views
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
        `INSERT INTO tenant.accounting_banking_saved_views (
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
    throw new BankingGovernanceError(404, "Saved banking view was not found.");
  }
  return result.rows[0];
}

export async function deleteBankingSavedView(client, context, viewId) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.view);
  const id = uuid(viewId, "Saved view");
  const result = await client.query(
    `DELETE FROM tenant.accounting_banking_saved_views
      WHERE organization_id=$1 AND owner_user_id=$2 AND id=$3
      RETURNING id`,
    [context.organizationId, context.userId, id],
  );
  if (!result.rows[0]) {
    throw new BankingGovernanceError(404, "Saved banking view was not found.");
  }
  return { deleted: true, id };
}

export async function upsertReconciliationExceptionCase(
  client,
  context,
  statementId,
  input = {},
) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.bankReconcile);
  const id = uuid(statementId, "Bank statement");
  const statement = (
    await client.query(
      `SELECT statement.id,statement.company_id,statement.bank_account_id,
              reconciliation.id AS reconciliation_id
         FROM tenant.accounting_bank_statements statement
         LEFT JOIN LATERAL (
           SELECT id
             FROM tenant.accounting_reconciliations candidate
            WHERE candidate.organization_id=statement.organization_id
              AND candidate.bank_statement_id=statement.id
            ORDER BY candidate.created_at DESC
            LIMIT 1
         ) reconciliation ON true
        WHERE statement.organization_id=$1 AND statement.id=$2
        FOR UPDATE OF statement`,
      [context.organizationId, id],
    )
  ).rows[0];
  if (!statement) {
    throw new BankingGovernanceError(404, "Bank statement was not found.");
  }
  const status = EXCEPTION_STATUSES.has(string(input.status))
    ? string(input.status)
    : "open";
  const priority = EXCEPTION_PRIORITIES.has(string(input.priority))
    ? string(input.priority)
    : "normal";
  const reasonCode = EXCEPTION_REASONS.has(string(input.reasonCode))
    ? string(input.reasonCode)
    : "other";
  const ownerUserId = input.ownerUserId
    ? uuid(input.ownerUserId, "Exception owner")
    : null;
  const nextActionAt = dateTime(input.nextActionAt, "Next action");
  const note = text(input.note, 2000) || null;
  const result = await client.query(
    `INSERT INTO tenant.accounting_reconciliation_exception_cases (
       organization_id,bank_statement_id,reconciliation_id,company_id,
       bank_account_id,status,priority,reason_code,owner_user_id,
       next_action_at,note,created_by,updated_by,resolved_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12,
       CASE WHEN $6 IN ('resolved','closed') THEN now() ELSE NULL END)
     ON CONFLICT (organization_id,bank_statement_id)
     DO UPDATE SET reconciliation_id=EXCLUDED.reconciliation_id,
                   status=EXCLUDED.status,priority=EXCLUDED.priority,
                   reason_code=EXCLUDED.reason_code,
                   owner_user_id=EXCLUDED.owner_user_id,
                   next_action_at=EXCLUDED.next_action_at,
                   note=EXCLUDED.note,updated_by=EXCLUDED.updated_by,
                   updated_at=now(),resolved_at=EXCLUDED.resolved_at
     RETURNING *`,
    [
      context.organizationId,
      statement.id,
      statement.reconciliation_id || null,
      statement.company_id,
      statement.bank_account_id,
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
    "bank_statement",
    statement.id,
    "accounting.reconciliation_exception.updated",
    null,
    status,
    { priority, reasonCode, ownerUserId, nextActionAt },
  );
  return result.rows[0];
}

export async function bulkManageReconciliationExceptions(
  client,
  context,
  input = {},
) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.bankReconcile);
  const statementIds = Array.isArray(input.statementIds)
    ? [
        ...new Set(
          input.statementIds.map((value) => uuid(value, "Bank statement")),
        ),
      ]
    : [];
  if (!statementIds.length) {
    throw new BankingGovernanceError(
      400,
      "Select at least one bank statement.",
    );
  }
  if (statementIds.length > 200) {
    throw new BankingGovernanceError(
      400,
      "Bulk banking actions are limited to 200 statements.",
    );
  }
  const records = [];
  for (const statementId of statementIds) {
    records.push(
      await upsertReconciliationExceptionCase(
        client,
        context,
        statementId,
        object(input.case),
      ),
    );
  }
  return { updated: records.length, records };
}

export async function captureCashPositionSnapshot(client, context, input = {}) {
  requireAnyPermission(context, [
    ACCOUNTING_PERMISSIONS.bankManage,
    ACCOUNTING_PERMISSIONS.budgetManage,
    ACCOUNTING_PERMISSIONS.reportsView,
  ]);
  const companyId = uuid(input.companyId || context.activeCompanyId, "Company");
  const company = (
    await client.query(
      `SELECT id,base_currency
         FROM public.companies
        WHERE organization_id=$1 AND id=$2`,
      [context.organizationId, companyId],
    )
  ).rows[0];
  if (!company) throw new BankingGovernanceError(404, "Company was not found.");
  if (
    !context.allowAllCompanies &&
    context.activeCompanyId &&
    context.activeCompanyId !== companyId
  ) {
    throw new BankingGovernanceError(403, "Switch to this company first.");
  }
  const balances = await client.query(
    `SELECT bank.id AS bank_account_id,bank.code,bank.bank_name,
            bank.account_name,bank.currency_code,
            COALESCE(sum(line.debit_amount-line.credit_amount) FILTER (WHERE entry.id IS NOT NULL),0) AS balance,
            COALESCE(sum(line.base_debit_amount-line.base_credit_amount) FILTER (WHERE entry.id IS NOT NULL),0)
              AS base_balance
       FROM tenant.accounting_bank_accounts bank
       LEFT JOIN tenant.accounting_journal_lines line
         ON line.organization_id=bank.organization_id
        AND line.account_id=bank.gl_account_id
       LEFT JOIN tenant.accounting_journal_entries entry
         ON entry.organization_id=line.organization_id
        AND entry.id=line.journal_entry_id
        AND entry.status='posted'
      WHERE bank.organization_id=$1 AND bank.company_id=$2
        AND bank.status='active'
      GROUP BY bank.id
      ORDER BY bank.bank_name,bank.account_name`,
    [context.organizationId, companyId],
  );
  const totalBaseBalance = balances.rows.reduce(
    (total, row) => total + decimal(row.base_balance || 0),
    0n,
  );
  const result = await client.query(
    `INSERT INTO tenant.accounting_cash_position_snapshots (
       organization_id,company_id,as_of,base_currency_code,
       total_base_balance,balances,captured_by
     ) VALUES ($1,$2,COALESCE($3::timestamptz,now()),$4,$5,$6::jsonb,$7)
     RETURNING *`,
    [
      context.organizationId,
      companyId,
      dateTime(input.asOf, "Cash position date"),
      company.base_currency,
      asDatabaseDecimal(totalBaseBalance),
      JSON.stringify(balances.rows),
      context.userId,
    ],
  );
  await event(
    client,
    context,
    "cash_position",
    result.rows[0].id,
    "accounting.cash_position.captured",
    null,
    "captured",
    { companyId, totalBaseBalance: asDatabaseDecimal(totalBaseBalance) },
  );
  return result.rows[0];
}

export async function captureCloseReadinessSnapshot(
  client,
  context,
  companyId,
  fiscalPeriodId,
) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.closeManage);
  const resolvedCompanyId = uuid(
    companyId || context.activeCompanyId,
    "Company",
  );
  const periodId = uuid(fiscalPeriodId, "Fiscal period");
  const period = (
    await client.query(
      `SELECT *
         FROM tenant.fiscal_periods
        WHERE organization_id=$1 AND company_id=$2 AND id=$3`,
      [context.organizationId, resolvedCompanyId, periodId],
    )
  ).rows[0];
  if (!period) {
    throw new BankingGovernanceError(404, "Fiscal period was not found.");
  }
  const blockers = await getPeriodCloseBlockers(
    client,
    context,
    resolvedCompanyId,
    periodId,
  );
  const bankingBlockers = blockers.filter((blocker) =>
    ["open_bank_reconciliations", "unreconciled_bank_lines"].includes(
      blocker.key,
    ),
  );
  const result = await client.query(
    `INSERT INTO tenant.accounting_close_readiness_snapshots (
       organization_id,company_id,fiscal_period_id,readiness_status,
       blockers,banking_blocker_count,captured_by
     ) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7)
     RETURNING *`,
    [
      context.organizationId,
      resolvedCompanyId,
      periodId,
      blockers.length ? "blocked" : "ready",
      JSON.stringify(blockers),
      bankingBlockers.reduce((sum, blocker) => sum + number(blocker.count), 0),
      context.userId,
    ],
  );
  await event(
    client,
    context,
    "fiscal_period",
    periodId,
    "accounting.close_readiness.captured",
    period.status,
    blockers.length ? "blocked" : "ready",
    {
      blockerCount: blockers.length,
      bankingBlockerCount: bankingBlockers.length,
    },
  );
  return result.rows[0];
}
