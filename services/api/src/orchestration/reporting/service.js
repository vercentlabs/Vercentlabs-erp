// Shared reporting: saved definitions over registered datasets, runs executed
// in the background, CSV outputs as expiring Shared Platform files.
//
// Authorization, every time (request AND execution):
//   module released + enabled + entitled (WorkspaceAccessSnapshot), the
//   dataset's permissions, then the module's own scoped read. Execution uses
//   the requester's CURRENT authority, rebuilt from the database - a revoked
//   permission or company access stops a queued run.
// Scheduling is not available: a definition with a schedule is refused.
import { rowsToCsv } from "@vercentlabs/reporting-engine";

import { buildWorkspaceAccessSnapshot } from "../../core/access/index.js";
import { hasSessionPermission } from "../../core/access-control-runtime.js";
import { getConfigurationValue } from "../../core/platform/configuration/index.js";
import { prepareFileUpload, readFileContent, storeFile } from "../../core/platform/files/index.js";
import { resolveMemberExecutionContext } from "../../core/platform/reporting/execution-context.js";
import { audit } from "../../core/security.js";
import { getReportDataset, REPORT_DATASETS } from "./datasets.js";

export const REPORT_RUN_JOB_TYPE = "platform.reports.run";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class ReportError extends Error {
  constructor(status, message, code = "REPORT_ERROR") {
    super(message);
    this.name = "ReportError";
    this.status = status;
    this.code = code;
  }
}

function canUseDataset(session, accessibleModules, dataset) {
  return new Set(accessibleModules || []).has(dataset.moduleKey) && dataset.requiredPermissions.every((permission) => hasSessionPermission(session, permission));
}

function datasetFor(session, accessibleModules, key) {
  const dataset = getReportDataset(key);
  if (!dataset) throw new ReportError(400, "This report is not available.", "REPORT_DATASET_UNKNOWN");
  if (!canUseDataset(session, accessibleModules, dataset)) throw new ReportError(403, "You cannot run this report.", "REPORT_DATASET_FORBIDDEN");
  return dataset;
}

function validColumns(dataset, columns) {
  const requested = Array.isArray(columns) && columns.length ? [...new Set(columns.map(String))] : dataset.columns.map((column) => column.key);
  for (const column of requested) if (!dataset.columns.some((entry) => entry.key === column)) throw new ReportError(400, `"${column.slice(0, 60)}" is not a column of this report.`, "REPORT_COLUMN_UNKNOWN");
  return requested;
}

function validFilters(dataset, filters) {
  const clean = {};
  for (const [key, value] of Object.entries(filters || {})) {
    if (!dataset.filters.some((entry) => entry.key === key)) throw new ReportError(400, `"${String(key).slice(0, 60)}" is not a filter of this report.`, "REPORT_FILTER_UNKNOWN");
    if (value !== null && value !== undefined && String(value).trim()) clean[key] = String(value).slice(0, 200);
  }
  return clean;
}

export function listReportDatasets(session, accessibleModules) {
  return REPORT_DATASETS.filter((dataset) => canUseDataset(session, accessibleModules, dataset)).map(({ key, moduleKey, label, description, columns, filters, maxRows }) => ({ key, moduleKey, label, description, columns, filters, maxRows }));
}

export async function listReportDefinitions(client, session, accessibleModules) {
  const allowed = listReportDatasets(session, accessibleModules).map((dataset) => dataset.key);
  const { rows } = await client.query(
    `SELECT definition.id, definition.name, definition.dataset_key, definition.columns, definition.filters, definition.status, definition.created_by, definition.updated_at,
            member.full_name AS created_by_name
       FROM report_definitions definition LEFT JOIN users member ON member.id = definition.created_by
      WHERE definition.organization_id=$1 AND definition.dataset_key = ANY($2::text[])
      ORDER BY definition.updated_at DESC LIMIT 250`,
    [session.organizationId, allowed],
  );
  return rows.map((row) => ({ id: row.id, name: row.name, datasetKey: row.dataset_key, datasetLabel: getReportDataset(row.dataset_key)?.label ?? row.dataset_key, columns: row.columns, filters: row.filters, status: row.status, createdByName: row.created_by_name, isMine: row.created_by === session.userId, updatedAt: row.updated_at }));
}

