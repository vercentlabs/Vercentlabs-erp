// Lead scoring (CRM plan 5.3): 0 to 100, kept on the lead with the reasons for it.
//
//   rules    the organization's own points — "+20 for IndiaMART", "+15 when the state is Maharashtra", "+10 with a mobile", "−10 for
//            students" — added up and kept between 0 and 100;
//   history  how often leads like this one converted, from the last year's closed leads (converted against disqualified): by source,
//            campaign, medium and state, each rate pulled towards the overall rate when it rests on few leads. Used once there are
//            enough closed leads (minimum_history), and switched off with use_history.
// With both, the score is their average; with one, that one; with neither (no rules, too little history), no score.
// A lead is scored when it is created or changed, and every open lead again when the rules or settings change.
import { CrmError } from "../data-management/errors.js";

const MANAGE = "crm.settings.manage";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (value) => String(value ?? "").trim();
const has = (input, field) => Object.prototype.hasOwnProperty.call(input ?? {}, field);
const invalid = (field, message) => new CrmError(400, message, "CRM_LEAD_SCORING_VALIDATION", { issues: [{ field, message }] });
const SMOOTHING = 5;

// What a rule can look at, and how: the lead's column (or custom field), and the comparisons that make sense.
export const SCORING_FIELDS = Object.freeze([
  { key: "sourceId", label: "Source", column: "source_id", operators: ["equals"] },
  { key: "campaignId", label: "Campaign", column: "campaign_id", operators: ["equals"] },
  { key: "medium", label: "Medium", column: "medium", operators: ["equals"] },
  { key: "state", label: "State", column: "state", operators: ["equals"] },
  { key: "city", label: "City", column: "city", operators: ["equals"] },
  { key: "countryCode", label: "Country", column: "country_code", operators: ["equals"] },
  { key: "industry", label: "Industry", column: "industry", operators: ["equals", "contains"] },
  { key: "productInterest", label: "Product interest", column: "product_interest", operators: ["contains"] },
  { key: "jobTitle", label: "Job title", column: "job_title", operators: ["contains"] },
  { key: "email", label: "Email", column: "email", operators: ["is_set"] },
  { key: "mobile", label: "Mobile", column: "mobile", operators: ["is_set"] },
  { key: "companyName", label: "Company", column: "company_name", operators: ["is_set"] },
  { key: "website", label: "Website", column: "website", operators: ["is_set"] },
  { key: "estimatedValue", label: "Estimated value", column: "estimated_value", operators: ["at_least"] },
  { key: "rating", label: "Rating", column: "rating", operators: ["equals"] },
  { key: "priority", label: "Priority", column: "priority", operators: ["equals"] },
]);
const FIELD = new Map(SCORING_FIELDS.map((field) => [field.key, field]));

function requireManage(context) {
  if (context.roleSlugs?.includes("organization_owner") || context.permissions?.includes(MANAGE)) return;
  throw new CrmError(403, "You do not have permission to manage lead scoring.", "PERMISSION_DENIED");
}

async function readSettings(client, organizationId) {
  const row = (await client.query("SELECT * FROM tenant.crm_lead_scoring_settings WHERE organization_id = $1", [organizationId])).rows[0];
  return { useHistory: row?.use_history ?? true, minimumHistory: row?.minimum_history ?? 20, hotThreshold: row?.hot_threshold ?? 70 };
}
const readRules = async (client, organizationId) =>
  (await client.query("SELECT * FROM tenant.crm_lead_scoring_rules WHERE organization_id = $1 AND status = 'active' ORDER BY created_at", [organizationId])).rows;

function valueOf(lead, field) {
  if (field.startsWith("custom:")) return lead.custom_data?.[field.slice(7)];
  return lead[FIELD.get(field)?.column];
}
function matches(rule, lead) {
  const value = valueOf(lead, rule.field);
  switch (rule.operator) {
    case "is_set": return value !== null && value !== undefined && text(value) !== "" && value !== false;
    case "at_least": return value !== null && value !== undefined && Number.isFinite(Number(value)) && Number(value) >= Number(rule.value);
    case "contains": return text(value).toLowerCase().includes(text(rule.value).toLowerCase()) && text(rule.value) !== "";
    default: return text(value).toLowerCase() === text(rule.value).toLowerCase();
  }
}

