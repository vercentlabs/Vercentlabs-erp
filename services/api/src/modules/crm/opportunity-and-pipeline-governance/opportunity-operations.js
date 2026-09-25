import { recordScope } from "../crm-data-operations-and-customization/record-policy.js";
import { queueOutboxEvent } from "../crm-data-operations-and-customization/outbox.js";
import { snapshotOpportunityBulkJobSelection } from "../crm-data-operations-and-customization/resource-query-service.js";
import { updateCrmRecord } from "../crm-data-operations-and-customization/resource-mutation-service.js";
import { createHash } from "node:crypto";
import {
  resources } from "../index.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;


export class OpportunityOperationsError extends Error {
  constructor(status, message, code = "CRM_OPPORTUNITY_OPERATIONS_ERROR") {
    super(message);
    this.name = "OpportunityOperationsError";
    this.status = status;
    this.code = code;
  }
}
const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const text = (value) => String(value ?? "").trim();
export function evaluateOpportunityHealth(row, now = new Date()) {
  const warnings = [];
  const amount = num(row.amount);
  const probability = num(row.probability);
  const close = row.expected_close_date
    ? new Date(row.expected_close_date)
    : null;
  const last = row.last_activity_at
    ? new Date(row.last_activity_at)
    : new Date(row.updated_at || row.created_at || now);
  const inactiveDays = Math.max(0, Math.floor((now - last) / 86400000));
  if (!text(row.next_step)) warnings.push("Next step is missing.");
  if (!close || Number.isNaN(close.getTime()))
    warnings.push("Expected close date is missing.");
  if (
    close &&
    close < now &&
    !["won", "lost", "archived"].includes(String(row.status))
  )
    warnings.push("Expected close date is overdue.");
  if (inactiveDays > 14) warnings.push("Opportunity has no recent activity.");
  if (amount <= 0)
    warnings.push("Opportunity amount must be greater than zero.");
  return {
    healthy: warnings.length === 0,
    warnings,
    inactiveDays,
    weightedAmount: Number.isFinite(Number(row.expected_revenue))
      ? Number(row.expected_revenue)
      : Math.round(amount * probability) / 100,
  };
}
export async function getOpportunityTimeline(client, context, opportunityId) {
  const parameters = [context.organizationId, opportunityId];
  const opportunity = await client.query(
    `SELECT record.id,record.name,record.amount,record.probability,record.expected_revenue,record.status,record.forecast_category,record.expected_close_date,record.next_step,record.updated_at FROM tenant.crm_opportunities record WHERE record.organization_id=$1 AND record.id=$2${recordScope(resources.opportunities, context, parameters)}`,
    parameters,
  );
  if (!opportunity.rows[0])
    throw new OpportunityOperationsError(
      404,
      "Opportunity not found.",
      "CRM_OPPORTUNITY_NOT_FOUND",
    );
  // Sequential, not Promise.all — see opportunity-revenue-intelligence.js's
  // fix for why concurrent client.query() on one shared PoolClient is unsafe.
  const stages = await client.query(
    `SELECT id,from_stage_id,to_stage_id,probability,note,changed_at FROM tenant.crm_opportunity_stage_history WHERE organization_id=$1 AND opportunity_id=$2 ORDER BY changed_at DESC LIMIT 100`,
    [context.organizationId, opportunityId],
  );
  const activities = await client.query(
    `SELECT id,activity_type,subject,status,due_at,completed_at,created_at FROM tenant.crm_activities WHERE organization_id=$1 AND entity_type='opportunity' AND entity_id=$2 ORDER BY created_at DESC LIMIT 100`,
    [context.organizationId, opportunityId],
  );
  const forecasts = await client.query(
    `SELECT id,forecast_category,probability,amount,expected_close_date,captured_at FROM tenant.crm_opportunity_forecast_snapshots WHERE organization_id=$1 AND opportunity_id=$2 ORDER BY captured_at DESC LIMIT 50`,
    [context.organizationId, opportunityId],
  );
  return {
    opportunity: opportunity.rows[0],
    health: evaluateOpportunityHealth(opportunity.rows[0]),
    stages: stages.rows,
    activities: activities.rows,
    forecasts: forecasts.rows,
  };
}
// F029 — bulk may change only what a single-record edit may change.
// forecastCategory is NOT here: the single-record policy (record-policy.js
// controlledFields) derives it from the stage and refuses a direct edit, so a
// bulk edit must not set it either.
export const OPPORTUNITY_BULK_FIELDS = new Map([
  ["ownerUserId", "owner_user_id"],
  ["expectedCloseDate", "expected_close_date"],
  ["nextStep", "next_step"],
]);

