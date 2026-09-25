// Multi-touch marketing attribution for Leads. Activates the
// tenant.crm_marketing_touchpoints table (migration 034) and the
// crm_campaigns.attribution_model enum it already defines
// (first_touch/last_touch/linear/position_based/time_decay) — both existed
// with zero application code before this. See the "Lead management in top
// ERPs" benchmark: every platform studied captures lead source as a single-
// touch picklist and sells multi-touch attribution as a separate,
// higher-tier feature; this module is that missing layer for Leads.
import { createHash } from "node:crypto";
import { canViewSensitiveLeadContent, leadScopeSql } from "../lead-lifecycle-qualification-and-prioritization/lead-security.js";

export class LeadAttributionError extends Error {
  constructor(status, message, code = "CRM_LEAD_ATTRIBUTION_ERROR") {
    super(message);
    this.name = "LeadAttributionError";
    this.status = status;
    this.code = code;
  }
}

const EVENT_TYPES = new Set([
  "impression", "sent", "delivered", "opened", "clicked", "responded",
  "registered", "attended", "surveyed", "converted", "revenue",
]);
const ATTRIBUTION_MODELS = new Set(["first_touch", "last_touch", "linear", "position_based", "time_decay"]);

function text(value) {
  return String(value ?? "").trim();
}

function touchpointHash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

// Idempotent by design: the same logical touch (same lead, campaign,
// channel, event type and occurredAt) recorded twice — a retried capture
// request, a redelivered webhook — collapses to one row via the
// (organization_id, content_hash) unique index added in migration 164.
// Callers that want a touch to always count separately (e.g. two distinct
// email sends) should include a distinguishing value in `metadata`.
export async function recordLeadTouchpoint(client, context, leadId, input = {}) {
  const eventType = text(input.eventType);
  if (!EVENT_TYPES.has(eventType))
    throw new LeadAttributionError(400, "Touchpoint event type is invalid.", "CRM_LEAD_ATTRIBUTION_EVENT_TYPE_INVALID");
  const channel = text(input.channel) || "other";
  const campaignId = input.campaignId || null;
  const occurredAt = input.occurredAt instanceof Date ? input.occurredAt : new Date(input.occurredAt || Date.now());
  const revenue = Math.max(0, Number(input.revenue || 0));
  const metadata = input.metadata && typeof input.metadata === "object" ? input.metadata : {};
  const hash = touchpointHash({
    subjectType: "lead",
    subjectId: leadId,
    campaignId,
    channel,
    eventType,
    occurredAt: occurredAt.toISOString(),
    metadata,
  });
  const result = await client.query(
    `INSERT INTO tenant.crm_marketing_touchpoints(organization_id,subject_type,subject_id,campaign_id,channel,event_type,event_at,revenue,metadata,content_hash)
     VALUES($1,'lead',$2,$3,$4,$5,$6,$7,$8::jsonb,$9)
     ON CONFLICT (organization_id, content_hash) DO NOTHING
     RETURNING *`,
    [context.organizationId, leadId, campaignId, channel, eventType, occurredAt.toISOString(), revenue, JSON.stringify(metadata), hash],
  );
  return result.rows[0] || null;
}

// Pure — given a chronologically-sorted touchpoint list, returns a parallel
// array of credit weights (summing to 1 for a non-empty input) under the
// requested attribution model.
export function calculateAttributionWeights(touchpoints, model = "linear") {
  const count = touchpoints.length;
  if (!count) return [];
  if (count === 1) return [1];
  const resolvedModel = ATTRIBUTION_MODELS.has(model) ? model : "linear";
  if (resolvedModel === "first_touch") return touchpoints.map((_, index) => (index === 0 ? 1 : 0));
  if (resolvedModel === "last_touch") return touchpoints.map((_, index) => (index === count - 1 ? 1 : 0));
  if (resolvedModel === "linear") return touchpoints.map(() => 1 / count);
  if (resolvedModel === "position_based")
    return touchpoints.map((_, index) => {
      if (index === 0 || index === count - 1) return 0.4;
      return 0.2 / (count - 2);
    });
  // time_decay: exponential recency weighting, 7-day half-life, normalized to sum to 1.
  const halfLifeDays = 7;
  const latest = new Date(touchpoints[count - 1].event_at).getTime();
  const raw = touchpoints.map((touchpoint) => {
    const ageDays = Math.max(0, (latest - new Date(touchpoint.event_at).getTime()) / 86400000);
    return Math.pow(2, -ageDays / halfLifeDays);
  });
  const total = raw.reduce((sum, value) => sum + value, 0) || 1;
  return raw.map((value) => value / total);
}

// Scoped read (same visibility rule as any other sensitive Lead detail):
// returns the touch timeline plus weighted campaign credit for one Lead.
export async function getLeadAttributionTimeline(client, context, leadId, options = {}) {
  const values = [context.organizationId, leadId];
  const scope = leadScopeSql(context, values, "lead");
  const leadResult = await client.query(
    `SELECT lead.id FROM tenant.crm_leads lead WHERE lead.organization_id=$1 AND lead.id=$2${scope}`,
    values,
  );
  if (!leadResult.rows[0]) throw new LeadAttributionError(404, "Lead not found.", "CRM_LEAD_NOT_FOUND");

  const touchpoints = await client.query(
    `SELECT touchpoint.id,touchpoint.campaign_id,campaign.name AS campaign_name,touchpoint.channel,touchpoint.event_type,touchpoint.event_at,touchpoint.revenue,touchpoint.metadata,campaign.attribution_model
       FROM tenant.crm_marketing_touchpoints touchpoint
       LEFT JOIN tenant.crm_campaigns campaign ON campaign.organization_id=touchpoint.organization_id AND campaign.id=touchpoint.campaign_id
      WHERE touchpoint.organization_id=$1 AND touchpoint.subject_type='lead' AND touchpoint.subject_id=$2
      ORDER BY touchpoint.event_at ASC`,
    [context.organizationId, leadId],
  );
  const distinctModels = new Set(touchpoints.rows.map((row) => row.attribution_model).filter(Boolean));
  const model = ATTRIBUTION_MODELS.has(text(options.model))
    ? text(options.model)
    : distinctModels.size === 1
      ? [...distinctModels][0]
      : "linear";
  const weights = calculateAttributionWeights(touchpoints.rows, model);
  const timeline = touchpoints.rows.map((row, index) => ({ ...row, creditWeight: weights[index] ?? 0 }));

  const creditByCampaign = new Map();
  for (const row of timeline) {
    if (!row.campaign_id) continue;
    const existing = creditByCampaign.get(row.campaign_id) || { campaignId: row.campaign_id, campaignName: row.campaign_name, credit: 0 };
    existing.credit += row.creditWeight;
    creditByCampaign.set(row.campaign_id, existing);
  }

  return {
    leadId,
    model,
    touchpoints: timeline,
    firstTouch: timeline[0] || null,
    lastTouch: timeline[timeline.length - 1] || null,
    campaignCredit: [...creditByCampaign.values()],
  };
}
