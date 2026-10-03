import { rowsToCsv } from "@vercentlabs/reporting-engine";

import { canViewAllCrmResource } from "../crm-access-scope.js";
import { queueOutboxEvent } from "../outbox.js";
import { camelizeRow } from "../record-utils.js";
import { leadScopeSql } from "../../lead-management/lead-security.js";
import { createIngestedLead, CrmLeadAcquisitionError, crmLeadAcquisitionHash, validateLeadImportRows } from "../../master-data/lead-acquisition.js";

// F021 Lead import at enterprise volume.
//
//   upload -> parse (bounded) -> header mapping -> dry run (validation,
//   in-file duplicates, existing matches, planned action per row) ->
//   commit -> chunked processing -> progress -> completion -> error download
//
// Thresholds: up to LEAD_IMPORT_LIMITS.syncCommitRows valid rows commit in the
// request (still chunked, per-row savepoints); anything larger is a durable
// background job (crm.leads.import) that processes chunkSize rows per short
// transaction. A row's lead creation and its "processed" mark commit together,
// so a crash or restart resumes at the next pending row and never imports a
// row twice. Every row goes through the same capture path (duplicate rules,
// assignment, source, provenance) as an interactive lead.

export const LEAD_IMPORT_LIMITS = Object.freeze({
  maxBytes: 20 * 1024 * 1024,
  maxRows: 50_000,
  syncCommitRows: 100, // ~50 ms per row through the full capture path: bounded request time
  chunkSize: 200,
  insertChunk: 1000,
});
export const LEAD_IMPORT_JOB_TYPE = "crm.leads.import";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STRATEGIES = new Set(["skip", "update", "create"]);
const notFound = () => new CrmLeadAcquisitionError(404, "Import batch not found.", "CRM_LEAD_IMPORT_NOT_FOUND");

const canSeeAllImports = (context) => (context.roleSlugs || []).includes("organization_owner") || canViewAllCrmResource(context, "leads");

function identity(normalized) {
  const email = normalized.email ? String(normalized.email).trim().toLowerCase() : null;
  const digits = String(normalized.mobile || normalized.phone || "").replace(/\D/g, "");
  return { email, phone: digits.length >= 7 ? digits : null };
}

/**
 * Dry run: validates every row, flags in-file duplicates, finds existing
 * leads the caller can see that match by email or phone, and plans the action
 * each row will take under the chosen duplicate policy. Rows are staged in
 * bulk; nothing is imported. The same file, mapping and policy return the
 * same batch (content hash).
 */