// Shared by both the synchronous (bulkUpdateOpportunities, <=200 records)
// and asynchronous (enqueueOpportunityBulkUpdateJob, worker-processed) bulk
// paths so a value the sync path rejects cannot silently succeed through the
// async one, or vice versa — F029-BR-001 "the same business rules" applies
// across both volumes, not just within one of them.
//
// Integrity closeout (Prompts 1-5): this whitelist restricted which
// *columns* could be touched, but never validated the *values* — a
// malformed forecastCategory would previously have bubbled up as a raw
// Postgres CHECK-constraint error instead of a clean validation error,
// ownerUserId was never confirmed to be an active org member (unlike the
// single-record updateCrmRecord path, which already does this via
// validateOrganizationUserReferences), and expectedCloseDate was never
// confirmed to be a real date.
export async function normalizeOpportunityBulkChanges(client, context, input) {
  const changes = input && typeof input === "object" ? { ...input } : {};
  const unsupported = Object.keys(changes).filter(
    (key) => !OPPORTUNITY_BULK_FIELDS.has(key),
  );
  if (unsupported.length)
    throw new OpportunityOperationsError(
      400,
      `Unsupported bulk Opportunity fields: ${unsupported.join(", ")}.`,
      "CRM_OPPORTUNITY_BULK_FIELD_UNSUPPORTED",
    );
  if (
    Object.prototype.hasOwnProperty.call(changes, "expectedCloseDate") &&
    changes.expectedCloseDate &&
    !Number.isFinite(new Date(String(changes.expectedCloseDate)).getTime())
  ) {
    throw new OpportunityOperationsError(
      400,
      "Enter a valid expected close date.",
      "CRM_OPPORTUNITY_BULK_CLOSE_DATE_INVALID",
    );
  }
  if (
    Object.prototype.hasOwnProperty.call(changes, "ownerUserId") &&
    changes.ownerUserId
  ) {
    const membership = await client.query(
      `SELECT user_id FROM public.organization_memberships
        WHERE organization_id = $1 AND user_id = $2 AND status = 'active'`,
      [context.organizationId, String(changes.ownerUserId)],
    );
    if (!membership.rows[0])
      throw new OpportunityOperationsError(
        409,
        "The new owner must be an active member of this organization.",
        "CRM_OPPORTUNITY_BULK_OWNER_INVALID",
      );
  }
  if (!Object.keys(changes).length)
    throw new OpportunityOperationsError(
      400,
      "No supported opportunity changes were supplied.",
      "CRM_OPPORTUNITY_BULK_CHANGES_EMPTY",
    );
  return changes;
}

function mapOpportunityBulkError(error) {
  const status = Number(error?.status || 500);
  const code = String(error?.code || "CRM_OPPORTUNITY_BULK_ITEM_FAILED");
  if (status === 409 && (code.includes("STALE") || code.includes("VERSION") || code.includes("CONFLICT")))
    return { status: "conflict", code, message: "Opportunity changed after selection. Refresh and retry this record." };
  if (status === 403 || status === 404)
    return { status: "skipped", code: "CRM_OPPORTUNITY_BULK_SCOPE_CHANGED", message: "Opportunity is no longer available in your permitted scope." };
  return { status: "failed", code, message: status >= 500 ? "Opportunity update failed and can be retried." : String(error?.message || "Opportunity update failed.") };
}

