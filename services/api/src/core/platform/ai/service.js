// AI governance (Settings > AI governance; platform.ai.manage). Properties: fail-closed default (no configured policy = AI disabled, not
// silently allowed); an execute-type request whose policy requires
// approval is explicitly blocked from bypassing the normal approval
// workflow — AI can never self-approve its own execution.
import { createHash } from "node:crypto";

import { audit } from "../../security.js";
import { getPrivacyDataClass, PRIVACY_DATA_CLASSES } from "../privacy/index.js";
import { AI_POLICY_KEYS, AI_TOOLS, getAiTool } from "./registry.js";

export const AI_POLICY_DISABLED = "AI_POLICY_DISABLED";
export const AI_POLICY_MISSING = "AI_POLICY_MISSING";
export const AI_APPROVAL_REQUIRED = "AI_APPROVAL_REQUIRED";
export const AI_TOOL_DENIED = "AI_TOOL_DENIED";

export class AiGovernanceError extends Error {
  constructor(status, message, code) {
    super(message);
    this.name = "AiGovernanceError";
    this.status = status;
    this.code = code;
  }
}

function text(value, name, maximum = 240) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new AiGovernanceError(400, `${name} is required.`);
  if (normalized.length > maximum) throw new AiGovernanceError(400, `${name} is too long.`);
  return normalized;
}

function optionalText(value, maximum = 2_000) {
  if (value == null) return null;
  const normalized = String(value).trim();
  if (!normalized) return null;
  if (normalized.length > maximum) throw new AiGovernanceError(400, "The submitted text is too long.");
  return normalized;
}

