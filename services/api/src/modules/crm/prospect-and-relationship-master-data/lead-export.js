import { rowsToCsv } from "@vercentlabs/reporting-engine";
import { CrmError } from "../crm-data-operations-and-customization/errors.js";
import { listCrmRecords } from "../crm-data-operations-and-customization/resource-query-service.js";

// F021 Stage A2 §9. Async, job-based Lead export — the "DEFINITELY
// REQUIRED" async/job/manifest/download-authorization architecture the
// interactive CSV download (CrmImportExportScreen.tsx's handleExport)
// never had. Reuses tenant.background_jobs, the same generic durable
// queue crm.leads.bulk_update already uses (lead-operations.js) — not a
// second job system. Reuses listCrmRecords("leads", filters) verbatim
// for row generation, the exact same governed/scoped read the Leads list
// UI itself calls, so CAP-003's "identical row/field scope" is true by
// construction, not by parallel re-implementation.
export const LEAD_EXPORT_JOB_TYPE = "crm.leads.export";
const EXPORT_ROW_CAP = 10_000;
const EXPORT_PAGE_SIZE = 500;
const EXPORT_TTL_HOURS = 24;

export const LEAD_EXPORT_COLUMNS = Object.freeze([
  { key: "code", label: "Code" },
  { key: "firstName", label: "First name" },
  { key: "lastName", label: "Last name" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "mobile", label: "Mobile" },
  { key: "companyName", label: "Company" },
  { key: "status", label: "Status" },
  { key: "priority", label: "Priority" },
  { key: "rating", label: "Rating" },
  { key: "ownerName", label: "Owner" },
  { key: "estimatedValue", label: "Estimated value" },
  { key: "currencyCode", label: "Currency" },
  { key: "city", label: "City" },
  { key: "state", label: "State" },
  { key: "countryCode", label: "Country" },
  { key: "createdAt", label: "Created at" },
]);

const FILTER_KEYS = ["status", "search", "ownerId", "priority", "rating", "qualification", "followup", "due"];

function sanitizeFilters(input = {}) {
  const filters = {};
  for (const key of FILTER_KEYS) if (input[key]) filters[key] = String(input[key]);
  return filters;
}

export async function enqueueCrmLeadExportJob(client, context, input = {}) {
  const filters = sanitizeFilters(input.filters);
  const payload = {
    requesterUserId: context.userId,
    activeCompanyId: context.activeCompanyId || null,
    activeBranchId: context.activeBranchId || null,
    allowAllCompanies: Boolean(context.allowAllCompanies),
    filters,
  };
  const inserted = await client.query(
    `INSERT INTO tenant.background_jobs
       (organization_id,job_type,payload,status,run_at,priority,max_attempts,requested_by,progress,result_manifest)
     VALUES($1,$2,$3::jsonb,'pending',now(),50,3,$4,'{}'::jsonb,'{}'::jsonb)
     RETURNING *`,
    [context.organizationId, LEAD_EXPORT_JOB_TYPE, JSON.stringify(payload), context.userId],
  );
  return inserted.rows[0];
}

export async function getCrmLeadExportJob(client, context, jobId) {
  const result = await client.query(
    `SELECT * FROM tenant.background_jobs WHERE organization_id=$1 AND id=$2 AND job_type=$3`,
    [context.organizationId, jobId, LEAD_EXPORT_JOB_TYPE],
  );
  const job = result.rows[0];
  if (!job) throw new CrmError(404, "Export job not found.");
  // Download authorization: the requester, or an org-wide view-all holder
  // (matching the same "mine means mine unless view_all" rule the rest of
  // this module already enforces), never anyone else in the organization.
  const canViewAll = (context.roleSlugs || []).includes("organization_owner") ||
    (context.permissions || []).includes("crm.records.view_all");
  if (job.requested_by !== context.userId && !canViewAll)
    throw new CrmError(403, "You do not have access to this export.", "CRM_LEAD_EXPORT_FORBIDDEN");
  return job;
}

// Called by the worker (services/worker/src/handlers/crm-lead-export.js)
// once it has re-resolved a fresh, currently-valid execution context —
// never trusting the permissions the requester happened to have at
// enqueue time, since a job may run well after that.
export async function buildCrmLeadExportCsv(client, context, filters) {
  const rows = [];
  let offset = 0;
  for (;;) {
    const page = await listCrmRecords(client, context, "leads", { ...filters, limit: EXPORT_PAGE_SIZE, offset });
    rows.push(...page.rows);
    offset += EXPORT_PAGE_SIZE;
    if (page.rows.length < EXPORT_PAGE_SIZE || rows.length >= EXPORT_ROW_CAP || offset >= page.total) break;
  }
  const bounded = rows.slice(0, EXPORT_ROW_CAP);
  const ownerIds = [...new Set(bounded.map((row) => row.ownerUserId).filter(Boolean))];
  const ownerNames = new Map();
  if (ownerIds.length) {
    const { rows: owners } = await client.query(
      `SELECT id,full_name FROM public.users WHERE id = ANY($1::uuid[])`,
      [ownerIds],
    );
    for (const owner of owners) ownerNames.set(owner.id, owner.full_name);
  }
  const withOwnerNames = bounded.map((row) => ({ ...row, ownerName: row.ownerUserId ? ownerNames.get(row.ownerUserId) || null : null }));
  const csv = rowsToCsv(LEAD_EXPORT_COLUMNS, withOwnerNames);
  return { csv, rowCount: withOwnerNames.length, truncated: rows.length > EXPORT_ROW_CAP };
}

export async function completeCrmLeadExportJob(client, jobId, organizationId, { csv, rowCount, truncated }) {
  // progress stays a small, poll-friendly summary (no file content) —
  // result_manifest additionally carries the generated CSV itself, since
  // this codebase has no separate blob-storage abstraction and the same
  // row cap already bounds it to a safe size (see EXPORT_ROW_CAP).
  const summary = {
    rowCount,
    truncated,
    columns: LEAD_EXPORT_COLUMNS.map((column) => column.key),
    generatedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + EXPORT_TTL_HOURS * 60 * 60 * 1000).toISOString(),
  };
  await client.query(
    `UPDATE tenant.background_jobs SET status='completed',progress=$3::jsonb,result_manifest=$4::jsonb,completed_at=now(),updated_at=now()
      WHERE organization_id=$1 AND id=$2`,
    [organizationId, jobId, JSON.stringify(summary), JSON.stringify({ ...summary, csv })],
  );
}
