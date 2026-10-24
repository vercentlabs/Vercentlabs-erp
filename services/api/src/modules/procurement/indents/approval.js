// Purchase request approval under the company's approval rules (report Phase 3): after the department head approves, each level asked
// decides from the approvals inbox, where these handlers run. A level approved asks the next one; the last level approves the request.
// A request changed since asks again.
import { approvalLevelsFor, createApprovalRequest } from "../../../core/platform/approvals/index.js";
import { PurchaseOrderError } from "../purchase-orders/constants.js";
import { INDENT_APPROVAL, indentApprovalContent } from "./departments.js";

async function currentIndent(client, context, documentId) {
  const indent = (await client.query(`SELECT * FROM tenant.purchase_indents WHERE organization_id = $1 AND id = $2 FOR UPDATE`, [context.organizationId, documentId])).rows[0];
  if (!indent) throw new PurchaseOrderError(404, "Purchase request not found.", "PURCHASE_INDENT_NOT_FOUND");
  return indent;
}

export async function approveIndentLevel(client, context, payload = {}) {
  const indent = await currentIndent(client, context, payload.documentId);
  if (indent.status !== "submitted") throw new PurchaseOrderError(409, `This purchase request is ${indent.status}; there is nothing left to approve.`, "PURCHASE_INDENT_APPROVAL_STALE");
  const { amount, contentKey } = await indentApprovalContent(client, context.organizationId, indent.id);
  if (contentKey !== payload.contentKey)
    throw new PurchaseOrderError(409, "The purchase request changed after it was sent for approval. Reject this request; it is asked again when approved.", "PURCHASE_INDENT_APPROVAL_STALE");
  const level = Number(payload.level);
  const levels = await approvalLevelsFor(client, context.organizationId, INDENT_APPROVAL, amount);
  const next = levels.find((entry) => entry.level > level);
  if (next) {
    await createApprovalRequest(client, {
      organizationId: context.organizationId, commandKey: "procurement.indent.approve", entityId: indent.id,
      title: `Purchase request ${indent.indent_number} (about ${amount}) · level ${next.level}`, requestedBy: indent.head_approved_by ?? context.userId,
      assignedTo: next.approverUserId, approverRoleId: next.approverRoleId, approvalLevel: next.level, approvalRuleId: next.id,
      payload: { documentId: indent.id, contentKey, level: String(next.level) },
    });
    return { indentId: indent.id, level, nextLevel: next.level, approved: false };
  }
  await client.query(`UPDATE tenant.purchase_indents SET status = 'approved', decided_at = now(), decided_by = $3, updated_by = $3, updated_at = now() WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, indent.id, context.userId ?? null]);
  return { indentId: indent.id, level, nextLevel: null, approved: true };
}

export async function rejectIndentApproval(client, context, payload = {}) {
  const indent = await currentIndent(client, context, payload.documentId);
  if (indent.status === "submitted")
    await client.query(`UPDATE tenant.purchase_indents SET status = 'rejected', decided_at = now(), decided_by = $3, decision_note = $4, head_approved_by = NULL, head_approved_at = NULL,
        updated_by = $3, updated_at = now() WHERE organization_id = $1 AND id = $2`, [context.organizationId, indent.id, context.userId ?? null, payload.note ?? "Refused at approval"]);
  return { indentId: indent.id, rejected: true };
}
