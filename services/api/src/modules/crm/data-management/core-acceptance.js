import { createHash } from "node:crypto";

export class CrmCoreAcceptanceError extends Error {
  constructor(status, message, code = "CRM_CORE_ACCEPTANCE_ERROR") {
    super(message);
    this.name = "CrmCoreAcceptanceError";
    this.status = status;
    this.code = code;
  }
}

export const CRM_CORE_CAPABILITY_IDS = Object.freeze([
  "CRM-010",
  "CRM-011",
  "CRM-012",
  "CRM-013",
  "CRM-014",
  "CRM-015",
  "CRM-016",
  "CRM-017",
  "CRM-018",
  "CRM-019",
  "CRM-020",
  "CRM-021",
  "CRM-022",
  "CRM-023",
  "CRM-024",
  "CRM-025",
  "CRM-026",
]);

export const CRM_CORE_SURFACE_CHECKS = Object.freeze([
  "surface:web",
  "surface:mobile",
  "surface:api",
  "surface:database",
  "surface:tenant-isolation",
  "surface:security",
  "surface:live-workflow",
]);

export const CRM_CORE_CHECK_KEYS = Object.freeze([
  ...CRM_CORE_CAPABILITY_IDS,
  ...CRM_CORE_SURFACE_CHECKS,
]);

const CHECK_STATUSES = new Set([
  "running",
  "passed",
  "warning",
  "failed",
  "skipped",
]);
const CHECK_SOURCES = new Set(["local", "ci", "acceptance", "manual"]);
const ENVIRONMENTS = new Set(["development", "staging", "production"]);
const string = (value) => String(value ?? "").trim();
const object = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function crmCoreContentHash(value) {
  return createHash("sha256").update(stable(value)).digest("hex");
}

function hasPermission(context, permission) {
  const roles = new Set(
    Array.isArray(context.roleSlugs) ? context.roleSlugs : [],
  );
  if (
    roles.has("organization_owner") ||
    roles.has("system_administrator") ||
    roles.has("super_admin")
  ) {
    return true;
  }
  return new Set(
    Array.isArray(context.permissions) ? context.permissions : [],
  ).has(permission);
}

function requireViewPermission(context) {
  if (
    !["crm.view", "crm.reports.view", "audit.view", "organization.manage"].some(
      (permission) => hasPermission(context, permission),
    )
  ) {
    throw new CrmCoreAcceptanceError(
      403,
      "You do not have permission to view CRM core acceptance evidence.",
      "CRM_CORE_ACCEPTANCE_PERMISSION_DENIED",
    );
  }
}

function requireManagePermission(context) {
  if (
    !["crm.settings.manage", "organization.manage"].some((permission) =>
      hasPermission(context, permission),
    )
  ) {
    throw new CrmCoreAcceptanceError(
      403,
      "CRM settings or organisation management permission is required to record acceptance evidence.",
      "CRM_CORE_ACCEPTANCE_MANAGE_PERMISSION_DENIED",
    );
  }
}

function dateTime(value, label, optional = true) {
  if (value === undefined || value === null || value === "") {
    if (optional) return null;
    throw new CrmCoreAcceptanceError(400, `${label} is required.`);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new CrmCoreAcceptanceError(400, `${label} is invalid.`);
  }
  return parsed.toISOString();
}

function latestByKey(checks) {
  const latest = new Map();
  for (const row of Array.isArray(checks) ? checks : []) {
    const key = string(row.check_key ?? row.checkKey);
    if (!key || latest.has(key)) continue;
    latest.set(key, row);
  }
  return latest;
}

