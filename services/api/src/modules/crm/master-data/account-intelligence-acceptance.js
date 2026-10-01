// Dormant acceptance-evidence ledger for the account-intelligence capability
// (tenant.crm_account_intelligence_acceptance_runs). No runtime caller; kept
// for the public export contract.

import { CrmAccountIntelligenceError } from "./account-intelligence-error.js";
import { crmAccountIntelligenceHash } from "./account-intelligence-hash.js";

const text = (value) => String(value ?? "").trim();
const object = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};

export const CRM_ACCOUNT_INTELLIGENCE_CAPABILITY_IDS = Object.freeze([
  "CRM-027",
  "CRM-028",
  "CRM-029",
  "CRM-030",
  "CRM-035",
]);

export async function recordCrmAccountIntelligenceAcceptance(
  client,
  context,
  input = {},
) {
  const capabilityId = text(input.capabilityId || input.capability_id);
  if (!CRM_ACCOUNT_INTELLIGENCE_CAPABILITY_IDS.includes(capabilityId)) {
    throw new CrmAccountIntelligenceError(400, "Capability ID is unsupported.");
  }
  const status = text(input.status || "passed");
  if (!new Set(["passed", "failed"]).has(status)) {
    throw new CrmAccountIntelligenceError(400, "Acceptance status is invalid.");
  }
  const evidence = object(input.evidence);
  const result = await client.query(
    `INSERT INTO tenant.crm_account_intelligence_acceptance_runs(
       organization_id,capability_id,status,evidence,content_hash,commit_sha,recorded_by
     ) VALUES($1,$2,$3,$4::jsonb,$5,$6,$7) RETURNING *`,
    [
      context.organizationId,
      capabilityId,
      status,
      JSON.stringify(evidence),
      crmAccountIntelligenceHash({ capabilityId, status, evidence }),
      text(input.commitSha || input.commit_sha) || null,
      context.userId,
    ],
  );
  return result.rows[0];
}

export async function getCrmAccountIntelligenceReadiness(client, context) {
  const result = await client.query(
    `SELECT DISTINCT ON (capability_id) *
     FROM tenant.crm_account_intelligence_acceptance_runs
     WHERE organization_id=$1
     ORDER BY capability_id,recorded_at DESC`,
    [context.organizationId],
  );
  const byId = new Map(result.rows.map((row) => [row.capability_id, row]));
  const checks = CRM_ACCOUNT_INTELLIGENCE_CAPABILITY_IDS.map(
    (capabilityId) => ({
      capabilityId,
      status: byId.get(capabilityId)?.status || "missing",
      evidence: byId.get(capabilityId)?.evidence || {},
      recordedAt: byId.get(capabilityId)?.recorded_at || null,
    }),
  );
  const blockers = checks
    .filter((check) => check.status !== "passed")
    .map((check) => `${check.capabilityId} has not passed acceptance.`);
  return {
    readiness: blockers.length ? "blocked" : "ready",
    score: Math.round(
      (checks.filter((check) => check.status === "passed").length /
        checks.length) *
        100,
    ),
    blockers,
    checks,
  };
}