// F029 — the synchronous bulk edit applies each row through the SAME
// single-record command (updateCrmRecord: scope, field policy, closed-deal
// rules, optimistic concurrency, per-record before/after audit event) inside
// its own savepoint, and reports every row's outcome. It previously ran one
// mass UPDATE that bypassed those rules, silently dropped rows it could not
// touch, and wrote a single batch event. With `preview: true` every row runs
// the real rules and is then rolled back, so the preview shows exactly what
// would apply, conflict or be skipped — nothing is written.
export async function bulkUpdateOpportunities(client, context, input) {
  const ids = Array.isArray(input.ids)
    ? [...new Set(input.ids.map(String))]
    : [];
  if (!ids.length || ids.length > 200 || ids.some((id) => !UUID_PATTERN.test(id)))
    throw new OpportunityOperationsError(
      400,
      "Select between 1 and 200 opportunities.",
      "CRM_OPPORTUNITY_BULK_SELECTION_INVALID",
    );
  const changes = await normalizeOpportunityBulkChanges(
    client,
    context,
    input.changes,
  );
  const preview = input.preview === true;
  const expectedVersions = input.expectedVersions && typeof input.expectedVersions === "object" ? input.expectedVersions : {};
  const items = [];
  for (const id of ids.sort()) {
    await client.query("SAVEPOINT crm_opportunity_bulk_item");
    try {
      const before = (await client.query(
        `SELECT name, owner_user_id, expected_close_date, next_step FROM tenant.crm_opportunities WHERE organization_id=$1 AND id=$2`,
        [context.organizationId, id],
      )).rows[0];
      const row = await updateCrmRecord(client, context, "opportunities", id, changes, {
        expectedUpdatedAt: expectedVersions[id],
        requireVersion: Boolean(expectedVersions[id]),
      });
      await client.query(preview ? "ROLLBACK TO SAVEPOINT crm_opportunity_bulk_item" : "RELEASE SAVEPOINT crm_opportunity_bulk_item");
      if (preview) await client.query("RELEASE SAVEPOINT crm_opportunity_bulk_item");
      items.push({
        id,
        name: before?.name ?? null,
        status: preview ? "would_apply" : "applied",
        before: before ? { ownerUserId: before.owner_user_id, expectedCloseDate: before.expected_close_date, nextStep: before.next_step } : null,
        updatedAt: preview ? null : row.updatedAt,
      });
    } catch (error) {
      await client.query("ROLLBACK TO SAVEPOINT crm_opportunity_bulk_item");
      await client.query("RELEASE SAVEPOINT crm_opportunity_bulk_item");
      items.push({ id, ...mapOpportunityBulkError(error) });
    }
  }
  const counts = items.reduce(
    (result, item) => ({ ...result, [item.status]: (result[item.status] || 0) + 1 }),
    { applied: 0, would_apply: 0, conflict: 0, skipped: 0, failed: 0 },
  );
  if (!preview && counts.applied)
    await queueOutboxEvent(client, context, "crm.opportunities.bulk_updated", "opportunities", ids[0], {
      requestedIds: ids, changedFields: Object.keys(changes), updatedCount: counts.applied,
    });
  return { mode: "synchronous", preview, requested: ids.length, updated: counts.applied, ...counts, items };
}