export function evaluateCrmCoreAcceptance(input = {}) {
  const checks = latestByKey(input.checks);
  const blockers = [];
  const warnings = [];
  let passed = 0;
  let warning = 0;
  let failed = 0;
  let missing = 0;

  for (const key of CRM_CORE_CHECK_KEYS) {
    const check = checks.get(key);
    const status = string(check?.status);
    if (!check) {
      missing += 1;
      blockers.push(`Required CRM core acceptance check is missing: ${key}.`);
      continue;
    }
    if (status === "passed") {
      passed += 1;
    } else if (status === "warning") {
      warning += 1;
      warnings.push(`CRM core acceptance check needs review: ${key}.`);
    } else {
      failed += 1;
      blockers.push(
        `CRM core acceptance check did not pass: ${key} (${status || "unknown"}).`,
      );
    }
  }

  const required = CRM_CORE_CHECK_KEYS.length;
  const passPercent = Math.round((passed / required) * 10000) / 100;
  const readiness = blockers.length
    ? "blocked"
    : warnings.length
      ? "attention"
      : "ready";
  const score = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        (passPercent - warning * 1.5 - failed * 4 - missing * 4) * 100,
      ) / 100,
    ),
  );

  return {
    readiness,
    riskBand:
      readiness === "blocked"
        ? "high"
        : readiness === "attention"
          ? "medium"
          : "low",
    score,
    blockers,
    warnings,
    metrics: {
      requiredChecks: required,
      capabilityChecks: CRM_CORE_CAPABILITY_IDS.length,
      surfaceChecks: CRM_CORE_SURFACE_CHECKS.length,
      passedChecks: passed,
      warningChecks: warning,
      failedChecks: failed,
      missingChecks: missing,
      passPercent,
    },
  };
}

export function buildCrmCoreAcceptanceSummary(input = {}) {
  const health = input.health || evaluateCrmCoreAcceptance(input);
  const checks = Array.isArray(input.checks) ? input.checks : [];
  const snapshots = Array.isArray(input.snapshots) ? input.snapshots : [];
  return {
    readiness: health.readiness,
    riskBand: health.riskBand,
    score: health.score,
    totalChecks: checks.length,
    passedChecks: checks.filter((row) => string(row.status) === "passed")
      .length,
    warningChecks: checks.filter((row) => string(row.status) === "warning")
      .length,
    failedChecks: checks.filter((row) => string(row.status) === "failed")
      .length,
    snapshots: snapshots.length,
  };
}

export function crmCoreAcceptanceContext(session = {}) {
  return {
    organizationId: string(session.organizationId),
    userId: string(session.userId),
    activeCompanyId: session.activeCompanyId
      ? string(session.activeCompanyId)
      : null,
    activeBranchId: session.activeBranchId
      ? string(session.activeBranchId)
      : null,
    allowAllCompanies: Array.isArray(session.roleSlugs)
      ? session.roleSlugs.some((role) =>
          ["organization_owner", "system_administrator"].includes(role),
        )
      : false,
    permissions: Array.isArray(session.permissions) ? session.permissions : [],
    roleSlugs: Array.isArray(session.roleSlugs) ? session.roleSlugs : [],
  };
}

async function latestChecks(client, context) {
  const result = await client.query(
    `SELECT DISTINCT ON (check_key) *
     FROM tenant.crm_core_acceptance_runs
     WHERE organization_id=$1
     ORDER BY check_key,COALESCE(completed_at,started_at,created_at) DESC,created_at DESC`,
    [context.organizationId],
  );
  return result.rows;
}

async function recentSnapshots(client, context) {
  const result = await client.query(
    `SELECT * FROM tenant.crm_core_acceptance_snapshots
     WHERE organization_id=$1 ORDER BY captured_at DESC LIMIT 30`,
    [context.organizationId],
  );
  return result.rows;
}

export async function getCrmCoreAcceptanceDashboard(client, context) {
  requireViewPermission(context);
  // Sequential, not Promise.all — see opportunity-revenue-intelligence.js's
  // fix for why concurrent client.query() on one shared PoolClient is unsafe.
  const checks = await latestChecks(client, context);
  const snapshots = await recentSnapshots(client, context);
  const health = evaluateCrmCoreAcceptance({ checks });
  return {
    health,
    summary: buildCrmCoreAcceptanceSummary({ health, checks, snapshots }),
    checks,
    snapshots,
    capabilityIds: CRM_CORE_CAPABILITY_IDS,
    surfaceChecks: CRM_CORE_SURFACE_CHECKS,
    completionGate: {
      command: "pnpm verify:crm-01-complete",
      status: health.readiness === "ready" ? "passed" : "blocked",
      note: "CRM-01 covers the 17 core capabilities CRM-010 through CRM-026; provider-dependent CRM capabilities remain in later stages.",
    },
  };
}

