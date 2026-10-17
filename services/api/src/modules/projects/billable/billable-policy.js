// Projects — Billable / Non-Billable Time, the policy: how a project's time may be billed (each change a new version), the hourly commercial
// authority (contract lines taken from the project customer's sales order lines — the rate and currency are Sales's, never typed here),
// task rules, and resolving approved time that waited for its contract line. Nothing here touches an invoice or the ledger.
import { has, projectEvent, seesAll, text, userNames, uuid } from "../project-core.js";
import { loadProjectRow, timeError } from "../timesheets/time-rules.js";
import { timeEvent } from "../timesheets/time-entries.js";
import {
  BILLING, BILLING_METHODS, CLASSIFICATIONS, NON_BILLABLE_REASONS, billError, billingScope, billingSettings, classifyProjectTimeEntry, keyOf, loadContractLine, mayManagePolicy, mayRequest,
  projectBillingPolicy, viewsBilling,
} from "./billable-rules.js";

const TASK_TYPES = ["GENERAL", "DESIGN", "BUILD", "CONFIGURATION", "DATA", "TESTING", "DOCUMENTATION", "MEETING", "OTHER"];
const mayAuthorizeLines = (c, project) => mayManagePolicy(c, project) || has(c, BILLING.approve);

// input: { billingMethod, defaultContractLineId?, reference?, note?, expectedVersion? (the policy version seen) }
export async function setProjectTimeBillingPolicy(client, c, projectId, input = {}) {
  const project = await loadProjectRow(client, c, projectId);
  if (!mayManagePolicy(c, project)) throw billError(403, "TIME_BILLING_PERMISSION_DENIED");
  await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`time-billing-policy:${project.id}`]);
  const current = await projectBillingPolicy(client, c, project);
  if (input.expectedVersion !== undefined && input.expectedVersion !== null && Number(input.expectedVersion) !== Number(current.version)) throw billError(409, "TIME_BILLING_VERSION_CONFLICT");
  const method = String(input.billingMethod ?? "").toUpperCase();
  if (!BILLING_METHODS[method]) throw billError(400, "TIME_BILLING_POLICY_MISSING", "Choose how the project's time is billed.");
  if (project.classification === "INTERNAL" && !["INTERNAL", "NON_BILLABLE"].includes(method)) throw billError(400, "TIME_BILLING_NOT_ALLOWED", "An internal project has no customer to bill.");
  if (["TIME_AND_MATERIALS", "HYBRID"].includes(method) && !project.customer_id) throw billError(400, "TIME_BILLING_CONTRACT_MISSING", "Hourly billing needs the project's customer.");
  const lineId = input.defaultContractLineId ? uuid(input.defaultContractLineId, "Contract line") : null;
  if (lineId) {
    const line = await loadContractLine(client, c, lineId);
    if (!line || line.project_id !== project.id || line.status !== "ACTIVE") throw billError(400, "TIME_BILLING_CONTRACT_MISSING", "Choose one of this project's active contract lines.");
    if (method !== "TIME_AND_MATERIALS") throw billError(400, "TIME_BILLING_NOT_ALLOWED", "A default contract line applies only to a time-and-materials project.");
  }
  const reference = text(input.reference, 200) || null;
  const note = text(input.note, 1000) || null;
  if (!current.implicit && method === current.method && lineId === (current.defaultContractLineId ?? null) && reference === current.reference) return { projectId: project.id, version: current.version, unchanged: true };
  const version = current.version + 1;
  await client.query(`INSERT INTO tenant.project_time_billing_policies (organization_id, project_id, policy_version, billing_method, default_contract_line_id, reference, note, set_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [c.organizationId, project.id, version, method, lineId, reference, note, c.userId ?? null]);
  await projectEvent(client, c, project.id, "TIME_BILLING_POLICY_CHANGED", `Time billing: ${BILLING_METHODS[current.method] ?? "not set"} → ${BILLING_METHODS[method]}${reference ? ` (${reference})` : ""}`);
  // Time already approved keeps the classification it was approved under; unsubmitted time is classified again when it is saved or submitted.
  const kept = Number((await client.query(`SELECT count(*)::int AS n FROM tenant.project_time_entries WHERE organization_id = $1 AND project_id = $2 AND entry_status IN ('SUBMITTED', 'APPROVED')
      AND billing_policy_version < $3`, [c.organizationId, project.id, version])).rows[0].n);
  return { projectId: project.id, version, billingMethod: method, keptEntries: kept };
}

// The hourly authority: one line of a sales order linked to the project, for the project's customer, not already billed through a milestone.
// input: { salesOrderLineId, label?, effectiveFrom, effectiveTo?, maxMinutes?, roundingMinutes?, allowedTaskTypes?, allowedUserIds? }
export async function authorizeContractLine(client, c, projectId, input = {}) {
  const project = await loadProjectRow(client, c, projectId);
  if (!mayAuthorizeLines(c, project)) throw billError(403, "TIME_BILLING_PERMISSION_DENIED");
  const soLine = (await client.query(`SELECT line.id, line.item_id, line.item_name_snapshot, line.description_snapshot, line.unit_price, line.quantity, line.uom_snapshot,
        version.sales_order_id, version.currency_code, so.party_id, so.lifecycle_status, so.sales_order_number, item.item_type
      FROM tenant.sales_order_lines line JOIN tenant.sales_order_versions version ON version.id = line.sales_order_version_id JOIN tenant.sales_orders so ON so.id = version.sales_order_id
      LEFT JOIN tenant.items item ON item.id = line.item_id
      WHERE line.organization_id = $1 AND line.id = $2`, [c.organizationId, uuid(input.salesOrderLineId, "Sales order line")])).rows[0];
  if (!soLine) throw billError(404, "TIME_BILLING_CONTRACT_MISSING", "The sales order line could not be found.");
  const linked = (await client.query(`SELECT 1 FROM tenant.project_links WHERE organization_id = $1 AND project_id = $2 AND source_type = 'SALES_ORDER' AND source_id = $3 AND removed_at IS NULL`,
    [c.organizationId, project.id, soLine.sales_order_id])).rows[0];
  if (!linked) throw billError(400, "TIME_BILLING_CONTRACT_MISSING", `Link ${soLine.sales_order_number} to the project first.`);
  if (!project.customer_id || soLine.party_id !== project.customer_id) throw billError(400, "TIME_BILLING_CUSTOMER_MISMATCH");
  if (["draft", "pending_approval", "cancelled"].includes(soLine.lifecycle_status)) throw billError(400, "TIME_BILLING_CONTRACT_MISSING", `${soLine.sales_order_number} is not confirmed (${soLine.lifecycle_status.replace(/_/g, " ")}).`);
  if (soLine.item_type && soLine.item_type !== "service") throw billError(400, "TIME_BILLING_NOT_ALLOWED", "Only a service line bills project hours.");
  if (soLine.unit_price === null || soLine.unit_price === undefined) throw billError(400, "TIME_BILLING_RATE_MISSING");
  const milestone = (await client.query(`SELECT milestone_code FROM tenant.project_milestones WHERE organization_id = $1 AND sales_order_line_id = $2 LIMIT 1`, [c.organizationId, soLine.id])).rows[0];
  if (milestone) throw billError(400, "TIME_BILLING_FIXED_FEE_INCLUDED", `This order line is billed through milestone ${milestone.milestone_code}; hourly time needs its own line.`);
  if ((await client.query(`SELECT 1 FROM tenant.project_time_contract_lines WHERE organization_id = $1 AND project_id = $2 AND sales_order_line_id = $3 AND status = 'ACTIVE'`,
    [c.organizationId, project.id, soLine.id])).rows[0]) throw billError(409, "TIME_BILLING_ALREADY_ALLOCATED", "This order line already authorizes time on the project.");
  const from = String(input.effectiveFrom ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) throw timeError(400, "TIME_WORK_DATE_INVALID", "Enter the date the agreed rate applies from.");
  const to = input.effectiveTo ? String(input.effectiveTo).slice(0, 10) : null;
  if (to && to < from) throw timeError(400, "TIME_WORK_DATE_INVALID", "The end date is on or after the start date.");
  // The cap: what was agreed (or the order line's quantity, when it is sold in hours).
  const hoursUom = /^(h|hr|hrs|hour|hours)$/i.test(String(soLine.uom_snapshot ?? "").trim());
  const maxMinutes = input.maxMinutes !== undefined && input.maxMinutes !== null ? Number(input.maxMinutes) : hoursUom && soLine.quantity ? Math.round(Number(soLine.quantity) * 60) : null;
  if (maxMinutes !== null && (!Number.isInteger(maxMinutes) || maxMinutes <= 0)) throw billError(400, "TIME_BILLING_LIMIT_EXCEEDED", "Enter the agreed maximum as whole minutes above zero.");
  const rounding = Number(input.roundingMinutes ?? 1);
  if (![1, 5, 6, 10, 15, 30, 60].includes(rounding)) throw billError(400, "TIME_BILLING_NOT_ALLOWED", "Choose a billing rounding of 1, 5, 6, 10, 15, 30 or 60 minutes.");
  const types = Array.isArray(input.allowedTaskTypes) && input.allowedTaskTypes.length ? input.allowedTaskTypes.map((type) => String(type).toUpperCase()) : null;
  if (types?.some((type) => !TASK_TYPES.includes(type))) throw billError(400, "TIME_BILLING_NOT_ALLOWED", "Choose task types from the list.");
  const users = Array.isArray(input.allowedUserIds) && input.allowedUserIds.length ? input.allowedUserIds.map((id) => uuid(id, "Person")) : null;
  const label = text(input.label, 120) || `${soLine.sales_order_number} · ${soLine.item_name_snapshot}`;
  const row = (await client.query(`INSERT INTO tenant.project_time_contract_lines (organization_id, project_id, sales_order_id, sales_order_line_id, service_item_id, label, hourly_rate, currency, effective_from,
        effective_to, max_minutes, rounding_minutes, allowed_task_types, allowed_user_ids, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id, line_number`,
  [c.organizationId, project.id, soLine.sales_order_id, soLine.id, soLine.item_id, label, soLine.unit_price, soLine.currency_code, from, to, maxMinutes, rounding, types, users, c.userId ?? null])).rows[0];
  await projectEvent(client, c, project.id, "TIME_CONTRACT_LINE_AUTHORIZED", `${label} authorizes hourly time from ${from}${maxMinutes ? ` (up to ${maxMinutes / 60}h)` : ""}`);
  return { contractLineId: row.id, lineNumber: `CL-${row.line_number}` };
}

// A line stops authorizing new time (a rate revision is a new line); time already classified on it keeps it, and so does its billing.
export async function closeContractLine(client, c, lineId, input = {}) {
  const line = await loadContractLine(client, c, lineId);
  if (!line) throw billError(404, "TIME_BILLING_NOT_FOUND");
  const project = await loadProjectRow(client, c, line.project_id);
  if (!mayAuthorizeLines(c, project)) throw billError(403, "TIME_BILLING_PERMISSION_DENIED");
  if (line.status === "CLOSED") return { contractLineId: line.id, status: "CLOSED", replayed: true };
  const reason = text(input.reason, 500);
  if (reason.length < 3) throw timeError(400, "TIME_REASON_REQUIRED", "Say why the line stops authorizing time.");
  await client.query(`UPDATE tenant.project_time_contract_lines SET status = 'CLOSED', closed_by = $3, closed_at = now(), close_reason = $4, row_version = row_version + 1 WHERE organization_id = $1 AND id = $2`,
    [c.organizationId, line.id, c.userId ?? null, reason]);
  await projectEvent(client, c, project.id, "TIME_CONTRACT_LINE_CLOSED", `${line.label} closed: ${reason}`);
  return { contractLineId: line.id, status: "CLOSED" };
}

// A task held non-billable, or tied to one contract line (the extra service on a hybrid project); null removes the rule.
// input: { rule: NON_BILLABLE | CONTRACT_LINE | null, contractLineId?, reasonCode?, note? }
export async function setTaskBillingRule(client, c, taskId, input = {}) {
  const task = (await client.query(`SELECT id, project_id, task_code FROM tenant.project_tasks WHERE organization_id = $1 AND id = $2`, [c.organizationId, uuid(taskId, "Task")])).rows[0];
  if (!task) throw billError(404, "TIME_BILLING_NOT_FOUND", "The task could not be found.");
  const project = await loadProjectRow(client, c, task.project_id);
  if (!mayManagePolicy(c, project)) throw billError(403, "TIME_BILLING_PERMISSION_DENIED");
  const rule = input.rule ? String(input.rule).toUpperCase() : null;
  if (!rule) {
    await client.query(`DELETE FROM tenant.project_time_task_billing WHERE organization_id = $1 AND task_id = $2`, [c.organizationId, task.id]);
    await projectEvent(client, c, project.id, "TIME_TASK_BILLING_CLEARED", `${task.task_code} follows the project's billing policy`);
    return { taskId: task.id, rule: null };
  }
  if (!["NON_BILLABLE", "CONTRACT_LINE"].includes(rule)) throw billError(400, "TIME_BILLING_NOT_ALLOWED", "Choose non-billable or a contract line.");
  let lineId = null;
  if (rule === "CONTRACT_LINE") {
    const line = await loadContractLine(client, c, input.contractLineId);
    if (!line || line.project_id !== project.id || line.status !== "ACTIVE") throw billError(400, "TIME_BILLING_CONTRACT_MISSING", "Choose one of this project's active contract lines.");
    lineId = line.id;
  }
  const reasonCode = rule === "NON_BILLABLE" ? (input.reasonCode ? String(input.reasonCode).toUpperCase() : "NON_BILLABLE_CONTRACT") : null;
  if (reasonCode && !NON_BILLABLE_REASONS[reasonCode]) throw billError(400, "TIME_BILLING_REASON_REQUIRED", "Choose one of the listed reasons.");
  await client.query(`INSERT INTO tenant.project_time_task_billing (task_id, organization_id, project_id, rule, contract_line_id, reason_code, note, set_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT (task_id) DO UPDATE SET rule = EXCLUDED.rule, contract_line_id = EXCLUDED.contract_line_id, reason_code = EXCLUDED.reason_code, note = EXCLUDED.note, set_by = EXCLUDED.set_by,
        set_at = now(), row_version = tenant.project_time_task_billing.row_version + 1`,
  [task.id, c.organizationId, project.id, rule, lineId, reasonCode, text(input.note, 500) || null, c.userId ?? null]);
  await projectEvent(client, c, project.id, "TIME_TASK_BILLING_SET", `${task.task_code}: ${rule === "NON_BILLABLE" ? `non-billable (${NON_BILLABLE_REASONS[reasonCode]})` : "billed on its contract line"}`);
  return { taskId: task.id, rule };
}