export async function previewLeadImport(client, context, input = {}) {
  const duplicateStrategy = String(input.duplicateStrategy || "skip");
  if (!STRATEGIES.has(duplicateStrategy)) throw new CrmLeadAcquisitionError(400, "Choose skip, update or create for matching leads.", "CRM_LEAD_IMPORT_STRATEGY_INVALID");
  if (!Array.isArray(input.rows) || !input.rows.length) throw new CrmLeadAcquisitionError(400, "At least one import row is required.", "CRM_LEAD_IMPORT_EMPTY");
  if (input.rows.length > LEAD_IMPORT_LIMITS.maxRows)
    throw new CrmLeadAcquisitionError(413, `A lead import is limited to ${LEAD_IMPORT_LIMITS.maxRows.toLocaleString("en-IN")} rows.`, "CRM_LEAD_IMPORT_TOO_MANY_ROWS");
  const rows = validateLeadImportRows(input.rows, input.fieldMapping || {}, { maxRows: LEAD_IMPORT_LIMITS.maxRows });
  const fileName = String(input.fileName || "lead-import.csv").slice(0, 240);
  const contentHash = crmLeadAcquisitionHash({ fileName, sourceFormat: "csv", duplicateStrategy, rows: input.rows, fieldMapping: input.fieldMapping || {} });
  const existing = await client.query(`SELECT * FROM tenant.crm_lead_import_batches WHERE organization_id=$1 AND content_hash=$2`, [context.organizationId, contentHash]);
  if (existing.rows[0]) return { batch: existing.rows[0], report: existing.rows[0].dry_run_report, rows: [], idempotent: true };

  // In-file duplicates: the first row with an identity wins.
  const firstByKey = new Map();
  for (const row of rows) {
    if (!row.valid) continue;
    const { email, phone } = identity(row.normalized);
    for (const key of [email && `e:${email}`, phone && `p:${phone}`].filter(Boolean)) {
      if (firstByKey.has(key)) {
        row.duplicateOfRow = firstByKey.get(key);
        break;
      }
    }
    if (!row.duplicateOfRow) for (const key of [email && `e:${email}`, phone && `p:${phone}`].filter(Boolean)) firstByKey.set(key, row.rowNumber);
  }

  // Existing matches, set-based and limited to leads the caller can see.
  const emails = [...new Set(rows.map((row) => identity(row.normalized).email).filter(Boolean))];
  const phones = [...new Set(rows.map((row) => identity(row.normalized).phone).filter(Boolean))];
  const matchByKey = new Map();
  if (emails.length || phones.length) {
    const values = [context.organizationId, emails, phones];
    const scope = leadScopeSql(context, values, "lead");
    const matches = await client.query(
      `SELECT lead.id, lower(lead.email) AS email, regexp_replace(COALESCE(lead.mobile, lead.phone, ''), '\\D', '', 'g') AS phone
         FROM tenant.crm_leads lead
        WHERE lead.organization_id=$1 AND lead.record_status='active'
          AND (lower(lead.email) = ANY($2::text[]) OR regexp_replace(COALESCE(lead.mobile, lead.phone, ''), '\\D', '', 'g') = ANY($3::text[]))${scope}`,
      values,
    );
    for (const match of matches.rows) {
      if (match.email) matchByKey.set(`e:${match.email}`, match.id);
      if (match.phone && match.phone.length >= 7) matchByKey.set(`p:${match.phone}`, match.id);
    }
  }

  const report = { total: rows.length, valid: 0, invalid: 0, inFileDuplicates: 0, existingMatches: 0, plannedCreate: 0, plannedUpdate: 0, plannedSkip: 0 };
  const staged = rows.map((row) => {
    const { email, phone } = identity(row.normalized);
    const duplicateLeadId = matchByKey.get(`e:${email}`) ?? matchByKey.get(`p:${phone}`) ?? null;
    let planned;
    let errors = row.errors;
    let errorCode = row.valid ? null : "CRM_LEAD_IMPORT_ROW_INVALID";
    if (!row.valid) planned = "error";
    else if (row.duplicateOfRow) {
      planned = "error";
      errorCode = "CRM_LEAD_IMPORT_DUPLICATE_IN_FILE";
      errors = [{ field: "row", message: `Repeats row ${row.duplicateOfRow} of this file.` }];
    } else if (duplicateLeadId) planned = duplicateStrategy === "create" ? "create" : duplicateStrategy;
    else planned = "create";
    if (planned === "error") report.invalid += 1;
    else report.valid += 1;
    if (row.duplicateOfRow) report.inFileDuplicates += 1;
    if (duplicateLeadId && planned !== "error") report.existingMatches += 1;
    if (planned === "create") report.plannedCreate += 1;
    if (planned === "update") report.plannedUpdate += 1;
    if (planned === "skip") report.plannedSkip += 1;
    return { rowNumber: row.rowNumber, raw: row.raw, normalized: row.normalized, errors, errorCode, planned, duplicateLeadId, duplicateOfRow: row.duplicateOfRow ?? null };
  });

  const batch = (
    await client.query(
      `INSERT INTO tenant.crm_lead_import_batches(organization_id,file_name,source_format,field_mapping,duplicate_strategy,total_rows,valid_rows,invalid_rows,content_hash,dry_run_report,created_by)
       VALUES($1,$2,'csv',$3::jsonb,$4,$5,$6,$7,$8,$9::jsonb,$10) RETURNING *`,
      [context.organizationId, fileName, JSON.stringify(input.fieldMapping || {}), duplicateStrategy, report.total, report.valid, report.invalid, contentHash, JSON.stringify(report), context.userId],
    )
  ).rows[0];
  // Bulk staging: one INSERT per 1,000 rows, not one round trip per row.
  for (let start = 0; start < staged.length; start += LEAD_IMPORT_LIMITS.insertChunk) {
    const chunk = staged.slice(start, start + LEAD_IMPORT_LIMITS.insertChunk).map((row) => ({
      row_number: row.rowNumber,
      raw_data: row.raw,
      normalized_data: row.normalized,
      validation_errors: row.errors,
      duplicate_lead_id: row.duplicateLeadId,
      action: row.planned === "error" ? "error" : "pending",
      planned_action: row.planned,
      error_code: row.errorCode,
      duplicate_of_row: row.duplicateOfRow,
    }));
    await client.query(
      `INSERT INTO tenant.crm_lead_import_rows(organization_id,batch_id,row_number,raw_data,normalized_data,validation_errors,duplicate_lead_id,action,planned_action,error_code,duplicate_of_row)
       SELECT $1, $2, item.row_number, item.raw_data, item.normalized_data, item.validation_errors, item.duplicate_lead_id, item.action, item.planned_action, item.error_code, item.duplicate_of_row
         FROM jsonb_to_recordset($3::jsonb) AS item(row_number integer, raw_data jsonb, normalized_data jsonb, validation_errors jsonb, duplicate_lead_id uuid, action text, planned_action text, error_code text, duplicate_of_row integer)`,
      [context.organizationId, batch.id, JSON.stringify(chunk)],
    );
  }
  return {
    batch,
    report,
    // Rejected rows first (what the user must fix), then a sample of the rest.
    rows: [...staged.filter((row) => row.planned === "error").slice(0, 200), ...staged.filter((row) => row.planned !== "error").slice(0, 20)].map((row) => ({ rowNumber: row.rowNumber, valid: row.planned !== "error", planned: row.planned, errors: row.errors, duplicateOfRow: row.duplicateOfRow, matchesExisting: Boolean(row.duplicateLeadId) })),
    idempotent: false,
  };
}

