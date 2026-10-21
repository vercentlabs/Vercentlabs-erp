// CRM imports and exports that run in the background (CRM plan 2.5: E2, E4). A file with more rows than an import takes while the
// person waits, or an export with more rows than a download returns at once, is handed to the worker instead: the person keeps working,
// is told when it finishes, and downloads the result from the import or export screen.
//
// Each run is a tenant.crm_data_jobs row with its background job. The uploaded file is kept as a Shared Platform file for the run;
// the run produces one file — the export, or the rows an import could not take with the reason for each. The work itself is the same
// import or export the screens use, with larger limits, under the requester's permissions as they are when it runs (a revoked
// permission stops a queued run), in one transaction: an import either finishes, row by row as usual, or leaves nothing behind.
import { buildWorkspaceAccessSnapshot } from "../../../core/access/index.js";
import { getConfigurationValue } from "../../../core/platform/configuration/index.js";
import { prepareFileUpload, readFileContent, storeFile } from "../../../core/platform/files/index.js";
import { createNotification } from "../../../core/platform/notifications/index.js";
import { resolveMemberExecutionContext } from "../../../core/platform/reporting/execution-context.js";
import { analyzeAccountImport, exportAccounts, importAccounts } from "../accounts/import-export.js";
import { analyzeContactImport, exportContacts, importContacts } from "../contacts/import-export.js";
import { appsFromSnapshot } from "../../../core/access/apps.js";
import { CrmError } from "../data-management/errors.js";
import { analyzeLeadImport, exportLeads, importLeads } from "../leads/import-export.js";
import { exportOpportunities } from "../opportunities/dashboard.js";
import { analyzeOpportunityImport, importOpportunities } from "../opportunities/import.js";

export const CRM_DATA_JOB_TYPE = "crm.data_job.run";
export const BACKGROUND_IMPORT_ROW_LIMIT = 20000;
export const BACKGROUND_EXPORT_ROW_LIMIT = 100000;
const FILE_ENTITY = "crm.data_job";
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// What each record type imports and exports with, and which options of its import a background run may carry.
const ENTITIES = Object.freeze({
  leads: { label: "leads", href: "/crm/data/import-export?type=leads", analyze: analyzeLeadImport, import: importLeads, export: exportLeads,
    options: ["defaultSourceId", "defaultOwnerUserId", "skipDuplicates", "assignmentMode", "invalidOwnerAction"] },
  accounts: { label: "companies", href: "/crm/data/import-export?type=companies", analyze: analyzeAccountImport, import: importAccounts, export: exportAccounts,
    options: ["defaultSourceId", "defaultOwnerUserId", "skipDuplicates"] },
  contacts: { label: "contacts", href: "/crm/data/import-export?type=contacts", analyze: analyzeContactImport, import: importContacts, export: exportContacts,
    options: ["defaultSourceId", "defaultOwnerUserId", "skipDuplicates"] },
  opportunities: { label: "deals", href: "/crm/data/import-export?type=deals", analyze: analyzeOpportunityImport, import: importOpportunities, export: exportOpportunities,
    options: ["createMissingCompanies", "defaultOwnerUserId"] },
});

function entityOf(key) {
  const entity = ENTITIES[key];
  if (!entity) throw new CrmError(400, "Choose leads, companies, contacts or deals.", "CRM_DATA_JOB_ENTITY");
  return entity;
}

function pickOptions(entity, options = {}) {
  const picked = {};
  for (const key of entity.options) if (options[key] !== undefined && options[key] !== null && options[key] !== "") picked[key] = options[key];
  return picked;
}

async function queueJob(client, context, jobId) {
  const job = (await client.query(
    `INSERT INTO tenant.background_jobs (organization_id, job_type, payload, status, run_at, priority, max_attempts, requested_by, progress, result_manifest)
     VALUES ($1, $2, $3::jsonb, 'pending', now(), 70, 2, $4, '{}'::jsonb, '{}'::jsonb) RETURNING id`,
    [context.organizationId, CRM_DATA_JOB_TYPE, JSON.stringify({ crmDataJobId: jobId }), context.userId],
  )).rows[0];
  await client.query("UPDATE tenant.crm_data_jobs SET job_id = $3 WHERE organization_id = $1 AND id = $2", [context.organizationId, jobId, job.id]);
}

async function retentionUntil(client, organizationId) {
  let hours = 72;
  try { hours = Number(await getConfigurationValue(client, organizationId, "platform.exports", "artifact_retention_hours")) || hours; } catch { /* the default */ }
  return new Date(Date.now() + hours * 3600 * 1000);
}

