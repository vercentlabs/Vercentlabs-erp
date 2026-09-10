import { updateCrmRecord } from "../crm-data-operations-and-customization/resource-mutation-service.js";
import { createHash } from "node:crypto";
import { resolveLeadOwner } from "./lead-governance.js";
import { snapshotLeadBulkJobSelection } from "../index.js";
import {
  LeadSourceError,
  validateLeadSourceAssignment,
} from "../prospect-and-relationship-master-data/lead-source-validation.js";

export class LeadOperationsError extends Error {
  constructor(
    status,
    message,
    code = "CRM_LEAD_OPERATIONS_ERROR",
    details = [],
  ) {
    super(message);
    this.name = "LeadOperationsError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
const text = (v) => String(v ?? "").trim();
const finite = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

function scopedLeadWhere(context, values, alias = "lead") {
  let sql = "";
  if (context.activeCompanyId) {
    values.push(context.activeCompanyId);
    sql += ` AND (${alias}.company_id IS NULL OR ${alias}.company_id=$${values.length})`;
  } else if (!context.allowAllCompanies) {
    sql += " AND false";
  }
  if (context.activeBranchId) {
    values.push(context.activeBranchId);
    sql += ` AND (${alias}.branch_id IS NULL OR ${alias}.branch_id=$${values.length})`;
  } else if (!context.allowAllCompanies) {
    sql += " AND false";
  }
  const viewAll =
    context.roleSlugs?.includes("organization_owner") ||
    context.permissions?.includes("crm.records.view_all");
  if (!viewAll) {
    values.push(context.userId);
    sql += ` AND (${alias}.owner_user_id IS NULL OR ${alias}.owner_user_id=$${values.length})`;
  }
  return sql;
}
export function evaluateLeadReadiness(lead, now = new Date(), options = {}) {
  const reasons = [];
  const scoringConfigured = options.scoringConfigured !== false;
  if (
    !text(lead.full_name || `${lead.first_name || ""} ${lead.last_name || ""}`)
  )
    reasons.push("Lead name is missing.");
  if (!text(lead.email) && !text(lead.mobile) && !text(lead.phone))
    reasons.push("At least one contact method is required.");
  const followUp = lead.next_follow_up_at
    ? new Date(lead.next_follow_up_at)
    : null;
  const overdue = Boolean(
    followUp && Number.isFinite(followUp.getTime()) && followUp < now,
  );
  return {
    ready: reasons.length === 0,
    reasons,
    overdue,
    score: finite(lead.score),
    scoringConfigured,
  };
}

export async function isLeadScoringConfigured(client, organizationId) {
  const result = await client.query(
    `SELECT EXISTS (
       SELECT 1
         FROM tenant.crm_scoring_rules
        WHERE organization_id=$1 AND status='active'
     ) AS configured`,
    [organizationId],
  );
  return Boolean(result.rows[0]?.configured);
}
export function buildLeadAgingBuckets(rows, now = new Date()) {
  const buckets = { fresh: 0, aging: 0, stale: 0, overdue: 0 };
  for (const row of rows) {
    const updated = new Date(row.updated_at || row.created_at || now);
    const days = Math.max(0, Math.floor((now - updated) / 86400000));
    if (row.next_follow_up_at && new Date(row.next_follow_up_at) < now)
      buckets.overdue += 1;
    else if (days <= 7) buckets.fresh += 1;
    else if (days <= 30) buckets.aging += 1;
    else buckets.stale += 1;
  }
  return buckets;
}
// F019 §31 closeout — the getLeadTimeline function that used to live here
// was removed: it was never exported from index.js (so no route could ever
// call it) and its "conversions" query selected from
// tenant.crm_lead_conversions, a table that does not exist in any
// migration — dead, broken, superseded code, not an active implementation.
// Lead's real timeline is served by getCrmTimelinePageBySource (the
// canonical Timeline domain module) and getLeadDetailData's own eager
// activities/communications/assignment/qualification/scoring queries.
export async function previewLeadAssignment(client, context, input) {
  const policies = await client.query(
    `SELECT id,name,sequence,criteria,mode,assignee_user_id,member_user_ids,territory_id
       FROM tenant.crm_lead_assignment_policies
      WHERE organization_id=$1 AND status='active' ORDER BY sequence,id`,
    [context.organizationId],
  );
  const criteriaMatches = (criteria) =>
    Object.entries(criteria || {}).every(([key, value]) =>
      Array.isArray(value)
        ? value.map(String).includes(String(input[key] ?? ""))
        : String(input[key] ?? "") === String(value),
    );
  const policy = policies.rows.find((item) => criteriaMatches(item.criteria));
  const ownerUserId = await resolveLeadOwner(client, context, input);
  return {
    matched: Boolean(policy),
    policy: policy || null,
    ownerUserId: ownerUserId || input.ownerUserId || null,
  };
}
export const LEAD_BULK_SYNC_LIMIT = 50;
export const LEAD_BULK_MAX_ITEMS = 50_000;
export const LEAD_BULK_JOB_TYPE = "crm.leads.bulk_update";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BULK_PRIORITY = new Set(["low", "medium", "high", "urgent"]);
const BULK_RATING = new Set(["cold", "warm", "hot"]);
const BULK_FOLLOWUP = new Set(["all", "none", "overdue", "today", "upcoming"]);
const BULK_QUALIFICATION = new Set(["all", "not_reviewed", "qualified", "unqualified"]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function leadBulkCommandFingerprint(selection, changes) {
  const canonicalSelection =
    selection.type === "explicit"
      ? { type: "explicit", ids: [...selection.ids].sort() }
      : { type: "filter", filters: selection.filters };
  return createHash("sha256")
    .update(JSON.stringify({ selection: canonicalSelection, changes }))
    .digest("hex");
}

function mapBulkError(error) {
  const status = Number(error?.status || 500);
  const code = String(error?.code || "CRM_LEAD_BULK_ITEM_FAILED");
  if (status === 409 && (code.includes("STALE") || code.includes("VERSION") || code.includes("CONFLICT")))
    return { status: "conflict", code, message: "Lead changed after selection. Refresh and retry this record." };
  if (status === 403 || status === 404)
    return { status: "skipped", code: "CRM_LEAD_BULK_SCOPE_CHANGED", message: "Lead is no longer available in your permitted scope." };
  return {
    status: "failed",
    code,
    message: status >= 500 ? "Lead update failed and can be retried." : String(error?.message || "Lead update failed."),
  };
}

export function normalizeLeadBulkChanges(input) {
  const changes = isPlainObject(input) ? { ...input } : {};
  if (
    Object.keys(changes).some((key) => key.startsWith("qualification")) ||
    ["qualified", "unqualified"].includes(String(changes.status || ""))
  )
    throw new LeadOperationsError(
      409,
      "Bulk Lead Qualification is not available. Use the governed per-Lead action.",
      "CRM_LEAD_QUALIFICATION_ACTION_REQUIRED",
    );
  if (
    ["status", "stage", "stageId", "stageCode", "recordStatus"].some(
      (field) => Object.prototype.hasOwnProperty.call(changes, field),
    )
  )
    throw new LeadOperationsError(
      409,
      "Bulk lifecycle movement is not available. Move each Lead through the governed transition action.",
      "CRM_LEAD_STAGE_ACTION_REQUIRED",
    );
  if (Object.prototype.hasOwnProperty.call(changes, "ownerUserId"))
    throw new LeadOperationsError(
      409,
      "Use the governed Lead assignment action to change ownership.",
      "CRM_LEAD_ASSIGNMENT_REQUIRED",
    );

  const allowed = new Set(["sourceId", "nextFollowUpAt", "priority", "rating"]);
  const unsupported = Object.keys(changes).filter((key) => !allowed.has(key));
  if (unsupported.length)
    throw new LeadOperationsError(
      400,
      `Unsupported bulk Lead fields: ${unsupported.join(", ")}.`,
      "CRM_LEAD_BULK_FIELD_UNSUPPORTED",
    );
  if (!Object.keys(changes).length)
    throw new LeadOperationsError(
      400,
      "No supported lead changes were supplied.",
      "CRM_LEAD_BULK_CHANGES_EMPTY",
    );
  if (Object.prototype.hasOwnProperty.call(changes, "priority")) {
    const value = text(changes.priority).toLowerCase();
    if (!BULK_PRIORITY.has(value))
      throw new LeadOperationsError(400, "Choose a valid Lead priority.", "CRM_LEAD_BULK_PRIORITY_INVALID");
    changes.priority = value;
  }
  if (Object.prototype.hasOwnProperty.call(changes, "rating")) {
    const value = text(changes.rating).toLowerCase();
    if (!BULK_RATING.has(value))
      throw new LeadOperationsError(400, "Choose a valid Lead rating.", "CRM_LEAD_BULK_RATING_INVALID");
    changes.rating = value;
  }
  if (Object.prototype.hasOwnProperty.call(changes, "sourceId")) {
    const value = text(changes.sourceId);
    if (value && !UUID_PATTERN.test(value))
      throw new LeadOperationsError(400, "Choose a valid Lead source.", "CRM_LEAD_BULK_SOURCE_INVALID");
    changes.sourceId = value || null;
  }
  if (Object.prototype.hasOwnProperty.call(changes, "nextFollowUpAt")) {
    const value = text(changes.nextFollowUpAt);
    if (value && !Number.isFinite(Date.parse(value)))
      throw new LeadOperationsError(400, "Choose a valid follow-up date and time.", "CRM_LEAD_BULK_FOLLOWUP_INVALID");
    changes.nextFollowUpAt = value || null;
  }
  return changes;
}

export function normalizeLeadBulkFilters(input = {}) {
  const value = isPlainObject(input) ? input : {};
  const status = text(value.status || "all").slice(0, 80) || "all";
  if (["archived", "converted"].includes(status))
    throw new LeadOperationsError(
      409,
      "Archived or converted Leads are read-only and cannot be bulk edited.",
      "CRM_LEAD_BULK_RECORD_CLOSED",
    );
  const ownerId = text(value.ownerId).slice(0, 80);
  const sourceId = text(value.sourceId).slice(0, 80);
  if (sourceId && !UUID_PATTERN.test(sourceId))
    throw new LeadOperationsError(400, "Choose a valid Lead source filter.", "CRM_LEAD_BULK_FILTER_INVALID");
  const priority = text(value.priority || "all").toLowerCase();
  const rating = text(value.rating || "all").toLowerCase();
  const followup = text(value.followup || "all").toLowerCase();
  const qualification = text(value.qualification || "all").toLowerCase();
  if (priority !== "all" && !BULK_PRIORITY.has(priority))
    throw new LeadOperationsError(400, "Invalid Lead priority filter.", "CRM_LEAD_BULK_FILTER_INVALID");
  if (rating !== "all" && !BULK_RATING.has(rating))
    throw new LeadOperationsError(400, "Invalid Lead rating filter.", "CRM_LEAD_BULK_FILTER_INVALID");
  if (!BULK_FOLLOWUP.has(followup) || !BULK_QUALIFICATION.has(qualification))
    throw new LeadOperationsError(400, "Invalid Lead bulk filter.", "CRM_LEAD_BULK_FILTER_INVALID");
  return {
    search: text(value.search).slice(0, 200),
    status,
    ownerId,
    sourceId,
    priority: priority || "all",
    rating: rating || "all",
    followup: followup || "all",
    qualification: qualification || "all",
  };
}

async function validateBulkSource(client, context, changes) {
  if (!Object.prototype.hasOwnProperty.call(changes, "sourceId") || !changes.sourceId) return;
  try {
    await validateLeadSourceAssignment(client, context, changes.sourceId);
  } catch (error) {
    if (error instanceof LeadSourceError)
      throw new LeadOperationsError(error.status, error.message, error.code, error.details);
    throw error;
  }
}

export async function bulkUpdateLeads(client, context, input) {
  const ids = Array.isArray(input.ids) ? [...new Set(input.ids.map(String))] : [];
  if (!ids.length || ids.length > LEAD_BULK_SYNC_LIMIT || ids.some((id) => !UUID_PATTERN.test(id)))
    throw new LeadOperationsError(
      400,
      `Select between 1 and ${LEAD_BULK_SYNC_LIMIT} valid Leads for a synchronous update. Larger selections are queued automatically.`,
      "CRM_LEAD_BULK_SELECTION_INVALID",
    );
  const changes = normalizeLeadBulkChanges(input.changes);
  await validateBulkSource(client, context, changes);
  const expectedVersions = isPlainObject(input.expectedVersions) ? input.expectedVersions : {};
  const items = [];

  for (const id of ids.sort()) {
    await client.query("SAVEPOINT crm_lead_bulk_item");
    try {
      const row = await updateCrmRecord(client, context, "leads", id, changes, {
        expectedUpdatedAt: expectedVersions[id],
        requireVersion: true,
      });
      await client.query("RELEASE SAVEPOINT crm_lead_bulk_item");
      items.push({ id, status: "applied", updatedAt: row.updatedAt });
    } catch (error) {
      await client.query("ROLLBACK TO SAVEPOINT crm_lead_bulk_item");
      await client.query("RELEASE SAVEPOINT crm_lead_bulk_item");
      items.push({ id, ...mapBulkError(error) });
    }
  }
  const counts = items.reduce(
    (result, item) => ({ ...result, [item.status]: (result[item.status] || 0) + 1 }),
    { applied: 0, conflict: 0, skipped: 0, failed: 0 },
  );
  return { mode: "synchronous", requested: ids.length, updated: counts.applied, ...counts, items };
}

function bulkJobProjection(row) {
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    jobType: row.job_type,
    attempts: Number(row.attempts || 0),
    maxAttempts: Number(row.max_attempts || 0),
    progress: row.progress || {},
    resultManifest: row.result_manifest || {},
    lastError: row.status === "dead" ? String(row.last_error || "Bulk Lead job failed.") : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

export async function enqueueLeadBulkUpdateJob(client, context, input) {
  const changes = normalizeLeadBulkChanges(input.changes);
  await validateBulkSource(client, context, changes);
  const idempotencyKey = text(input.idempotencyKey);
  if (!idempotencyKey || idempotencyKey.length < 16 || idempotencyKey.length > 200)
    throw new LeadOperationsError(
      400,
      "A stable idempotency key is required for a large Lead bulk operation.",
      "CRM_LEAD_BULK_IDEMPOTENCY_REQUIRED",
    );

  let selection;
  if (input.selection?.type === "filter") {
    selection = { type: "filter", filters: normalizeLeadBulkFilters(input.selection.filters) };
  } else {
    const ids = Array.isArray(input.selection?.ids ?? input.ids)
      ? [...new Set((input.selection?.ids ?? input.ids).map(String))]
      : [];
    if (!ids.length || ids.length > LEAD_BULK_MAX_ITEMS || ids.some((id) => !UUID_PATTERN.test(id)))
      throw new LeadOperationsError(
        400,
        `Select between 1 and ${LEAD_BULK_MAX_ITEMS} valid Leads.`,
        "CRM_LEAD_BULK_SELECTION_INVALID",
      );
    selection = { type: "explicit", ids };
  }

  const commandFingerprint = leadBulkCommandFingerprint(selection, changes);
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
    [context.organizationId, LEAD_BULK_JOB_TYPE, JSON.stringify(payload), idempotencyKey, context.userId],
  );
  let job = inserted.rows[0];
  if (!job) {
    const existing = await client.query(
      `SELECT * FROM tenant.background_jobs
        WHERE organization_id=$1 AND idempotency_key=$2 AND job_type=$3 AND requested_by=$4`,
      [context.organizationId, idempotencyKey, LEAD_BULK_JOB_TYPE, context.userId],
    );
    if (!existing.rows[0] || existing.rows[0].payload?.commandFingerprint !== commandFingerprint)
      throw new LeadOperationsError(
        409,
        "That idempotency key belongs to a different Lead bulk command.",
        "CRM_LEAD_BULK_IDEMPOTENCY_CONFLICT",
      );
    return { mode: "asynchronous", deduped: true, job: bulkJobProjection(existing.rows[0]) };
  }

  const snapshot = await snapshotLeadBulkJobSelection(client, context, job.id, selection, {
    maximum: LEAD_BULK_MAX_ITEMS,
  });
  if (!snapshot.snapshotted) {
    await client.query(`DELETE FROM tenant.background_jobs WHERE organization_id=$1 AND id=$2`, [context.organizationId, job.id]);
    throw new LeadOperationsError(400, "No editable Leads matched this selection.", "CRM_LEAD_BULK_SELECTION_EMPTY");
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
  return { mode: "asynchronous", deduped: false, job: bulkJobProjection(job) };
}

export async function getLeadBulkJob(client, context, jobId = null) {
  const values = [context.organizationId, LEAD_BULK_JOB_TYPE];
  let where = "organization_id=$1 AND job_type=$2";
  if (jobId) {
    if (!UUID_PATTERN.test(String(jobId)))
      throw new LeadOperationsError(400, "Invalid Lead bulk job identifier.", "CRM_LEAD_BULK_JOB_INVALID");
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
    throw new LeadOperationsError(404, "Lead bulk job not found.", "CRM_LEAD_BULK_JOB_NOT_FOUND");
  const jobs = result.rows.map(bulkJobProjection);
  if (!jobId) return { jobs };

  const errors = await client.query(
    `SELECT status,error_code,count(*)::int AS count,min(error_message) AS message
       FROM tenant.crm_lead_bulk_job_items
      WHERE organization_id=$1 AND job_id=$2 AND status IN ('conflict','skipped','failed')
      GROUP BY status,error_code
      ORDER BY count(*) DESC,status,error_code
      LIMIT 20`,
    [context.organizationId, jobId],
  );
  return { job: jobs[0], errors: errors.rows };
}

function bulkJobOwnershipScope(context, values) {
  const canViewAll = context.roleSlugs?.includes("organization_owner") || context.permissions?.includes("crm.records.view_all");
  if (canViewAll) return "";
  values.push(context.userId);
  return ` AND requested_by=$${values.length}`;
}

export async function cancelLeadBulkJob(client, context, jobId) {
  if (!UUID_PATTERN.test(String(jobId)))
    throw new LeadOperationsError(400, "Invalid Lead bulk job identifier.", "CRM_LEAD_BULK_JOB_INVALID");
  const values = [context.organizationId, LEAD_BULK_JOB_TYPE, jobId];
  const where = "organization_id=$1 AND job_type=$2 AND id=$3" + bulkJobOwnershipScope(context, values);
  const result = await client.query(
    `UPDATE tenant.background_jobs
        SET status='cancelled', updated_at=now(), locked_by=NULL, locked_at=NULL, lease_expires_at=NULL
      WHERE ${where} AND status IN ('pending','processing')
      RETURNING *`,
    values,
  );
  if (result.rows[0]) return bulkJobProjection(result.rows[0]);
  // Distinguish "not found/not yours" from "already terminal" for a clearer error.
  const existing = await client.query(`SELECT status FROM tenant.background_jobs WHERE ${where}`, values);
  if (!existing.rows[0])
    throw new LeadOperationsError(404, "Lead bulk job not found.", "CRM_LEAD_BULK_JOB_NOT_FOUND");
  throw new LeadOperationsError(
    409,
    `This job is already ${existing.rows[0].status} and cannot be cancelled.`,
    "CRM_LEAD_BULK_JOB_NOT_CANCELLABLE",
  );
}

export async function retryFailedLeadBulkJobItems(client, context, jobId) {
  if (!UUID_PATTERN.test(String(jobId)))
    throw new LeadOperationsError(400, "Invalid Lead bulk job identifier.", "CRM_LEAD_BULK_JOB_INVALID");
  const values = [context.organizationId, LEAD_BULK_JOB_TYPE, jobId];
  const where = "organization_id=$1 AND job_type=$2 AND id=$3" + bulkJobOwnershipScope(context, values);
  const jobResult = await client.query(`SELECT * FROM tenant.background_jobs WHERE ${where} FOR UPDATE`, values);
  const job = jobResult.rows[0];
  if (!job) throw new LeadOperationsError(404, "Lead bulk job not found.", "CRM_LEAD_BULK_JOB_NOT_FOUND");
  if (!["completed", "dead"].includes(job.status))
    throw new LeadOperationsError(409, "Only a finished Lead bulk job can be retried.", "CRM_LEAD_BULK_JOB_NOT_RETRYABLE");
  const reset = await client.query(
    `UPDATE tenant.crm_lead_bulk_job_items
        SET status='pending', error_code=NULL, error_message=NULL, processed_at=NULL
      WHERE organization_id=$1 AND job_id=$2 AND status='failed'
      RETURNING id`,
    [context.organizationId, jobId],
  );
  if (!reset.rows.length)
    throw new LeadOperationsError(400, "This job has no failed rows to retry.", "CRM_LEAD_BULK_JOB_NO_FAILED_ITEMS");
  const updated = await client.query(
    `UPDATE tenant.background_jobs
        SET status='pending', run_at=now(), attempts=0, last_error=NULL, completed_at=NULL, updated_at=now()
      WHERE organization_id=$1 AND id=$2
      RETURNING *`,
    [context.organizationId, jobId],
  );
  return bulkJobProjection(updated.rows[0]);
}

export async function resolveLeadBulkExecutionContext(client, organizationId, input) {
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
  if (!allowAllCompanies && !permissions.includes("crm.leads.manage")) return null;

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

export async function getLeadOperationsDashboard(client, context) {
  const values = [context.organizationId];
  const scope = scopedLeadWhere(context, values);
  const result = await client.query(
    `SELECT
       count(*)::int AS total,
       count(*) FILTER (
         WHERE btrim(COALESCE(NULLIF(lead.full_name,''), concat_ws(' ',lead.first_name,lead.last_name))) <> ''
           AND (NULLIF(btrim(COALESCE(lead.email,'')),'') IS NOT NULL
             OR NULLIF(btrim(COALESCE(lead.mobile,'')),'') IS NOT NULL
             OR NULLIF(btrim(COALESCE(lead.phone,'')),'') IS NOT NULL)
       )::int AS ready,
       count(*) FILTER (WHERE lead.next_follow_up_at < now())::int AS overdue,
       count(*) FILTER (
         WHERE NOT (lead.next_follow_up_at < now())
           AND COALESCE(lead.updated_at,lead.created_at) >= now() - interval '8 days'
       )::int AS fresh,
       count(*) FILTER (
         WHERE NOT (lead.next_follow_up_at < now())
           AND COALESCE(lead.updated_at,lead.created_at) < now() - interval '8 days'
           AND COALESCE(lead.updated_at,lead.created_at) >= now() - interval '31 days'
       )::int AS aging,
       count(*) FILTER (
         WHERE NOT (lead.next_follow_up_at < now())
           AND COALESCE(lead.updated_at,lead.created_at) < now() - interval '31 days'
       )::int AS stale
     FROM tenant.crm_leads lead
    WHERE lead.organization_id=$1 AND lead.record_status='active'${scope}`,
    values,
  );
  const row = result.rows[0] || {};
  return {
    total: Number(row.total || 0),
    ready: Number(row.ready || 0),
    overdue: Number(row.overdue || 0),
    aging: {
      fresh: Number(row.fresh || 0),
      aging: Number(row.aging || 0),
      stale: Number(row.stale || 0),
      overdue: Number(row.overdue || 0),
    },
  };
}