// The last year's closed leads, by dimension: { total, rate, by: { dimension: Map(value → { converted, total }) } }.
async function readHistory(client, organizationId) {
  const { rows } = await client.query(
    `SELECT source_id::text AS source, campaign_id::text AS campaign, medium, lower(btrim(state)) AS state, (status = 'converted') AS converted
       FROM tenant.crm_leads WHERE organization_id = $1 AND status IN ('converted', 'disqualified') AND COALESCE(converted_at, disqualified_at, updated_at) >= now() - interval '365 days'
        AND merged_into_lead_id IS NULL`, [organizationId]);
  const by = { source: new Map(), campaign: new Map(), medium: new Map(), state: new Map() };
  for (const row of rows)
    for (const dimension of Object.keys(by)) {
      if (!row[dimension]) continue;
      const entry = by[dimension].get(row[dimension]) ?? { converted: 0, total: 0 };
      entry.total += 1;
      if (row.converted) entry.converted += 1;
      by[dimension].set(row[dimension], entry);
    }
  const converted = rows.filter((row) => row.converted).length;
  return { total: rows.length, rate: rows.length ? converted / rows.length : 0, by };
}

const DIMENSION_LABEL = { source: "source", campaign: "campaign", medium: "medium", state: "state" };

// Scores one lead row. Returns { score, details } (score null when there is nothing to score by).
export function scoreLead(lead, { rules, settings, history }) {
  const matched = rules.filter((rule) => matches(rule, lead)).map((rule) => ({ label: rule.label || describeRule(rule), points: rule.points }));
  const rulesScore = rules.length ? Math.max(0, Math.min(100, matched.reduce((sum, entry) => sum + entry.points, 0))) : null;
  let learned = null;
  if (settings.useHistory && history.total >= settings.minimumHistory) {
    const values = { source: lead.source_id, campaign: lead.campaign_id, medium: lead.medium, state: text(lead.state).toLowerCase() || null };
    const factors = [];
    for (const [dimension, value] of Object.entries(values)) {
      if (!value) continue;
      const entry = history.by[dimension].get(String(value)) ?? { converted: 0, total: 0 };
      const rate = (entry.converted + SMOOTHING * history.rate) / (entry.total + SMOOTHING);
      factors.push({ dimension, label: `Leads of this ${DIMENSION_LABEL[dimension]}: ${entry.converted} of ${entry.total} converted`, rate: Math.round(rate * 1000) / 1000, count: entry.total });
    }
    const rate = factors.length ? factors.reduce((sum, factor) => sum + factor.rate, 0) / factors.length : history.rate;
    learned = { score: Math.round(rate * 100), basedOn: history.total, overallRate: Math.round(history.rate * 1000) / 1000, factors };
  }
  const parts = [rulesScore, learned?.score].filter((value) => value !== null && value !== undefined);
  const score = parts.length ? Math.round(parts.reduce((sum, value) => sum + value, 0) / parts.length) : null;
  return { score, details: { score, rulesScore, rules: matched, learned, hot: score !== null && score >= settings.hotThreshold } };
}

function describeRule(rule) {
  const field = rule.field.startsWith("custom:") ? rule.field.slice(7) : FIELD.get(rule.field)?.label ?? rule.field;
  if (rule.operator === "is_set") return `Has ${field.toLowerCase()}`;
  if (rule.operator === "at_least") return `${field} at least ${rule.value}`;
  if (rule.operator === "contains") return `${field} mentions "${rule.value}"`;
  return `${field}: ${rule.valueLabel ?? rule.value}`;
}

async function writeScore(client, organizationId, leadId, { score, details }) {
  await client.query("UPDATE tenant.crm_leads SET lead_score = $3, lead_score_details = $4::jsonb, lead_scored_at = now() WHERE organization_id = $1 AND id = $2",
    [organizationId, leadId, score, JSON.stringify(details)]);
}