function scopes(value) {
  if (!Array.isArray(value)) return [];
  const normalized = value.map((scope) => String(scope).trim()).filter(Boolean);
  return [...new Set(normalized)].slice(0, 32);
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function assertAiActionPolicy({ enabled, allowRead, allowPropose, allowExecute, requiresApproval, requestType }) {
  if (!enabled) throw new AiGovernanceError(403, "AI is disabled by organization policy.", AI_POLICY_DISABLED);
  if (requestType === "read" && !allowRead) throw new AiGovernanceError(403, "AI read access is disabled by policy.");
  if (requestType === "propose" && !allowPropose) throw new AiGovernanceError(403, "AI proposals are disabled by policy.");
  if (requestType === "execute") {
    if (!allowExecute) throw new AiGovernanceError(403, "AI execution is disabled by policy.");
    if (requiresApproval) {
      throw new AiGovernanceError(
        409,
        "AI execution requires a normal approval request before the business command can run.",
        AI_APPROVAL_REQUIRED,
      );
    }
  }
}

// Only registered policy keys, tools and data classes; each change is a new
// audited version.
export async function setAiPolicy(client, session, input) {
  const policyKey = text(input.policyKey ?? "organization", "AI policy key", 160);
  if (!AI_POLICY_KEYS.includes(policyKey)) throw new AiGovernanceError(400, "Unknown AI policy.", "AI_POLICY_KEY_UNKNOWN");
  const allowedTools = scopes(input.allowedTools);
  for (const tool of allowedTools) if (!getAiTool(tool)) throw new AiGovernanceError(400, `"${tool.slice(0, 80)}" is not a registered AI tool.`, AI_TOOL_DENIED);
  const dataClasses = scopes(input.dataClasses);
  for (const dataClass of dataClasses) if (!getPrivacyDataClass(dataClass)) throw new AiGovernanceError(400, `"${dataClass.slice(0, 80)}" is not a registered data class.`, "AI_DATA_CLASS_UNKNOWN");

  await client.query("SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))", [session.organizationId, `ai-policy:${policyKey}`]);
  const current = await client.query(
    `SELECT version FROM ai_policies WHERE organization_id=$1 AND policy_key=$2 ORDER BY version DESC LIMIT 1`,
    [session.organizationId, policyKey],
  );
  const version = (current.rows[0]?.version || 0) + 1;
  const result = await client.query(
    `INSERT INTO ai_policies(
       organization_id,policy_key,enabled,allow_read,allow_propose,allow_execute,requires_approval,allowed_tools,data_classes,version,updated_by
     ) VALUES($1,$2,$3,$4,$5,$6,$7,$8::text[],$9::text[],$10,$11) RETURNING id,version`,
    [
      session.organizationId,
      policyKey,
      input.enabled !== false,
      input.allowRead !== false,
      input.allowPropose !== false,
      input.allowExecute === true,
      input.requiresApproval !== false,
      allowedTools,
      dataClasses,
      version,
      session.userId,
    ],
  );
  await audit(client, {
    organizationId: session.organizationId,
    actorUserId: session.userId,
    eventType: "ai.policy_versioned",
    entityType: "ai_policy",
    entityId: result.rows[0].id,
    afterData: {
      policyKey,
      version,
      enabled: input.enabled !== false,
      allowRead: input.allowRead !== false,
      allowPropose: input.allowPropose !== false,
      allowExecute: input.allowExecute === true,
      requiresApproval: input.requiresApproval !== false,
      allowedTools,
      dataClasses,
    },
  });
  return result.rows[0];
}

export async function listAiPolicies(client, organizationId) {
  const result = await client.query(
    `SELECT DISTINCT ON (policy_key) id,policy_key,enabled,allow_read,allow_propose,allow_execute,requires_approval,allowed_tools,data_classes,version,updated_at
       FROM ai_policies WHERE organization_id=$1 ORDER BY policy_key,version DESC`,
    [organizationId],
  );
  return result.rows;
}

export async function recordAiEvaluation(client, session, input) {
  const aiRequestId = text(input.aiRequestId, "AI request id", 80);
  const evaluationKey = text(input.evaluationKey, "AI evaluation key", 160);
  const score = Number(input.score);
  const threshold = input.threshold == null ? null : Number(input.threshold);
  if (!Number.isFinite(score) || (threshold != null && !Number.isFinite(threshold))) {
    throw new AiGovernanceError(400, "AI evaluation score/threshold is invalid.");
  }
  const passed = threshold == null ? true : score >= threshold;
  const result = await client.query(
    `INSERT INTO ai_evaluations(organization_id,ai_request_id,evaluation_key,score,threshold,passed,evidence)
     SELECT $1,request.id,$3,$4,$5,$6,$7::jsonb FROM ai_requests request
      WHERE request.id=$2 AND request.organization_id=$1 RETURNING id`,
    [session.organizationId, aiRequestId, evaluationKey, score, threshold, passed, JSON.stringify(input.evidence ?? {})],
  );
  if (!result.rows[0]) throw new AiGovernanceError(404, "AI request not found.");
  return { id: result.rows[0].id, passed };
}

export async function recordAiRequest(client, session, input) {
  const policyKey = text(input.policyKey, "AI policy key", 160);
  const requestType = text(input.requestType, "AI request type", 30);
  if (!["read", "propose", "execute"].includes(requestType)) throw new AiGovernanceError(400, "AI request type is invalid.");
  const policies = await client.query(
    `SELECT enabled,allow_read,allow_propose,allow_execute,requires_approval,allowed_tools
       FROM ai_policies
      WHERE organization_id=$1 AND policy_key=$2
      ORDER BY version DESC LIMIT 1`,
    [session.organizationId, policyKey],
  );
  const policy = policies.rows[0];
  if (!policy) throw new AiGovernanceError(403, "AI is disabled until an organization policy is configured.", AI_POLICY_MISSING);
  assertAiActionPolicy({
    enabled: policy.enabled,
    allowRead: policy.allow_read,
    allowPropose: policy.allow_propose,
    allowExecute: policy.allow_execute,
    requiresApproval: policy.requires_approval,
    requestType,
  });
  const actionKey = optionalText(input.actionKey, 160);
  const allowedTools = Array.isArray(policy.allowed_tools) ? policy.allowed_tools.map(String) : [];
  // A tool must be registered AND allowed by the policy (an empty list allows none).
  if (actionKey && (!getAiTool(actionKey) || !allowedTools.includes(actionKey))) {
    throw new AiGovernanceError(403, `AI tool ${actionKey} is not allowed by organization policy.`, AI_TOOL_DENIED);
  }
  const prompt = text(input.prompt, "AI prompt", 20_000);
  const result = await client.query(
    `INSERT INTO ai_requests(
       organization_id,user_id,policy_key,request_type,prompt_hash,context_manifest,provenance,model_identifier,status,action_key
     ) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,'received',$9)
     RETURNING id,status`,
    [
      session.organizationId,
      session.userId,
      policyKey,
      requestType,
      hash(prompt),
      JSON.stringify(input.contextManifest ?? {}),
      JSON.stringify(input.provenance ?? []),
      optionalText(input.modelIdentifier, 240),
      actionKey,
    ],
  );
  return result.rows[0];
}

/** Settings view: the current policy, its versions and recent request evidence (never prompts). */
export async function getAiGovernanceOverview(client, organizationId) {
  const versions = (
    await client.query(
      `SELECT policy.id, policy.policy_key, policy.enabled, policy.allow_read, policy.allow_propose, policy.allow_execute, policy.requires_approval,
              policy.allowed_tools, policy.data_classes, policy.version, policy.updated_at, member.full_name AS updated_by_name
         FROM ai_policies policy LEFT JOIN users member ON member.id = policy.updated_by
        WHERE policy.organization_id=$1 ORDER BY policy.policy_key, policy.version DESC LIMIT 50`,
      [organizationId],
    )
  ).rows;
  const requests = (
    await client.query(
      `SELECT request.id, request.policy_key, request.request_type, request.status, request.action_key, request.model_identifier, request.created_at,
              member.full_name AS user_name,
              (SELECT count(*) FROM ai_evaluations evaluation WHERE evaluation.ai_request_id=request.id)::int AS evaluations,
              (SELECT bool_and(evaluation.passed) FROM ai_evaluations evaluation WHERE evaluation.ai_request_id=request.id) AS evaluations_passed
         FROM ai_requests request LEFT JOIN users member ON member.id = request.user_id
        WHERE request.organization_id=$1 ORDER BY request.created_at DESC LIMIT 25`,
      [organizationId],
    )
  ).rows;
  return {
    policy: versions.find((row) => row.policy_key === "organization") ?? null,
    versions,
    requests,
    tools: AI_TOOLS.map(({ key, label, description }) => ({ key, label, description })),
    dataClasses: PRIVACY_DATA_CLASSES.map(({ key, label }) => ({ key, label })),
  };
}
