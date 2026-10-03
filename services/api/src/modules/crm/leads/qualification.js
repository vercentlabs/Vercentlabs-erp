// Structured qualification (need, budget, authority, timeframe) and the
// status decisions built on it: qualify, disqualify and reopen.
//
//   open ──qualify──▶ qualified ──convert──▶ converted
//     │                   │
//     └──disqualify──▶ disqualified ──reopen──▶ open   (qualified can reopen too)
//
// Disqualifying never deletes anything: the lead keeps its history, notes,
// files and activities and can be reopened later.
import { CrmError } from "../data-management/errors.js";
import { requireLeadPermission } from "./access.js";
import {
  LEAD_BUDGET_STATUSES, LEAD_DISQUALIFICATION_REASONS, LEAD_PERMISSIONS, LEAD_PURCHASE_TIMEFRAMES, LEAD_RATINGS, LEAD_TRI_STATE,
  leadDisqualificationReasonLabel,
} from "./constants.js";
import { recordLeadHistory } from "./history.js";
import { lockLead, runLeadBulkOperation } from "./records.js";

const TIMEFRAMES = LEAD_PURCHASE_TIMEFRAMES.map((entry) => entry.code);
const REASONS = LEAD_DISQUALIFICATION_REASONS.map((entry) => entry.code);
const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const text = (value) => String(value ?? "").trim();

function choice(input, field, allowed, label) {
  const value = text(input[field]).toLowerCase();
  if (!allowed.includes(value)) throw new CrmError(400, `Choose a value for ${label}.`, "CRM_LEAD_QUALIFICATION_VALIDATION");
  return value;
}

// camelCase field -> [column, normalizer]. Only fields present in the input change.
const QUALIFICATION_FIELDS = Object.freeze({
  needIdentified: ["need_identified", (input) => choice(input, "needIdentified", LEAD_TRI_STATE, "Need identified")],
  budgetStatus: ["budget_status", (input) => choice(input, "budgetStatus", LEAD_BUDGET_STATUSES, "Budget")],
  budgetAmount: ["budget_amount", (input) => {
    if (input.budgetAmount === null || text(input.budgetAmount) === "") return null;
    const amount = Number(input.budgetAmount);
    if (!Number.isFinite(amount) || amount < 0) throw new CrmError(400, "Enter a budget of zero or more.", "CRM_LEAD_QUALIFICATION_VALIDATION");
    return amount;
  }],
  decisionAuthority: ["decision_authority", (input) => choice(input, "decisionAuthority", LEAD_TRI_STATE, "Decision authority")],
  purchaseTimeframe: ["purchase_timeframe", (input) => (text(input.purchaseTimeframe) ? choice(input, "purchaseTimeframe", TIMEFRAMES, "Purchase timeframe") : null)],
  productInterest: ["product_interest", (input) => text(input.productInterest).slice(0, 4000) || null],
  estimatedValue: ["estimated_value", (input) => {
    const amount = input.estimatedValue === null || text(input.estimatedValue) === "" ? 0 : Number(input.estimatedValue);
    if (!Number.isFinite(amount) || amount < 0) throw new CrmError(400, "Enter an expected value of zero or more.", "CRM_LEAD_QUALIFICATION_VALIDATION");
    return amount;
  }],
  qualificationNotes: ["qualification_notes", (input) => text(input.qualificationNotes).slice(0, 4000) || null],
  rating: ["rating", (input) => choice(input, "rating", LEAD_RATINGS, "Rating")],
});