// F029 (Bulk actions) — LAST PROMPT 1/3 closeout: async bulk-job path for
// Opportunities, mirroring Leads' enqueueLeadBulkUpdateJob/getLeadBulkJob/
// cancelLeadBulkJob/retryFailedLeadBulkJobItems/resolveLeadBulkExecutionContext
// (lead-operations.js) exactly, so a filter-snapshot selection larger than
// bulkUpdateOpportunities' synchronous 200-record cap has a real path instead
// of an outright rejection. Unlike the synchronous path (one mass UPDATE
// statement), the worker that processes this job (services/worker/src/
// handlers/crm-opportunity-bulk-update.js) applies each change through the
// generic single-record updateCrmRecord(..., "opportunities", ...) command —
// per F029-CAP-003 ("Bulk jobs invoke normal CRM domain commands per record"),
// this is the more literally compliant of the two paths, at the cost of being
// slower per record; both share the identical field/value validation via
// normalizeOpportunityBulkChanges above, so a value the sync path rejects
// cannot silently succeed through the async path or vice versa.
export const OPPORTUNITY_BULK_MAX_ITEMS = 50_000;
export const OPPORTUNITY_BULK_JOB_TYPE = "crm.opportunities.bulk_update";

function opportunityBulkCommandFingerprint(selection, changes) {
  const canonicalSelection =
    selection.type === "explicit"
      ? { type: "explicit", ids: [...selection.ids].sort() }
      : { type: "filter", filters: selection.filters };
  return createHash("sha256")
    .update(JSON.stringify({ selection: canonicalSelection, changes }))
    .digest("hex");
}