// Approved time that waited for its contract line becomes billable once a valid line covers it (input.contractLineId, or the policy's).
export async function resolveTimeEligibility(client, c, entryId, input = {}) {
  const entry = (await client.query(`SELECT *, to_char(work_date, 'YYYY-MM-DD') AS work_date_text FROM tenant.project_time_entries WHERE organization_id = $1 AND id = $2 FOR UPDATE`,
    [c.organizationId, uuid(entryId, "Time entry")])).rows[0];
  if (!entry) throw billError(404, "TIME_BILLING_NOT_FOUND");
  const project = await loadProjectRow(client, c, entry.project_id);
  if (!mayRequest(c, project)) throw billError(403, "TIME_BILLING_PERMISSION_DENIED");
  if (entry.billing_classification === "TIME_AND_MATERIALS_ELIGIBLE" && (!input.contractLineId || input.contractLineId === entry.contract_line_id)) return { entryId: entry.id, classification: entry.billing_classification, replayed: true };
  if (entry.entry_status !== "APPROVED") throw billError(409, "TIME_BILLING_HOURS_UNAPPROVED", "Unapproved time is classified when it is saved or submitted.");
  if (entry.billing_classification !== "ELIGIBILITY_PENDING") throw billError(409, "TIME_BILLING_CORRECTION_REQUIRED");
  const task = entry.task_id ? (await client.query(`SELECT id, task_code, task_type FROM tenant.project_tasks WHERE id = $1`, [entry.task_id])).rows[0] : null;
  const decided = await classifyProjectTimeEntry(client, c, { project, task, employeeUserId: entry.employee_user_id, day: entry.work_date_text, billable: true, contractLineId: input.contractLineId ?? null });
  if (decided.classification !== "TIME_AND_MATERIALS_ELIGIBLE") throw billError(400, "TIME_BILLING_CONTRACT_MISSING", decided.warnings[0]?.message);
  await client.query(`UPDATE tenant.project_time_entries SET billing_classification = 'TIME_AND_MATERIALS_ELIGIBLE', contract_line_id = $3, billing_policy_version = $4, classification_updated_by = $5,
      classification_updated_at = now(), row_version = row_version + 1 WHERE organization_id = $1 AND id = $2`, [c.organizationId, entry.id, decided.contractLineId, decided.policyVersion, c.userId ?? null]);
  await timeEvent(client, c, { projectId: project.id, employeeUserId: entry.employee_user_id, entryId: entry.id, action: "BILLING_ELIGIBILITY_RESOLVED", summary: decided.explanation,
    details: { contractLineId: decided.contractLineId, key: keyOf(input) } });
  return { entryId: entry.id, classification: "TIME_AND_MATERIALS_ELIGIBLE", contractLineId: decided.contractLineId };
}

