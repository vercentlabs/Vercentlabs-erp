// Projects — Billable / Non-Billable Time, the rules: the project's time-billing policy (versioned; the company default when a project has
// none), the commercial authority for hourly billing (a contract line from the project customer's sales order), and the one decision every
// time entry goes through — whether its time is non-billable, included in a fixed fee, eligible for hourly billing on a contract line, or
// waiting for that line. What the person ticks is an intent; the server decides. Classification is not approval, approval is not invoicing.
import { has, projectError, seesAll, text, uuid } from "../project-core.js";

export const BILLING = Object.freeze({
  viewBilling: "projects.time.view_billing", viewCost: "projects.time.view_cost", request: "projects.time.billing_request", approve: "projects.time.billing_approve",
  correct: "projects.time.correct_approved", export: "projects.time.export",
});
export const BILLING_METHODS = Object.freeze({
  INTERNAL: "Internal project", NON_BILLABLE: "Non-billable", FIXED_PRICE: "Fixed price", TIME_AND_MATERIALS: "Time and materials", HYBRID: "Fixed price with hourly extras",
});
export const CLASSIFICATIONS = Object.freeze({
  NON_BILLABLE: "Non-billable", INCLUDED_IN_FIXED_FEE: "Included in the fixed fee", TIME_AND_MATERIALS_ELIGIBLE: "Billable (hourly)", ELIGIBILITY_PENDING: "Billable — contract line pending",
});
export const NON_BILLABLE_REASONS = Object.freeze({
  INTERNAL_WORK: "Internal project or company activity", INCLUDED_IN_CONTRACT: "Work already covered by the fixed price", INTERNAL_MEETING: "Internal coordination",
  TRAINING: "Internal staff development", REWORK_INTERNAL: "Corrective work not chargeable", GOODWILL_SUPPORT: "Free customer assistance",
  NON_BILLABLE_CONTRACT: "The contract excludes this work", OTHER: "Other (explain)",
});
export const REQUEST_STATUS = Object.freeze({ DRAFT: "Reserved (draft)", SUBMITTED: "With Sales", INVOICED: "Invoiced", CANCELLED: "Cancelled (released)", REVERSED: "Reversed (credited)" });

const MESSAGES = Object.freeze({
  TIME_BILLING_POLICY_MISSING: "This Project needs billing settings before time can be classified for customer invoicing.",
  TIME_BILLING_NOT_ALLOWED: "This work is not eligible for separate customer billing.",
  TIME_BILLING_CONTRACT_MISSING: "Link an eligible Sales contract or order line.",
  TIME_BILLING_CUSTOMER_MISMATCH: "The Sales contract belongs to a different customer.",
  TIME_BILLING_RATE_MISSING: "No authorized billing rate is available.",
  TIME_BILLING_HOURS_UNAPPROVED: "Approve the Timesheet before requesting billing.",
  TIME_BILLING_LIMIT_EXCEEDED: "The requested hours exceed the contract allowance.",
  TIME_BILLING_ALREADY_ALLOCATED: "Some of this time is already reserved or invoiced.",
  TIME_BILLING_FIXED_FEE_INCLUDED: "This time is covered by the fixed-price agreement.",
  TIME_BILLING_CORRECTION_REQUIRED: "This entry has been approved. Request a correction.",
  TIME_BILLING_INVOICE_EXISTS: "This time is already invoiced. Use the Sales adjustment workflow.",
  TIME_BILLING_VERSION_CONFLICT: "Time or billing records changed. Refresh and review.",
  TIME_BILLING_PERMISSION_DENIED: "You are not authorized for this action.",
  TIME_BILLING_OUTCOME_UNKNOWN: "Checking the earlier billing operation. Do not submit again.",
  TIME_BILLING_REASON_REQUIRED: "Choose why this time is not billable.",
  TIME_BILLING_NOT_FOUND: "The billing record could not be found.",
});
export const billError = (status, code, message, details) => projectError(status, code, message ?? MESSAGES[code], details);
export const BILLING_MESSAGES = MESSAGES;
export const keyOf = (input) => text(input?.idempotencyKey, 200) || null;
export const minutesLabel = (minutes) => {
  const total = Number(minutes ?? 0);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h && m ? `${h}h ${m}m` : h ? `${h}h` : `${m}m`;
};
export const money = (value) => Math.round(Number(value) * 100) / 100;
export const amountFor = (minutes, rate) => money((Number(minutes) * Number(rate)) / 60);

