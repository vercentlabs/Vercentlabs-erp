import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { config as loadDotEnv } from "dotenv";
import pg from "pg";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
for (const file of [
  path.join(root, "apps/web/.env.local"),
  path.join(root, "apps/web/.env"),
  path.join(root, ".env"),
]) {
  if (fs.existsSync(file)) loadDotEnv({ path: file, override: false });
}

const connectionString = String(
  process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL || "",
).trim();
if (!connectionString) {
  throw new Error(
    "MIGRATION_DATABASE_URL or DATABASE_URL is required for F001 Pass 2C performance verification. " +
      "The verifier loads apps/web/.env.local, apps/web/.env and .env automatically.",
  );
}

const requestedRows = Number(process.env.F001_PERF_ROWS || 50_000);
const rowCount = Math.max(10_000, Math.min(100_000, Math.trunc(requestedRows || 50_000)));
const thresholds = {
  detailP95Ms: 400,
  filteredListP95Ms: 600,
  dashboardP95Ms: 600,
  mutationP95Ms: 750,
};
const samplesPerProbe = 7;
const warmups = 2;

const client = new pg.Client({
  connectionString,
  application_name: "vercentlabs-f001-pass2c-performance-verifier",
});

function percentile95(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] || 0;
}

async function measure(query, values, { mutate = false } = {}) {
  const samples = [];
  for (let index = 0; index < warmups + samplesPerProbe; index += 1) {
    if (mutate) await client.query("SAVEPOINT f001_perf_mutation");
    const started = performance.now();
    await client.query(query, values);
    const elapsed = performance.now() - started;
    if (mutate) await client.query("ROLLBACK TO SAVEPOINT f001_perf_mutation");
    if (index >= warmups) samples.push(elapsed);
  }
  return {
    p95Ms: Number(percentile95(samples).toFixed(2)),
    maxMs: Number(Math.max(...samples).toFixed(2)),
    samplesMs: samples.map((value) => Number(value.toFixed(2))),
  };
}

const result = {
  representativeRows: rowCount,
  migrationPresent: false,
  indexesPresent: false,
  probes: {},
  thresholds,
  passed: false,
  rolledBack: false,
};