export async function recordCrmCoreAcceptanceRun(client, context, input = {}) {
  requireManagePermission(context);
  const checkKey = string(input.checkKey ?? input.check_key);
  if (!CRM_CORE_CHECK_KEYS.includes(checkKey)) {
    throw new CrmCoreAcceptanceError(
      400,
      "CRM core acceptance check key is unsupported.",
    );
  }
  const status = string(input.status || "passed");
  if (!CHECK_STATUSES.has(status)) {
    throw new CrmCoreAcceptanceError(
      400,
      "CRM core acceptance status is invalid.",
    );
  }
  const source = string(input.source || "acceptance");
  if (!CHECK_SOURCES.has(source)) {
    throw new CrmCoreAcceptanceError(
      400,
      "CRM core acceptance source is invalid.",
    );
  }
  const environment = string(input.environment || "development");
  if (!ENVIRONMENTS.has(environment)) {
    throw new CrmCoreAcceptanceError(
      400,
      "CRM core acceptance environment is invalid.",
    );
  }
  const startedAt =
    dateTime(input.startedAt ?? input.started_at, "Started at") ||
    new Date().toISOString();
  const completedAt =
    status === "running"
      ? null
      : dateTime(input.completedAt ?? input.completed_at, "Completed at") ||
        new Date().toISOString();
  const evidence = object(input.evidence);
  const payload = {
    checkKey,
    status,
    source,
    environment,
    commitSha: string(input.commitSha ?? input.commit_sha) || null,
    startedAt,
    completedAt,
    evidence,
  };
  const result = await client.query(
    `INSERT INTO tenant.crm_core_acceptance_runs(
       organization_id,check_key,status,source,environment,commit_sha,started_at,completed_at,evidence,content_hash,recorded_by
     ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11) RETURNING *`,
    [
      context.organizationId,
      checkKey,
      status,
      source,
      environment,
      payload.commitSha,
      startedAt,
      completedAt,
      JSON.stringify(evidence),
      crmCoreContentHash(payload),
      context.userId,
    ],
  );
  return result.rows[0];
}

export async function captureCrmCoreAcceptanceSnapshot(
  client,
  context,
  input = {},
) {
  requireManagePermission(context);
  const dashboard = await getCrmCoreAcceptanceDashboard(client, context);
  const environment = string(input.environment || "development");
  if (!ENVIRONMENTS.has(environment)) {
    throw new CrmCoreAcceptanceError(
      400,
      "CRM core acceptance environment is invalid.",
    );
  }
  const commitSha = string(input.commitSha ?? input.commit_sha) || null;
  const evidence = object(input.evidence);
  const payload = {
    environment,
    commitSha,
    health: dashboard.health,
    checks: dashboard.checks.map((row) => ({
      checkKey: row.check_key,
      status: row.status,
      completedAt: row.completed_at,
      contentHash: row.content_hash,
    })),
    evidence,
  };
  const result = await client.query(
    `INSERT INTO tenant.crm_core_acceptance_snapshots(
       organization_id,environment,commit_sha,readiness_status,risk_band,acceptance_score,blockers,warnings,metrics,capability_results,evidence,content_hash,captured_by
     ) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb,$12,$13) RETURNING *`,
    [
      context.organizationId,
      environment,
      commitSha,
      dashboard.health.readiness,
      dashboard.health.riskBand,
      dashboard.health.score,
      JSON.stringify(dashboard.health.blockers),
      JSON.stringify(dashboard.health.warnings),
      JSON.stringify(dashboard.health.metrics),
      JSON.stringify(
        dashboard.checks
          .filter((row) => CRM_CORE_CAPABILITY_IDS.includes(row.check_key))
          .map((row) => ({
            checkKey: row.check_key,
            status: row.status,
            contentHash: row.content_hash,
          })),
      ),
      JSON.stringify(evidence),
      crmCoreContentHash(payload),
      context.userId,
    ],
  );
  return result.rows[0];
}

export async function getCrmCoreAcceptanceTimeline(client, context) {
  requireViewPermission(context);
  const result = await client.query(
    `SELECT 'check' AS entry_type,id,check_key AS title,status AS state,source AS category,
       completed_at AS occurred_at,evidence,content_hash
     FROM tenant.crm_core_acceptance_runs WHERE organization_id=$1
     UNION ALL
     SELECT 'snapshot' AS entry_type,id,'CRM core acceptance snapshot' AS title,
       readiness_status AS state,environment AS category,captured_at AS occurred_at,evidence,content_hash
     FROM tenant.crm_core_acceptance_snapshots WHERE organization_id=$1
     ORDER BY occurred_at DESC NULLS LAST LIMIT 200`,
    [context.organizationId],
  );
  return result.rows;
}
