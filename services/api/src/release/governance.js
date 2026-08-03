import { createHash } from "node:crypto";

export class ReleaseGovernanceError extends Error {
  constructor(status, message, code = "RELEASE_GOVERNANCE_ERROR") {
    super(message);
    this.name = "ReleaseGovernanceError";
    this.status = status;
    this.code = code;
  }
}

export const RELEASE_CHECK_KEYS = Object.freeze([
  "unit_tests",
  "lint",
  "typecheck",
  "control_database",
  "tenant_database",
  "crm_live",
  "sales_live",
  "accounting_live",
  "procurement_live",
  "security",
  "backup",
  "restore",
  "deployment_smoke",
  "mobile",
]);

const CHECK_STATUSES = new Set([
  "running",
  "passed",
  "warning",
  "failed",
  "skipped",
]);
const CHECK_SOURCES = new Set(["local", "ci", "deployment", "manual"]);
const ENVIRONMENTS = new Set(["development", "staging", "production"]);
const INCIDENT_STATUSES = new Set([
  "open",
  "investigating",
  "monitoring",
  "resolved",
  "closed",
]);
const INCIDENT_SEVERITIES = new Set(["low", "medium", "high", "critical"]);
const string = (value) => String(value ?? "").trim();
const number = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
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

export function releaseContentHash(value) {
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
    ![
      "organization.manage",
      "audit.view",
      "modules.manage",
      "accounting.audit.view",
    ].some((permission) => hasPermission(context, permission))
  ) {
    throw new ReleaseGovernanceError(
      403,
      "You do not have permission to view enterprise release governance.",
      "RELEASE_GOVERNANCE_PERMISSION_DENIED",
    );
  }
}

