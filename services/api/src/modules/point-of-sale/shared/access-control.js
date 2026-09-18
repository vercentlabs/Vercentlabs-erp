import { posError } from "./errors.js";

// Every POS-CAP-00x capability function that needs a coarse platform
// permission check calls this directly (rather than trusting only the HTTP
// route layer) because several POS domain functions are invoked from more
// than one entry point -- an HTTP route AND the global cross-module
// approvals dispatch table (services/api/src/core/approvals.js's
// COMMAND_DISPATCH), which has no POS-specific route of its own to gate a
// decision on pos.discount.approve/pos.payment.override.approve. Removing
// this in-function check would silently drop the only permission
// enforcement those second entry points ever see.
export function requirePermission(context, permission) {
  if (!context.roleSlugs?.includes("organization_owner") && !context.permissions?.includes(permission)) {
    const error = new Error(`Missing permission: ${permission}`);
    error.code = "FORBIDDEN";
    throw error;
  }
}

// POS Session 3, Phase 2 (F268-F273): every store/shift/sale/return/cart
// function used to filter by organization_id+company_id only -- any
// cashier holding pos.sale.create could read or mutate ANY store's records
// in the company by guessing/enumerating an id, regardless of which
// physical store they actually work at. The platform has no existing
// sub-company access-grant finer than company/branch (see
// database/platform/migrations/002_platform_foundation.sql's
// membership_company_access/membership_branch_access), so
// tenant.pos_store_access (migration 115) is the smallest analogous table
// for POS stores specifically.
//
// Deliberately permissive when unconfigured: if an organization has never
// created a single pos_store_access row for a company, every existing
// company-scoped cashier keeps working exactly as before (a single-store
// tenant is never affected). The moment an organization assigns ANY user
// to ANY store in a company, this becomes a real fail-closed boundary for
// every other non-bypass user in that company: no assignment, no access to
// that store's carts/shifts, full stop. pos.store.manage/pos.settings.manage
// (store/policy administrators) and organization_owner/system_administrator
// always bypass it, matching every other POS permission check's convention.
//
// This is a cross-cutting primitive used by nearly every POS-CAP-00x
// capability (store-terminal-and-cashier-control, assortment-pricing-
// customer-and-cart, transaction-continuity-and-documents, returns-
// refunds-and-exchanges, cash-shift-day-end-and-reconciliation), which is
// why it lives here in shared/ rather than inside any one of them -- it
// used to be homed in the cart capability purely because that is where it
// was first built, which made every other capability importing it reach
// sideways into a sibling capability's internals for a genuinely
// cross-cutting concern.
// F270/F271: terminalId is optional and additive. Every call site that
// never passes one (the large majority -- returns, receipts, invoices,
// day-end reports, reconciliation, accounting posting, cash movements...)
// exercises ONLY the store-level check below, byte-for-byte the same
// query/behavior this function has always had. The two call sites where a
// cashier actively starts operating a specific terminal --
// openShift (shift-operations.js) and createPosCart (cart.js) -- pass
// terminalId, which adds a second, narrower check: does this user's
// access to the store cover this terminal specifically? A store-wide
// grant (terminal_id IS NULL) always covers every terminal, unchanged
// from before this column existed; a user holding only terminal-specific
// grants is confined to those terminals even though they have real
// "presence" at the store (so a store-level-only call, e.g. viewing a
// receipt for a sale at that store, still succeeds for them).
export async function assertPosStoreAccess(client, context, storeId, terminalId = null) {
  if (context.roleSlugs?.includes("organization_owner") || context.roleSlugs?.includes("system_administrator")) return;
  if (context.permissions?.includes("pos.store.manage") || context.permissions?.includes("pos.settings.manage")) return;
  const configured = await client.query(`SELECT 1 FROM tenant.pos_store_access WHERE organization_id=$1 AND company_id=$2 LIMIT 1`, [
    context.organizationId,
    context.companyId,
  ]);
  if (!configured.rows[0]) return;
  const granted = await client.query(`SELECT 1 FROM tenant.pos_store_access WHERE organization_id=$1 AND user_id=$2 AND store_id=$3 LIMIT 1`, [
    context.organizationId,
    context.userId,
    storeId,
  ]);
  if (!granted.rows[0]) throw posError(403, "You are not authorized to operate this POS store.", "POS_STORE_ACCESS_DENIED");
  if (!terminalId) return;
  const terminalCovered = await client.query(
    `SELECT 1 FROM tenant.pos_store_access WHERE organization_id=$1 AND user_id=$2 AND store_id=$3 AND (terminal_id IS NULL OR terminal_id=$4) LIMIT 1`,
    [context.organizationId, context.userId, storeId, terminalId],
  );
  if (!terminalCovered.rows[0]) throw posError(403, "You are not authorized to operate this POS terminal.", "POS_TERMINAL_ACCESS_DENIED");
}

