// F027 Lead scoring — shared primitives used by both the scoring engine
// and (for now) the legacy lead-intelligence.js's SLA/nurture functions,
// which are not F027-owned but share the same error class, sensitive-scope
// guard and scoped-Lead fetch. Kept as the one definition here (moved from
// lead-intelligence.js) so neither module needs to import the other —
// avoiding a circular dependency between them.
import { createHash } from "node:crypto";
import { canViewSensitiveLeadContent, leadScopeSql } from "../lead-security.js";

export class CrmLeadIntelligenceError extends Error {
  constructor(status, message, code = "CRM_LEAD_INTELLIGENCE_ERROR", details = []) {
    super(message);
    this.name = "CrmLeadIntelligenceError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const text = (value) => String(value ?? "").trim();
export const number = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
export const object = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});
export const array = (value) => (Array.isArray(value) ? value : []);
export const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

export function assertSensitiveLeadIntelligenceAccess(context) {
  if (canViewSensitiveLeadContent(context)) return;
  throw new CrmLeadIntelligenceError(403, "You do not have permission to view sensitive Lead intelligence.", "CRM_LEAD_SENSITIVE_CONTENT_FORBIDDEN");
}

export async function getScopedLead(client, context, leadId, { lock = false } = {}) {
  const values = [context.organizationId, leadId];
  const scope = leadScopeSql(context, values, "lead");
  const result = await client.query(
    `SELECT lead.* FROM tenant.crm_leads lead
      WHERE lead.organization_id=$1 AND lead.id=$2${scope}${lock ? " FOR UPDATE" : ""}`,
    values,
  );
  if (!result.rows[0]) throw new CrmLeadIntelligenceError(404, "Lead not found.", "CRM_LEAD_NOT_FOUND");
  return result.rows[0];
}

export function scopedLeadWhere(context, values, alias = "lead") {
  return leadScopeSql(context, values, alias);
}

export function crmLeadIntelligenceHash(value) {
  const stable = (input) => {
    if (Array.isArray(input)) return input.map(stable);
    if (input && typeof input === "object") {
      return Object.fromEntries(
        Object.keys(input)
          .sort()
          .map((key) => [key, stable(input[key])]),
      );
    }
    return input;
  };
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}