async function loadBatch(client, context, batchId, { lock = false } = {}) {
  if (!UUID.test(String(batchId || ""))) throw notFound();
  const values = [context.organizationId, batchId];
  let own = "";
  if (!canSeeAllImports(context)) {
    values.push(context.userId);
    own = " AND created_by=$3";
  }
  const { rows } = await client.query(`SELECT * FROM tenant.crm_lead_import_batches WHERE organization_id=$1 AND id=$2${own}${lock ? " FOR UPDATE" : ""}`, values);
  if (!rows[0]) throw notFound();
  return rows[0];
}

// A row-level problem (validation, duplicate policy, data/constraint error)
// is recorded on the row; anything else (connection loss, deadlock, timeout)
// fails the chunk so the job retries it from the same pending rows.
function isRowError(error) {
  const status = Number(error?.status);
  if (Number.isFinite(status) && status >= 400 && status < 500) return true;
  return typeof error?.code === "string" && /^(22|23)/.test(error.code);
}

async function refreshCounters(client, organizationId, batchId) {
  const { rows } = await client.query(
    `UPDATE tenant.crm_lead_import_batches batch
        SET created_rows=counts.created, updated_rows=counts.updated, skipped_rows=counts.skipped, failed_rows=counts.failed,
            processed_rows=counts.processed, updated_at=now()
       FROM (SELECT count(*) FILTER (WHERE action='create')::int AS created, count(*) FILTER (WHERE action='update')::int AS updated,
                    count(*) FILTER (WHERE action='skip')::int AS skipped, count(*) FILTER (WHERE action='error' AND processed_at IS NOT NULL)::int AS failed,
                    count(*) FILTER (WHERE processed_at IS NOT NULL)::int AS processed, count(*) FILTER (WHERE action='pending')::int AS pending
               FROM tenant.crm_lead_import_rows WHERE organization_id=$1 AND batch_id=$2) counts
      WHERE batch.organization_id=$1 AND batch.id=$2
      RETURNING batch.*, counts.pending`,
    [organizationId, batchId],
  );
  return rows[0];
}