function requireManagePermission(context) {
  if (!hasPermission(context, "organization.manage")) {
    throw new ReleaseGovernanceError(
      403,
      "Organisation management permission is required to change release evidence.",
      "RELEASE_GOVERNANCE_MANAGE_PERMISSION_DENIED",
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
    throw new ReleaseGovernanceError(400, `${label} is invalid.`);
  }
  return normalized;
}

function dateTime(value, label, optional = true) {
  if (value === undefined || value === null || value === "") {
    if (optional) return null;
    throw new ReleaseGovernanceError(400, `${label} is required.`);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new ReleaseGovernanceError(400, `${label} is invalid.`);
  }
  return parsed.toISOString();
}

function defaultPolicy(policy = {}) {
  const configured =
    policy.required_check_keys ??
    policy.requiredCheckKeys ??
    RELEASE_CHECK_KEYS;
  const requiredCheckKeys = Array.isArray(configured)
    ? [
        ...new Set(
          configured
            .map(string)
            .filter((key) => RELEASE_CHECK_KEYS.includes(key)),
        ),
      ]
    : [...RELEASE_CHECK_KEYS];
  return {
    requiredCheckKeys: requiredCheckKeys.length
      ? requiredCheckKeys
      : [...RELEASE_CHECK_KEYS],
    minimumPassPercent: Math.min(
      100,
      Math.max(
        1,
        number(policy.minimum_pass_percent ?? policy.minimumPassPercent ?? 100),
      ),
    ),
    backupMaximumAgeHours: Math.max(
      1,
      number(
        policy.backup_maximum_age_hours ?? policy.backupMaximumAgeHours ?? 24,
      ),
    ),
    maximumOpenCriticalIncidents: Math.max(
      0,
      number(
        policy.maximum_open_critical_incidents ??
          policy.maximumOpenCriticalIncidents ??
          0,
      ),
    ),
    maximumOpenHighIncidents: Math.max(
      0,
      number(
        policy.maximum_open_high_incidents ??
          policy.maximumOpenHighIncidents ??
          0,
      ),
    ),
    requireRestoreEvidence:
      policy.require_restore_evidence ?? policy.requireRestoreEvidence ?? true,
    requireDeploymentSmoke:
      policy.require_deployment_smoke ?? policy.requireDeploymentSmoke ?? true,
    requireRestrictedRuntimeRole:
      policy.require_restricted_runtime_role ??
      policy.requireRestrictedRuntimeRole ??
      true,
  };
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

function openIncidentCounts(incidents) {
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const incident of Array.isArray(incidents) ? incidents : []) {
    const status = string(incident.status);
    if (["resolved", "closed"].includes(status)) continue;
    const severity = string(incident.severity);
    if (severity in counts) counts[severity] += 1;
  }
  return counts;
}

export function evaluateReleaseReadiness(
  input = {},
  policyInput = {},
  now = new Date(),
) {
  const policy = defaultPolicy(policyInput);
  const checks = latestByKey(input.checks);
  const blockers = [];
  const warnings = [];
  let passed = 0;
  let warning = 0;
  let failed = 0;
  let missing = 0;

  for (const key of policy.requiredCheckKeys) {
    if (key === "deployment_smoke" && !policy.requireDeploymentSmoke) continue;
    if (key === "restore" && !policy.requireRestoreEvidence) continue;
    const check = checks.get(key);
    const status = string(check?.status);
    if (!check) {
      missing += 1;
      blockers.push(`Required release check is missing: ${key}.`);
      continue;
    }
    if (status === "passed") {
      passed += 1;
    } else if (status === "warning") {
      warning += 1;
      warnings.push(`Release check needs review: ${key}.`);
    } else {
      failed += 1;
      blockers.push(
        `Release check did not pass: ${key} (${status || "unknown"}).`,
      );
    }
  }

  const denominator = Math.max(
    1,
    policy.requiredCheckKeys.filter(
      (key) =>
        (key !== "deployment_smoke" || policy.requireDeploymentSmoke) &&
        (key !== "restore" || policy.requireRestoreEvidence),
    ).length,
  );
  const passPercent = Math.round((passed / denominator) * 10000) / 100;
  if (passPercent < policy.minimumPassPercent) {
    blockers.push(
      `Release check pass rate ${passPercent}% is below the required ${policy.minimumPassPercent}%.`,
    );
  }

  const backup = checks.get("backup");
  const backupCompletedAt = backup?.completed_at ?? backup?.completedAt;
  let backupAgeHours = null;
  if (backupCompletedAt) {
    const completed = new Date(backupCompletedAt);
    if (!Number.isNaN(completed.getTime())) {
      backupAgeHours = Math.max(
        0,
        Math.round(((now.getTime() - completed.getTime()) / 3_600_000) * 100) /
          100,
      );
      if (backupAgeHours > policy.backupMaximumAgeHours) {
        blockers.push(
          `Latest verified backup is ${backupAgeHours} hours old; maximum is ${policy.backupMaximumAgeHours}.`,
        );
      }
    }
  }

  const incidents = openIncidentCounts(input.incidents);
  if (incidents.critical > policy.maximumOpenCriticalIncidents) {
    blockers.push(
      `${incidents.critical} open critical incident(s) exceed the permitted ${policy.maximumOpenCriticalIncidents}.`,
    );
  }
  if (incidents.high > policy.maximumOpenHighIncidents) {
    blockers.push(
      `${incidents.high} open high-severity incident(s) exceed the permitted ${policy.maximumOpenHighIncidents}.`,
    );
  }
  if (incidents.medium > 0) {
    warnings.push(
      `${incidents.medium} open medium-severity incident(s) require review.`,
    );
  }

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
        (passPercent -
          incidents.critical * 25 -
          incidents.high * 15 -
          incidents.medium * 5) *
          100,
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
      requiredChecks: denominator,
      passedChecks: passed,
      warningChecks: warning,
      failedChecks: failed,
      missingChecks: missing,
      passPercent,
      backupAgeHours,
      openCriticalIncidents: incidents.critical,
      openHighIncidents: incidents.high,
      openMediumIncidents: incidents.medium,
      openLowIncidents: incidents.low,
    },
  };
}

export function buildReleaseGovernanceSummary(input = {}) {
  const health = input.health || evaluateReleaseReadiness(input, input.policy);
  const checks = Array.isArray(input.checks) ? input.checks : [];
  const incidents = Array.isArray(input.incidents) ? input.incidents : [];
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
    openIncidents: incidents.filter(
      (row) => !["resolved", "closed"].includes(string(row.status)),
    ).length,
    snapshots: snapshots.length,
  };
}

