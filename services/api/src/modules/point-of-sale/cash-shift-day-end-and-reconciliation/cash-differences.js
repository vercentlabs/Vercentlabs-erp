// POS Cash Difference (0106). A shortage or overage is a reconciliation result of the cash session — never a cash movement, never an edit to a
// sale, the count or the closed session:
//
//   difference = physically counted − reference           (negative = shortage, positive = overage; one formula everywhere)
//     CLOSING   reference = expected cash, from the cash session's own events at the cash ledger version the count was compared with
//     OPENING   reference = the cash documented as handed over to the incoming cashier
//     HANDOVER  reference = the amount handed over at a close to the safe or a manager, against what they received
//
// The policy (a reason for any difference; within the tolerance that is enough; above it a supervisor approves; above the hard limit only an
// authorized supervisor can close, and the case starts under investigation) can differ for shortages and overages; every evaluation keeps
// the policy version it used. Every non-zero difference becomes a case that is investigated and resolved — with the Finance treatment
// recorded once, by Finance — while the difference itself stays exactly as found. A handover difference can be linked to the closing it came
// from so the same missing cash is not accounted for twice.
import { createHash } from "node:crypto";

import { nextDocumentNumber } from "../../../core/platform/numbering/index.js";
import { decimal, sub, asDatabaseDecimal, formatDecimal } from "../../../core/decimal.js";
import { posError } from "../shared/errors.js";
import { requirePermission, assertPosStoreAccess, accessiblePosStoreIds } from "../shared/access-control.js";
import { event } from "../shared/audit.js";
import { authorizePosAction } from "../permissions/index.js";

export const CASH_DIFFERENCE_MESSAGES = Object.freeze({
  POS_CASH_DIFFERENCE_NOT_FOUND: "Cash difference not found.",
  POS_CASH_DIFFERENCE_STALE: "Cash in the drawer changed after your count. Count the drawer again.",
  POS_CASH_DIFFERENCE_PERMISSION_DENIED: "You cannot work on this cash difference.",
  POS_CASH_DIFFERENCE_RESOLVED: "This cash difference has already been resolved.",
  POS_CASH_DIFFERENCE_RESOLUTION_INVALID: "Choose how the difference was resolved and describe it.",
  POS_CASH_DIFFERENCE_FINANCE_RECORDED: "The Finance treatment of this difference is already recorded.",
});
const differenceError = (status, code, message = CASH_DIFFERENCE_MESSAGES[code]) => posError(status, message, code);

// What a cashier picks. CASH_REFUND_DISCREPANCY is the earlier name of CASH_REFUND_ERROR (kept for counts recorded under it).
export const CASH_DIFFERENCE_REASONS = Object.freeze({
  COUNTING_ERROR: "I may have counted incorrectly",
  INCORRECT_CHANGE: "Incorrect change given",
  CASH_REFUND_ERROR: "Cash refund discrepancy",
  CASH_REFUND_DISCREPANCY: "Cash refund discrepancy",
  MISSING_CASH_MOVEMENT: "Cash In/Out not recorded correctly",
  CASH_RECEIPT_ERROR: "Cash received but recorded incorrectly",
  DRAWER_SHORTAGE: "Cash missing from drawer",
  DRAWER_OVERAGE: "Extra cash found",
  PREVIOUS_HANDOVER_MISMATCH: "Difference from previous handover",
  UNKNOWN: "I am not sure",
  OTHER: "Other reason",
});
export const RESOLUTION_TYPES = Object.freeze(["SHORTAGE_ACCEPTED", "OVERAGE_ACCEPTED", "CASH_MOVEMENT_CORRECTION", "CUSTODY_RESOLVED", "SAME_AS_LINKED_DIFFERENCE", "OTHER"]);
export const FINANCE_TREATMENTS = Object.freeze(["SHORTAGE_EXPENSE", "OVERAGE_INCOME", "SUSPENSE", "NO_ENTRY"]);