/**
 * Processes the next chunk of pending rows of a batch (row order, SKIP LOCKED
 * so two workers never take the same rows). Each row runs in a savepoint: a
 * bad row is recorded as an error and the rest of the chunk continues.
 */
export async function processLeadImportChunk(client, context, batchId, { limit = LEAD_IMPORT_LIMITS.chunkSize } = {}) {
  const batch = (await client.query(`SELECT * FROM tenant.crm_lead_import_batches WHERE organization_id=$1 AND id=$2`, [context.organizationId, batchId])).rows[0];
  if (!batch) throw notFound();
  const pending = await client.query(
    `SELECT id, row_number, raw_data, normalized_data FROM tenant.crm_lead_import_rows
      WHERE organization_id=$1 AND batch_id=$2 AND action='pending' ORDER BY row_number LIMIT $3 FOR UPDATE SKIP LOCKED`,
    [context.organizationId, batchId, Math.max(1, Math.min(1000, Number(limit) || LEAD_IMPORT_LIMITS.chunkSize))],
  );
  for (const row of pending.rows) {
    await client.query("SAVEPOINT crm_lead_import_row");
    try {
      const result = await createIngestedLead(client, context, row.normalized_data, {
        duplicateStrategy: batch.duplicate_strategy,
        enforceScope: true,
      });
      if (result.action === "create")
        await client.query(
          `INSERT INTO tenant.crm_lead_provenance(organization_id,lead_id,source_channel,source_record_id,provider,external_id,original_payload,content_hash,created_by)
           VALUES($1,$2,'import',$3,'import',$4,$5::jsonb,$6,$7)`,
          [context.organizationId, result.leadId, batchId, `${batchId}:${row.row_number}`, JSON.stringify(row.raw_data), crmLeadAcquisitionHash(row.raw_data), context.userId],
        );
      await client.query(`UPDATE tenant.crm_lead_import_rows SET action=$3,result_lead_id=$4,processed_at=now() WHERE organization_id=$1 AND id=$2`, [context.organizationId, row.id, result.action, result.leadId]);
      await client.query("RELEASE SAVEPOINT crm_lead_import_row");
    } catch (error) {
      await client.query("ROLLBACK TO SAVEPOINT crm_lead_import_row");
      await client.query("RELEASE SAVEPOINT crm_lead_import_row");
      if (!isRowError(error)) throw error; // infrastructure failure: the whole chunk rolls back and retries
      await client.query(
        `UPDATE tenant.crm_lead_import_rows SET action='error',error_code=$3,validation_errors=$4::jsonb,processed_at=now() WHERE organization_id=$1 AND id=$2`,
        [context.organizationId, row.id, String(error?.code || "CRM_LEAD_IMPORT_ROW_FAILED").slice(0, 80), JSON.stringify([{ message: String(error?.message || "Import failed").slice(0, 300) }])],
      );
    }
  }
  const counters = await refreshCounters(client, context.organizationId, batchId);
  return { processed: pending.rows.length, remaining: Number(counters.pending) };
}