// Scores one lead (after it is created or changed). Never refuses: scoring is advice.
export async function rescoreLead(client, organizationId, leadId) {
  // one connection: one query at a time
  const rules = await readRules(client, organizationId);
  const settings = await readSettings(client, organizationId);
  const history = await readHistory(client, organizationId);
  const lead = (await client.query("SELECT * FROM tenant.crm_leads WHERE organization_id = $1 AND id = $2", [organizationId, leadId])).rows[0];
  if (!lead) return null;
  const result = scoreLead(lead, { rules, settings, history });
  await writeScore(client, organizationId, lead.id, result);
  return result;
}

// Scores every open lead again (after the rules or settings change). Returns how many.
export async function rescoreOpenLeads(client, organizationId, { limit = 5000 } = {}) {
  // one connection: one query at a time
  const rules = await readRules(client, organizationId);
  const settings = await readSettings(client, organizationId);
  const history = await readHistory(client, organizationId);
  const leads = (await client.query(
    `SELECT * FROM tenant.crm_leads WHERE organization_id = $1 AND status IN ('open', 'qualified') AND archived_at IS NULL ORDER BY updated_at DESC LIMIT $2`, [organizationId, limit])).rows;
  for (const lead of leads) await writeScore(client, organizationId, lead.id, scoreLead(lead, { rules, settings, history }));
  return leads.length;
}

// ------------------------------------------------------------------ settings (CRM › Setup › Lead scoring)

function toRule(row) {
  return { id: row.id, field: row.field, operator: row.operator, value: row.value ?? null, points: row.points, label: row.label ?? describeRule(row), isActive: row.status === "active" };
}

export async function getLeadScoring(client, context) {
  requireManage(context);
  const { rows } = await client.query("SELECT * FROM tenant.crm_lead_scoring_rules WHERE organization_id = $1 ORDER BY created_at", [context.organizationId]);
  const history = await readHistory(client, context.organizationId);
  const custom = (await client.query("SELECT key, label, field_type FROM tenant.crm_custom_fields WHERE organization_id = $1 AND entity_type = 'lead' AND status = 'active' ORDER BY sequence",
    [context.organizationId])).rows;
  return {
    settings: await readSettings(client, context.organizationId),
    rules: rows.map(toRule),
    fields: [...SCORING_FIELDS.map(({ key, label, operators }) => ({ key, label, operators })),
      ...custom.map((field) => ({ key: `custom:${field.key}`, label: field.label, operators: field.field_type === "number" ? ["at_least", "is_set"] : field.field_type === "checkbox" ? ["is_set"] : ["equals", "contains", "is_set"] }))],
    history: { closedLeads: history.total, conversionRate: Math.round(history.rate * 1000) / 1000 },
  };
}

async function cleanRule(client, context, input) {
  const field = text(input.field);
  const known = FIELD.get(field) ?? (field.startsWith("custom:")
    ? (await client.query("SELECT 1 FROM tenant.crm_custom_fields WHERE organization_id = $1 AND entity_type = 'lead' AND key = $2 AND status = 'active'", [context.organizationId, field.slice(7)])).rows[0]
      && { operators: ["equals", "contains", "is_set", "at_least"] } : null);
  if (!known) throw invalid("field", "Choose what the rule looks at.");
  if (!known.operators.includes(input.operator)) throw invalid("operator", "Choose how to compare.");
  const value = input.operator === "is_set" ? null : text(input.value).slice(0, 200);
  if (input.operator !== "is_set" && !value) throw invalid("value", "Give the value to compare with.");
  if (input.operator === "at_least" && !Number.isFinite(Number(value))) throw invalid("value", "Give a number.");
  if (["sourceId", "campaignId"].includes(field) && !UUID.test(value)) throw invalid("value", "Choose from the list.");
  const points = Number(input.points);
  if (!Number.isInteger(points) || points < -100 || points > 100 || points === 0) throw invalid("points", "Give from −100 to 100 points (not 0).");
  return { field, operator: input.operator, value, points, label: text(input.label).slice(0, 120) || null };
}