// Queues an import of a file. The file is read now — the same checks and permission as an import on screen, with the larger limit —
// so a file that cannot be imported is refused at once rather than failing later.
// input: { entity, bytes, fileName, mapping, options }
export async function requestCrmImportJob(client, context, { entity: entityKey, bytes, fileName, mapping = {}, options = {} } = {}, { env = process.env, storage } = {}) {
  const entity = entityOf(entityKey);
  const analysis = await entity.analyze(client, context, { bytes, fileName, maxRows: BACKGROUND_IMPORT_ROW_LIMIT });
  const unknown = Object.keys(mapping).filter((header) => !analysis.headers.includes(header));
  if (unknown.length) throw new CrmError(400, `The file has no column named "${unknown[0]}".`, "CRM_DATA_JOB_MAPPING");
  const prepared = await prepareFileUpload({ fileName, mimeType: /\.xlsx$/i.test(fileName) ? XLSX : "text/csv", bytes, maximumBytes: MAX_UPLOAD_BYTES }, env);
  const row = (await client.query(
    `INSERT INTO tenant.crm_data_jobs (organization_id, kind, entity, file_name, options, requested_by, result)
     VALUES ($1, 'import', $2, $3, $4::jsonb, $5, $6::jsonb) RETURNING id`,
    [context.organizationId, entityKey, prepared.fileName, JSON.stringify({ mapping, ...pickOptions(entity, options) }), context.userId, JSON.stringify({ rowCount: analysis.rowCount })],
  )).rows[0];
  const file = await storeFile(client, {
    organizationId: context.organizationId, entityType: FILE_ENTITY, entityId: row.id, prepared, uploadedBy: context.userId, purpose: "attachment",
    expiresAt: await retentionUntil(client, context.organizationId), classification: "confidential",
  }, { storage, env });
  await client.query("UPDATE tenant.crm_data_jobs SET input_file_id = $3 WHERE organization_id = $1 AND id = $2", [context.organizationId, row.id, file.id]);
  await queueJob(client, context, row.id);
  return getCrmDataJob(client, context, row.id);
}

// Queues an export of the records the list shows for the same view and filters.
export async function requestCrmExportJob(client, context, { entity: entityKey, filters = {} } = {}) {
  const entity = entityOf(entityKey);
  // The export's own permission and filter checks, reading at most one row: with a limit of 0, a non-empty result is "too large",
  // which here only means there is something to export.
  await entity.export(client, context, filters, { limit: 0 }).catch((error) => {
    if (!(error instanceof CrmError && error.status === 413)) throw error;
  });
  const clean = Object.fromEntries(Object.entries(filters ?? {}).filter(([key, value]) => !["limit", "offset"].includes(key) && value !== undefined && value !== null && value !== ""));
  const row = (await client.query(
    `INSERT INTO tenant.crm_data_jobs (organization_id, kind, entity, options, requested_by) VALUES ($1, 'export', $2, $3::jsonb, $4) RETURNING id`,
    [context.organizationId, entityKey, JSON.stringify({ filters: clean }), context.userId],
  )).rows[0];
  await queueJob(client, context, row.id);
  return getCrmDataJob(client, context, row.id);
}

const JOB_SELECT = `SELECT job.*, member.full_name AS requested_by_name FROM tenant.crm_data_jobs job LEFT JOIN users member ON member.id = job.requested_by`;

function toJob(row) {
  const entity = ENTITIES[row.entity];
  return {
    id: row.id, kind: row.kind, entity: row.entity, entityLabel: entity?.label ?? row.entity, status: row.status, fileName: row.file_name,
    result: row.result ?? {}, error: row.error_message ? String(row.error_message).slice(0, 300) : null,
    hasOutput: Boolean(row.output_file_id), requestedByName: row.requested_by_name ?? null,
    requestedAt: row.requested_at, startedAt: row.started_at, completedAt: row.completed_at,
  };
}

// The person's own background imports and exports, newest first (optionally of one record type).
export async function listCrmDataJobs(client, context, { entity, limit = 20 } = {}) {
  const values = [context.organizationId, context.userId];
  let where = "WHERE job.organization_id = $1 AND job.requested_by = $2";
  if (entity) { entityOf(entity); values.push(entity); where += ` AND job.entity = $${values.length}`; }
  const { rows } = await client.query(`${JOB_SELECT} ${where} ORDER BY job.requested_at DESC LIMIT ${Math.min(Math.max(Number(limit) || 20, 1), 50)}`, values);
  return rows.map(toJob);
}

export async function getCrmDataJob(client, context, jobId) {
  if (!UUID.test(String(jobId ?? ""))) throw new CrmError(404, "Import or export not found.", "CRM_DATA_JOB_NOT_FOUND");
  const row = (await client.query(`${JOB_SELECT} WHERE job.organization_id = $1 AND job.id = $2 AND job.requested_by = $3`, [context.organizationId, jobId, context.userId])).rows[0];
  if (!row) throw new CrmError(404, "Import or export not found.", "CRM_DATA_JOB_NOT_FOUND");
  return toJob(row);
}

// The file a finished run produced (the export, or an import's rejected rows), for the person who started it.
export async function readCrmDataJobOutput(client, context, jobId, { storage } = {}) {
  await getCrmDataJob(client, context, jobId);
  const row = (await client.query("SELECT output_file_id FROM tenant.crm_data_jobs WHERE organization_id = $1 AND id = $2", [context.organizationId, jobId])).rows[0];
  if (!row?.output_file_id) throw new CrmError(409, "This run has no file to download.", "CRM_DATA_JOB_NO_FILE");
  return readFileContent(client, { organizationId: context.organizationId, entityType: FILE_ENTITY, entityId: jobId, fileId: row.output_file_id }, { storage });
}