// The read-side counterpart to assertPosStoreAccess: returns null (no
// filter needed) for a bypass-eligible caller or an unconfigured company,
// otherwise the caller's own granted store ids -- used to row-filter a
// LIST of records rather than assert access to one already-known id.
export async function accessiblePosStoreIds(client, context) {
  if (context.roleSlugs?.includes("organization_owner") || context.roleSlugs?.includes("system_administrator")) return null;
  if (context.permissions?.includes("pos.store.manage") || context.permissions?.includes("pos.settings.manage")) return null;
  const configured = await client.query(`SELECT 1 FROM tenant.pos_store_access WHERE organization_id=$1 AND company_id=$2 LIMIT 1`, [
    context.organizationId,
    context.companyId,
  ]);
  if (!configured.rows[0]) return null;
  const granted = await client.query(`SELECT store_id FROM tenant.pos_store_access WHERE organization_id=$1 AND user_id=$2`, [
    context.organizationId,
    context.userId,
  ]);
  return granted.rows.map((row) => row.store_id);
}

// F270/F271: the terminal-granularity counterpart, used to row-filter a
// LIST of terminals (e.g. the checkout/shift-open terminal picker) beyond
// what accessiblePosStoreIds already narrows to. Returns null the same
// way (no restriction -- bypass-eligible, unconfigured, or this user holds
// no terminal-SPECIFIC grant at all, meaning every store they're
// store-scoped to grants every terminal in it, the pre-existing
// behavior). A non-null result is the set of terminal ids this user may
// operate; a terminal at a store where they hold a store-wide grant is
// always included alongside any terminal-specific grants elsewhere.
export async function accessiblePosTerminalIds(client, context) {
  if (context.roleSlugs?.includes("organization_owner") || context.roleSlugs?.includes("system_administrator")) return null;
  if (context.permissions?.includes("pos.store.manage") || context.permissions?.includes("pos.settings.manage")) return null;
  const configured = await client.query(`SELECT 1 FROM tenant.pos_store_access WHERE organization_id=$1 AND company_id=$2 LIMIT 1`, [
    context.organizationId,
    context.companyId,
  ]);
  if (!configured.rows[0]) return null;
  const anyTerminalScoped = await client.query(
    `SELECT 1 FROM tenant.pos_store_access WHERE organization_id=$1 AND user_id=$2 AND terminal_id IS NOT NULL LIMIT 1`,
    [context.organizationId, context.userId],
  );
  if (!anyTerminalScoped.rows[0]) return null;
  const result = await client.query(
    `SELECT terminal.id
       FROM tenant.pos_terminals terminal
       JOIN tenant.pos_store_access access
         ON access.organization_id=terminal.organization_id AND access.store_id=terminal.store_id
        AND access.user_id=$2 AND (access.terminal_id IS NULL OR access.terminal_id=terminal.id)
      WHERE terminal.organization_id=$1`,
    [context.organizationId, context.userId],
  );
  return result.rows.map((row) => row.id);
}
