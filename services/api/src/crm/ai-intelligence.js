import { createHash } from "node:crypto";
export const CRM_AI_INTELLIGENCE_CAPABILITY_IDS = Object.freeze([
  "CRM-007",
  "CRM-008",
  "CRM-009",
  "CRM-043",
]);
export class CrmAiIntelligenceError extends Error {
  constructor(
    status,
    message,
    code = "CRM_AI_INTELLIGENCE_ERROR",
    details = [],
  ) {
    super(message);
    this.name = "CrmAiIntelligenceError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
const text = (v) => String(v ?? "").trim();
const number = (v, f = 0) => (Number.isFinite(Number(v)) ? Number(v) : f);
const array = (v) => (Array.isArray(v) ? v : []);
const object = (v) =>
  v && typeof v === "object" && !Array.isArray(v) ? v : {};
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const round2 = (v) => Math.round((number(v) + Number.EPSILON) * 100) / 100;
export function crmAiHash(value) {
  const stable = (v) =>
    Array.isArray(v)
      ? v.map(stable)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .map((k) => [k, stable(v[k])]),
          )
        : v;
  return createHash("sha256")
    .update(JSON.stringify(stable(value)))
    .digest("hex");
}
export function rankNextBestActions(input = {}) {
  const signals = object(input.signals),
    actions = array(input.actions).map((a, index) => ({
      key: text(a.key || `action-${index + 1}`),
      label: text(a.label),
      base: number(a.baseScore || a.base_score, 50),
      requirements: array(a.requirements),
      blockers: array(a.blockers),
      reason: text(a.reason),
    }));
  const rows = actions
    .map((a) => {
      let score = a.base;
      const reasons = [];
      for (const r of a.requirements) {
        const key = text(r.key);
        const weight = number(r.weight, 10);
        if (signals[key]) {
          score += weight;
          reasons.push(`matched:${key}`);
        } else score -= Math.abs(weight);
      }
      for (const b of a.blockers) {
        const key = text(b.key);
        if (signals[key]) {
          score -= 100;
          reasons.push(`blocked:${key}`);
        }
      }
      return { ...a, score: round2(clamp(score, 0, 100)), reasons };
    })
    .sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
  return {
    recommendations: rows,
    top: rows[0] || null,
    modelVersion: "crm-nba-rules-v1",
  };
}
export function calculateRelationshipIntelligence(input = {}) {
  const contacts = array(input.contacts),
    interactions = array(input.interactions);
  const now = new Date(input.now || Date.now());
  const coverage = contacts.length
    ? Math.min(
        100,
        (contacts.filter((c) => text(c.role || c.designation)).length /
          contacts.length) *
          100,
      )
    : 0;
  const recent = interactions.filter(
    (i) => (now - new Date(i.at || i.created_at || 0)) / 86400000 <= 30,
  ).length;
  const positive = interactions.filter((i) =>
    ["positive", "engaged", "accepted"].includes(
      text(i.sentiment || i.outcome),
    ),
  ).length;
  const risk = interactions.filter((i) =>
    ["negative", "declined", "unresponsive"].includes(
      text(i.sentiment || i.outcome),
    ),
  ).length;
  const score = clamp(
    coverage * 0.35 +
      Math.min(100, recent * 12) * 0.35 +
      clamp(50 + (positive - risk) * 10, 0, 100) * 0.3,
    0,
    100,
  );
  return {
    score: round2(score),
    coveragePercent: round2(coverage),
    recentInteractions: recent,
    positiveSignals: positive,
    riskSignals: risk,
    grade:
      score >= 80
        ? "strong"
        : score >= 60
          ? "healthy"
          : score >= 40
            ? "watch"
            : "at-risk",
  };
}
export function redactAssistantContext(input = {}) {
  const sensitive = new Set([
    "password",
    "secret",
    "token",
    "accessToken",
    "refreshToken",
    "pan",
    "aadhaar",
    "bankAccount",
  ]);
  const walk = (v, key = "") => {
    if (sensitive.has(key)) return "[REDACTED]";
    if (Array.isArray(v)) return v.map((x) => walk(x));
    if (v && typeof v === "object")
      return Object.fromEntries(
        Object.entries(v).map(([k, val]) => [k, walk(val, k)]),
      );
    if (typeof v === "string")
      return v
        .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[EMAIL]")
        .replace(/\+?\d[\d\s-]{8,}\d/g, "[PHONE]");
    return v;
  };
  return walk(object(input));
}
export function buildGenerativeAssistantDraft(input = {}) {
  const purpose = text(input.purpose || "follow-up"),
    context = redactAssistantContext(input.context),
    facts = array(input.facts).map(text).filter(Boolean);
  if (!facts.length)
    throw new CrmAiIntelligenceError(
      400,
      "Assistant drafts require grounded facts.",
      "CRM_AI_FACTS_REQUIRED",
    );
  const subject = text(
    input.generatedSubject ||
      input.subject ||
      `${purpose[0]?.toUpperCase() || "F"}${purpose.slice(1)} update`,
  );
  const body =
    text(input.generatedBody) ||
    `Hello,\n\n${facts.map((f) => `• ${f}`).join("\n")}\n\nNext step: ${text(input.nextStep || "Please confirm the preferred next action.")}\n\nRegards`;
  const providerEvidence = object(input.providerEvidence);
  return {
    purpose,
    subject,
    body,
    grounding: {
      facts,
      contextHash: crmAiHash(context),
      ...(Object.keys(providerEvidence).length ? { providerEvidence } : {}),
    },
    requiresHumanApproval: true,
    contentHash: crmAiHash({ purpose, subject, body, facts, providerEvidence }),
  };
}
export function calculateDealRisk(input = {}) {
  const amount = Math.max(0, number(input.amount)),
    probability = clamp(number(input.probability), 0, 100),
    daysWithoutActivity = Math.max(
      0,
      number(input.daysWithoutActivity || input.days_without_activity),
    ),
    closeOverdue = Boolean(input.closeOverdue || input.close_overdue),
    stakeholderCoverage = clamp(
      number(input.stakeholderCoverage || input.stakeholder_coverage, 50),
      0,
      100,
    ),
    planCompletion = clamp(
      number(input.planCompletion || input.plan_completion, 0),
      0,
      100,
    );
  let risk = 100 - probability;
  risk += Math.min(35, daysWithoutActivity * 0.8);
  if (closeOverdue) risk += 20;
  risk += (100 - stakeholderCoverage) * 0.2;
  risk += (100 - planCompletion) * 0.15;
  if (amount > 1000000) risk += 5;
  risk = clamp(risk, 0, 100);
  const reasons = [];
  if (daysWithoutActivity > 14) reasons.push("stale-activity");
  if (closeOverdue) reasons.push("close-date-overdue");
  if (stakeholderCoverage < 50) reasons.push("weak-stakeholder-coverage");
  if (planCompletion < 50) reasons.push("incomplete-action-plan");
  return {
    riskScore: round2(risk),
    riskBand:
      risk >= 75
        ? "critical"
        : risk >= 55
          ? "high"
          : risk >= 35
            ? "medium"
            : "low",
    reasons,
    modelVersion: "crm-deal-risk-v1",
  };
}
export function validateAiFeedback(input = {}) {
  const outcome = text(input.outcome);
  if (
    !["accepted", "dismissed", "edited", "successful", "unsuccessful"].includes(
      outcome,
    )
  )
    throw new CrmAiIntelligenceError(
      400,
      "Unsupported AI feedback outcome.",
      "CRM_AI_FEEDBACK_INVALID",
    );
  return {
    outcome,
    reason: text(input.reason),
    correction: object(input.correction),
    learnable: ["accepted", "edited", "successful", "unsuccessful"].includes(
      outcome,
    ),
  };
}
function assertContext(c) {
  if (!c?.organizationId || !c?.userId)
    throw new CrmAiIntelligenceError(
      401,
      "An authenticated CRM context is required.",
      "CRM_CONTEXT_REQUIRED",
    );
}
export async function createNextBestAction(client, context, input = {}) {
  assertContext(context);
  const ranked = rankNextBestActions(input);
  const top = ranked.top;
  if (!top)
    throw new CrmAiIntelligenceError(
      400,
      "At least one action candidate is required.",
      "CRM_AI_ACTION_REQUIRED",
    );
  const result = await client.query(
    `INSERT INTO tenant.crm_ai_recommendations(organization_id,entity_type,entity_id,recommendation_type,title,score,reasoning,payload,model_version,status,content_hash,created_by) VALUES($1,$2,$3,'next_best_action',$4,$5,$6::jsonb,$7::jsonb,$8,'pending',$9,$10) RETURNING *`,
    [
      context.organizationId,
      text(input.entityType || input.entity_type || "lead"),
      input.entityId || input.entity_id || null,
      top.label || top.key,
      top.score,
      JSON.stringify(top.reasons),
      JSON.stringify(top),
      ranked.modelVersion,
      crmAiHash(top),
      context.userId,
    ],
  );
  return { ...result.rows[0], ranked };
}
export async function captureRelationshipIntelligence(
  client,
  context,
  input = {},
) {
  assertContext(context);
  const resultValue = calculateRelationshipIntelligence(input);
  const result = await client.query(
    `INSERT INTO tenant.crm_relationship_intelligence_snapshots(organization_id,entity_type,entity_id,score,grade,signals,model_version,content_hash,captured_by) VALUES($1,$2,$3,$4,$5,$6::jsonb,'crm-relationship-v1',$7,$8) RETURNING *`,
    [
      context.organizationId,
      text(input.entityType || input.entity_type || "party"),
      input.entityId || input.entity_id || null,
      resultValue.score,
      resultValue.grade,
      JSON.stringify(resultValue),
      crmAiHash(resultValue),
      context.userId,
    ],
  );
  return result.rows[0];
}
export async function createAssistantDraft(client, context, input = {}) {
  assertContext(context);
  const draft = buildGenerativeAssistantDraft(input);
  const result = await client.query(
    `INSERT INTO tenant.crm_ai_assistant_drafts(organization_id,entity_type,entity_id,purpose,subject,body,grounding,provider,model,status,content_hash,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,'review_required',$10,$11,$11) RETURNING *`,
    [
      context.organizationId,
      text(input.entityType || input.entity_type || "lead"),
      input.entityId || input.entity_id || null,
      draft.purpose,
      draft.subject,
      draft.body,
      JSON.stringify(draft.grounding),
      text(input.provider || "governed-rules"),
      text(input.model || "crm-assistant-v1"),
      draft.contentHash,
      context.userId,
    ],
  );
  return result.rows[0];
}
export async function captureDealRisk(client, context, input = {}) {
  assertContext(context);
  const risk = calculateDealRisk(input);
  const result = await client.query(
    `INSERT INTO tenant.crm_ai_deal_risk_snapshots(organization_id,opportunity_id,risk_score,risk_band,reasons,model_version,input_hash,captured_by) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8) RETURNING *`,
    [
      context.organizationId,
      input.opportunityId || input.opportunity_id || null,
      risk.riskScore,
      risk.riskBand,
      JSON.stringify(risk.reasons),
      risk.modelVersion,
      crmAiHash(input),
      context.userId,
    ],
  );
  return result.rows[0];
}
export async function recordAiFeedback(client, context, input = {}) {
  assertContext(context);
  const feedback = validateAiFeedback(input);
  const result = await client.query(
    `INSERT INTO tenant.crm_ai_feedback(organization_id,recommendation_id,draft_id,outcome,reason,correction,learnable,user_id) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8) RETURNING *`,
    [
      context.organizationId,
      input.recommendationId || input.recommendation_id || null,
      input.draftId || input.draft_id || null,
      feedback.outcome,
      feedback.reason,
      JSON.stringify(feedback.correction),
      feedback.learnable,
      context.userId,
    ],
  );
  return result.rows[0];
}
export async function getCrmAiDashboard(client, context) {
  assertContext(context);
  const result = await client.query(
    `SELECT (SELECT count(*)::int FROM tenant.crm_ai_recommendations WHERE organization_id=$1 AND status='pending') AS pending_recommendations,(SELECT count(*)::int FROM tenant.crm_ai_assistant_drafts WHERE organization_id=$1 AND status='review_required') AS drafts_to_review,(SELECT COALESCE(avg(score),0)::numeric(5,2) FROM tenant.crm_relationship_intelligence_snapshots WHERE organization_id=$1) AS relationship_score,(SELECT count(*)::int FROM tenant.crm_ai_deal_risk_snapshots WHERE organization_id=$1 AND risk_band IN('critical','high')) AS risky_deals,(SELECT count(*)::int FROM tenant.crm_ai_feedback WHERE organization_id=$1) AS feedback_events`,
    [context.organizationId],
  );
  return result.rows[0];
}
export async function recordCrmAiAcceptance(client, context, input = {}) {
  assertContext(context);
  const id = text(input.capabilityId || input.capability_id);
  if (!CRM_AI_INTELLIGENCE_CAPABILITY_IDS.includes(id))
    throw new CrmAiIntelligenceError(
      400,
      "Unknown CRM-11 capability.",
      "CRM11_CAPABILITY_UNKNOWN",
    );
  const evidence = object(input.evidence);
  const result = await client.query(
    `INSERT INTO tenant.crm_ai_acceptance_evidence(organization_id,capability_id,commit_sha,status,evidence,evidence_hash,verified_by) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7) ON CONFLICT(organization_id,capability_id,commit_sha) DO UPDATE SET status=EXCLUDED.status,evidence=EXCLUDED.evidence,evidence_hash=EXCLUDED.evidence_hash,verified_by=EXCLUDED.verified_by,verified_at=now() RETURNING *`,
    [
      context.organizationId,
      id,
      text(input.commitSha || input.commit_sha || "local"),
      text(input.status || "passed"),
      JSON.stringify(evidence),
      crmAiHash(evidence),
      context.userId,
    ],
  );
  return result.rows[0];
}
export async function getCrmAiReadiness(client, context, commitSha = "local") {
  assertContext(context);
  const result = await client.query(
    `SELECT capability_id,status FROM tenant.crm_ai_acceptance_evidence WHERE organization_id=$1 AND commit_sha=$2`,
    [context.organizationId, commitSha],
  );
  const map = new Map(result.rows.map((r) => [r.capability_id, r.status]));
  const missing = CRM_AI_INTELLIGENCE_CAPABILITY_IDS.filter(
    (id) => map.get(id) !== "passed",
  );
  return {
    readiness: missing.length ? "blocked" : "ready",
    passed: 4 - missing.length,
    total: 4,
    missing,
  };
}