const privileged = (c) => Boolean(c.roleSlugs?.some((slug) => ["organization_owner", "system_administrator"].includes(slug)));
const can = (c, permission) => privileged(c) || Boolean(c.permissions?.includes(permission));
const text = (value, max = 500) => { const out = String(value ?? "").trim(); return out ? out.slice(0, max) : null; };
const money = (value) => {
  if (value === null || value === undefined) return null;
  const [whole, fraction = ""] = formatDecimal(decimal(String(value))).split(".");
  return `${whole}.${(fraction + "00").slice(0, 2)}`;
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const absoluteOf = (value) => (value < 0n ? sub(decimal("0"), value) : value);
const amountOrNull = (value) => (value === null || value === undefined ? null : decimal(String(value)));

// ------------------------------------------------------------------ the calculation and the policy

// The cash ledger version of a session: how many cash events it has (they are append-only, so any new event moves it on).
export async function cashLedgerVersion(client, organizationId, shiftId) {
  return (await client.query(`SELECT count(*)::int AS n FROM tenant.pos_cash_movements WHERE organization_id = $1 AND shift_id = $2`, [organizationId, shiftId])).rows[0].n;
}

export const differenceType = (difference) => (difference === 0n ? "MATCH" : difference < 0n ? "SHORTAGE" : "OVERAGE");

// The closing variance policy from the settings row: general thresholds with optional shortage / overage overrides, the reasons offered, and
// its version (a hash of exactly these rules).
export function closingVariancePolicy(row) {
  const reasons = Array.isArray(row?.closing_variance_reasons) && row.closing_variance_reasons.length ? row.closing_variance_reasons.map(String)
    : ["COUNTING_ERROR", "INCORRECT_CHANGE", "CASH_REFUND_ERROR", "MISSING_CASH_MOVEMENT", "CASH_RECEIPT_ERROR", "DRAWER_SHORTAGE", "DRAWER_OVERAGE", "PREVIOUS_HANDOVER_MISMATCH", "UNKNOWN", "OTHER"];
  const rules = {
    approvalAbove: row ? (row.closing_variance_approval_above === null || row.closing_variance_approval_above === undefined ? null : money(row.closing_variance_approval_above)) : "0.00",
    blockAbove: row?.closing_variance_block_above === null || row?.closing_variance_block_above === undefined ? null : money(row.closing_variance_block_above),
    shortageApprovalAbove: row?.closing_shortage_approval_above === null || row?.closing_shortage_approval_above === undefined ? null : money(row.closing_shortage_approval_above),
    overageApprovalAbove: row?.closing_overage_approval_above === null || row?.closing_overage_approval_above === undefined ? null : money(row.closing_overage_approval_above),
    shortageBlockAbove: row?.closing_shortage_block_above === null || row?.closing_shortage_block_above === undefined ? null : money(row.closing_shortage_block_above),
    overageBlockAbove: row?.closing_overage_block_above === null || row?.closing_overage_block_above === undefined ? null : money(row.closing_overage_block_above),
    reasons: reasons.includes("OTHER") ? reasons : [...reasons, "OTHER"],
    unknownNoteRequired: row?.cash_difference_unknown_note_required !== false,
  };
  return { ...rules, version: createHash("sha256").update(JSON.stringify(rules)).digest("hex").slice(0, 16) };
}

// Evaluate a difference: zero → matched; otherwise a reason is required, and the sign's own thresholds (or the general ones) decide whether a
// supervisor approves (above the tolerance) or only an authorized supervisor can close, under investigation (above the hard limit).
export function evaluateCashVariance(policy, difference) {
  const amount = absoluteOf(difference);
  const type = differenceType(difference);
  if (difference === 0n) return { amount, type, reasonRequired: false, approvalRequired: false, blocked: false, status: "MATCHED", policyVersion: policy.version };
  const shortage = difference < 0n;
  const approvalAbove = amountOrNull(shortage ? policy.shortageApprovalAbove ?? policy.approvalAbove : policy.overageApprovalAbove ?? policy.approvalAbove);
  const blockAbove = amountOrNull(shortage ? policy.shortageBlockAbove ?? policy.blockAbove : policy.overageBlockAbove ?? policy.blockAbove);
  const blocked = blockAbove !== null && amount > blockAbove;
  const approvalRequired = approvalAbove !== null && amount > approvalAbove;
  return { amount, type, reasonRequired: true, approvalRequired, blocked, status: blocked ? "INVESTIGATION_REQUIRED" : approvalRequired ? "AWAITING_APPROVAL" : "VARIANCE_DETECTED",
    approvalAbove: approvalAbove === null ? null : money(asDatabaseDecimal(approvalAbove)), blockAbove: blockAbove === null ? null : money(asDatabaseDecimal(blockAbove)), policyVersion: policy.version };
}

// A reason that fits the policy: one of the offered codes; OTHER (and, when the company asks, UNKNOWN) with an explanation.
export function readDifferenceReason(policy, input) {
  const code = String(input.varianceReasonCode ?? input.reasonCode ?? "").trim().toUpperCase() || null;
  const note = text(input.varianceReason ?? input.reasonNote);
  if (!code || !policy.reasons.includes(code)) return { error: "Choose a reason for the cash difference." };
  if (code === "OTHER" && !note) return { error: "Describe the cash difference." };
  if (code === "UNKNOWN" && policy.unknownNoteRequired && !note) return { error: "Add a note: say what you checked." };
  return { code, note };
}

// ------------------------------------------------------------------ cases

// Record a non-zero difference as a case (inside the transaction that found it). values: context, storeId, terminalId, drawerId, cashSessionId,
// shiftId, cashierUserId, currency, reference, counted (decimals), countId, ledgerVersion, recounts, reasonCode, reasonNote, policy,
// evaluation, approvalId, closingId, handoverId, transferId, relatedId, status, assignedTo.
export async function recordCashDifference(client, context, values) {
  const difference = sub(values.counted, values.reference);
  if (difference === 0n) return null;
  const number = await nextDocumentNumber(client, context, { documentType: "pos_cash_difference", prefix: "CD" });
  const row = (await client.query(
    `INSERT INTO tenant.pos_cash_differences (organization_id, difference_number, store_id, terminal_id, cash_drawer_id, cash_session_id, operating_session_id, cashier_user_id,
       difference_context, currency_code, reference_amount, counted_amount, difference_amount, count_id, cash_ledger_version, recounts, reason_code, reason_note, policy_version, policy,
       evaluation, approval_id, closing_id, handover_id, transfer_id, related_difference_id, case_status, assigned_to, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20::jsonb, $21::jsonb, $22, $23, $24, $25, $26, $27, $28, $29)
     ON CONFLICT DO NOTHING RETURNING id`,
    [context.organizationId, number, values.storeId, values.terminalId ?? null, values.drawerId ?? null, values.cashSessionId ?? null, values.shiftId, values.cashierUserId ?? null,
      values.context, values.currency ?? "INR", asDatabaseDecimal(values.reference), asDatabaseDecimal(values.counted), asDatabaseDecimal(difference), values.countId ?? null,
      values.ledgerVersion ?? null, values.recounts ?? 0, values.reasonCode ?? null, values.reasonNote ?? null, values.policy?.version ?? null,
      values.policy ? JSON.stringify(values.policy) : null, values.evaluation ? JSON.stringify({ ...values.evaluation, amount: money(asDatabaseDecimal(values.evaluation.amount)) }) : null,
      values.approvalId ?? null, values.closingId ?? null, values.handoverId ?? null, values.transferId ?? null, values.relatedId ?? null, values.status ?? "OPEN", values.assignedTo ?? null,
      context.userId])).rows[0];
  if (row) await event(client, context, "shift", values.shiftId, "pos.cash_difference.recorded", { differenceId: row.id, number, context: values.context,
    difference: money(asDatabaseDecimal(difference)), reasonCode: values.reasonCode ?? null });
  return row?.id ?? null;
}

// The closing difference of a session, to link a later handover difference to it.
export async function closingDifferenceOf(client, organizationId, shiftId) {
  return (await client.query(`SELECT id FROM tenant.pos_cash_differences WHERE organization_id = $1 AND operating_session_id = $2 AND difference_context = 'CLOSING'`,
    [organizationId, shiftId])).rows[0]?.id ?? null;
}

async function seesDifferences(client, context, storeId) {
  if (can(context, "pos.store.manage") || can(context, "pos.reconciliation.approve")) return true;
  try { return (await authorizePosAction(client, context, { permission: "SESSION_VIEW_EXPECTED_CASH", outletId: storeId })).decision === "ALLOW"; } catch { return false; }
}
const mayInvestigate = (context) => can(context, "pos.store.manage") || can(context, "pos.reconciliation.approve");
const mayRecordFinance = (context) => can(context, "pos.accounting.post") || can(context, "pos.reconciliation.approve");

const DIFFERENCE_SELECT = `
  SELECT difference.*, store.name AS store_name, terminal.code AS terminal_code, shift.shift_number, cashier.full_name AS cashier_name, creator.full_name AS created_by_name,
         assignee.full_name AS assignee_name, resolver.full_name AS resolver_name, approver.full_name AS approver_name, related.difference_number AS related_number,
         finance.full_name AS finance_recorded_by_name
    FROM tenant.pos_cash_differences difference
    JOIN tenant.pos_stores store ON store.organization_id = difference.organization_id AND store.id = difference.store_id
    JOIN tenant.pos_shifts shift ON shift.organization_id = difference.organization_id AND shift.id = difference.operating_session_id
    LEFT JOIN tenant.pos_terminals terminal ON terminal.organization_id = difference.organization_id AND terminal.id = difference.terminal_id
    LEFT JOIN public.users cashier ON cashier.id = difference.cashier_user_id
    LEFT JOIN public.users creator ON creator.id = difference.created_by
    LEFT JOIN public.users assignee ON assignee.id = difference.assigned_to
    LEFT JOIN public.users resolver ON resolver.id = difference.resolved_by
    LEFT JOIN public.users finance ON finance.id = difference.finance_recorded_by
    LEFT JOIN tenant.pos_permission_approvals approval ON approval.organization_id = difference.organization_id AND approval.id = difference.approval_id
    LEFT JOIN public.users approver ON approver.id = approval.approver_user_id
    LEFT JOIN tenant.pos_cash_differences related ON related.organization_id = difference.organization_id AND related.id = difference.related_difference_id`;

function differenceView(row, sensitive) {
  const showReference = sensitive || row.difference_context !== "CLOSING";
  return {
    id: row.id, number: row.difference_number, context: row.difference_context, type: Number(row.difference_amount) < 0 ? "SHORTAGE" : "OVERAGE", currency: row.currency_code.trim(),
    referenceAmount: showReference ? money(row.reference_amount) : null, countedAmount: money(row.counted_amount), differenceAmount: money(row.difference_amount),
    outlet: row.store_name, storeId: row.store_id, terminal: row.terminal_code, shiftId: row.operating_session_id, shiftNumber: row.shift_number, cashSessionId: row.cash_session_id,
    cashierUserId: row.cashier_user_id, cashier: row.cashier_name, countId: row.count_id, cashLedgerVersion: row.cash_ledger_version, recounts: row.recounts,
    reasonCode: row.reason_code, reasonLabel: row.reason_code ? CASH_DIFFERENCE_REASONS[row.reason_code] ?? row.reason_code : null, reasonNote: row.reason_note,
    policyVersion: row.policy_version, evaluation: sensitive ? row.evaluation : null, approvalId: row.approval_id, approvedBy: row.approver_name ?? null,
    closingId: row.closing_id, handoverId: row.handover_id, transferId: row.transfer_id, relatedDifferenceId: row.related_difference_id, relatedNumber: row.related_number ?? null,
    caseStatus: row.case_status, assignedTo: row.assignee_name ?? null, assignedToUserId: row.assigned_to, notes: row.investigation_notes ?? [],
    resolutionType: row.resolution_type, resolutionNote: row.resolution_note, resolutionMovementId: row.resolution_movement_id, resolvedBy: row.resolver_name ?? null, resolvedAt: row.resolved_at,
    financeStatus: row.finance_status, financeTreatment: row.finance_treatment, financeReference: row.finance_adjustment_reference, financeRecordedBy: row.finance_recorded_by_name ?? null,
    financeRecordedAt: row.finance_recorded_at, createdBy: row.created_by_name, createdAt: row.created_at, version: row.version,
  };
}

async function loadDifference(client, context, differenceId, { lock = false } = {}) {
  requirePermission(context, "pos.view");
  if (!UUID.test(String(differenceId ?? ""))) throw differenceError(404, "POS_CASH_DIFFERENCE_NOT_FOUND");
  if (lock) await client.query(`SELECT id FROM tenant.pos_cash_differences WHERE organization_id = $1 AND id = $2 FOR UPDATE`, [context.organizationId, differenceId]);
  const row = (await client.query(`${DIFFERENCE_SELECT} WHERE difference.organization_id = $1 AND difference.id = $2`, [context.organizationId, differenceId])).rows[0];
  if (!row) throw differenceError(404, "POS_CASH_DIFFERENCE_NOT_FOUND");
  const mine = row.cashier_user_id === context.userId;
  if (!mine) { try { await assertPosStoreAccess(client, context, row.store_id); } catch { throw differenceError(404, "POS_CASH_DIFFERENCE_NOT_FOUND"); } }
  const sensitive = await seesDifferences(client, context, row.store_id);
  if (!mine && !sensitive) throw differenceError(404, "POS_CASH_DIFFERENCE_NOT_FOUND");
  return { row, mine, sensitive };
}

export async function getCashDifference(client, context, differenceId) {
  const { row, sensitive } = await loadDifference(client, context, differenceId);
  const linked = (await client.query(`SELECT id FROM tenant.pos_cash_differences WHERE organization_id = $1 AND related_difference_id = $2`, [context.organizationId, row.id])).rows.map((entry) => entry.id);
  return { ...differenceView(row, sensitive), linkedDifferenceIds: linked };
}

// Differences, newest first. A cashier sees their own; those who may see expected cash (or manage the outlet / reconciliation) see their
// outlets'. filters: context, type (SHORTAGE | OVERAGE), status (open | OPEN | INVESTIGATING | RESOLVED), financePending, storeId, cashierUserId,
// from, to, limit, offset.
export async function listCashDifferences(client, context, filters = {}) {
  requirePermission(context, "pos.view");
  const sensitive = await seesDifferences(client, context, UUID.test(String(filters.storeId ?? "")) ? filters.storeId : undefined);
  const { where, values } = await scopeOf(client, context, filters, sensitive);
  const limit = Math.min(Math.max(Number(filters.limit) || 50, 1), 200);
  const offset = Math.max(Number(filters.offset) || 0, 0);
  const total = (await client.query(`SELECT count(*)::int AS n FROM tenant.pos_cash_differences difference WHERE ${where}`, values)).rows[0].n;
  const rows = (await client.query(`${DIFFERENCE_SELECT} WHERE ${where} ORDER BY difference.created_at DESC LIMIT ${limit} OFFSET ${offset}`, values)).rows;
  return { total, rows: rows.map((row) => differenceView(row, sensitive)) };
}

async function scopeOf(client, context, filters, sensitive) {
  const values = [context.organizationId];
  const where = ["difference.organization_id = $1"];
  const add = (value) => { values.push(value); return `$${values.length}`; };
  if (!sensitive) where.push(`difference.cashier_user_id = ${add(context.userId)}`);
  else {
    const outlets = await accessiblePosStoreIds(client, context);
    if (outlets) where.push(`difference.store_id = ANY(${add(outlets)}::uuid[])`);
  }
  if (["OPENING", "CLOSING", "HANDOVER"].includes(String(filters.context ?? "").toUpperCase())) where.push(`difference.difference_context = ${add(String(filters.context).toUpperCase())}`);
  if (String(filters.type ?? "").toUpperCase() === "SHORTAGE") where.push("difference.difference_amount < 0");
  if (String(filters.type ?? "").toUpperCase() === "OVERAGE") where.push("difference.difference_amount > 0");
  const status = String(filters.status ?? "").toUpperCase();
  if (status === "OPEN_ANY" || filters.status === "open") where.push("difference.case_status <> 'RESOLVED'");
  else if (["OPEN", "INVESTIGATING", "RESOLVED"].includes(status)) where.push(`difference.case_status = ${add(status)}`);
  if (filters.financePending === true || filters.financePending === "true") where.push("difference.finance_status = 'PENDING'");
  if (UUID.test(String(filters.storeId ?? ""))) where.push(`difference.store_id = ${add(filters.storeId)}`);
  if (UUID.test(String(filters.cashierUserId ?? ""))) where.push(`difference.cashier_user_id = ${add(filters.cashierUserId)}`);
  if (UUID.test(String(filters.shiftId ?? ""))) where.push(`difference.operating_session_id = ${add(filters.shiftId)}`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(filters.from ?? ""))) where.push(`difference.created_at >= ${add(filters.from)}::date`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(filters.to ?? ""))) where.push(`difference.created_at < ${add(filters.to)}::date + 1`);
  return { where: where.join(" AND "), values };
}