export async function finalizeLeadImport(client, context, batchId, { failureReason = null } = {}) {
  const counters = await refreshCounters(client, context.organizationId, batchId);
  const status = failureReason ? "failed" : Number(counters.failed_rows) + Number(counters.invalid_rows) > 0 ? "completed_with_errors" : "completed";
  const { rows } = await client.query(
    `UPDATE tenant.crm_lead_import_batches SET status=$3, committed_at=COALESCE(committed_at, now()), completed_at=now(), failure_reason=$4, updated_at=now()
      WHERE organization_id=$1 AND id=$2 AND status IN ('queued','processing','committing') RETURNING *`,
    [context.organizationId, batchId, status, failureReason],
  );
  if (rows[0]) await queueOutboxEvent(client, context, "crm.leads.import_completed", "lead_import_batches", batchId, { status, created: rows[0].created_rows, updated: rows[0].updated_rows, skipped: rows[0].skipped_rows, failed: rows[0].failed_rows });
  return rows[0] ?? null;
}

/**
 * Commit: small batches run now (still chunked); large ones become one
 * background job. Idempotent: committing a queued, running or finished batch
 * returns its current state instead of starting a second import.
 */
export async function commitLeadImport(client, context, batchId) {
  const batch = await loadBatch(client, context, batchId, { lock: true });
  if (["queued", "processing", "committing", "completed", "completed_with_errors"].includes(batch.status))
    return { batch, async: ["queued", "processing"].includes(batch.status), replayed: true };
  if (batch.status !== "previewed") throw new CrmLeadAcquisitionError(409, "Only a previewed import can be committed.", "CRM_LEAD_IMPORT_STATE_INVALID");
  const pending = Number((await client.query(`SELECT count(*)::int AS n FROM tenant.crm_lead_import_rows WHERE organization_id=$1 AND batch_id=$2 AND action='pending'`, [context.organizationId, batch.id])).rows[0].n);
  if (pending > LEAD_IMPORT_LIMITS.syncCommitRows) {
    const job = await client.query(
      `INSERT INTO tenant.background_jobs(organization_id,job_type,payload,idempotency_key,requested_by,max_attempts,progress,result_manifest)
       VALUES($1,$2,$3::jsonb,$4,$5,5,'{}'::jsonb,'{}'::jsonb)
       ON CONFLICT (organization_id,idempotency_key) DO NOTHING RETURNING id`,
      [
        context.organizationId,
        LEAD_IMPORT_JOB_TYPE,
        JSON.stringify({ batchId: batch.id, requesterUserId: context.userId }),
        `${LEAD_IMPORT_JOB_TYPE}:${batch.id}`,
        context.userId,
      ],
    );
    const jobId = job.rows[0]?.id ?? (await client.query(`SELECT id FROM tenant.background_jobs WHERE organization_id=$1 AND idempotency_key=$2`, [context.organizationId, `${LEAD_IMPORT_JOB_TYPE}:${batch.id}`])).rows[0].id;
    const queued = await client.query(`UPDATE tenant.crm_lead_import_batches SET status='queued', job_id=$3, updated_at=now() WHERE organization_id=$1 AND id=$2 RETURNING *`, [context.organizationId, batch.id, jobId]);
    return { batch: queued.rows[0], async: true, jobId };
  }
  await client.query(`UPDATE tenant.crm_lead_import_batches SET status='committing', started_at=now(), updated_at=now() WHERE organization_id=$1 AND id=$2`, [context.organizationId, batch.id]);
  for (;;) {
    const chunk = await processLeadImportChunk(client, context, batch.id);
    if (!chunk.remaining || !chunk.processed) break;
  }
  return { batch: await finalizeLeadImport(client, context, batch.id), async: false };
}

/** Progress and result of one batch (the creator, or someone who sees every lead). */
export async function getLeadImportBatch(client, context, batchId) {
  const batch = await loadBatch(client, context, batchId);
  const job = batch.job_id
    ? (await client.query(`SELECT status, attempts, last_error, completed_at FROM tenant.background_jobs WHERE organization_id=$1 AND id=$2`, [context.organizationId, batch.job_id])).rows[0] ?? null
    : null;
  const total = Number(batch.valid_rows);
  return {
    batch,
    progress: { processed: Number(batch.processed_rows), total, percent: total ? Math.min(100, Math.round((Number(batch.processed_rows) / total) * 100)) : 100 },
    job: job ? camelizeRow(job) : null,
  };
}