// input: { field, operator, value?, points, label? }
export async function createLeadScoringRule(client, context, input = {}) {
  requireManage(context);
  const rule = await cleanRule(client, context, input);
  const row = (await client.query(
    `INSERT INTO tenant.crm_lead_scoring_rules (organization_id, field, operator, value, points, label, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [context.organizationId, rule.field, rule.operator, rule.value, rule.points, rule.label, context.userId ?? null])).rows[0];
  const rescored = await rescoreOpenLeads(client, context.organizationId);
  return { rule: toRule(row), rescored };
}

export async function updateLeadScoringRule(client, context, ruleId, input = {}) {
  requireManage(context);
  const current = UUID.test(String(ruleId ?? "")) ? (await client.query("SELECT * FROM tenant.crm_lead_scoring_rules WHERE organization_id = $1 AND id = $2", [context.organizationId, ruleId])).rows[0] : null;
  if (!current) throw new CrmError(404, "Scoring rule not found.", "CRM_LEAD_SCORING_RULE_NOT_FOUND");
  const rule = await cleanRule(client, context, { field: current.field, operator: current.operator, value: current.value, points: current.points, label: current.label, ...input });
  const status = has(input, "isActive") ? (input.isActive ? "active" : "inactive") : current.status;
  const row = (await client.query(
    `UPDATE tenant.crm_lead_scoring_rules SET field = $3, operator = $4, value = $5, points = $6, label = $7, status = $8, updated_at = now() WHERE organization_id = $1 AND id = $2 RETURNING *`,
    [context.organizationId, current.id, rule.field, rule.operator, rule.value, rule.points, rule.label, status])).rows[0];
  const rescored = await rescoreOpenLeads(client, context.organizationId);
  return { rule: toRule(row), rescored };
}

export async function deleteLeadScoringRule(client, context, ruleId) {
  requireManage(context);
  if (!UUID.test(String(ruleId ?? ""))) throw new CrmError(404, "Scoring rule not found.", "CRM_LEAD_SCORING_RULE_NOT_FOUND");
  const { rowCount } = await client.query("DELETE FROM tenant.crm_lead_scoring_rules WHERE organization_id = $1 AND id = $2", [context.organizationId, ruleId]);
  if (!rowCount) throw new CrmError(404, "Scoring rule not found.", "CRM_LEAD_SCORING_RULE_NOT_FOUND");
  return { deleted: true, rescored: await rescoreOpenLeads(client, context.organizationId) };
}

// input: any of { useHistory, minimumHistory, hotThreshold }
export async function saveLeadScoringSettings(client, context, input = {}) {
  requireManage(context);
  const current = await readSettings(client, context.organizationId);
  const next = { ...current };
  if (has(input, "useHistory")) next.useHistory = Boolean(input.useHistory);
  if (has(input, "minimumHistory")) {
    next.minimumHistory = Number(input.minimumHistory);
    if (!Number.isInteger(next.minimumHistory) || next.minimumHistory < 5 || next.minimumHistory > 10000) throw invalid("minimumHistory", "Use history once there are 5 to 10,000 closed leads.");
  }
  if (has(input, "hotThreshold")) {
    next.hotThreshold = Number(input.hotThreshold);
    if (!Number.isInteger(next.hotThreshold) || next.hotThreshold < 1 || next.hotThreshold > 100) throw invalid("hotThreshold", "Choose a score from 1 to 100.");
  }
  await client.query(
    `INSERT INTO tenant.crm_lead_scoring_settings (organization_id, use_history, minimum_history, hot_threshold, updated_by, updated_at) VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (organization_id) DO UPDATE SET use_history = EXCLUDED.use_history, minimum_history = EXCLUDED.minimum_history, hot_threshold = EXCLUDED.hot_threshold,
       updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [context.organizationId, next.useHistory, next.minimumHistory, next.hotThreshold, context.userId ?? null]);
  return { settings: next, rescored: await rescoreOpenLeads(client, context.organizationId) };
}