// Investigate: take the case (or assign it) and add a note — the difference itself never changes. input: note, assignedTo?.
export async function investigateCashDifference(client, context, differenceId, input = {}) {
  const { row } = await loadDifference(client, context, differenceId, { lock: true });
  if (row.case_status === "RESOLVED") throw differenceError(409, "POS_CASH_DIFFERENCE_RESOLVED");
  if (!mayInvestigate(context) && row.assigned_to !== context.userId) throw differenceError(403, "POS_CASH_DIFFERENCE_PERMISSION_DENIED");
  if (row.cashier_user_id === context.userId) throw differenceError(403, "POS_CASH_DIFFERENCE_PERMISSION_DENIED", "A cashier does not investigate their own cash difference.");
  const note = text(input.note);
  if (!note) throw differenceError(400, "POS_CASH_DIFFERENCE_RESOLUTION_INVALID", "Add a note about what was checked.");
  const assignee = UUID.test(String(input.assignedTo ?? "")) ? input.assignedTo : row.assigned_to ?? context.userId;
  await client.query(
    `UPDATE tenant.pos_cash_differences SET case_status = 'INVESTIGATING', assigned_to = $3,
            investigation_notes = investigation_notes || jsonb_build_array(jsonb_build_object('note', $4::text, 'by', $5::text, 'at', now()))
      WHERE organization_id = $1 AND id = $2`, [context.organizationId, row.id, assignee, note, context.userId]);
  await event(client, context, "shift", row.operating_session_id, "pos.cash_difference.investigating", { differenceId: row.id, assignedTo: assignee });
  return getCashDifference(client, context, row.id);
}