function opportunityBulkJobProjection(row) {
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    jobType: row.job_type,
    attempts: Number(row.attempts || 0),
    maxAttempts: Number(row.max_attempts || 0),
    progress: row.progress || {},
    resultManifest: row.result_manifest || {},
    lastError: row.status === "dead" ? String(row.last_error || "Bulk Opportunity job failed.") : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

function opportunityBulkJobOwnershipScope(context, values) {
  const canViewAll = context.roleSlugs?.includes("organization_owner") || context.permissions?.includes("crm.records.view_all");
  if (canViewAll) return "";
  values.push(context.userId);
  return ` AND requested_by=$${values.length}`;
}

export async function enqueueOpportunityBulkUpdateJob(client, context, input) {
  const changes = await normalizeOpportunityBulkChanges(client, context, input.changes);
  const idempotencyKey = text(input.idempotencyKey);
  if (!idempotencyKey || idempotencyKey.length < 16 || idempotencyKey.length > 200)
    throw new OpportunityOperationsError(
      400,
      "A stable idempotency key is required for a large Opportunity bulk operation.",
      "CRM_OPPORTUNITY_BULK_IDEMPOTENCY_REQUIRED",
    );

  let selection;
  if (input.selection?.type === "filter") {
    const filters = input.selection.filters && typeof input.selection.filters === "object" ? input.selection.filters : {};
    selection = { type: "filter", filters };
  } else {
    const ids = Array.isArray(input.selection?.ids ?? input.ids)
      ? [...new Set((input.selection?.ids ?? input.ids).map(String))]
      : [];
    if (!ids.length || ids.length > OPPORTUNITY_BULK_MAX_ITEMS || ids.some((id) => !UUID_PATTERN.test(id)))
      throw new OpportunityOperationsError(
        400,
        `Select between 1 and ${OPPORTUNITY_BULK_MAX_ITEMS} valid Opportunities.`,
        "CRM_OPPORTUNITY_BULK_SELECTION_INVALID",
      );
    selection = { type: "explicit", ids };
  }

  const commandFingerprint = opportunityBulkCommandFingerprint(selection, changes);
  const payload = {
    requesterUserId: context.userId,
    activeCompanyId: context.activeCompanyId || null,
    activeBranchId: context.activeBranchId || null,
    commandFingerprint,
    changes,
  };
  const inserted = await client.query(
    `INSERT INTO tenant.background_jobs
       (organization_id,job_type,payload,status,run_at,priority,max_attempts,idempotency_key,requested_by,progress,result_manifest)
     VALUES($1,$2,$3::jsonb,'pending',now(),50,5,$4,$5,'{}'::jsonb,'{}'::jsonb)
     ON CONFLICT (organization_id,idempotency_key) DO NOTHING
     RETURNING *`,
    [context.organizationId, OPPORTUNITY_BULK_JOB_TYPE, JSON.stringify(payload), idempotencyKey, context.userId],
  );
  let job = inserted.rows[0];
  if (!job) {
    const existing = await client.query(
      `SELECT * FROM tenant.background_jobs
        WHERE organization_id=$1 AND idempotency_key=$2 AND job_type=$3 AND requested_by=$4`,
      [context.organizationId, idempotencyKey, OPPORTUNITY_BULK_JOB_TYPE, context.userId],
    );
    if (!existing.rows[0] || existing.rows[0].payload?.commandFingerprint !== commandFingerprint)
      throw new OpportunityOperationsError(
        409,
        "That idempotency key belongs to a different Opportunity bulk command.",
        "CRM_OPPORTUNITY_BULK_IDEMPOTENCY_CONFLICT",
      );
    return { mode: "asynchronous", deduped: true, job: opportunityBulkJobProjection(existing.rows[0]) };
  }

  const snapshot = await snapshotOpportunityBulkJobSelection(client, context, job.id, selection, {
    maximum: OPPORTUNITY_BULK_MAX_ITEMS,
  });
  if (!snapshot.snapshotted) {
    await client.query(`DELETE FROM tenant.background_jobs WHERE organization_id=$1 AND id=$2`, [context.organizationId, job.id]);
    throw new OpportunityOperationsError(400, "No editable Opportunities matched this selection.", "CRM_OPPORTUNITY_BULK_SELECTION_EMPTY");
  }
  const manifest = {
    requested: snapshot.snapshotted,
    processed: 0,
    pending: snapshot.snapshotted,
    applied: 0,
    conflict: 0,
    skipped: 0,
    failed: 0,
    percent: 0,
  };
  const updated = await client.query(
    `UPDATE tenant.background_jobs
        SET progress=$3::jsonb,result_manifest=$3::jsonb,updated_at=now()
      WHERE organization_id=$1 AND id=$2
      RETURNING *`,
    [context.organizationId, job.id, JSON.stringify(manifest)],
  );
  job = updated.rows[0] || job;
  return { mode: "asynchronous", deduped: false, job: opportunityBulkJobProjection(job) };
}

export async function getOpportunityBulkJob(client, context, jobId = null) {
  const values = [context.organizationId, OPPORTUNITY_BULK_JOB_TYPE];
  let where = "organization_id=$1 AND job_type=$2";
  if (jobId) {
    if (!UUID_PATTERN.test(String(jobId)))
      throw new OpportunityOperationsError(400, "Invalid Opportunity bulk job identifier.", "CRM_OPPORTUNITY_BULK_JOB_INVALID");
    values.push(String(jobId));
    where += ` AND id=$${values.length}`;
  }
  const canViewAll = context.roleSlugs?.includes("organization_owner") || context.permissions?.includes("crm.records.view_all");
  if (!canViewAll) {
    values.push(context.userId);
    where += ` AND requested_by=$${values.length}`;
  }
  const result = await client.query(
    `SELECT * FROM tenant.background_jobs WHERE ${where} ORDER BY created_at DESC LIMIT ${jobId ? 1 : 10}`,
    values,
  );
  if (jobId && !result.rows[0])
    throw new OpportunityOperationsError(404, "Opportunity bulk job not found.", "CRM_OPPORTUNITY_BULK_JOB_NOT_FOUND");
  const jobs = result.rows.map(opportunityBulkJobProjection);
  if (!jobId) return { jobs };

  const errors = await client.query(
    `SELECT status,error_code,count(*)::int AS count,min(error_message) AS message
       FROM tenant.crm_opportunity_bulk_job_items
      WHERE organization_id=$1 AND job_id=$2 AND status IN ('conflict','skipped','failed')
      GROUP BY status,error_code
      ORDER BY count(*) DESC,status,error_code
      LIMIT 20`,
    [context.organizationId, jobId],
  );
  return { job: jobs[0], errors: errors.rows };
}

export async function cancelOpportunityBulkJob(client, context, jobId) {
  if (!UUID_PATTERN.test(String(jobId)))
    throw new OpportunityOperationsError(400, "Invalid Opportunity bulk job identifier.", "CRM_OPPORTUNITY_BULK_JOB_INVALID");
  const values = [context.organizationId, OPPORTUNITY_BULK_JOB_TYPE, jobId];
  const where = "organization_id=$1 AND job_type=$2 AND id=$3" + opportunityBulkJobOwnershipScope(context, values);
  const result = await client.query(
    `UPDATE tenant.background_jobs
        SET status='cancelled', updated_at=now(), locked_by=NULL, locked_at=NULL, lease_expires_at=NULL
      WHERE ${where} AND status IN ('pending','processing')
      RETURNING *`,
    values,
  );
  if (result.rows[0]) return opportunityBulkJobProjection(result.rows[0]);
  const existing = await client.query(`SELECT status FROM tenant.background_jobs WHERE ${where}`, values);
  if (!existing.rows[0])
    throw new OpportunityOperationsError(404, "Opportunity bulk job not found.", "CRM_OPPORTUNITY_BULK_JOB_NOT_FOUND");
  throw new OpportunityOperationsError(
    409,
    `This job is already ${existing.rows[0].status} and cannot be cancelled.`,
    "CRM_OPPORTUNITY_BULK_JOB_NOT_CANCELLABLE",
  );
}

export async function retryFailedOpportunityBulkJobItems(client, context, jobId) {
  if (!UUID_PATTERN.test(String(jobId)))
    throw new OpportunityOperationsError(400, "Invalid Opportunity bulk job identifier.", "CRM_OPPORTUNITY_BULK_JOB_INVALID");
  const values = [context.organizationId, OPPORTUNITY_BULK_JOB_TYPE, jobId];
  const where = "organization_id=$1 AND job_type=$2 AND id=$3" + opportunityBulkJobOwnershipScope(context, values);
  const jobResult = await client.query(`SELECT * FROM tenant.background_jobs WHERE ${where} FOR UPDATE`, values);
  const job = jobResult.rows[0];
  if (!job) throw new OpportunityOperationsError(404, "Opportunity bulk job not found.", "CRM_OPPORTUNITY_BULK_JOB_NOT_FOUND");
  if (!["completed", "dead"].includes(job.status))
    throw new OpportunityOperationsError(409, "Only a finished Opportunity bulk job can be retried.", "CRM_OPPORTUNITY_BULK_JOB_NOT_RETRYABLE");
  const reset = await client.query(
    `UPDATE tenant.crm_opportunity_bulk_job_items
        SET status='pending', error_code=NULL, error_message=NULL, processed_at=NULL
      WHERE organization_id=$1 AND job_id=$2 AND status='failed'
      RETURNING id`,
    [context.organizationId, jobId],
  );
  if (!reset.rows.length)
    throw new OpportunityOperationsError(400, "This job has no failed rows to retry.", "CRM_OPPORTUNITY_BULK_JOB_NO_FAILED_ITEMS");
  const updated = await client.query(
    `UPDATE tenant.background_jobs
        SET status='pending', run_at=now(), attempts=0, last_error=NULL, completed_at=NULL, updated_at=now()
      WHERE organization_id=$1 AND id=$2
      RETURNING *`,
    [context.organizationId, jobId],
  );
  return opportunityBulkJobProjection(updated.rows[0]);
}

// Mirrors resolveLeadBulkExecutionContext (lead-operations.js) exactly,
// substituting the Opportunity-manage permission — re-derives a fresh
// permission/scope context for the worker at execution time (not the
// snapshot taken when the job was enqueued), so a permission revoked between
// enqueue and processing is respected.
export async function resolveOpportunityBulkExecutionContext(client, organizationId, input) {
  const userId = text(input?.requesterUserId);
  if (!UUID_PATTERN.test(userId)) return null;
  const access = await client.query(
    `SELECT membership.user_id,
            COALESCE(array_agg(DISTINCT role.slug) FILTER (WHERE role.slug IS NOT NULL),ARRAY[]::text[]) AS role_slugs,
            COALESCE(array_agg(DISTINCT permission.permission_key) FILTER (WHERE permission.permission_key IS NOT NULL),ARRAY[]::text[]) AS permissions
       FROM public.organization_memberships membership
       JOIN public.users user_account ON user_account.id=membership.user_id AND user_account.status='active'
       LEFT JOIN public.user_role_assignments assignment
         ON assignment.organization_id=membership.organization_id AND assignment.user_id=membership.user_id
        AND assignment.status='active' AND assignment.starts_at<=now()
        AND (assignment.expires_at IS NULL OR assignment.expires_at>now())
       LEFT JOIN public.roles role
         ON role.organization_id=assignment.organization_id AND role.id=assignment.role_id AND role.status='active'
       LEFT JOIN public.role_permissions permission ON permission.role_id=role.id
      WHERE membership.organization_id=$1 AND membership.user_id=$2 AND membership.status='active'
      GROUP BY membership.user_id`,
    [organizationId, userId],
  );
  const row = access.rows[0];
  if (!row) return null;
  const roleSlugs = row.role_slugs || [];
  const permissions = row.permissions || [];
  const allowAllCompanies = roleSlugs.includes("organization_owner") || roleSlugs.includes("system_administrator");
  if (!allowAllCompanies && !permissions.includes("crm.opportunities.manage")) return null;

  const activeCompanyId = input.activeCompanyId || null;
  const activeBranchId = input.activeBranchId || null;
  if (activeCompanyId) {
    const company = await client.query(
      `SELECT company.id
         FROM public.companies company
        WHERE company.organization_id=$1 AND company.id=$2 AND company.status='active'
          AND ($3::boolean OR EXISTS(
            SELECT 1 FROM public.membership_company_access access
             WHERE access.organization_id=$1 AND access.user_id=$4 AND access.company_id=company.id
          ))`,
      [organizationId, activeCompanyId, allowAllCompanies, userId],
    );
    if (!company.rows[0]) return null;
  } else if (!allowAllCompanies) return null;
  if (activeBranchId) {
    const branch = await client.query(
      `SELECT branch.id
         FROM public.branches branch
        WHERE branch.organization_id=$1 AND branch.id=$2 AND branch.status='active'
          AND ($3::uuid IS NULL OR branch.company_id=$3)
          AND ($4::boolean OR EXISTS(
            SELECT 1 FROM public.membership_branch_access access
             WHERE access.organization_id=$1 AND access.user_id=$5 AND access.branch_id=branch.id
          ))`,
      [organizationId, activeBranchId, activeCompanyId, allowAllCompanies, userId],
    );
    if (!branch.rows[0]) return null;
  } else if (!allowAllCompanies) return null;

  return {
    organizationId,
    userId,
    activeCompanyId,
    activeBranchId,
    allowAllCompanies,
    permissions,
    roleSlugs,
  };
}

export async function captureForecastSnapshot(client, context, opportunityId) {
  const parameters = [context.organizationId, opportunityId, context.userId];
  const result = await client.query(
    `INSERT INTO tenant.crm_opportunity_forecast_snapshots (organization_id,opportunity_id,forecast_category,probability,amount,expected_close_date,captured_by) SELECT record.organization_id,record.id,record.forecast_category,record.probability,record.amount,record.expected_close_date,$3 FROM tenant.crm_opportunities record WHERE record.organization_id=$1 AND record.id=$2${recordScope(resources.opportunities, context, parameters)} RETURNING *`,
    parameters,
  );
  if (!result.rows[0])
    throw new OpportunityOperationsError(
      404,
      "Opportunity not found.",
      "CRM_OPPORTUNITY_NOT_FOUND",
    );
  return result.rows[0];
}
