// Approval rules (Shared Platform plan 6): "a purchase order over ₹1,00,000 needs the Purchase Manager, and over ₹10,00,000 the owner
// as well". Per document type, a rule names a minimum amount, a level (1 or 2) and its approver — a named member or anyone with a
// role. For a document, each level's rule is the one with the highest minimum the amount reaches; level 2 is asked only after level 1
// approved. The document's own action (confirming a PO) asks for what is still missing and goes ahead once every level approved this
// exact content.
import { createApprovalRequest } from "./repository.js";

export const APPROVAL_RULE_DOCUMENTS = Object.freeze([
  Object.freeze({ key: "procurement.purchase_order", moduleKey: "procurement", label: "Purchase orders", commandKey: "procurement.purchase_order.approve",
    description: "Confirming a purchase order of at least the amount waits for the approver(s)." }),
]);
const DOCUMENT = new Map(APPROVAL_RULE_DOCUMENTS.map((document) => [document.key, document]));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class ApprovalRuleError extends Error {
  constructor(status, message, code = "APPROVAL_RULE_INVALID", field = null) {
    super(message);
    this.name = "ApprovalRuleError";
    this.status = status;
    this.code = code;
    if (field) this.details = { field };
  }
}

const ruleView = (row) => ({ id: row.id, documentType: row.document_type, name: row.name, minAmount: row.min_amount, level: row.level, approverUserId: row.approver_user_id,
  approverRoleId: row.approver_role_id, approverName: row.approver_name ?? row.role_name ?? null, active: row.active, updatedAt: row.updated_at });
const RULE_SELECT = `SELECT rule.*, approver.full_name AS approver_name, role.name AS role_name FROM public.approval_rules rule
  LEFT JOIN public.users approver ON approver.id = rule.approver_user_id LEFT JOIN public.roles role ON role.id = rule.approver_role_id`;

export async function listApprovalRules(client, session) {
  const rows = (await client.query(`${RULE_SELECT} WHERE rule.organization_id = $1 ORDER BY rule.document_type, rule.level, rule.min_amount`, [session.organizationId])).rows;
  const roles = (await client.query(`SELECT id, name FROM public.roles WHERE (organization_id = $1 OR organization_id IS NULL) AND status = 'active' ORDER BY name`, [session.organizationId])).rows;
  return { rules: rows.map(ruleView), documents: APPROVAL_RULE_DOCUMENTS.map(({ key, label, description }) => ({ key, label, description })), roles };
}

// input: { id?, documentType, name, minAmount, level, approverUserId | approverRoleId, active? }
export async function saveApprovalRule(client, session, input = {}) {
  if (!DOCUMENT.has(input.documentType)) throw new ApprovalRuleError(400, "Choose the documents this rule is for.", "APPROVAL_RULE_INVALID", "documentType");
  const name = String(input.name ?? "").trim().slice(0, 120);
  if (!name) throw new ApprovalRuleError(400, "Name the rule.", "APPROVAL_RULE_INVALID", "name");
  const minAmount = Number(String(input.minAmount ?? "0").replace(/[,₹\s]/g, ""));
  if (!Number.isFinite(minAmount) || minAmount < 0) throw new ApprovalRuleError(400, "The amount must be zero or more.", "APPROVAL_RULE_INVALID", "minAmount");
  const level = Number(input.level ?? 1);
  if (![1, 2].includes(level)) throw new ApprovalRuleError(400, "Choose level 1 or 2.", "APPROVAL_RULE_INVALID", "level");
  const userId = input.approverUserId || null;
  const roleId = input.approverRoleId || null;
  if (Boolean(userId) === Boolean(roleId)) throw new ApprovalRuleError(400, "Choose one approver: a member or a role.", "APPROVAL_RULE_INVALID", "approverUserId");
  if (userId && !(UUID.test(userId) && (await client.query(`SELECT 1 FROM organization_memberships WHERE organization_id = $1 AND user_id = $2 AND status = 'active'`, [session.organizationId, userId])).rows[0]))
    throw new ApprovalRuleError(422, "The approver must be an active member.", "APPROVAL_RULE_INVALID", "approverUserId");
  if (roleId && !(UUID.test(roleId) && (await client.query(`SELECT 1 FROM public.roles WHERE id = $2 AND (organization_id = $1 OR organization_id IS NULL) AND status = 'active'`, [session.organizationId, roleId])).rows[0]))
    throw new ApprovalRuleError(422, "Choose an active role.", "APPROVAL_RULE_INVALID", "approverRoleId");
  const values = [session.organizationId, input.documentType, name, minAmount.toFixed(2), level, userId, roleId, input.active !== false, session.userId ?? null];
  const row = input.id
    ? (await client.query(
      `UPDATE public.approval_rules SET document_type = $2, name = $3, min_amount = $4, level = $5, approver_user_id = $6, approver_role_id = $7, active = $8, updated_at = now()
        WHERE organization_id = $1 AND id = $10 RETURNING id`, [...values, String(input.id)]).catch(() => ({ rows: [] }))).rows[0]
    : (await client.query(
      `INSERT INTO public.approval_rules (organization_id, document_type, name, min_amount, level, approver_user_id, approver_role_id, active, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`, values)).rows[0];
  if (!row) throw new ApprovalRuleError(404, "Rule not found.", "APPROVAL_RULE_NOT_FOUND");
  return ruleView((await client.query(`${RULE_SELECT} WHERE rule.id = $1`, [row.id])).rows[0]);
}