export async function createReportDefinition(client, session, accessibleModules, input) {
  if (input?.schedule !== undefined && input.schedule !== null) throw new ReportError(409, "Scheduled reports are not available. Save the report and run it when you need it.", "REPORT_SCHEDULE_UNAVAILABLE");
  const name = String(input?.name ?? "").trim().slice(0, 160);
  if (!name) throw new ReportError(400, "Name the report.", "REPORT_DEFINITION_INVALID");
  const dataset = datasetFor(session, accessibleModules, input?.datasetKey);
  const columns = validColumns(dataset, input?.columns);
  const filters = validFilters(dataset, input?.filters);
  const { rows } = await client.query(
    `INSERT INTO report_definitions (organization_id, name, dataset_key, columns, filters, schedule, created_by) VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,NULL,$6) RETURNING id`,
    [session.organizationId, name, dataset.key, JSON.stringify(columns), JSON.stringify(filters), session.userId],
  );
  await audit(client, { organizationId: session.organizationId, actorUserId: session.userId, eventType: "report.definition_created", entityType: "report_definition", entityId: rows[0].id, afterData: { name, datasetKey: dataset.key, columns } });
  return { id: rows[0].id };
}

// The creator (or a reports administrator) can archive/restore a definition.
export async function setReportDefinitionStatus(client, session, definitionId, status) {
  if (!["active", "inactive"].includes(status)) throw new ReportError(400, "Unsupported status.", "REPORT_DEFINITION_INVALID");
  if (!UUID.test(String(definitionId || ""))) throw new ReportError(404, "Report not found.", "REPORT_DEFINITION_NOT_FOUND");
  const manager = hasSessionPermission(session, "platform.reports.manage");
  const { rows } = await client.query(
    `UPDATE report_definitions SET status=$3, updated_at=now() WHERE organization_id=$1 AND id=$2 AND ($4::boolean OR created_by=$5) RETURNING id`,
    [session.organizationId, definitionId, status, manager, session.userId],
  );
  if (!rows[0]) throw new ReportError(404, "Report not found.", "REPORT_DEFINITION_NOT_FOUND");
  await audit(client, { organizationId: session.organizationId, actorUserId: session.userId, eventType: "report.definition_status_changed", entityType: "report_definition", entityId: definitionId, afterData: { status } });
  return { id: definitionId, status };
}

/** Queues a run (tenant transaction: the job row is tenant data). */
export async function requestReportRun(client, session, accessibleModules, input) {
  let dataset;
  let columns;
  let filters;
  let definitionId = null;
  if (input?.definitionId) {
    if (!UUID.test(String(input.definitionId))) throw new ReportError(404, "Report not found.", "REPORT_DEFINITION_NOT_FOUND");
    const definition = (await client.query(`SELECT * FROM report_definitions WHERE organization_id=$1 AND id=$2 AND status='active'`, [session.organizationId, input.definitionId])).rows[0];
    if (!definition) throw new ReportError(404, "Report not found.", "REPORT_DEFINITION_NOT_FOUND");
    dataset = datasetFor(session, accessibleModules, definition.dataset_key);
    columns = validColumns(dataset, definition.columns);
    filters = validFilters(dataset, definition.filters);
    definitionId = definition.id;
  } else {
    dataset = datasetFor(session, accessibleModules, input?.datasetKey);
    columns = validColumns(dataset, input?.columns);
    filters = validFilters(dataset, input?.filters);
  }
  const run = (
    await client.query(
      `INSERT INTO report_runs (organization_id, report_definition_id, dataset_key, filters, columns, status, requested_by) VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,'queued',$6) RETURNING id`,
      [session.organizationId, definitionId, dataset.key, JSON.stringify(filters), JSON.stringify(columns), session.userId],
    )
  ).rows[0];
  const job = (
    await client.query(
      `INSERT INTO tenant.background_jobs (organization_id, job_type, payload, status, run_at, priority, max_attempts, requested_by, progress, result_manifest)
       VALUES ($1,$2,$3::jsonb,'pending',now(),60,3,$4,'{}'::jsonb,'{}'::jsonb) RETURNING id`,
      [session.organizationId, REPORT_RUN_JOB_TYPE, JSON.stringify({ reportRunId: run.id, activeCompanyId: session.activeCompanyId ?? null, activeBranchId: session.activeBranchId ?? null }), session.userId],
    )
  ).rows[0];
  await client.query(`UPDATE report_runs SET job_id=$2 WHERE id=$1`, [run.id, job.id]);
  await audit(client, { organizationId: session.organizationId, actorUserId: session.userId, eventType: "report.run_requested", entityType: "report_run", entityId: run.id, metadata: { datasetKey: dataset.key, definitionId } });
  return { id: run.id, status: "queued", jobId: job.id };
}