// Who may see billing on a project (its manager or a portfolio reader, or anyone holding billing visibility), request and authorize it.
export const viewsBilling = (c) => has(c, BILLING.viewBilling);
export const viewsCost = (c) => has(c, BILLING.viewCost);
export const billingScope = (c, project) => viewsBilling(c) && (seesAll(c) || project.manager_user_id === c.userId || has(c, BILLING.request) || has(c, BILLING.approve));
export const mayRequest = (c, project) => has(c, BILLING.request) && viewsBilling(c) && (seesAll(c) || project.manager_user_id === c.userId || has(c, BILLING.approve));
export const mayAuthorize = (c) => has(c, BILLING.approve) && viewsBilling(c);
export const mayManagePolicy = (c, project) => has(c, "projects.billing.manage") && (seesAll(c) || project.manager_user_id === c.userId);

// ------------------------------------------------------------------ policy
export async function billingSettings(client, c) {
  const row = (await client.query(`SELECT time_billing_default_method, time_nonbillable_reason_required, time_billing_request_approval FROM tenant.project_settings WHERE organization_id = $1`,
    [c.organizationId])).rows[0] ?? {};
  return { defaultMethod: row.time_billing_default_method ?? "NON_BILLABLE", reasonRequired: Boolean(row.time_nonbillable_reason_required), requestApproval: row.time_billing_request_approval ?? true };
}
// The project's policy now: its latest version, or — for a project that never set one — internal for an internal project and the company
// default for a customer project (method null when the company asks every customer project to be set up first).
export async function projectBillingPolicy(client, c, project) {
  const row = (await client.query(`SELECT * FROM tenant.project_time_billing_policies WHERE organization_id = $1 AND project_id = $2 ORDER BY policy_version DESC LIMIT 1`,
    [c.organizationId, project.id])).rows[0];
  const settings = await billingSettings(client, c);
  if (row) return { method: row.billing_method, version: row.policy_version, defaultContractLineId: row.default_contract_line_id, reference: row.reference, note: row.note, setBy: row.set_by, setAt: row.set_at, settings, implicit: false };
  const method = project.classification === "INTERNAL" ? "INTERNAL" : settings.defaultMethod === "REQUIRE_SETUP" ? null : settings.defaultMethod;
  return { method, version: 0, defaultContractLineId: null, reference: null, note: null, setBy: null, setAt: null, settings, implicit: true };
}

