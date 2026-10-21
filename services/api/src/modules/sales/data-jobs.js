// Sales imports that run in the background (Line-by-line audit P5). A customer, address, contact or price file with more rows than an
// import takes while the person waits is handed to the worker instead: the person keeps working, is told when it finishes, and
// downloads the rows that could not be imported from the import screen. The same pattern as CRM's data jobs, kept inside Sales.
//
// Each run is a tenant.sales_data_jobs row with its background job. The uploaded file is kept as a Shared Platform file for the run.
// The work is the same import the screens use, with a larger row limit, under the requester's permissions as they are when it runs,
// in one transaction: an import either finishes, row by row as usual, or leaves nothing behind.
import { buildWorkspaceAccessSnapshot } from "../../core/access/index.js";
import { appsFromSnapshot } from "../../core/access/apps.js";
import { getConfigurationValue } from "../../core/platform/configuration/index.js";
import { prepareFileUpload, readFileContent, storeFile } from "../../core/platform/files/index.js";
import { createNotification } from "../../core/platform/notifications/index.js";
import { resolveMemberExecutionContext } from "../../core/platform/reporting/execution-context.js";
import { analyzeCustomerImport, buildCustomerImportErrorFile, importCustomers, toCsv } from "./customers/import-export.js";
import { analyzeCustomerRelatedImport, importCustomerRelated } from "./customers/related-import-export.js";
import { analyzePriceImport, buildPriceImportErrorFile, importPrices } from "./price-lists/import-export.js";
import { SalesError } from "./index.js";

export const SALES_DATA_JOB_TYPE = "sales.data_job.run";
export const BACKGROUND_IMPORT_ROW_LIMIT = 20000;
const FILE_ENTITY = "sales.data_job";
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// What each kind of file imports with: the analysis (the same checks and permission as on screen), the import, the file of rows to fix.
const ENTITIES = Object.freeze({
  customers: { label: "customers", href: "/sales/customers/import",
    analyze: (client, context, input) => analyzeCustomerImport(client, context, input),
    import: (client, context, input) => importCustomers(client, context, input),
    errors: (result) => buildCustomerImportErrorFile(result.results), options: ["duplicateMode", "defaults"] },
  customer_addresses: { label: "customer addresses", href: "/sales/customers/import",
    analyze: (client, context, input) => analyzeCustomerRelatedImport(client, context, "addresses", input),
    import: (client, context, input) => importCustomerRelated(client, context, "addresses", input),
    errors: (result) => rowsToFix(result.results), options: [] },
  customer_contacts: { label: "customer contacts", href: "/sales/customers/import",
    analyze: (client, context, input) => analyzeCustomerRelatedImport(client, context, "contacts", input),
    import: (client, context, input) => importCustomerRelated(client, context, "contacts", input),
    errors: (result) => rowsToFix(result.results), options: [] },
  prices: { label: "prices", href: "/sales/price-lists",
    analyze: (client, context, input, options) => analyzePriceImport(client, context, options.priceListId, input),
    import: (client, context, input, options) => importPrices(client, context, options.priceListId, input),
    errors: (result) => buildPriceImportErrorFile(result.results), options: ["priceListId"] },
});

// The rows an address or contact import could not take, with the reason.
const rowsToFix = (results = []) => toCsv([["Row", "Customer / person", "Result", "Reason"],
  ...results.filter((row) => !["created", "updated", "linked"].includes(row.outcome)).map((row) => [row.rowNumber, row.name ?? "", row.outcome, row.message ?? ""])]);

function entityOf(key) {
  const entity = ENTITIES[key];
  if (!entity) throw new SalesError(400, "Choose customers, addresses, contacts or prices.", "SALES_DATA_JOB_ENTITY");
  return entity;
}
const pickOptions = (entity, options = {}) =>
  Object.fromEntries(entity.options.filter((key) => options[key] !== undefined && options[key] !== null && options[key] !== "").map((key) => [key, options[key]]));
const failedRows = (result) => (result.failed ?? 0) + (result.skipped ?? 0) + (result.review ?? 0);

async function retentionUntil(client, organizationId) {
  let hours = 72;
  try { hours = Number(await getConfigurationValue(client, organizationId, "platform.exports", "artifact_retention_hours")) || hours; } catch { /* the default */ }
  return new Date(Date.now() + hours * 3600 * 1000);
}