// Resolve the case with the authorized outcome. A correction for cash that really moved points at the authorized cash movement that recorded
// it (never invented here); "same as linked" points at the difference that already accounts for the cash (Finance then records nothing for
// this one). input: resolutionType, resolutionNote, movementId?, relatedDifferenceId?.
export async function resolveCashDifference(client, context, differenceId, input = {}) {
  const { row } = await loadDifference(client, context, differenceId, { lock: true });
  if (row.case_status === "RESOLVED") throw differenceError(409, "POS_CASH_DIFFERENCE_RESOLVED");
  if (!mayInvestigate(context) && row.assigned_to !== context.userId) throw differenceError(403, "POS_CASH_DIFFERENCE_PERMISSION_DENIED");
  if (row.cashier_user_id === context.userId) throw differenceError(403, "POS_CASH_DIFFERENCE_PERMISSION_DENIED", "A cashier does not resolve their own cash difference.");
  const type = String(input.resolutionType ?? "").toUpperCase();
  const note = text(input.resolutionNote ?? input.note);
  if (!RESOLUTION_TYPES.includes(type) || !note) throw differenceError(400, "POS_CASH_DIFFERENCE_RESOLUTION_INVALID");
  const shortage = Number(row.difference_amount) < 0;
  if ((type === "SHORTAGE_ACCEPTED" && !shortage) || (type === "OVERAGE_ACCEPTED" && shortage))
    throw differenceError(400, "POS_CASH_DIFFERENCE_RESOLUTION_INVALID", `This difference is ${shortage ? "a shortage" : "an overage"}.`);
  let movementId = null;
  if (type === "CASH_MOVEMENT_CORRECTION") {
    movementId = UUID.test(String(input.movementId ?? "")) ? input.movementId : null;
    const movement = movementId ? (await client.query(`SELECT id, cash_event, movement_type FROM tenant.pos_cash_movements WHERE organization_id = $1 AND id = $2`,
      [context.organizationId, movementId])).rows[0] : null;
    if (!movement) throw differenceError(400, "POS_CASH_DIFFERENCE_RESOLUTION_INVALID", "Link the authorized cash movement that recorded the cash that really moved.");
  }
  let relatedId = row.related_difference_id;
  if (type === "SAME_AS_LINKED_DIFFERENCE") {
    relatedId = UUID.test(String(input.relatedDifferenceId ?? "")) ? input.relatedDifferenceId : row.related_difference_id;
    const related = relatedId && relatedId !== row.id ? (await client.query(`SELECT id FROM tenant.pos_cash_differences WHERE organization_id = $1 AND id = $2`, [context.organizationId, relatedId])).rows[0] : null;
    if (!related) throw differenceError(400, "POS_CASH_DIFFERENCE_RESOLUTION_INVALID", "Choose the difference that already accounts for this cash.");
  }
  await client.query(
    `UPDATE tenant.pos_cash_differences SET case_status = 'RESOLVED', resolution_type = $3, resolution_note = $4, resolution_movement_id = $5, related_difference_id = $6,
            resolved_by = $7, resolved_at = now(), finance_status = CASE WHEN $3 = 'SAME_AS_LINKED_DIFFERENCE' AND finance_status = 'PENDING' THEN 'NOT_REQUIRED' ELSE finance_status END
      WHERE organization_id = $1 AND id = $2`, [context.organizationId, row.id, type, note, movementId, relatedId, context.userId]);
  await event(client, context, "shift", row.operating_session_id, "pos.cash_difference.resolved", { differenceId: row.id, resolutionType: type, movementId, relatedId });
  return getCashDifference(client, context, row.id);
}