export async function listCrmLeadImportBatches(client, context, { limit = 25 } = {}) {
  const values = [context.organizationId];
  let own = "";
  if (!canSeeAllImports(context)) {
    values.push(context.userId);
    own = ` AND created_by=$${values.length}`;
  }
  values.push(Math.max(1, Math.min(100, Math.trunc(Number(limit)) || 25)));
  const { rows } = await client.query(`SELECT * FROM tenant.crm_lead_import_batches WHERE organization_id=$1${own} ORDER BY created_at DESC LIMIT $${values.length}`, values);
  return rows;
}

/**
 * Every rejected or failed row as CSV: row number, problem, then the original
 * columns. Cells are neutralised against spreadsheet formula injection.
 */
export async function getLeadImportErrorsCsv(client, context, batchId) {
  const batch = await loadBatch(client, context, batchId);
  const { rows } = await client.query(
    `SELECT row_number, error_code, validation_errors, raw_data FROM tenant.crm_lead_import_rows
      WHERE organization_id=$1 AND batch_id=$2 AND action='error' ORDER BY row_number`,
    [context.organizationId, batch.id],
  );
  const sourceColumns = [...new Set(rows.flatMap((row) => Object.keys(row.raw_data || {})))].slice(0, 100);
  const columns = [
    { key: "__row", label: "Row" },
    { key: "__code", label: "Problem code" },
    { key: "__problem", label: "Problem" },
    ...sourceColumns.map((column) => ({ key: `raw:${column}`, label: column })),
  ];
  const records = rows.map((row) => ({
    __row: row.row_number + 1, // +1: the header is line 1 of the uploaded file
    __code: row.error_code || "CRM_LEAD_IMPORT_ROW_INVALID",
    __problem: (Array.isArray(row.validation_errors) ? row.validation_errors : []).map((error) => error.message).join("; "),
    ...Object.fromEntries(sourceColumns.map((column) => [`raw:${column}`, row.raw_data?.[column] ?? ""])),
  }));
  return { fileName: `${String(batch.file_name).replace(/\.csv$/i, "").replace(/[^\w.-]+/g, "_").slice(0, 80)}-errors.csv`, csv: rowsToCsv(columns, records), rows: records.length };
}

/** Removes leads a completed import created that nobody has worked yet. */
export async function rollbackLeadImport(client, context, batchId) {
  const batch = await loadBatch(client, context, batchId, { lock: true });
  if (!["completed", "completed_with_errors"].includes(batch.status)) throw new CrmLeadAcquisitionError(409, "Only a completed import can be rolled back.", "CRM_LEAD_IMPORT_STATE_INVALID");
  const deleted = await client.query(
    `DELETE FROM tenant.crm_leads lead USING tenant.crm_lead_provenance provenance
     WHERE provenance.organization_id=$1 AND provenance.source_channel='import' AND provenance.source_record_id=$2
       AND lead.organization_id=provenance.organization_id AND lead.id=provenance.lead_id
       AND NOT EXISTS(SELECT 1 FROM tenant.crm_activities activity WHERE activity.organization_id=lead.organization_id AND activity.entity_type='lead' AND activity.entity_id=lead.id)
     RETURNING lead.id`,
    [context.organizationId, batch.id],
  );
  await client.query(`UPDATE tenant.crm_lead_import_batches SET status='rolled_back',rolled_back_at=now(),updated_at=now() WHERE organization_id=$1 AND id=$2`, [context.organizationId, batch.id]);
  return { rolledBack: deleted.rows.length, protected: Math.max(0, Number(batch.created_rows) - deleted.rows.length) };
}