async function storeOutput(client, organizationId, job, fileName, csv, { env, storage }) {
  const prepared = await prepareFileUpload({ fileName, mimeType: "text/csv", bytes: Buffer.from(csv, "utf8"), maximumBytes: 50 * 1024 * 1024 }, env);
  const file = await storeFile(client, {
    organizationId, entityType: FILE_ENTITY, entityId: job.id, prepared, uploadedBy: job.requested_by, purpose: "export",
    expiresAt: await retentionUntil(client, organizationId), classification: "confidential",
  }, { storage, env });
  return file.id;
}

function summaryOf(job, entity, result) {
  if (job.kind === "export") return `Your export of ${result.rowCount} ${entity.label} is ready to download.`;
  const parts = [`${result.created} of ${result.total} ${entity.label} imported`];
  if (result.updated) parts.push(`${result.updated} updated`);
  if (result.failed) parts.push(`${result.failed} not imported — download the file of rows that were not imported`);
  return `${parts.join(", ")}.`;
}

// Worker: runs one queued import or export under the requester's current authority.
export async function executeCrmDataJob(client, organizationId, { crmDataJobId }, { env = process.env, storage } = {}) {
  const job = (await client.query("SELECT * FROM tenant.crm_data_jobs WHERE organization_id = $1 AND id = $2 FOR UPDATE", [organizationId, crmDataJobId])).rows[0];
  if (!job || !["queued", "running"].includes(job.status)) return { skipped: true };
  const entity = entityOf(job.entity);
  await client.query("UPDATE tenant.crm_data_jobs SET status = 'running', started_at = COALESCE(started_at, now()) WHERE id = $1", [job.id]);
  const member = await resolveMemberExecutionContext(client, organizationId, { userId: job.requested_by });
  if (!member) throw new CrmError(403, "The person who started this can no longer use CRM.", "CRM_DATA_JOB_REQUESTER");
  const snapshot = await buildWorkspaceAccessSnapshot(client, member, { env });
  if (!snapshot.accessibleModules?.includes("crm")) throw new CrmError(403, "CRM is no longer available to the person who started this.", "CRM_DATA_JOB_REQUESTER");
  const context = { organizationId, userId: member.userId, permissions: member.permissions, roleSlugs: member.roleSlugs, apps: appsFromSnapshot(snapshot) };

  let result;
  let outputFileId = null;
  if (job.kind === "export") {
    const exported = await entity.export(client, context, job.options?.filters ?? {}, { limit: BACKGROUND_EXPORT_ROW_LIMIT });
    outputFileId = await storeOutput(client, organizationId, job, exported.fileName, exported.csv, { env, storage });
    result = { rowCount: exported.rowCount, fileName: exported.fileName };
  } else {
    const input = await readFileContent(client, { organizationId, entityType: FILE_ENTITY, entityId: job.id, fileId: job.input_file_id }, { storage });
    const { mapping = {}, ...options } = job.options ?? {};
    const imported = await entity.import(client, context, { bytes: input.body, fileName: job.file_name, mapping, ...options, maxRows: BACKGROUND_IMPORT_ROW_LIMIT });
    const { errorCsv, errors, ...counts } = imported;
    if (errorCsv) outputFileId = await storeOutput(client, organizationId, job, `${job.entity}-import-errors-${job.id.slice(0, 8)}.csv`, errorCsv, { env, storage });
    result = { ...counts, errors: (errors ?? []).slice(0, 20) };
  }
  await client.query(
    "UPDATE tenant.crm_data_jobs SET status = 'succeeded', result = $2::jsonb, output_file_id = $3, completed_at = now() WHERE id = $1",
    [job.id, JSON.stringify(result), outputFileId],
  );
  await createNotification(client, {
    organizationId, userId: job.requested_by, category: "crm_data_job_finished",
    title: job.kind === "export" ? "Export ready" : "Import finished", message: summaryOf(job, entity, result),
    href: entity.href, entityType: "crm_data_job", entityId: job.id,
  });
  return { crmDataJobId: job.id, ...result };
}

// Worker: records why a run failed (in its own transaction, after the run's own was rolled back) and tells the person.
export async function failCrmDataJob(client, organizationId, crmDataJobId, error) {
  const message = String(error?.message || error).slice(0, 1000);
  const job = (await client.query(
    `UPDATE tenant.crm_data_jobs SET status = 'failed', error_message = $3, completed_at = now()
      WHERE organization_id = $1 AND id = $2 AND status IN ('queued', 'running') RETURNING *`,
    [organizationId, crmDataJobId, message],
  )).rows[0];
  if (!job) return;
  const entity = ENTITIES[job.entity];
  await createNotification(client, {
    organizationId, userId: job.requested_by, category: "crm_data_job_finished",
    title: job.kind === "export" ? "Export failed" : "Import failed", message: `Your ${job.kind} of ${entity?.label ?? job.entity} could not finish: ${message}`.slice(0, 1000),
    href: entity?.href ?? "/crm/data/import-export", entityType: "crm_data_job", entityId: job.id,
  });
}