// Finance records how it accounted for the difference (shortage expense, overage income, suspense, or no entry) and its journal reference —
// once. The difference and the closed session are untouched; nothing is posted from here. input: treatment, reference.
export async function recordCashDifferenceFinanceTreatment(client, context, differenceId, input = {}) {
  const { row } = await loadDifference(client, context, differenceId, { lock: true });
  if (!mayRecordFinance(context)) throw differenceError(403, "POS_CASH_DIFFERENCE_PERMISSION_DENIED", "Only Finance records how a cash difference was accounted for.");
  if (row.finance_status !== "PENDING") throw differenceError(409, "POS_CASH_DIFFERENCE_FINANCE_RECORDED");
  const treatment = String(input.treatment ?? "").toUpperCase();
  if (!FINANCE_TREATMENTS.includes(treatment)) throw differenceError(400, "POS_CASH_DIFFERENCE_RESOLUTION_INVALID", "Choose the Finance treatment.");
  const shortage = Number(row.difference_amount) < 0;
  if ((treatment === "SHORTAGE_EXPENSE" && !shortage) || (treatment === "OVERAGE_INCOME" && shortage))
    throw differenceError(400, "POS_CASH_DIFFERENCE_RESOLUTION_INVALID", `This difference is ${shortage ? "a shortage" : "an overage"}.`);
  const reference = text(input.reference, 120);
  if (treatment !== "NO_ENTRY" && !reference) throw differenceError(400, "POS_CASH_DIFFERENCE_RESOLUTION_INVALID", "Give the journal or adjustment reference.");
  await client.query(
    `UPDATE tenant.pos_cash_differences SET finance_status = 'RECORDED', finance_treatment = $3, finance_adjustment_reference = $4, finance_recorded_by = $5, finance_recorded_at = now()
      WHERE organization_id = $1 AND id = $2`, [context.organizationId, row.id, treatment, reference, context.userId]);
  await event(client, context, "shift", row.operating_session_id, "pos.cash_difference.finance_recorded", { differenceId: row.id, treatment, reference });
  return getCashDifference(client, context, row.id);
}

