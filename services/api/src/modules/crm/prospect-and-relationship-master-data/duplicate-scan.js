// F008 gap-closure — a genuine full-dataset duplicate scan, distinct from
// the deliberately-scoped "suspected duplicates" workspace check (which
// only ever looks at the 40 most-recently-changed records via the
// frontend). This is a real background job that pages through every
// active record of a given entity type and calls the SAME governed
// matching engine (evaluateLeadDuplicateRisk / findAccountDuplicates /
// findContactDuplicates) per record — no separate/simplified matching
// logic is introduced here, exactly the constraint the workspace's own
// code comments already establish for this feature.
import { CrmError } from "../crm-data-operations-and-customization/errors.js";
import { queueOutboxEvent } from "../crm-data-operations-and-customization/outbox.js";
import { evaluateLeadDuplicateRisk } from "./lead-duplicates.js";
import { findAccountDuplicates, findContactDuplicates } from "./duplicate-matching.js";

export const DUPLICATE_FULL_SCAN_JOB_TYPE = "crm.duplicates.full_scan";
export const DUPLICATE_FULL_SCAN_BATCH_SIZE = 100;

const ENTITY_TYPES = new Set(["lead", "contact", "account"]);

function text(value) {
  return String(value ?? "").trim();
}

function jobProjection(row) {
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    jobType: row.job_type,
    entityType: row.payload?.entityType || null,
    attempts: Number(row.attempts || 0),
    maxAttempts: Number(row.max_attempts || 0),
    progress: row.progress || {},
    resultManifest: row.result_manifest || {},
    lastError: row.status === "dead" ? String(row.last_error || "Duplicate scan job failed.") : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

// Each "run a scan" request deliberately creates a new job rather than
// deduping against a prior one (unlike stage migration's singleton-per-
// from/to-pair job) — a later scan is expected to find newly-created
// duplicates a stale one never saw, so no idempotency_key is set (NULL
// never collides with the table's UNIQUE(organization_id, idempotency_key)
// constraint), same as crm-lead-export.js's own enqueue.
export async function enqueueDuplicateFullScan(client, context, entityType) {
  const type = text(entityType);
  if (!ENTITY_TYPES.has(type))
    throw new CrmError(400, "Choose Lead, Account or Contact to scan.", "CRM_DUPLICATE_SCAN_ENTITY_INVALID");
  const inserted = await client.query(
    `INSERT INTO tenant.background_jobs
       (organization_id,job_type,payload,status,run_at,priority,max_attempts,requested_by,progress,result_manifest)
     VALUES($1,$2,$3::jsonb,'pending',now(),50,3,$4,'{}'::jsonb,'{}'::jsonb)
     RETURNING *`,
    [
      context.organizationId,
      DUPLICATE_FULL_SCAN_JOB_TYPE,
      JSON.stringify({ entityType: type, requesterUserId: context.userId }),
      context.userId,
    ],
  );
  const job = inserted.rows[0];
  await queueOutboxEvent(client, context, "crm.duplicates.full_scan.started", "duplicate_scan", job.id, {
    entityType: type, jobId: job.id,
  });
  return jobProjection(job);
}

export async function getDuplicateFullScanJob(client, context, jobId) {
  const result = await client.query(
    `SELECT * FROM tenant.background_jobs WHERE organization_id=$1 AND id=$2 AND job_type=$3`,
    [context.organizationId, jobId, DUPLICATE_FULL_SCAN_JOB_TYPE],
  );
  if (!result.rows[0]) throw new CrmError(404, "Duplicate scan job not found.", "CRM_DUPLICATE_SCAN_JOB_NOT_FOUND");
  return jobProjection(result.rows[0]);
}

// The frontend never needs to remember a job id across a page reload — it
// just asks "what's the latest scan for this entity type", the same way
// the honestly-scoped workspace check needs no job bookkeeping at all.
export async function getLatestDuplicateFullScan(client, context, entityType) {
  const type = text(entityType);
  if (!ENTITY_TYPES.has(type))
    throw new CrmError(400, "Choose Lead, Account or Contact.", "CRM_DUPLICATE_SCAN_ENTITY_INVALID");
  const result = await client.query(
    `SELECT * FROM tenant.background_jobs
      WHERE organization_id=$1 AND job_type=$2 AND payload->>'entityType'=$3
      ORDER BY created_at DESC LIMIT 1`,
    [context.organizationId, DUPLICATE_FULL_SCAN_JOB_TYPE, type],
  );
  return jobProjection(result.rows[0]);
}

async function labelsFor(client, organizationId, entityType, ids) {
  if (!ids.length) return new Map();
  if (entityType === "lead") {
    const result = await client.query(
      `SELECT id,full_name AS label FROM tenant.crm_leads WHERE organization_id=$1 AND id=ANY($2::uuid[])`,
      [organizationId, ids],
    );
    return new Map(result.rows.map((row) => [row.id, row.label]));
  }
  if (entityType === "account") {
    const result = await client.query(
      `SELECT id,display_name AS label FROM tenant.business_parties WHERE organization_id=$1 AND id=ANY($2::uuid[])`,
      [organizationId, ids],
    );
    return new Map(result.rows.map((row) => [row.id, row.label]));
  }
  const result = await client.query(
    `SELECT id,btrim(first_name || ' ' || COALESCE(last_name,'')) AS label FROM tenant.contacts WHERE organization_id=$1 AND id=ANY($2::uuid[])`,
    [organizationId, ids],
  );
  return new Map(result.rows.map((row) => [row.id, row.label]));
}

// Names are resolved separately (never embedded in the scan-time insert)
// so a match always shows a record's CURRENT name, never a stale snapshot
// from whenever the scan ran — consistent with the table's own append-only,
// resolution-free design (see migration 169's comment on this table).
export async function listDuplicateScanMatches(client, context, jobId) {
  const result = await client.query(
    `SELECT * FROM tenant.crm_duplicate_scan_matches
      WHERE organization_id=$1 AND job_id=$2
      ORDER BY classification='exact' DESC, created_at DESC
      LIMIT 500`,
    [context.organizationId, jobId],
  );
  if (!result.rows.length) return [];
  const entityType = result.rows[0].entity_type;
  const ids = [...new Set(result.rows.flatMap((row) => [row.record_a_id, row.record_b_id]))];
  const labels = await labelsFor(client, context.organizationId, entityType, ids);
  return result.rows.map((row) => ({
    id: row.id,
    entityType: row.entity_type,
    recordAId: row.record_a_id,
    recordAName: labels.get(row.record_a_id) || null,
    recordBId: row.record_b_id,
    recordBName: labels.get(row.record_b_id) || null,
    classification: row.classification,
    matchedSignals: row.matched_signals || [],
    createdAt: row.created_at,
  }));
}

async function fetchPage(client, organizationId, entityType, lastId, limit) {
  if (entityType === "lead") {
    const result = await client.query(
      `SELECT id,first_name,last_name,email,mobile,phone,company_name FROM tenant.crm_leads
        WHERE organization_id=$1 AND record_status='active' AND ($2::uuid IS NULL OR id>$2)
        ORDER BY id LIMIT $3`,
      [organizationId, lastId, limit],
    );
    return result.rows;
  }
  if (entityType === "account") {
    const result = await client.query(
      `SELECT id,display_name,legal_name,gstin,pan FROM tenant.business_parties
        WHERE organization_id=$1 AND status='active' AND ($2::uuid IS NULL OR id>$2)
        ORDER BY id LIMIT $3`,
      [organizationId, lastId, limit],
    );
    return result.rows;
  }
  const result = await client.query(
    `SELECT id,first_name,last_name,email,mobile,phone FROM tenant.contacts
      WHERE organization_id=$1 AND status='active' AND ($2::uuid IS NULL OR id>$2)
      ORDER BY id LIMIT $3`,
    [organizationId, lastId, limit],
  );
  return result.rows;
}

async function matchesFor(client, context, entityType, row) {
  if (entityType === "lead") {
    const evaluation = await evaluateLeadDuplicateRisk(
      client,
      context,
      { firstName: row.first_name, lastName: row.last_name, email: row.email, mobile: row.mobile, phone: row.phone, companyName: row.company_name },
      { excludeLeadId: row.id, lock: false },
    );
    return evaluation.internalMatches.map((match) => ({ id: match.row.id, classification: match.classification, signals: match.signals }));
  }
  if (entityType === "account") {
    const rows = await findAccountDuplicates(client, context, { displayName: row.display_name, legalName: row.legal_name, gstin: row.gstin, pan: row.pan, excludeId: row.id });
    return rows.filter((match) => match.classification !== "none").map((match) => ({ id: match.id, classification: match.classification, signals: match.matched_signals || [] }));
  }
  const rows = await findContactDuplicates(client, context, { firstName: row.first_name, lastName: row.last_name, email: row.email, mobile: row.mobile, phone: row.phone, excludeId: row.id });
  return rows.filter((match) => match.classification !== "none").map((match) => ({ id: match.id, classification: match.classification, signals: match.matched_signals || [] }));
}

async function recordMatch(client, context, jobId, entityType, aId, bId, classification, signals) {
  const [recordAId, recordBId] = [String(aId), String(bId)].sort();
  await client.query(
    `INSERT INTO tenant.crm_duplicate_scan_matches
       (organization_id,job_id,entity_type,record_a_id,record_b_id,classification,matched_signals)
     VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)
     ON CONFLICT (organization_id,job_id,record_a_id,record_b_id)
     DO UPDATE SET classification=EXCLUDED.classification WHERE tenant.crm_duplicate_scan_matches.classification<>'exact'`,
    [context.organizationId, jobId, entityType, recordAId, recordBId, classification, JSON.stringify(signals)],
  );
}

// Called by the worker handler once per lease-extension cycle — mirrors
// processLeadStageMigrationBatch's exact "keep calling until done" shape.
// Keyset-paginated (never OFFSET) so a resumed/retried job never re-scans
// records it already covered, and a concurrently-growing table can't cause
// a page to be skipped or duplicated the way OFFSET pagination would.
export async function processDuplicateFullScanBatch(client, systemContext, jobId) {
  const job = await client.query(
    `SELECT * FROM tenant.background_jobs WHERE organization_id=$1 AND id=$2`,
    [systemContext.organizationId, jobId],
  );
  const row = job.rows[0];
  if (!row) throw new CrmError(404, "Duplicate scan job not found.", "CRM_DUPLICATE_SCAN_JOB_NOT_FOUND");
  const entityType = row.payload?.entityType;
  const progress = row.progress || {};
  const lastId = progress.lastId || null;
  const processedSoFar = Number(progress.processed || 0);
  const foundSoFar = Number(progress.found || 0);

  const page = await fetchPage(client, systemContext.organizationId, entityType, lastId, DUPLICATE_FULL_SCAN_BATCH_SIZE);
  let found = foundSoFar;
  for (const record of page) {
    const matches = await matchesFor(client, systemContext, entityType, record);
    for (const match of matches) {
      await recordMatch(client, systemContext, jobId, entityType, record.id, match.id, match.classification, match.signals);
      found += 1;
    }
  }
  const processed = processedSoFar + page.length;
  const done = page.length < DUPLICATE_FULL_SCAN_BATCH_SIZE;
  const manifest = {
    lastId: page.length ? page[page.length - 1].id : lastId,
    processed,
    found,
    percent: done ? 100 : null,
  };
  await client.query(
    `UPDATE tenant.background_jobs SET progress=$3::jsonb,result_manifest=$3::jsonb,updated_at=now()
      WHERE organization_id=$1 AND id=$2`,
    [systemContext.organizationId, jobId, JSON.stringify(manifest)],
  );
  return { done, manifest };
}