// ------------------------------------------------------------------ contract lines
export async function loadContractLine(client, c, lineId) {
  return (await client.query(`SELECT line.*, to_char(line.effective_from, 'YYYY-MM-DD') AS from_day, to_char(line.effective_to, 'YYYY-MM-DD') AS to_day,
        so.party_id AS order_party_id, so.lifecycle_status AS order_status, so.sales_order_number
      FROM tenant.project_time_contract_lines line JOIN tenant.sales_orders so ON so.id = line.sales_order_id
      WHERE line.organization_id = $1 AND line.id = $2`, [c.organizationId, uuid(lineId, "Contract line")])).rows[0] ?? null;
}
// Why this contract line cannot authorize this work (or null when it can): the project's own active line, on the work date, still on a
// live sales order of the project's customer, covering this person and this kind of work.
export function lineProblem(line, { project, day, employeeUserId, task }) {
  if (!line || line.project_id !== project.id) return { code: "TIME_BILLING_CONTRACT_MISSING", message: "That contract line is not on this project." };
  if (line.status !== "ACTIVE") return { code: "TIME_BILLING_CONTRACT_MISSING", message: `Contract line ${line.label} is closed.` };
  if (["cancelled", "draft"].includes(line.order_status)) return { code: "TIME_BILLING_CONTRACT_MISSING", message: `${line.sales_order_number} is ${line.order_status}.` };
  if (!project.customer_id || line.order_party_id !== project.customer_id) return { code: "TIME_BILLING_CUSTOMER_MISMATCH" };
  if (day && (day < line.from_day || (line.to_day && day > line.to_day))) return { code: "TIME_BILLING_CONTRACT_MISSING", message: `Contract line ${line.label} covers ${line.from_day}${line.to_day ? ` to ${line.to_day}` : " onwards"}, not ${day}.` };
  if (line.allowed_user_ids?.length && !line.allowed_user_ids.includes(employeeUserId)) return { code: "TIME_BILLING_NOT_ALLOWED", message: `Contract line ${line.label} does not cover this person's work.` };
  if (line.allowed_task_types?.length && (!task || !line.allowed_task_types.includes(task.task_type))) return { code: "TIME_BILLING_NOT_ALLOWED", message: `Contract line ${line.label} covers only ${line.allowed_task_types.join(", ").toLowerCase()} work.` };
  if (line.hourly_rate === null || line.hourly_rate === undefined) return { code: "TIME_BILLING_RATE_MISSING" };
  return null;
}
export async function taskBillingRule(client, c, taskId) {
  if (!taskId) return null;
  return (await client.query(`SELECT * FROM tenant.project_time_task_billing WHERE organization_id = $1 AND task_id = $2`, [c.organizationId, taskId])).rows[0] ?? null;
}

