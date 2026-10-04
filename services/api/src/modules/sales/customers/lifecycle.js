// Customer status: Active, Inactive, Blocked.
//
// Inactive — the customer is no longer used. It stays on every document and
//   report, and cannot be chosen for a new one.
// Blocked  — the customer is still in use but may not receive new quotations
//   or sales orders until someone unblocks it; a reason is required.
//
// Each change records who made it, when and why. None of them touches a
// document that already exists.
import { recordAccountHistory } from "../../crm/accounts/history.js";
import { requireCustomerPermission } from "./access.js";
import { CUSTOMER_PERMISSIONS, CustomerError } from "./constants.js";
import { customerStatusOf, getCustomerUnscoped, loadCustomerRow } from "./records.js";
import { text } from "./validation.js";

const reasonOf = (input) => text(input?.reason).slice(0, 500);

export async function deactivateCustomer(client, context, customerId, input = {}) {
  requireCustomerPermission(context, CUSTOMER_PERMISSIONS.inactivate, "You do not have permission to inactivate customers.");
  const row = await loadCustomerRow(client, context, customerId, { lock: true });
  if (row.status !== "active") throw new CustomerError(409, "This customer is already inactive.", "SALES_CUSTOMER_STATUS_UNCHANGED");
  const reason = reasonOf(input) || null;
  await client.query(
    `UPDATE tenant.business_parties SET status = 'inactive', status_reason = $3, status_changed_at = now(), status_changed_by = $4, updated_by = $4, updated_at = now()
      WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, row.id, reason, context.userId ?? null],
  );
  await recordAccountHistory(client, context, row.id, "deactivated", reason ? `Customer inactivated: ${reason}` : "Customer inactivated", { from: customerStatusOf(row), to: "inactive", reason });
  return getCustomerUnscoped(client, context, row.id);
}

export async function activateCustomer(client, context, customerId, input = {}) {
  requireCustomerPermission(context, CUSTOMER_PERMISSIONS.reactivate, "You do not have permission to reactivate customers.");
  const row = await loadCustomerRow(client, context, customerId, { lock: true });
  if (row.status === "active") throw new CustomerError(409, "This customer is already active.", "SALES_CUSTOMER_STATUS_UNCHANGED");
  const reason = reasonOf(input) || null;
  await client.query(
    `UPDATE tenant.business_parties SET status = 'active', archived_at = NULL, archived_by = NULL, status_reason = $3, status_changed_at = now(), status_changed_by = $4,
            updated_by = $4, updated_at = now()
      WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, row.id, reason, context.userId ?? null],
  );
  await recordAccountHistory(client, context, row.id, "reactivated", reason ? `Customer reactivated: ${reason}` : "Customer reactivated", { from: "inactive", to: row.sales_block === "none" ? "active" : "blocked", reason });
  return getCustomerUnscoped(client, context, row.id);
}

export async function blockCustomer(client, context, customerId, input = {}) {
  requireCustomerPermission(context, CUSTOMER_PERMISSIONS.block, "You do not have permission to block customers.");
  const row = await loadCustomerRow(client, context, customerId, { lock: true });
  if (row.status !== "active") throw new CustomerError(409, "Only an active customer can be blocked.", "SALES_CUSTOMER_INACTIVE");
  if (row.sales_block === "all") throw new CustomerError(409, "This customer is already blocked.", "SALES_CUSTOMER_STATUS_UNCHANGED");
  const reason = reasonOf(input);
  if (reason.length < 5)
    throw new CustomerError(400, "Say why the customer is being blocked, in at least 5 characters.", "SALES_CUSTOMER_BLOCK_REASON_REQUIRED", { issues: [{ field: "reason", message: "Enter the reason." }] });
  await client.query(
    `UPDATE tenant.business_parties SET sales_block = 'all', sales_block_reason = $3, sales_blocked_at = now(), sales_blocked_by = $4, updated_by = $4, updated_at = now()
      WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, row.id, reason, context.userId ?? null],
  );
  await recordAccountHistory(client, context, row.id, "status_changed", `Customer blocked: ${reason}`, { kind: "blocked", from: customerStatusOf(row), to: "blocked", reason });
  return getCustomerUnscoped(client, context, row.id);
}

export async function unblockCustomer(client, context, customerId, input = {}) {
  requireCustomerPermission(context, CUSTOMER_PERMISSIONS.unblock, "You do not have permission to unblock customers.");
  const row = await loadCustomerRow(client, context, customerId, { lock: true });
  if (row.sales_block === "none") throw new CustomerError(409, "This customer is not blocked.", "SALES_CUSTOMER_STATUS_UNCHANGED");
  const reason = reasonOf(input) || null;
  await client.query(
    `UPDATE tenant.business_parties SET sales_block = 'none', sales_block_reason = NULL, sales_blocked_at = NULL, sales_blocked_by = NULL, updated_by = $3, updated_at = now()
      WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, row.id, context.userId ?? null],
  );
  await recordAccountHistory(client, context, row.id, "status_changed", reason ? `Customer unblocked: ${reason}` : "Customer unblocked",
    { kind: "unblocked", from: "blocked", to: row.status === "active" ? "active" : "inactive", previousReason: row.sales_block_reason, reason });
  return getCustomerUnscoped(client, context, row.id);
}