// The policy as people see it: method and version history, contract lines (rates only for those who see billing), task rules, reasons.
export async function getProjectTimeBillingPolicy(client, c, projectId) {
  const project = await loadProjectRow(client, c, projectId);
  const policy = await projectBillingPolicy(client, c, project);
  const history = (await client.query(`SELECT * FROM tenant.project_time_billing_policies WHERE organization_id = $1 AND project_id = $2 ORDER BY policy_version DESC`, [c.organizationId, project.id])).rows;
  const lines = (await client.query(`SELECT line.*, to_char(line.effective_from, 'YYYY-MM-DD') AS from_day, to_char(line.effective_to, 'YYYY-MM-DD') AS to_day, so.sales_order_number,
        COALESCE((SELECT sum(allocation.allocated_minutes) FROM tenant.project_time_billing_allocations allocation WHERE allocation.contract_line_id = line.id AND allocation.status <> 'REVERSED'), 0)::int AS used
      FROM tenant.project_time_contract_lines line JOIN tenant.sales_orders so ON so.id = line.sales_order_id WHERE line.organization_id = $1 AND line.project_id = $2 ORDER BY line.status, line.created_at`,
  [c.organizationId, project.id])).rows;
  const rules = (await client.query(`SELECT rule.*, task.task_code, task.title FROM tenant.project_time_task_billing rule JOIN tenant.project_tasks task ON task.id = rule.task_id
      WHERE rule.organization_id = $1 AND rule.project_id = $2 ORDER BY task.task_code`, [c.organizationId, project.id])).rows;
  const names = await userNames(client, [...history.map((row) => row.set_by), ...lines.map((row) => row.created_by)]);
  const billing = billingScope(c, project) || viewsBilling(c);
  return {
    projectId: project.id, code: project.project_code, classification: project.classification, customerId: project.customer_id,
    method: policy.method, methodLabel: policy.method ? BILLING_METHODS[policy.method] : "Not set", version: policy.version, implicit: policy.implicit,
    defaultContractLineId: policy.defaultContractLineId, reference: policy.reference, reasonRequired: policy.settings.reasonRequired, requestApproval: policy.settings.requestApproval,
    history: history.map((row) => ({ version: row.policy_version, method: row.billing_method, methodLabel: BILLING_METHODS[row.billing_method], reference: row.reference, note: row.note,
      setBy: names.get(row.set_by) ?? null, setAt: row.set_at })),
    lines: lines.map((row) => ({ id: row.id, number: `CL-${row.line_number}`, label: row.label, salesOrderId: row.sales_order_id, salesOrderNumber: row.sales_order_number, salesOrderLineId: row.sales_order_line_id,
      status: row.status, effectiveFrom: row.from_day, effectiveTo: row.to_day, maxMinutes: row.max_minutes, usedMinutes: row.used, remainingMinutes: row.max_minutes === null ? null : Math.max(row.max_minutes - row.used, 0),
      roundingMinutes: row.rounding_minutes, allowedTaskTypes: row.allowed_task_types, allowedUserIds: row.allowed_user_ids, closeReason: row.close_reason, createdBy: names.get(row.created_by) ?? null,
      ...(billing ? { hourlyRate: String(row.hourly_rate), currency: row.currency } : {}) })),
    taskRules: rules.map((row) => ({ taskId: row.task_id, task: `${row.task_code} · ${row.title}`, rule: row.rule, contractLineId: row.contract_line_id, reasonCode: row.reason_code,
      reason: row.reason_code ? NON_BILLABLE_REASONS[row.reason_code] : null, note: row.note })),
    methods: Object.entries(BILLING_METHODS).map(([code, label]) => ({ code, label })), reasons: Object.entries(NON_BILLABLE_REASONS).map(([code, label]) => ({ code, label })),
    classifications: CLASSIFICATIONS,
    can: { manage: mayManagePolicy(c, project), authorizeLines: mayAuthorizeLines(c, project), viewRates: billing, request: mayRequest(c, project), allProjects: seesAll(c) },
  };
}
// The order lines of the sales orders linked to the project that could authorize hourly time.
export async function listContractLineCandidates(client, c, projectId) {
  const project = await loadProjectRow(client, c, projectId);
  if (!mayAuthorizeLines(c, project)) throw billError(403, "TIME_BILLING_PERMISSION_DENIED");
  const rows = (await client.query(`SELECT line.id, line.item_name_snapshot, line.description_snapshot, line.quantity, line.uom_snapshot, line.unit_price, version.currency_code, so.sales_order_number, so.lifecycle_status,
        item.item_type, (SELECT milestone_code FROM tenant.project_milestones milestone WHERE milestone.sales_order_line_id = line.id LIMIT 1) AS milestone_code
      FROM tenant.project_links link JOIN tenant.sales_orders so ON so.id = link.source_id JOIN tenant.sales_order_versions version ON version.id = so.current_version_id
      JOIN tenant.sales_order_lines line ON line.sales_order_version_id = version.id LEFT JOIN tenant.items item ON item.id = line.item_id
      WHERE link.organization_id = $1 AND link.project_id = $2 AND link.source_type = 'SALES_ORDER' AND link.removed_at IS NULL ORDER BY so.sales_order_number, line.sequence`, [c.organizationId, project.id])).rows;
  return { rows: rows.map((row) => ({ salesOrderLineId: row.id, salesOrderNumber: row.sales_order_number, orderStatus: row.lifecycle_status, item: row.item_name_snapshot, description: row.description_snapshot,
    quantity: row.quantity === null ? null : String(row.quantity), uom: row.uom_snapshot, unitPrice: row.unit_price === null ? null : String(row.unit_price), currency: row.currency_code,
    eligible: (!row.item_type || row.item_type === "service") && !row.milestone_code && !["draft", "pending_approval", "cancelled"].includes(row.lifecycle_status),
    why: row.milestone_code ? `Billed through milestone ${row.milestone_code}` : row.item_type && row.item_type !== "service" ? "Not a service" : ["draft", "pending_approval", "cancelled"].includes(row.lifecycle_status) ? "Order not confirmed" : null })) };
}