// Queues an import. The file is read now with the same checks and permission as on screen (and the larger limit), so a file that
// cannot be imported is refused at once rather than failing later. input: { entity, bytes, fileName, mapping, options }
export async function requestSalesImportJob(client, context, { entity: entityKey, bytes, fileName, mapping = {}, options = {} } = {}, { env = process.env, storage } = {}) {
  const entity = entityOf(entityKey);
  const kept = pickOptions(entity, options);
  if (entityKey === "prices" && !UUID.test(String(kept.priceListId ?? ""))) throw new SalesError(400, "Choose the price list.", "SALES_DATA_JOB_OPTIONS");
  const analysis = await entity.analyze(client, context, { bytes, fileName, maxRows: BACKGROUND_IMPORT_ROW_LIMIT }, kept);
  const unknown = Object.keys(mapping).filter((header) => !analysis.headers.includes(header));
  if (unknown.length) throw new SalesError(400, `The file has no column named "${unknown[0]}".`, "SALES_DATA_JOB_MAPPING");
  const prepared = await prepareFileUpload({ fileName, mimeType: /\.xlsx$/i.test(fileName) ? XLSX : "text/csv", bytes, maximumBytes: MAX_UPLOAD_BYTES }, env);
  const row = (await client.query(
    `INSERT INTO tenant.sales_data_jobs (organization_id, entity, file_name, options, requested_by, result) VALUES ($1, $2, $3, $4::jsonb, $5, $6::jsonb) RETURNING id`,
    [context.organizationId, entityKey, prepared.fileName, JSON.stringify({ mapping, ...kept }), context.userId, JSON.stringify({ rowCount: analysis.rowCount })])).rows[0];
  const file = await storeFile(client, {
    organizationId: context.organizationId, entityType: FILE_ENTITY, entityId: row.id, prepared, uploadedBy: context.userId, purpose: "attachment",
    expiresAt: await retentionUntil(client, context.organizationId), classification: "confidential",
  }, { storage, env });
  const job = (await client.query(
    `INSERT INTO tenant.background_jobs (organization_id, job_type, payload, status, run_at, priority, max_attempts, requested_by, progress, result_manifest)
     VALUES ($1, $2, $3::jsonb, 'pending', now(), 70, 2, $4, '{}'::jsonb, '{}'::jsonb) RETURNING id`,
    [context.organizationId, SALES_DATA_JOB_TYPE, JSON.stringify({ salesDataJobId: row.id }), context.userId])).rows[0];
  await client.query("UPDATE tenant.sales_data_jobs SET input_file_id = $3, job_id = $4 WHERE organization_id = $1 AND id = $2", [context.organizationId, row.id, file.id, job.id]);
  return getSalesDataJob(client, context, row.id);
}

const JOB_SELECT = "SELECT job.*, member.full_name AS requested_by_name FROM tenant.sales_data_jobs job LEFT JOIN users member ON member.id = job.requested_by";
function toJob(row) {
  return {
    id: row.id, entity: row.entity, entityLabel: ENTITIES[row.entity]?.label ?? row.entity, status: row.status, fileName: row.file_name, result: row.result ?? {},
    error: row.error_message ? String(row.error_message).slice(0, 300) : null, hasOutput: Boolean(row.output_file_id), requestedByName: row.requested_by_name ?? null,
    requestedAt: row.requested_at, startedAt: row.started_at, completedAt: row.completed_at,
  };
}

// The person's own background imports, newest first (optionally of some kinds).
export async function listSalesDataJobs(client, context, { entities = [], limit = 10 } = {}) {
  const values = [context.organizationId, context.userId];
  let where = "WHERE job.organization_id = $1 AND job.requested_by = $2";
  const kinds = (Array.isArray(entities) ? entities : [entities]).filter((key) => ENTITIES[key]);
  if (kinds.length) { values.push(kinds); where += ` AND job.entity = ANY ($${values.length}::text[])`; }
  const { rows } = await client.query(`${JOB_SELECT} ${where} ORDER BY job.requested_at DESC LIMIT ${Math.min(Math.max(Number(limit) || 10, 1), 50)}`, values);
  return rows.map(toJob);
}

export async function getSalesDataJob(client, context, jobId) {
  if (!UUID.test(String(jobId ?? ""))) throw new SalesError(404, "Import not found.", "SALES_DATA_JOB_NOT_FOUND");
  const row = (await client.query(`${JOB_SELECT} WHERE job.organization_id = $1 AND job.id = $2 AND job.requested_by = $3`, [context.organizationId, jobId, context.userId])).rows[0];
  if (!row) throw new SalesError(404, "Import not found.", "SALES_DATA_JOB_NOT_FOUND");
  return toJob(row);
}