// ------------------------------------------------------------------ the decision
// input: { project, task (row or null), employeeUserId, day, billable (the person's intent; null = the policy's default), contractLineId?,
// reasonCode?, reasonNote? }. Returns { classification, billable, contractLineId, reasonCode, reasonNote, policyVersion, explanation, warnings }.
export async function classifyProjectTimeEntry(client, c, input) {
  const { project, task = null, employeeUserId, day } = input;
  const policy = input.policy ?? await projectBillingPolicy(client, c, project);
  const rule = await taskBillingRule(client, c, task?.id ?? null);
  const intent = input.billable === undefined || input.billable === null ? null : Boolean(input.billable);
  const reasonCode = input.reasonCode ? String(input.reasonCode).toUpperCase() : null;
  const reasonNote = text(input.reasonNote, 500) || null;
  if (reasonCode && !NON_BILLABLE_REASONS[reasonCode]) throw billError(400, "TIME_BILLING_REASON_REQUIRED", "Choose one of the listed reasons.");
  const base = { policyVersion: policy.version, warnings: [] };
  const nonBillable = (code, explanation) => {
    const reason = reasonCode ?? code;
    if (!reason && policy.settings.reasonRequired) throw billError(400, "TIME_BILLING_REASON_REQUIRED");
    if (reason === "OTHER" && (!reasonNote || reasonNote.length < 3)) throw billError(400, "TIME_BILLING_REASON_REQUIRED", "Explain why this time is not billable.");
    return { ...base, classification: reason === "INCLUDED_IN_CONTRACT" && ["FIXED_PRICE", "HYBRID"].includes(policy.method) ? "INCLUDED_IN_FIXED_FEE" : "NON_BILLABLE",
      billable: false, contractLineId: null, reasonCode: reason, reasonNote, explanation };
  };
  if (!policy.method) {
    if (intent) throw billError(400, "TIME_BILLING_POLICY_MISSING");
    return nonBillable(null, "The project's billing is not set up yet: time is recorded as non-billable.");
  }
  if (rule?.rule === "NON_BILLABLE") {
    if (intent) throw billError(400, "TIME_BILLING_NOT_ALLOWED", `${task?.task_code ?? "This task"} is non-billable (${NON_BILLABLE_REASONS[rule.reason_code] ?? "project policy"}).`);
    return nonBillable(rule.reason_code ?? "NON_BILLABLE_CONTRACT", "This task is non-billable.");
  }
  if (policy.method === "INTERNAL" || policy.method === "NON_BILLABLE") {
    if (intent) throw billError(400, "TIME_BILLING_NOT_ALLOWED", policy.method === "INTERNAL" ? "This is an internal project: its time is never billed to a customer." : "This project's time is not billed to the customer.");
    return nonBillable(policy.method === "INTERNAL" ? "INTERNAL_WORK" : "NON_BILLABLE_CONTRACT", policy.method === "INTERNAL" ? "Internal project: non-billable, still counted in labor cost." : "Non-billable project.");
  }
  // The contract line this work would bill on: the one chosen, the task's, or — on a time-and-materials project — the project's default line or
  // its only line in force on the work date. A hybrid project bills hourly only on an explicitly chosen or task-tied extra-service line.
  let lineId = input.contractLineId || input.preferredLineId || rule?.contract_line_id || null;
  if (!lineId && policy.method === "TIME_AND_MATERIALS") {
    lineId = policy.defaultContractLineId ?? null;
    if (!lineId) {
      const lines = (await client.query(`SELECT id FROM tenant.project_time_contract_lines WHERE organization_id = $1 AND project_id = $2 AND status = 'ACTIVE' AND effective_from <= $3::date
          AND (effective_to IS NULL OR effective_to >= $3::date)`, [c.organizationId, project.id, day])).rows;
      if (lines.length === 1) lineId = lines[0].id;
    }
  }
  if (policy.method === "FIXED_PRICE") {
    if (intent) throw billError(400, "TIME_BILLING_FIXED_FEE_INCLUDED", "This time is covered by the fixed-price agreement. Extra hourly work needs its own authorized sales order line (a hybrid project).");
    return nonBillable(reasonCode && reasonCode !== "INCLUDED_IN_CONTRACT" ? reasonCode : "INCLUDED_IN_CONTRACT", "Included in the fixed price: recorded for effort and cost, not billed by the hour.");
  }
  const wantsBilling = intent ?? (policy.method === "TIME_AND_MATERIALS" || (policy.method === "HYBRID" && Boolean(lineId)));
  if (!wantsBilling) {
    if (policy.method === "HYBRID") return nonBillable(reasonCode ?? "INCLUDED_IN_CONTRACT", "Included in the fixed price.");
    return nonBillable(null, "Not billed to the customer.");
  }
  if (!lineId) {
    if (policy.method === "HYBRID") throw billError(400, "TIME_BILLING_CONTRACT_MISSING", "On this project hourly billing applies only to work on an authorized extra-service line. Choose the line, or record the time as included.");
    if (!project.customer_id) throw billError(400, "TIME_BILLING_CONTRACT_MISSING", "Hourly billing needs the project's customer and an authorized sales order line.");
    return { ...base, classification: "ELIGIBILITY_PENDING", billable: true, contractLineId: null, reasonCode: null, reasonNote: null,
      explanation: "Billable once a contract line authorizes it.", warnings: [{ code: "TIME_BILLING_CONTRACT_MISSING", message: "No contract line authorizes hourly billing for this work yet: it waits for one before it can be billed." }] };
  }
  const line = await loadContractLine(client, c, lineId);
  const problem = lineProblem(line, { project, day, employeeUserId, task });
  if (problem) {
    // A line the person chose explicitly must be right; an inferred one that does not apply leaves the time waiting.
    if (input.contractLineId) throw billError(400, problem.code, problem.message);
    if (policy.method === "HYBRID") throw billError(400, problem.code, problem.message);
    return { ...base, classification: "ELIGIBILITY_PENDING", billable: true, contractLineId: null, reasonCode: null, reasonNote: null, explanation: "Billable once a valid contract line authorizes it.",
      warnings: [{ code: problem.code, message: problem.message ?? MESSAGES[problem.code] }] };
  }
  return { ...base, classification: "TIME_AND_MATERIALS_ELIGIBLE", billable: true, contractLineId: line.id, reasonCode: null, reasonNote: null,
    explanation: `Billable on ${line.label} once approved.` };
}
