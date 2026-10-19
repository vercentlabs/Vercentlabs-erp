// Purchase order approval under the company's approval rules (Shared Platform plan 6). Confirming a PO whose total reaches a rule
// asks that level's approver first (core/platform/approvals/rules.js); the approver decides from the approvals inbox, where these
// handlers run. Approving a level asks the next one; when every level has approved this exact content (supplier and total), the
// buyer's next Confirm goes through. A PO changed since asks again.
import { approvalLevelsFor, createApprovalRequest } from "../../../core/platform/approvals/index.js";
import { PurchaseOrderError } from "./constants.js";

export const PURCHASE_ORDER_APPROVAL = "procurement.purchase_order";
// What an approval is for: the supplier and the total, as stored.
export const purchaseOrderContentKey = (order) => `${order.supplier_id}:${order.grand_total}`;

async function currentOrder(client, context, documentId) {
  const order = (await client.query(`SELECT id, purchase_order_number, supplier_id, grand_total, currency_code, status FROM tenant.purchase_orders WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, documentId])).rows[0];
  if (!order) throw new PurchaseOrderError(404, "Purchase order not found.", "PURCHASE_ORDER_NOT_FOUND");
  return order;
}

export async function approvePurchaseOrderLevel(client, context, payload = {}) {
  const order = await currentOrder(client, context, payload.documentId);
  if (order.status !== "draft") throw new PurchaseOrderError(409, `This purchase order is ${order.status}; there is nothing left to approve.`, "PURCHASE_ORDER_APPROVAL_STALE");
  if (purchaseOrderContentKey(order) !== payload.contentKey)
    throw new PurchaseOrderError(409, "The purchase order changed after it was sent for approval. Reject this request; the buyer sends it again when confirming.", "PURCHASE_ORDER_APPROVAL_STALE");
  const level = Number(payload.level);
  const levels = await approvalLevelsFor(client, context.organizationId, PURCHASE_ORDER_APPROVAL, order.grand_total);
  const next = levels.find((entry) => entry.level > level);
  if (next) {
    const asked = (await client.query(
      `SELECT requested_by FROM public.approval_requests WHERE organization_id = $1 AND command_key = 'procurement.purchase_order.approve' AND dedupe_key = $2 ORDER BY requested_at DESC LIMIT 1`,
      [context.organizationId, `${order.id}:${payload.contentKey}:${level}`])).rows[0];
    await createApprovalRequest(client, {
      organizationId: context.organizationId, commandKey: "procurement.purchase_order.approve", entityId: order.id,
      title: `Purchase order ${order.purchase_order_number ?? ""} (${order.currency_code?.trim() ?? "INR"} ${order.grand_total}) · level ${next.level}`.replace("  ", " "),
      requestedBy: asked?.requested_by ?? context.userId, assignedTo: next.approverUserId, approverRoleId: next.approverRoleId, approvalLevel: next.level, approvalRuleId: next.id,
      payload: { documentId: order.id, contentKey: payload.contentKey, level: String(next.level) },
    });
  }
  return { purchaseOrderId: order.id, level, nextLevel: next?.level ?? null, fullyApproved: !next };
}

export async function rejectPurchaseOrderApproval(client, context, payload = {}) {
  const order = await currentOrder(client, context, payload.documentId);
  return { purchaseOrderId: order.id, level: Number(payload.level), rejected: true };
}
