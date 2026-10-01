// Dormant acceptance-evidence ledger for the communications capability
// (tenant.crm_communication_acceptance_runs). No runtime caller; kept for the
// public export contract.

import { CrmCommunicationsError } from "./communications-error.js";
import { crmCommunicationsHash } from "./content-hash.js";

const text = (value) => String(value ?? "").trim();
const object = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};

export const CRM_COMMUNICATION_CAPABILITY_IDS = Object.freeze([
  "CRM-001",
  "CRM-002",
  "CRM-004",
  "CRM-005",
  "CRM-036",
  "CRM-038",
  "CRM-040",
  "CRM-045",
  "CRM-081",
]);

export async function recordCrmCommunicationsAcceptance(
  client,
  context,
  input = {},
) {
  const capabilityId = text(input.capabilityId);
  if (!CRM_COMMUNICATION_CAPABILITY_IDS.includes(capabilityId))
    throw new CrmCommunicationsError(
      400,
      "CRM communications capability is invalid.",
    );
  const evidence = object(input.evidence);
  const result = await client.query(
    `INSERT INTO tenant.crm_communication_acceptance_runs(organization_id,capability_id,status,commit_sha,evidence,evidence_hash,provider_acceptance,recorded_by)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (organization_id,capability_id,commit_sha) DO NOTHING RETURNING *`,
    [
      context.organizationId,
      capabilityId,
      text(input.status) || "passed",
      text(input.commitSha) || "crm04-local",
      JSON.stringify(evidence),
      crmCommunicationsHash(evidence),
      text(input.providerAcceptance) || "sandbox",
      context.userId,
    ],
  );
  return result.rows[0] || null;
}

export async function getCrmCommunicationsReadiness(client, context) {
  const result = await client.query(
    `SELECT capability_id,status,provider_acceptance,recorded_at,commit_sha,evidence_hash FROM tenant.crm_communication_acceptance_runs WHERE organization_id=$1 ORDER BY recorded_at DESC`,
    [context.organizationId],
  );
  const latest = new Map();
  for (const row of result.rows)
    if (!latest.has(row.capability_id)) latest.set(row.capability_id, row);
  const checks = CRM_COMMUNICATION_CAPABILITY_IDS.map((id) => ({
    id,
    status: latest.get(id)?.status || "missing",
    providerAcceptance: latest.get(id)?.provider_acceptance || "missing",
  }));
  const passed = checks.filter((check) => check.status === "passed").length;
  return {
    readiness: passed === checks.length ? "ready" : "blocked",
    score: Math.round((passed / checks.length) * 100),
    passed,
    total: checks.length,
    checks,
  };
}
