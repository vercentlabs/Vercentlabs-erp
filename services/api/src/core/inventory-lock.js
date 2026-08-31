function required(value, name) {
  const text = String(value || "").trim();
  if (!text) {
    const error = new Error(`${name} is required for inventory locking.`);
    error.status = 400;
    error.code = "INVENTORY_LOCK_SCOPE_INVALID";
    throw error;
  }
  return text;
}

/**
 * Serialize Quality hold changes and Stock movements for one item within one
 * company. The item-level lock intentionally covers all warehouses/batches for
 * the item so wildcard warehouse/batch holds cannot race a more-specific issue.
 */
export async function lockInventoryItem(client, context, itemId) {
  const organizationId = required(context?.organizationId, "Organization");
  const companyId = required(context?.companyId, "Company");
  const item = required(itemId, "Item");
  const lockKey = `quality-stock:${organizationId}:${companyId}:${item}`;
  await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [lockKey]);
  return lockKey;
}