export async function deleteApprovalRule(client, session, ruleId) {
  const deleted = await client.query(`DELETE FROM public.approval_rules WHERE organization_id = $1 AND id = $2`, [session.organizationId, String(ruleId ?? "")]).catch(() => ({ rowCount: 0 }));
  if (!deleted.rowCount) throw new ApprovalRuleError(404, "Rule not found.", "APPROVAL_RULE_NOT_FOUND");
  return { deleted: true };
}

// The levels a document of this amount needs: for each level, the rule with the highest minimum it reaches.
export async function approvalLevelsFor(client, organizationId, documentType, amount) {
  const rows = (await client.query(
    `SELECT DISTINCT ON (rule.level) rule.*, approver.full_name AS approver_name, role.name AS role_name FROM public.approval_rules rule
       LEFT JOIN public.users approver ON approver.id = rule.approver_user_id LEFT JOIN public.roles role ON role.id = rule.approver_role_id
      WHERE rule.organization_id = $1 AND rule.document_type = $2 AND rule.active AND rule.min_amount <= $3::numeric
      ORDER BY rule.level, rule.min_amount DESC, rule.created_at`, [organizationId, documentType, String(amount ?? 0)])).rows;
  return rows.map(ruleView);
}

// Asked by the document's action. Returns { required: false } (no rule), { approved: true } (every level approved this content), or
// { approved: false, pending: { level, approver } } after asking the next level (an approval request, its approvers told).
// contentKey ties approvals to what was approved (a changed amount needs approving again).
export async function requireRuleApprovals(client, context, { documentType, documentId, amount, contentKey, title }) {
  const document = DOCUMENT.get(documentType);
  if (!document) return { required: false };
  const levels = await approvalLevelsFor(client, context.organizationId, documentType, amount);
  if (!levels.length) return { required: false };
  for (const level of levels) {
    const dedupeKey = `${documentId}:${contentKey}:${level.level}`;
    const existing = (await client.query(
      `SELECT status FROM public.approval_requests WHERE organization_id = $1 AND command_key = $2 AND dedupe_key = $3 ORDER BY requested_at DESC LIMIT 1`,
      [context.organizationId, document.commandKey, dedupeKey])).rows[0];
    if (existing?.status === "approved") continue;
    if (existing?.status !== "pending") {
      // The level's approver may not be the person asking (separation of duties): then the owner's oversight decides.
      await createApprovalRequest(client, {
        organizationId: context.organizationId, commandKey: document.commandKey, entityId: documentId, title: `${title} · level ${level.level}`, requestedBy: context.userId,
        assignedTo: level.approverUserId && level.approverUserId !== context.userId ? level.approverUserId : null, approverRoleId: level.approverRoleId,
        approvalLevel: level.level, approvalRuleId: level.id,
        payload: { documentId: String(documentId), contentKey: String(contentKey), level: String(level.level) },
      });
    }
    return { required: true, approved: false, pending: { level: level.level, approver: level.approverName, levels: levels.length } };
  }
  return { required: true, approved: true, levels: levels.length };
}