export function releaseContext(session = {}) {
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

async function getPolicy(client, context) {
  const result = await client.query(
    `SELECT * FROM tenant.release_governance_policies WHERE organization_id=$1`,
    [context.organizationId],
  );
  return result.rows[0] || {};
}

async function latestChecks(client, context) {
  const result = await client.query(
    `SELECT DISTINCT ON (check_key) *
     FROM tenant.release_governance_check_runs
     WHERE organization_id=$1
     ORDER BY check_key,COALESCE(completed_at,started_at,created_at) DESC,created_at DESC`,
    [context.organizationId],
  );
  return result.rows;
}

async function openIncidents(client, context) {
  const result = await client.query(
    `SELECT incident.*,owner.full_name AS owner_name
     FROM tenant.release_governance_incident_cases incident
     LEFT JOIN public.users owner ON owner.id=incident.owner_user_id
     WHERE incident.organization_id=$1 AND incident.status NOT IN ('resolved','closed')
     ORDER BY CASE incident.severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
       incident.next_action_at NULLS LAST,incident.detected_at DESC
     LIMIT 100`,
    [context.organizationId],
  );
  return result.rows;
}

async function recentSnapshots(client, context) {
  const result = await client.query(
    `SELECT * FROM tenant.release_governance_snapshots
     WHERE organization_id=$1 ORDER BY captured_at DESC LIMIT 30`,
    [context.organizationId],
  );
  return result.rows;
}

export async function getReleaseGovernanceDashboard(client, context) {
  requireViewPermission(context);
  const [policyRow, checks, incidents, snapshots] = await Promise.all([
    getPolicy(client, context),
    latestChecks(client, context),
    openIncidents(client, context),
    recentSnapshots(client, context),
  ]);
  const policy = defaultPolicy(policyRow);
  const health = evaluateReleaseReadiness({ checks, incidents }, policy);
  return {
    policy,
    health,
    summary: buildReleaseGovernanceSummary({
      health,
      checks,
      incidents,
      snapshots,
    }),
    checks,
    incidents,
    snapshots,
    benchmarkGate: {
      command: "pnpm verify:419-complete",
      status: "separate",
      note: "Stage 11 release governance does not mark unsupported benchmark capabilities as complete.",
    },
  };
}

export async function recordReleaseCheckRun(client, context, input = {}) {
  requireManagePermission(context);
  const checkKey = string(input.checkKey ?? input.check_key);
  if (!RELEASE_CHECK_KEYS.includes(checkKey)) {
    throw new ReleaseGovernanceError(400, "Release check key is unsupported.");
  }
  const status = string(input.status || "passed");
  if (!CHECK_STATUSES.has(status)) {
    throw new ReleaseGovernanceError(400, "Release check status is invalid.");
  }
  const source = string(input.source || "manual");
  if (!CHECK_SOURCES.has(source)) {
    throw new ReleaseGovernanceError(400, "Release check source is invalid.");
  }
  const environment = string(input.environment || "development");
  if (!ENVIRONMENTS.has(environment)) {
    throw new ReleaseGovernanceError(400, "Release environment is invalid.");
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
    `INSERT INTO tenant.release_governance_check_runs(
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
      releaseContentHash(payload),
      context.userId,
    ],
  );
  return result.rows[0];
}

export async function captureReleaseReadinessSnapshot(
  client,
  context,
  input = {},
) {
  requireManagePermission(context);
  const dashboard = await getReleaseGovernanceDashboard(client, context);
  const environment = string(input.environment || "development");
  if (!ENVIRONMENTS.has(environment)) {
    throw new ReleaseGovernanceError(400, "Release environment is invalid.");
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
    incidents: dashboard.incidents.map((row) => ({
      id: row.id,
      severity: row.severity,
      status: row.status,
    })),
    evidence,
  };
  const result = await client.query(
    `INSERT INTO tenant.release_governance_snapshots(
       organization_id,environment,commit_sha,readiness_status,risk_band,release_score,blockers,warnings,metrics,evidence,content_hash,captured_by
     ) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb,$11,$12) RETURNING *`,
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
      JSON.stringify(evidence),
      releaseContentHash(payload),
      context.userId,
    ],
  );
  return result.rows[0];
}

export async function upsertReleaseIncidentCase(client, context, input = {}) {
  requireManagePermission(context);
  const id = input.id ? uuid(input.id, "Release incident") : null;
  const severity = string(input.severity || "medium");
  const status = string(input.status || "open");
  if (!INCIDENT_SEVERITIES.has(severity)) {
    throw new ReleaseGovernanceError(400, "Incident severity is invalid.");
  }
  if (!INCIDENT_STATUSES.has(status)) {
    throw new ReleaseGovernanceError(400, "Incident status is invalid.");
  }
  const service = string(input.service || "platform").slice(0, 100);
  const title = string(input.title).slice(0, 240);
  if (!title)
    throw new ReleaseGovernanceError(400, "Incident title is required.");
  const details = string(input.details).slice(0, 4000) || null;
  const ownerUserId = input.ownerUserId
    ? uuid(input.ownerUserId, "Incident owner")
    : null;
  const nextActionAt = dateTime(input.nextActionAt, "Next action at");
  const resolvedAt = ["resolved", "closed"].includes(status)
    ? new Date().toISOString()
    : null;

  if (id) {
    const updated = await client.query(
      `UPDATE tenant.release_governance_incident_cases SET
       service=$3,severity=$4,status=$5,title=$6,details=$7,owner_user_id=$8,next_action_at=$9,
       updated_by=$2,updated_at=now(),resolved_at=CASE WHEN $5 IN ('resolved','closed') THEN COALESCE(resolved_at,$10) ELSE NULL END
       WHERE organization_id=$1 AND id=$11 RETURNING *`,
      [
        context.organizationId,
        context.userId,
        service,
        severity,
        status,
        title,
        details,
        ownerUserId,
        nextActionAt,
        resolvedAt,
        id,
      ],
    );
    if (!updated.rows[0]) {
      throw new ReleaseGovernanceError(404, "Release incident was not found.");
    }
    return updated.rows[0];
  }

  const created = await client.query(
    `INSERT INTO tenant.release_governance_incident_cases(
      organization_id,service,severity,status,title,details,owner_user_id,next_action_at,created_by,updated_by,resolved_at
    ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$10) RETURNING *`,
    [
      context.organizationId,
      service,
      severity,
      status,
      title,
      details,
      ownerUserId,
      nextActionAt,
      context.userId,
      resolvedAt,
    ],
  );
  return created.rows[0];
}

export async function getReleaseGovernanceTimeline(client, context) {
  requireViewPermission(context);
  const result = await client.query(
    `SELECT * FROM (
       SELECT id,'check'::text AS entry_type,check_key AS title,status AS state,completed_at AS occurred_at,
         jsonb_build_object('source',source,'environment',environment,'commitSha',commit_sha,'evidence',evidence,'contentHash',content_hash) AS details
       FROM tenant.release_governance_check_runs WHERE organization_id=$1
       UNION ALL
       SELECT id,'incident'::text AS entry_type,title,status AS state,detected_at AS occurred_at,
         jsonb_build_object('service',service,'severity',severity,'ownerUserId',owner_user_id,'nextActionAt',next_action_at,'details',details) AS details
       FROM tenant.release_governance_incident_cases WHERE organization_id=$1
       UNION ALL
       SELECT id,'snapshot'::text AS entry_type,environment AS title,readiness_status AS state,captured_at AS occurred_at,
         jsonb_build_object('riskBand',risk_band,'score',release_score,'commitSha',commit_sha,'contentHash',content_hash) AS details
       FROM tenant.release_governance_snapshots WHERE organization_id=$1
     ) timeline ORDER BY occurred_at DESC NULLS LAST LIMIT 200`,
    [context.organizationId],
  );
  return result.rows;
}