export async function listReportRuns(client, session) {
  const manager = hasSessionPermission(session, "platform.reports.manage");
  const { rows } = await client.query(
    `SELECT run.id, run.report_definition_id, run.dataset_key, run.status, run.row_count, run.output_file_id, run.error_message, run.requested_by, run.requested_at, run.completed_at,
            definition.name AS definition_name, member.full_name AS requested_by_name, file.expires_at AS output_expires_at, file.content_removed_at AS output_removed_at
       FROM report_runs run
       LEFT JOIN report_definitions definition ON definition.id = run.report_definition_id
       LEFT JOIN users member ON member.id = run.requested_by
       LEFT JOIN attachments file ON file.id = run.output_file_id
      WHERE run.organization_id=$1 AND ($2::boolean OR run.requested_by=$3)
      ORDER BY run.requested_at DESC LIMIT 50`,
    [session.organizationId, manager, session.userId],
  );
  const now = Date.now();
  return rows.map((row) => ({
    id: row.id,
    datasetKey: row.dataset_key,
    datasetLabel: getReportDataset(row.dataset_key)?.label ?? row.dataset_key,
    definitionName: row.definition_name,
    status: row.status,
    rowCount: row.row_count,
    error: row.error_message ? String(row.error_message).slice(0, 300) : null,
    requestedByName: row.requested_by_name,
    requestedAt: row.requested_at,
    completedAt: row.completed_at,
    downloadable: Boolean(row.output_file_id) && !row.output_removed_at && (!row.output_expires_at || new Date(row.output_expires_at).getTime() > now),
    outputExpiresAt: row.output_expires_at,
  }));
}

/** Worker: executes one run with the requester's current authority. */
export async function executeReportRun(client, organizationId, payload, { env = process.env, storage } = {}) {
  const run = (await client.query(`SELECT * FROM report_runs WHERE organization_id=$1 AND id=$2 FOR UPDATE`, [organizationId, payload.reportRunId])).rows[0];
  if (!run || !["queued", "running"].includes(run.status)) return { skipped: true };
  await client.query(`UPDATE report_runs SET status='running', started_at=COALESCE(started_at, now()) WHERE id=$1`, [run.id]);
  const context = await resolveMemberExecutionContext(client, organizationId, { userId: run.requested_by, activeCompanyId: payload.activeCompanyId, activeBranchId: payload.activeBranchId });
  if (!context) throw new ReportError(403, "The requester can no longer run this report.", "REPORT_REQUESTER_UNAUTHORIZED");
  const snapshot = await buildWorkspaceAccessSnapshot(client, context, { env });
  const dataset = datasetFor(context, snapshot.accessibleModules, run.dataset_key);
  const columns = validColumns(dataset, run.columns);
  const filters = validFilters(dataset, run.filters);
  const rows = await dataset.execute(client, context, filters, dataset.maxRows);
  const csv = rowsToCsv(columns.map((key) => dataset.columns.find((column) => column.key === key)), rows);
  const retentionHours = await getConfigurationValue(client, organizationId, "platform.exports", "artifact_retention_hours");
  const prepared = await prepareFileUpload({ fileName: `${dataset.key.replace(".", "-")}-${run.id.slice(0, 8)}.csv`, mimeType: "text/csv", bytes: Buffer.from(csv, "utf8"), maximumBytes: 50 * 1024 * 1024 }, env);
  const file = await storeFile(
    client,
    { organizationId, entityType: "platform.report_run", entityId: run.id, prepared, uploadedBy: run.requested_by, purpose: "report_output", expiresAt: new Date(Date.now() + Number(retentionHours) * 3600 * 1000), classification: "confidential" },
    { storage, env },
  );
  await client.query(`UPDATE report_runs SET status='succeeded', row_count=$2, output_file_id=$3, completed_at=now() WHERE id=$1`, [run.id, rows.length, file.id]);
  await audit(client, { organizationId, actorUserId: run.requested_by, eventType: "report.exported", entityType: "report_run", entityId: run.id, metadata: { datasetKey: dataset.key, rowCount: rows.length } });
  return { rowCount: rows.length, fileId: file.id };
}

export async function failReportRun(client, organizationId, reportRunId, error) {
  await client.query(`UPDATE report_runs SET status='failed', error_message=$3, completed_at=now() WHERE organization_id=$1 AND id=$2 AND status IN ('queued','running')`, [
    organizationId,
    reportRunId,
    String(error?.message || error).slice(0, 1000),
  ]);
}

/** Download: the requester (or a reports administrator); 410 once expired. */
export async function readReportRunOutput(client, session, runId, { storage } = {}) {
  if (!UUID.test(String(runId || ""))) throw new ReportError(404, "Report run not found.", "REPORT_RUN_NOT_FOUND");
  const manager = hasSessionPermission(session, "platform.reports.manage");
  const run = (await client.query(`SELECT * FROM report_runs WHERE organization_id=$1 AND id=$2 AND ($3::boolean OR requested_by=$4)`, [session.organizationId, runId, manager, session.userId])).rows[0];
  if (!run) throw new ReportError(404, "Report run not found.", "REPORT_RUN_NOT_FOUND");
  if (run.status !== "succeeded" || !run.output_file_id) throw new ReportError(409, "This report has no file to download.", "REPORT_RUN_NOT_READY");
  return readFileContent(client, { organizationId: session.organizationId, entityType: "platform.report_run", entityId: run.id, fileId: run.output_file_id }, { storage });
}
