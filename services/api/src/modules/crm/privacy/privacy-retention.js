// CRM privacy retention: policy dashboard, policy update and the retention
// run (legal-hold aware, SKIP LOCKED, batch-limited) that applies the same
// anonymize/restrict operations as privacy requests.

import { CrmError } from "../data-management/errors.js";
import { assertId, privacyEvidenceHash } from "./support.js";
import { anonymizeSubject, restrictSubject } from "./privacy-requests.js";

const text = (value) => String(value ?? "").trim();

export async function getPrivacyRetentionDashboard(client, context) {
  // Sequential, not Promise.all — see opportunity-revenue-intelligence.js's
  // fix for why concurrent client.query() on one shared PoolClient is unsafe.
  const policies = await client.query(
    `SELECT * FROM tenant.crm_privacy_retention_policies
     WHERE organization_id=$1 ORDER BY subject_type,name`,
    [context.organizationId],
  );
  const runs = await client.query(
    `SELECT * FROM tenant.crm_privacy_execution_runs
     WHERE organization_id=$1 ORDER BY executed_at DESC LIMIT 100`,
    [context.organizationId],
  );
  return {
    policies: policies.rows,
    runs: runs.rows,
    metrics: {
      activePolicies: policies.rows.filter((row) => row.status === "active")
        .length,
      completedRuns: runs.rows.filter((row) => row.status === "completed")
        .length,
      failedRuns: runs.rows.filter((row) => row.status === "failed").length,
    },
  };
}

export async function updatePrivacyRetentionPolicy(
  client,
  context,
  policyId,
  input = {},
) {
  const id = assertId(policyId, "Retention policy");
  const current = await client.query(
    `SELECT * FROM tenant.crm_privacy_retention_policies
     WHERE organization_id=$1 AND id=$2 FOR UPDATE`,
    [context.organizationId, id],
  );
  if (!current.rows[0]) {
    throw new CrmError(404, "Retention policy not found.");
  }
  const status = text(input.status || current.rows[0].status);
  const action = text(input.action || current.rows[0].action);
  const retentionDays = Number(
    input.retentionDays ||
      input.retention_days ||
      current.rows[0].retention_days,
  );
  if (!new Set(["active", "inactive"]).has(status)) {
    throw new CrmError(
      400,
      "Retention policy status is invalid.",
    );
  }
  if (!new Set(["restrict", "anonymize"]).has(action)) {
    throw new CrmError(
      400,
      "Retention policy action is invalid.",
    );
  }
  if (
    !Number.isInteger(retentionDays) ||
    retentionDays < 1 ||
    retentionDays > 36500
  ) {
    throw new CrmError(
      400,
      "Retention days must be between 1 and 36500.",
    );
  }
  const result = await client.query(
    `UPDATE tenant.crm_privacy_retention_policies
     SET name=$1,retention_days=$2,action=$3,status=$4,updated_by=$5,updated_at=now()
     WHERE organization_id=$6 AND id=$7 RETURNING *`,
    [
      text(input.name || current.rows[0].name),
      retentionDays,
      action,
      status,
      context.userId,
      context.organizationId,
      id,
    ],
  );
  return result.rows[0];
}

export async function runPrivacyRetention(client, context, input = {}) {
  const limit = Math.max(1, Math.min(200, Number(input.limit || 50)));
  const policies = await client.query(
    `SELECT * FROM tenant.crm_privacy_retention_policies
     WHERE organization_id=$1 AND status='active' ORDER BY subject_type,name`,
    [context.organizationId],
  );
  const results = [];
  for (const policy of policies.rows) {
    const table =
      policy.subject_type === "lead"
        ? "crm_leads"
        : policy.subject_type === "contact"
          ? "contacts"
          : "business_parties";
    const inactiveStatus =
      policy.subject_type === "lead" ? "archived" : "inactive";
    const candidates = await client.query(
      `SELECT id FROM tenant.${table}
       WHERE organization_id=$1 AND legal_hold=false AND privacy_status='active'
         AND (retention_until<=now() OR (status=$2 AND updated_at<=now()-($3::int || ' days')::interval))
       ORDER BY COALESCE(retention_until,updated_at) LIMIT $4 FOR UPDATE SKIP LOCKED`,
      [context.organizationId, inactiveStatus, policy.retention_days, limit],
    );
    for (const candidate of candidates.rows) {
      if (policy.action === "anonymize") {
        await anonymizeSubject(
          client,
          context,
          policy.subject_type,
          candidate.id,
        );
      } else {
        await restrictSubject(
          client,
          context,
          policy.subject_type,
          candidate.id,
        );
      }
      const summary = {
        automated: true,
        policyId: policy.id,
        policyName: policy.name,
        retentionDays: policy.retention_days,
      };
      const run = await client.query(
        `INSERT INTO tenant.crm_privacy_execution_runs(
           organization_id,policy_id,subject_type,subject_id,operation,status,result_summary,content_hash,executed_by
         ) VALUES($1,$2,$3,$4,$5,'completed',$6::jsonb,$7,$8) RETURNING *`,
        [
          context.organizationId,
          policy.id,
          policy.subject_type,
          candidate.id,
          policy.action,
          JSON.stringify(summary),
          privacyEvidenceHash({
            policyId: policy.id,
            subjectId: candidate.id,
            action: policy.action,
          }),
          context.userId,
        ],
      );
      results.push(run.rows[0]);
    }
    await client.query(
      `UPDATE tenant.crm_privacy_retention_policies SET last_run_at=now(),updated_by=$1,updated_at=now() WHERE organization_id=$2 AND id=$3`,
      [context.userId, context.organizationId, policy.id],
    );
  }
  return {
    policies: policies.rows.length,
    processed: results.length,
    runs: results,
  };
}