// The report: shortages and overages kept apart (never only a net figure), counts of discrepant shifts, by outlet, by cashier and by context,
// approvals, unresolved cases, recounts and Finance treatments pending. Superseded counts are not differences; a handover difference is its
// own context. filters: storeId, from, to.
export async function getCashDifferenceSummary(client, context, filters = {}) {
  requirePermission(context, "pos.view");
  const sensitive = await seesDifferences(client, context, UUID.test(String(filters.storeId ?? "")) ? filters.storeId : undefined);
  if (!sensitive) throw differenceError(403, "POS_CASH_DIFFERENCE_PERMISSION_DENIED", "The cash difference report is for those who may see expected cash.");
  const today = new Date().toISOString().slice(0, 10);
  const from = /^\d{4}-\d{2}-\d{2}$/.test(String(filters.from ?? "")) ? filters.from : `${today.slice(0, 8)}01`;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(String(filters.to ?? "")) ? filters.to : today;
  const { where, values } = await scopeOf(client, context, { ...filters, from, to }, true);
  const totals = (await client.query(
    `SELECT COALESCE(sum(-difference_amount) FILTER (WHERE difference_amount < 0), 0)::text AS shortages, count(*) FILTER (WHERE difference_amount < 0)::int AS shortage_count,
            COALESCE(sum(difference_amount) FILTER (WHERE difference_amount > 0), 0)::text AS overages, count(*) FILTER (WHERE difference_amount > 0)::int AS overage_count,
            COALESCE(sum(difference_amount), 0)::text AS net, COALESCE(avg(abs(difference_amount)), 0)::numeric(20, 2)::text AS average,
            count(DISTINCT operating_session_id) FILTER (WHERE difference_context = 'CLOSING')::int AS discrepant_shifts,
            count(*) FILTER (WHERE approval_id IS NOT NULL)::int AS approved, count(*) FILTER (WHERE case_status <> 'RESOLVED')::int AS unresolved,
            count(*) FILTER (WHERE finance_status = 'PENDING')::int AS finance_pending
       FROM tenant.pos_cash_differences difference WHERE ${where}`, values)).rows[0];
  const group = async (key, label) => (await client.query(
    `SELECT ${key} AS key, ${label} AS label, COALESCE(sum(-difference.difference_amount) FILTER (WHERE difference.difference_amount < 0), 0)::text AS shortages,
            COALESCE(sum(difference.difference_amount) FILTER (WHERE difference.difference_amount > 0), 0)::text AS overages, count(*)::int AS differences
       FROM tenant.pos_cash_differences difference
       JOIN tenant.pos_stores store ON store.organization_id = difference.organization_id AND store.id = difference.store_id
       LEFT JOIN public.users cashier ON cashier.id = difference.cashier_user_id
      WHERE ${where} GROUP BY 1, 2 ORDER BY 2`, values)).rows.map((row) => ({ key: row.key, label: row.label, shortages: money(row.shortages), overages: money(row.overages), differences: row.differences }));
  const countValues = [context.organizationId, from, to];
  const outlets = await accessiblePosStoreIds(client, context);
  if (outlets) countValues.push(outlets);
  const recounts = (await client.query(
    `SELECT count(*)::int AS n FROM tenant.pos_cash_closing_counts closing_count JOIN tenant.pos_shifts shift ON shift.organization_id = closing_count.organization_id AND shift.id = closing_count.shift_id
      WHERE closing_count.organization_id = $1 AND closing_count.status = 'SUPERSEDED' AND closing_count.submitted_at >= $2::date AND closing_count.submitted_at < $3::date + 1
        ${outlets ? "AND shift.store_id = ANY($4::uuid[])" : ""}`, countValues)).rows[0].n;
  return {
    from, to,
    totals: { shortages: money(totals.shortages), shortageCount: totals.shortage_count, overages: money(totals.overages), overageCount: totals.overage_count, net: money(totals.net),
      average: money(totals.average), discrepantShifts: totals.discrepant_shifts, approvedExceptions: totals.approved, unresolved: totals.unresolved, financePending: totals.finance_pending,
      recounts },
    byContext: await group("difference.difference_context", "difference.difference_context"),
    byOutlet: await group("difference.store_id::text", "store.name"),
    byCashier: await group("difference.cashier_user_id::text", "COALESCE(cashier.full_name, '—')"),
  };
}