async function writeQualification(client, context, lead, input) {
  const fields = Object.keys(QUALIFICATION_FIELDS).filter((field) => has(input, field));
  if (!fields.length) return [];
  const values = fields.map((field) => QUALIFICATION_FIELDS[field][1](input));
  const changed = fields.filter((field, index) => String(lead[QUALIFICATION_FIELDS[field][0]] ?? "") !== String(values[index] ?? ""));
  if (!changed.length) return [];
  await client.query(
    `UPDATE tenant.crm_leads SET ${fields.map((field, index) => `${QUALIFICATION_FIELDS[field][0]} = $${index + 3}`).join(", ")}, updated_by = $${fields.length + 3}
      WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, lead.id, ...values, context.userId ?? null],
  );
  return changed;
}

// Saves the qualification answers without deciding anything.
export async function saveLeadQualification(client, context, leadId, input = {}) {
  requireLeadPermission(context, LEAD_PERMISSIONS.edit, "You do not have permission to edit leads.");
  const lead = await lockLead(client, context, leadId);
  if (lead.status === "converted") throw new CrmError(409, "A converted lead is read-only.", "CRM_LEAD_CONVERTED");
  const changed = await writeQualification(client, context, lead, input);
  if (changed.length) await recordLeadHistory(client, context, lead.id, "qualification_updated", "Qualification details updated", { fields: changed });
  return { changed: changed.length > 0 };
}

export async function qualifyLead(client, context, leadId, input = {}) {
  requireLeadPermission(context, LEAD_PERMISSIONS.qualify, "You do not have permission to qualify leads.");
  const lead = await lockLead(client, context, leadId);
  if (lead.status !== "open")
    throw new CrmError(409, `Only an open lead can be qualified. This lead is ${lead.status}.`, "CRM_LEAD_STATUS_CONFLICT");
  await writeQualification(client, context, lead, input);
  await client.query(
    `UPDATE tenant.crm_leads SET status = 'qualified', qualified_at = now(), qualified_by = $3, updated_by = $3
      WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, lead.id, context.userId ?? null],
  );
  await recordLeadHistory(client, context, lead.id, "qualified", "Lead qualified", { from: lead.status, to: "qualified" });
  return { status: "qualified" };
}

export async function disqualifyLead(client, context, leadId, input = {}) {
  requireLeadPermission(context, LEAD_PERMISSIONS.disqualify, "You do not have permission to disqualify leads.");
  const reason = text(input.reason);
  if (!REASONS.includes(reason)) throw new CrmError(400, "Choose a reason for disqualifying this lead.", "CRM_LEAD_DISQUALIFICATION_REASON_REQUIRED");
  const notes = text(input.notes).slice(0, 4000) || null;
  if (reason === "other" && !notes) throw new CrmError(400, "Add a note explaining the reason.", "CRM_LEAD_DISQUALIFICATION_NOTES_REQUIRED");
  const lead = await lockLead(client, context, leadId);
  if (!["open", "qualified"].includes(lead.status))
    throw new CrmError(409, `This lead is already ${lead.status}.`, "CRM_LEAD_STATUS_CONFLICT");
  await client.query(
    `UPDATE tenant.crm_leads SET status = 'disqualified', disqualification_reason = $3, disqualification_notes = $4,
            disqualified_at = now(), disqualified_by = $5, updated_by = $5
      WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, lead.id, reason, notes, context.userId ?? null],
  );
  await recordLeadHistory(client, context, lead.id, "disqualified", `Lead disqualified — ${leadDisqualificationReasonLabel(reason)}`, {
    from: lead.status, to: "disqualified", reason, notes,
  });
  return { status: "disqualified" };
}

// Returns a qualified or disqualified lead to open. The earlier decision
// stays in the history.
export async function reopenLead(client, context, leadId, input = {}) {
  requireLeadPermission(context, LEAD_PERMISSIONS.reopen, "You do not have permission to reopen leads.");
  const lead = await lockLead(client, context, leadId);
  if (lead.status === "converted") throw new CrmError(409, "A converted lead cannot be reopened.", "CRM_LEAD_CONVERTED");
  if (lead.status === "open") throw new CrmError(409, "This lead is already open.", "CRM_LEAD_STATUS_CONFLICT");
  await client.query(
    `UPDATE tenant.crm_leads SET status = 'open', qualified_at = NULL, qualified_by = NULL,
            disqualification_reason = NULL, disqualification_notes = NULL, disqualified_at = NULL, disqualified_by = NULL, updated_by = $3
      WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, lead.id, context.userId ?? null],
  );
  await recordLeadHistory(client, context, lead.id, "reopened", "Lead reopened", {
    from: lead.status, to: "open", previousReason: lead.disqualification_reason, note: text(input.note).slice(0, 500) || null,
  });
  return { status: "open" };
}

export async function bulkDisqualifyLeads(client, context, input = {}) {
  return runLeadBulkOperation(client, input.leadIds, (leadId) => disqualifyLead(client, context, leadId, input));
}