// The company's billing defaults: the method of a customer project that never set one (or REQUIRE_SETUP), whether non-billable time needs
// its reason, and whether a billing request is authorized by a second person. input: { defaultMethod?, reasonRequired?, requestApproval? }
export async function saveTimeBillingSettings(client, c, input = {}) {
  if (!has(c, "projects.settings.manage")) throw billError(403, "TIME_BILLING_PERMISSION_DENIED");
  const current = await billingSettings(client, c);
  const method = input.defaultMethod === undefined ? current.defaultMethod : String(input.defaultMethod).toUpperCase();
  if (!["NON_BILLABLE", "FIXED_PRICE", "TIME_AND_MATERIALS", "REQUIRE_SETUP"].includes(method)) throw billError(400, "TIME_BILLING_POLICY_MISSING", "Choose the company's default billing method.");
  const reasonRequired = input.reasonRequired === undefined ? current.reasonRequired : Boolean(input.reasonRequired);
  const requestApproval = input.requestApproval === undefined ? current.requestApproval : Boolean(input.requestApproval);
  await client.query(`INSERT INTO tenant.project_settings (organization_id, time_billing_default_method, time_nonbillable_reason_required, time_billing_request_approval, updated_by, updated_at)
      VALUES ($1,$2,$3,$4,$5,now()) ON CONFLICT (organization_id) DO UPDATE SET time_billing_default_method = EXCLUDED.time_billing_default_method,
        time_nonbillable_reason_required = EXCLUDED.time_nonbillable_reason_required, time_billing_request_approval = EXCLUDED.time_billing_request_approval, updated_by = EXCLUDED.updated_by, updated_at = now()`,
  [c.organizationId, method, reasonRequired, requestApproval, c.userId ?? null]);
  return { defaultMethod: method, reasonRequired, requestApproval, can: { manage: true } };
}
export async function getTimeBillingSettings(client, c) {
  return { ...(await billingSettings(client, c)), can: { manage: has(c, "projects.settings.manage") } };
}