// The rows a finished import could not take, for the person who started it.
export async function readSalesDataJobOutput(client, context, jobId, { storage } = {}) {
  await getSalesDataJob(client, context, jobId);
  const row = (await client.query("SELECT output_file_id FROM tenant.sales_data_jobs WHERE organization_id = $1 AND id = $2", [context.organizationId, jobId])).rows[0];
  if (!row?.output_file_id) throw new SalesError(409, "This import has no file to download.", "SALES_DATA_JOB_NO_FILE");
  return readFileContent(client, { organizationId: context.organizationId, entityType: FILE_ENTITY, entityId: jobId, fileId: row.output_file_id }, { storage });
}

// Worker: runs one queued import under the requester's current authority.
export async function executeSalesDataJob(client, organizationId, { salesDataJobId }, { env = process.env, storage } = {}) {
  const job = (await client.query("SELECT * FROM tenant.sales_data_jobs WHERE organization_id = $1 AND id = $2 FOR UPDATE", [organizationId, salesDataJobId])).rows[0];
  if (!job || !["queued", "running"].includes(job.status)) return { skipped: true };
  const entity = entityOf(job.entity);
  await client.query("UPDATE tenant.sales_data_jobs SET status = 'running', started_at = COALESCE(started_at, now()) WHERE id = $1", [job.id]);
  const member = await resolveMemberExecutionContext(client, organizationId, { userId: job.requested_by });
  if (!member) throw new SalesError(403, "The person who started this can no longer use Sales.", "SALES_DATA_JOB_REQUESTER");
  const snapshot = await buildWorkspaceAccessSnapshot(client, member, { env });
  if (!snapshot.accessibleModules?.includes("sales")) throw new SalesError(403, "Sales is no longer available to the person who started this.", "SALES_DATA_JOB_REQUESTER");
  const context = { organizationId, userId: member.userId, permissions: member.permissions, roleSlugs: member.roleSlugs, apps: appsFromSnapshot(snapshot) };
  const input = await readFileContent(client, { organizationId, entityType: FILE_ENTITY, entityId: job.id, fileId: job.input_file_id }, { storage });
  const { mapping = {}, ...options } = job.options ?? {};
  const imported = await entity.import(client, context, { bytes: input.body, fileName: job.file_name, mapping, ...options, maxRows: BACKGROUND_IMPORT_ROW_LIMIT }, options);
  let outputFileId = null;
  if (failedRows(imported) > 0) {
    const prepared = await prepareFileUpload({ fileName: `${job.entity}-import-rows-to-fix-${job.id.slice(0, 8)}.csv`, mimeType: "text/csv",
      bytes: Buffer.from(entity.errors(imported), "utf8"), maximumBytes: 50 * 1024 * 1024 }, env);
    outputFileId = (await storeFile(client, {
      organizationId, entityType: FILE_ENTITY, entityId: job.id, prepared, uploadedBy: job.requested_by, purpose: "export",
      expiresAt: await retentionUntil(client, organizationId), classification: "confidential",
    }, { storage, env })).id;
  }
  const { results: _rows, ...counts } = imported;
  await client.query("UPDATE tenant.sales_data_jobs SET status = 'succeeded', result = $2::jsonb, output_file_id = $3, completed_at = now() WHERE id = $1",
    [job.id, JSON.stringify(counts), outputFileId]);
  const done = (counts.created ?? counts.added ?? 0) + (counts.updated ?? 0) + (counts.linked ?? 0);
  await createNotification(client, {
    organizationId, userId: job.requested_by, category: "sales_data_job_finished", title: "Import finished",
    message: `${done} of ${counts.total ?? 0} ${entity.label} imported${failedRows(counts) ? `; ${failedRows(counts)} not imported — download the rows to fix from the import screen` : ""}.`,
    href: entity.href, entityType: "sales_data_job", entityId: job.id,
  });
  return { salesDataJobId: job.id, ...counts };
}

// Worker: records why a run failed (in its own transaction, after the run's own was rolled back) and tells the person.
export async function failSalesDataJob(client, organizationId, salesDataJobId, error) {
  const message = String(error?.message || error).slice(0, 1000);
  const job = (await client.query(
    `UPDATE tenant.sales_data_jobs SET status = 'failed', error_message = $3, completed_at = now() WHERE organization_id = $1 AND id = $2 AND status IN ('queued', 'running') RETURNING *`,
    [organizationId, salesDataJobId, message])).rows[0];
  if (!job) return;
  const entity = ENTITIES[job.entity];
  await createNotification(client, {
    organizationId, userId: job.requested_by, category: "sales_data_job_finished", title: "Import failed",
    message: `Your import of ${entity?.label ?? job.entity} could not finish: ${message}`.slice(0, 1000), href: entity?.href ?? "/sales", entityType: "sales_data_job", entityId: job.id,
  });
}
