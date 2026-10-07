// Who may receive goods into each warehouse. A warehouse with nobody listed
// may be received into by anyone allowed to receive; once people are listed,
// only they (and owners and administrators) may post receipts into it.
import { requirePoAccess, requirePoPermission } from "./access.js";
import { PO_PERMISSIONS, fail, requireUuid } from "./constants.js";

export async function getReceivingWarehouseUsers(client, context) {
  requirePoAccess(context);
  const { rows } = await client.query(
    `SELECT warehouse.id, warehouse.code, warehouse.name, COALESCE(array_agg(access.user_id) FILTER (WHERE access.user_id IS NOT NULL), '{}') AS user_ids
       FROM tenant.warehouses warehouse LEFT JOIN tenant.warehouse_receiving_users access ON access.organization_id = warehouse.organization_id AND access.warehouse_id = warehouse.id
      WHERE warehouse.organization_id = $1 AND warehouse.status = 'active' GROUP BY warehouse.id ORDER BY warehouse.name`, [context.organizationId]);
  return rows.map((row) => ({ warehouseId: row.id, code: row.code, name: row.name, userIds: row.user_ids }));
}

// input: { warehouseId, userIds: [] } — an empty list opens the warehouse to everyone allowed to receive.
export async function setReceivingWarehouseUsers(client, context, input = {}) {
  requirePoPermission(context, PO_PERMISSIONS.receivingAccess, "You do not have permission to choose who receives into warehouses.");
  const warehouseId = requireUuid(input.warehouseId, "Warehouse");
  const warehouse = (await client.query(`SELECT 1 FROM tenant.warehouses WHERE organization_id = $1 AND id = $2`, [context.organizationId, warehouseId])).rows[0];
  if (!warehouse) fail("Choose a warehouse.", "warehouseId", "PURCHASE_ORDER_WAREHOUSE_INVALID", 404);
  const userIds = [...new Set((Array.isArray(input.userIds) ? input.userIds : []).map((id) => requireUuid(id, "User")))];
  if (userIds.length) {
    const members = (await client.query(`SELECT user_id FROM public.organization_memberships WHERE organization_id = $1 AND status = 'active' AND user_id = ANY($2::uuid[])`,
      [context.organizationId, userIds])).rows.map((row) => row.user_id);
    if (members.length !== userIds.length) fail("Everyone listed must be an active member of the workspace.", "userIds", "PURCHASE_ORDER_VALIDATION", 409);
  }
  await client.query(`DELETE FROM tenant.warehouse_receiving_users WHERE organization_id = $1 AND warehouse_id = $2 AND NOT (user_id = ANY($3::uuid[]))`, [context.organizationId, warehouseId, userIds]);
  for (const userId of userIds)
    await client.query(`INSERT INTO tenant.warehouse_receiving_users (organization_id, warehouse_id, user_id, created_by) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
      [context.organizationId, warehouseId, userId, context.userId ?? null]);
  return { warehouseId, userIds };
}
