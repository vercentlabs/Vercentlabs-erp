// Departments for purchase requests (report Phase 3): each with its head, who approves the department's requests. Above an amount, the
// company's approval rules for purchase requests ask further levels (Settings › Approval rules), on the request's estimated value — each
// line's quantity at the item's last price paid, else its purchase price. Procurement keeps its own list, so it works without the HR app.
import { createHash } from "node:crypto";

import { add, decimal, formatDecimal, mul, roundMoney } from "../../../core/decimal.js";
import { requirePoAccess, requirePoPermission } from "../purchase-orders/access.js";
import { PO_PERMISSIONS, PurchaseOrderError, fail, optionalUuid, requireUuid, text } from "../purchase-orders/constants.js";

export const INDENT_APPROVAL = "procurement.indent";
const dec = (value) => (value === null || value === undefined ? null : formatDecimal(value));

export async function listProcurementDepartments(client, context, { includeInactive = false } = {}) {
  requirePoAccess(context);
  return (await client.query(
    `SELECT department.id, department.name, department.head_user_id, department.active, head.full_name AS head_name FROM tenant.procurement_departments department
       LEFT JOIN public.users head ON head.id = department.head_user_id WHERE department.organization_id = $1 ${includeInactive ? "" : "AND department.active"} ORDER BY department.name`,
    [context.organizationId])).rows.map((row) => ({ id: row.id, name: row.name, headUserId: row.head_user_id, headName: row.head_name, active: row.active }));
}

// input: { id?, name, headUserId?, active? }
export async function saveProcurementDepartment(client, context, input = {}) {
  requirePoPermission(context, PO_PERMISSIONS.settings, "You do not have permission to change procurement settings.");
  const name = text(input.name, 120);
  if (!name) fail("Name the department.", "name");
  const headUserId = optionalUuid(input.headUserId, "Head");
  if (headUserId && !(await client.query(`SELECT 1 FROM public.organization_memberships WHERE organization_id = $1 AND user_id = $2 AND status = 'active'`,
    [context.organizationId, headUserId])).rowCount) fail("Choose an active member as the head.", "headUserId");
  try {
    const row = input.id
      ? (await client.query(`UPDATE tenant.procurement_departments SET name = $3, head_user_id = $4, active = COALESCE($5, active), updated_by = $6, updated_at = now()
            WHERE organization_id = $1 AND id = $2 RETURNING id`, [context.organizationId, requireUuid(input.id, "Department"), name, headUserId, input.active ?? null, context.userId ?? null])).rows[0]
      : (await client.query(`INSERT INTO tenant.procurement_departments (organization_id, name, head_user_id, created_by, updated_by) VALUES ($1, $2, $3, $4, $4) RETURNING id`,
        [context.organizationId, name, headUserId, context.userId ?? null])).rows[0];
    if (!row) throw new PurchaseOrderError(404, "Department not found.", "PROCUREMENT_DEPARTMENT_NOT_FOUND");
    return { id: row.id };
  } catch (error) {
    if (error?.code === "23505") fail("A department with this name already exists.", "name", "PROCUREMENT_DEPARTMENT_DUPLICATE", 409);
    throw error;
  }
}

export async function departmentOf(client, organizationId, departmentId) {
  if (!departmentId) return null;
  return (await client.query(`SELECT id, name, head_user_id, active FROM tenant.procurement_departments WHERE organization_id = $1 AND id = $2`, [organizationId, departmentId])).rows[0] ?? null;
}

// The request's estimated value and what an approval is for (its lines as they stand).
export async function indentApprovalContent(client, organizationId, indentId) {
  const lines = (await client.query(
    `SELECT line.item_id, line.description, line.quantity, line.uom_id, COALESCE(
              (SELECT po_line.unit_price FROM tenant.purchase_order_lines po_line JOIN tenant.purchase_orders po ON po.organization_id = po_line.organization_id AND po.id = po_line.purchase_order_id
                WHERE po_line.organization_id = line.organization_id AND po_line.product_id = line.item_id AND po.status IN ('confirmed', 'closed') ORDER BY po.order_date DESC LIMIT 1),
              item.purchase_price, 0) AS price
       FROM tenant.purchase_indent_lines line LEFT JOIN tenant.items item ON item.organization_id = line.organization_id AND item.id = line.item_id
      WHERE line.organization_id = $1 AND line.indent_id = $2 AND line.status = 'open' ORDER BY line.line_number`, [organizationId, indentId])).rows;
  const amount = roundMoney(lines.reduce((sum, line) => add(sum, mul(decimal(line.quantity), decimal(line.price))), 0n), 2);
  const content = JSON.stringify(lines.map((line) => [line.item_id, line.description, String(line.quantity), line.uom_id]));
  return { amount: dec(amount), contentKey: createHash("sha256").update(`${indentId}:${content}`).digest("hex").slice(0, 24) };
}