let transactionOpen = false;
await client.connect();
try {
  await client.query("BEGIN");
  transactionOpen = true;

  const migrationShape = await client.query(`
    SELECT
      to_regclass('tenant.crm_lead_bulk_job_items') IS NOT NULL AS item_table,
      EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema='tenant' AND table_name='background_jobs' AND column_name='requested_by'
      ) AS requester_column,
      EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema='tenant' AND table_name='background_jobs' AND column_name='result_manifest'
      ) AS result_column`);
  result.migrationPresent = Boolean(
    migrationShape.rows[0]?.item_table &&
      migrationShape.rows[0]?.requester_column &&
      migrationShape.rows[0]?.result_column,
  );
  if (!result.migrationPresent) {
    throw new Error("F001 Pass 2C migration 074_f001_lead_bulk_scale.sql is not applied.");
  }

  const indexRows = await client.query(`
    SELECT indexname
      FROM pg_indexes
     WHERE schemaname='tenant'
       AND indexname IN (
         'crm_leads_f001_active_queue_idx',
         'crm_leads_f001_owner_queue_idx',
         'crm_leads_f001_followup_queue_idx',
         'crm_lead_bulk_job_items_pending_idx'
       )`);
  result.indexesPresent = indexRows.rowCount === 4;
  if (!result.indexesPresent) throw new Error("F001 Pass 2C queue/list indexes are incomplete.");

  const base = (
    await client.query(`
      SELECT organization.id AS organization_id,
             company.id AS company_id,
             branch.id AS branch_id
        FROM public.organizations organization
        JOIN public.companies company
          ON company.organization_id=organization.id AND company.status='active'
        LEFT JOIN LATERAL (
          SELECT candidate.id
            FROM public.branches candidate
           WHERE candidate.organization_id=organization.id
             AND candidate.company_id=company.id
             AND candidate.status='active'
           ORDER BY candidate.is_primary DESC,candidate.created_at,candidate.id
           LIMIT 1
        ) branch ON true
       WHERE organization.status='active'
       ORDER BY company.is_primary DESC,organization.created_at,company.created_at
       LIMIT 1`)
  ).rows[0];
  if (!base) throw new Error("F001 Pass 2C performance verification requires an active organization/company.");
  await client.query("SELECT set_config('app.current_organization_id',$1,true)", [base.organization_id]);

  const actor = (
    await client.query(
      `SELECT membership.user_id
         FROM public.organization_memberships membership
         JOIN public.users user_account
           ON user_account.id=membership.user_id AND user_account.status='active'
        WHERE membership.organization_id=$1 AND membership.status='active'
        ORDER BY (membership.role='owner') DESC,membership.created_at,membership.user_id
        LIMIT 1`,
      [base.organization_id],
    )
  ).rows[0];
  if (!actor) throw new Error("F001 Pass 2C performance verification requires an active organization member.");

  const stage = (
    await client.query(
      `SELECT code
         FROM tenant.crm_lead_stages
        WHERE organization_id=$1 AND status='active'
        ORDER BY is_initial DESC,sort_order,id
        LIMIT 1`,
      [base.organization_id],
    )
  ).rows[0];
  if (!stage) throw new Error("F001 Pass 2C performance verification requires an active Lead lifecycle stage.");

  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const inserted = await client.query(
    `INSERT INTO tenant.crm_leads(
       organization_id,company_id,branch_id,code,first_name,email,status,record_status,
       owner_user_id,priority,rating,next_follow_up_at,created_by,updated_by,created_at,updated_at
     )
     SELECT $1,$2,$3,
            'F001P2C-' || $4 || '-' || series::text,
            'Scale ' || series::text,
            'f001p2c-' || $4 || '-' || series::text || '@example.invalid',
            $5,'active',$6,
            CASE series % 4 WHEN 0 THEN 'urgent' WHEN 1 THEN 'high' WHEN 2 THEN 'medium' ELSE 'low' END,
            CASE series % 3 WHEN 0 THEN 'hot' WHEN 1 THEN 'warm' ELSE 'cold' END,
            CASE WHEN series % 5 = 0 THEN now() - interval '1 hour' ELSE now() + interval '1 day' END,
            $6,$6,
            now() - ((series % 45)::text || ' days')::interval,
            now() - ((series % 240)::text || ' minutes')::interval
       FROM generate_series(1,$7::int) series
     RETURNING id`,
    [
      base.organization_id,
      base.company_id,
      base.branch_id || null,
      suffix,
      stage.code,
      actor.user_id,
      rowCount,
    ],
  );
  if (inserted.rowCount !== rowCount) throw new Error(`Expected ${rowCount} representative Leads, inserted ${inserted.rowCount}.`);
  const targetId = inserted.rows[Math.floor(inserted.rows.length / 2)].id;

  const detailSql = `SELECT id,code,full_name,email,status,priority,rating,updated_at
       FROM tenant.crm_leads
      WHERE organization_id=$1 AND id=$2 AND record_status='active'
      LIMIT 1`;
  result.probes.detail = await measure(detailSql, [base.organization_id, targetId]);

  const filteredListSql = `SELECT id,code,full_name,status,priority,rating,next_follow_up_at,updated_at
       FROM tenant.crm_leads
      WHERE organization_id=$1
        AND record_status='active'
        AND (company_id IS NULL OR company_id=$2)
        AND owner_user_id=$3
      ORDER BY updated_at DESC,created_at DESC,id DESC
      LIMIT 50`;
  result.probes.filteredList = await measure(filteredListSql, [
    base.organization_id,
    base.company_id,
    actor.user_id,
  ]);

  const dashboardSql = `SELECT
       count(*)::int AS total,
       count(*) FILTER (
         WHERE btrim(COALESCE(NULLIF(full_name,''), concat_ws(' ',first_name,last_name))) <> ''
           AND (NULLIF(btrim(COALESCE(email,'')),'') IS NOT NULL
             OR NULLIF(btrim(COALESCE(mobile,'')),'') IS NOT NULL
             OR NULLIF(btrim(COALESCE(phone,'')),'') IS NOT NULL)
       )::int AS ready,
       count(*) FILTER (WHERE next_follow_up_at < now())::int AS overdue
     FROM tenant.crm_leads
    WHERE organization_id=$1 AND record_status='active'
      AND (company_id IS NULL OR company_id=$2)`;
  result.probes.dashboard = await measure(dashboardSql, [base.organization_id, base.company_id]);

  const mutationSql = `UPDATE tenant.crm_leads
      SET priority=CASE priority WHEN 'high' THEN 'medium' ELSE 'high' END,
          updated_by=$3,updated_at=now()
    WHERE organization_id=$1 AND id=$2 AND record_status='active'
    RETURNING id,updated_at`;
  result.probes.mutation = await measure(
    mutationSql,
    [base.organization_id, targetId, actor.user_id],
    { mutate: true },
  );

  result.passed =
    result.probes.detail.p95Ms <= thresholds.detailP95Ms &&
    result.probes.filteredList.p95Ms <= thresholds.filteredListP95Ms &&
    result.probes.dashboard.p95Ms <= thresholds.dashboardP95Ms &&
    result.probes.mutation.p95Ms <= thresholds.mutationP95Ms;

  if (!result.passed) {
    throw new Error(`F001 Pass 2C performance thresholds were exceeded: ${JSON.stringify(result.probes)}`);
  }
} finally {
  if (transactionOpen) {
    await client.query("ROLLBACK").catch(() => {});
    result.rolledBack = true;
  }
  await client.end();
}

console.log(JSON.stringify(result, null, 2));
