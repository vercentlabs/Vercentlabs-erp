import { posError } from "./errors.js";

// Every POS-CAP-00x capability function that needs a coarse platform
// permission check calls this directly (rather than trusting only the HTTP
// route layer) because several POS domain functions are invoked from more
// than one entry point -- an HTTP route AND the global cross-module
// approvals dispatch table (services/api/src/core/approvals.js's
// COMMAND_DISPATCH), which has no POS-specific route of its own to gate a
// decision on pos.payment.override.approve. Removing
// this in-function check would silently drop the only permission
// enforcement those second entry points ever see.
export function requirePermission(context, permission) {
  if (!context.roleSlugs?.includes("organization_owner") && !context.permissions?.includes(permission)) {
    const error = new Error(`Missing permission: ${permission}`);
    error.code = "FORBIDDEN";
    throw error;
  }
}

// Outlet access (Cashiers, migration 0082): where a person may work is their cashier profile's outlets, enforced here server-side for every
// POS operation and read. Fail-closed: without an active cashier profile holding access to an outlet, a person cannot operate there or see
// its carts, shifts, sales and returns. Owners and system administrators, and outlet administrators (pos.store.manage /
// pos.settings.manage), work at every outlet. What a person may do there is their permissions; both must pass.
//
// The terminal is not part of access: an outlet's cashiers may use any of its active terminals (terminalId is accepted for older callers).
const bypassesOutletAccess = (context) =>
  context.roleSlugs?.includes("organization_owner") || context.roleSlugs?.includes("system_administrator")
  || context.permissions?.includes("pos.store.manage") || context.permissions?.includes("pos.settings.manage");

export async function assertPosStoreAccess(client, context, storeId, terminalId = null) {
  void terminalId;
  if (bypassesOutletAccess(context)) return;
  const { rows } = await client.query(
    `SELECT cashier.status, EXISTS (SELECT 1 FROM tenant.pos_cashier_outlets access WHERE access.organization_id = cashier.organization_id
            AND access.cashier_id = cashier.id AND access.store_id = $3) AS allowed
       FROM tenant.pos_cashiers cashier WHERE cashier.organization_id = $1 AND cashier.user_id = $2`,
    [context.organizationId, context.userId, storeId],
  );
  if (!rows[0]) throw posError(403, "You do not have a cashier profile, so you cannot work at this outlet.", "CASHIER_OUTLET_ACCESS_DENIED");
  if (rows[0].status !== "active") throw posError(403, "Your cashier profile is inactive.", "CASHIER_INACTIVE");
  if (!rows[0].allowed) throw posError(403, "You are not authorized to work at this outlet.", "CASHIER_OUTLET_ACCESS_DENIED");
}

// The read-side counterpart to assertPosStoreAccess: null (no filter) for someone who works everywhere, otherwise the outlets of their active
// cashier profile (possibly none) -- used to row-filter a LIST of records.
export async function accessiblePosStoreIds(client, context) {
  if (bypassesOutletAccess(context)) return null;
  const { rows } = await client.query(
    `SELECT access.store_id FROM tenant.pos_cashier_outlets access
       JOIN tenant.pos_cashiers cashier ON cashier.organization_id = access.organization_id AND cashier.id = access.cashier_id
      WHERE access.organization_id = $1 AND cashier.user_id = $2 AND cashier.status = 'active'`,
    [context.organizationId, context.userId],
  );
  return rows.map((row) => row.store_id);
}
