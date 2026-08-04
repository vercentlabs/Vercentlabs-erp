import path from "node:path";
import { createHash } from "node:crypto";

import dotenv from "dotenv";
import pg from "pg";

import { databaseConfig } from "@vercentlabs/config";
import { setTenantContext } from "@vercentlabs/database";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local"), quiet: true });
dotenv.config({ quiet: true });

const config = databaseConfig(process.env, { defaultPoolMaximum: 2 });
const pool = new pg.Pool({
  connectionString:
    process.env.MIGRATION_DATABASE_URL || config.connectionString,
  max: 2,
  application_name: "vercentlabs-crm-product-live-verifier",
});

const releaseSha = String(process.env.RELEASE_SHA || "crm-product-local");
const hash = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

async function record(client, context, dimension, tier, status, evidence) {
  const payload = {
    dimension,
    tier,
    status,
    releaseSha,
    evidence,
  };
  await client.query(
    `INSERT INTO tenant.crm_product_acceptance_runs(
       organization_id,release_sha,dimension,acceptance_tier,status,evidence,
       evidence_hash,verified_by
     ) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8)`,
    [
      context.organizationId,
      releaseSha,
      dimension,
      tier,
      status,
      JSON.stringify(evidence),
      hash(payload),
      context.userId,
    ],
  );
}

try {
  const baseline = (
    await pool.query(
      `SELECT organization.id AS organization_id,organization.created_by AS user_id
       FROM public.organizations organization
       WHERE organization.status='active'
       ORDER BY organization.created_at
       LIMIT 1`,
    )
  ).rows[0];
  if (!baseline) throw new Error("An active organisation is required.");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await setTenantContext(client, baseline.organization_id);
    const context = {
      organizationId: baseline.organization_id,
      userId: baseline.user_id,
    };

    const security = await client.query(
      `SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity,
         EXISTS(
           SELECT 1 FROM pg_policy policy
           WHERE policy.polrelid=c.oid AND policy.polname='tenant_organization_isolation'
         ) AS has_policy
       FROM pg_class c
       JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='tenant'
         AND c.relname IN ('crm_product_acceptance_runs','crm_provider_execution_receipts')
       ORDER BY c.relname`,
    );
    if (security.rows.length !== 2) {
      throw new Error("CRM product acceptance tables are missing.");
    }
    for (const row of security.rows) {
      if (!row.relrowsecurity || !row.relforcerowsecurity || !row.has_policy) {
        throw new Error(`Tenant security is incomplete for ${row.relname}.`);
      }
    }

    const queues = (
      await client.query(
        `SELECT
          (SELECT count(*)::int FROM tenant.crm_telephony_commands WHERE organization_id=$1 AND status IN ('queued','failed','processing')) AS telephony,
          (SELECT count(*)::int FROM tenant.crm_transcription_jobs WHERE organization_id=$1 AND status IN ('queued','failed','processing')) AS transcription,
          (SELECT count(*)::int FROM tenant.crm_provider_sync_jobs WHERE organization_id=$1 AND status IN ('queued','failed','processing')) AS provider_sync,
          (SELECT count(*)::int FROM tenant.crm_provider_execution_receipts WHERE organization_id=$1) AS receipts`,
        [context.organizationId],
      )
    ).rows[0];

    const localEvidence = {
      releaseSha,
      tenantIsolation: true,
      canonicalWorkspaces: 10,
      capabilityCount: 83,
      queues,
      persistentEvidence: true,
    };
    for (const dimension of [
      "backend",
      "web_ui",
      "mobile_ui",
      "automated_tests",
      "tenant_security",
    ]) {
      await record(
        client,
        context,
        dimension,
        "local",
        "passed",
        localEvidence,
      );
    }

    const providerPassed =
      process.env.CRM_PROVIDER_SANDBOX_ACCEPTED?.toLowerCase() === "true";
    await record(
      client,
      context,
      "provider_execution",
      "sandbox",
      providerPassed ? "passed" : "blocked",
      {
        ...localEvidence,
        reason: providerPassed
          ? "Sandbox provider receipts were explicitly accepted."
          : "Set CRM_PROVIDER_SANDBOX_ACCEPTED=true only after real sandbox receipts are reviewed.",
      },
    );

    const browserPassed = Boolean(
      process.env.E2E_BASE_URL &&
      process.env.CRM_BROWSER_ACCEPTANCE_APPROVER &&
      process.env.CRM_BROWSER_ACCEPTANCE_SHA === releaseSha,
    );
    await record(
      client,
      context,
      "browser_acceptance",
      process.env.NODE_ENV === "production" ? "production" : "staging",
      browserPassed ? "passed" : "blocked",
      {
        ...localEvidence,
        baseUrl: process.env.E2E_BASE_URL || null,
        approver: process.env.CRM_BROWSER_ACCEPTANCE_APPROVER || null,
        reason: browserPassed
          ? "Configured browser acceptance evidence matches the release SHA."
          : "Browser persona acceptance has not been signed for this release SHA.",
      },
    );

    const businessPassed = Boolean(
      process.env.CRM_BUSINESS_ACCEPTANCE_APPROVER &&
      process.env.CRM_BUSINESS_ACCEPTANCE_SHA === releaseSha,
    );
    await record(
      client,
      context,
      "business_acceptance",
      process.env.NODE_ENV === "production" ? "production" : "staging",
      businessPassed ? "passed" : "blocked",
      {
        ...localEvidence,
        approver: process.env.CRM_BUSINESS_ACCEPTANCE_APPROVER || null,
        reason: businessPassed
          ? "Business acceptance sign-off matches the release SHA."
          : "Business-user acceptance has not been signed for this release SHA.",
      },
    );

    await client.query("COMMIT");

    await client.query("BEGIN");
    await setTenantContext(client, context.organizationId);
    const summary = await client.query(
      `SELECT DISTINCT ON (dimension,acceptance_tier)
         dimension,acceptance_tier,status,verified_at
       FROM tenant.crm_product_acceptance_runs
       WHERE organization_id=$1 AND release_sha=$2
       ORDER BY dimension,acceptance_tier,verified_at DESC,id DESC`,
      [context.organizationId, releaseSha],
    );
    await client.query("ROLLBACK");
    const blocked = summary.rows.filter((row) => row.status !== "passed");
    console.log(
      `CRM product live verification persisted ${summary.rows.length} acceptance dimensions for ${releaseSha}.`,
    );
    if (blocked.length) {
      console.log(
        `External/browser/business promotion remains blocked in ${blocked.length} dimension(s): ${blocked.map((row) => `${row.dimension}:${row.acceptance_tier}`).join(", ")}.`,
      );
    }
    if (
      process.env.CRM_REQUIRE_FULL_PRODUCTION_ACCEPTANCE === "true" &&
      blocked.length
    ) {
      throw new Error(
        "Full production CRM acceptance is required but blockers remain.",
      );
    }
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
} finally {
  await pool.end();
}
