import { requireCompanyRecord } from "../../../core/references.js";
import { posError } from "../shared/errors.js";
import { requirePermission, assertPosStoreAccess } from "../shared/access-control.js";

export async function createTerminal(client, context, input) {
  requirePermission(context, "pos.terminal.manage");
  await assertPosStoreAccess(client, context, input.storeId);
  await requireCompanyRecord(client, context, "pos_store", input.storeId);
  const result = await client.query(
    `INSERT INTO tenant.pos_terminals
      (organization_id,company_id,store_id,code,name,receipt_prefix,created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING *`,
    [
      context.organizationId,
      context.companyId,
      input.storeId,
      input.code,
      input.name,
      input.receiptPrefix || "POS",
      context.userId,
    ],
  );
  return result.rows[0];
}

// F269: reassigning a terminal to a different store (or changing its
// receipt prefix) is blocked while a shift is currently open on it, for
// the same reason store warehouse/currency changes are blocked -- it must
// never happen mid-transaction.
export async function updatePosTerminal(client, context, id, input) {
  requirePermission(context, "pos.terminal.manage");
  const fields = [];
  const values = [context.organizationId, context.companyId, id];
  function set(column, value) {
    values.push(value);
    fields.push(`${column}=$${values.length}`);
  }
  if (input.name != null) set("name", String(input.name).trim());
  if (input.receiptPrefix != null) set("receipt_prefix", String(input.receiptPrefix).trim().toUpperCase().slice(0, 10) || "POS");
  if (input.storeId != null) {
    const openShift = await client.query(
      `SELECT 1 FROM tenant.pos_shifts WHERE organization_id=$1 AND company_id=$2 AND terminal_id=$3 AND status='open' LIMIT 1`,
      [context.organizationId, context.companyId, id],
    );
    if (openShift.rows[0]) throw posError(409, "Cannot reassign a terminal's store while a shift is open on it.", "POS_TERMINAL_UNSAFE_TRANSITION");
    await assertPosStoreAccess(client, context, input.storeId);
    await requireCompanyRecord(client, context, "pos_store", input.storeId);
    set("store_id", input.storeId);
  }
  if (!fields.length) throw posError(400, "No fields to update.", "POS_TERMINAL_UPDATE_EMPTY");
  fields.push("updated_at=now()");
  const result = await client.query(
    `UPDATE tenant.pos_terminals SET ${fields.join(",")} WHERE organization_id=$1 AND company_id=$2 AND id=$3 RETURNING *`,
    values,
  );
  if (!result.rows[0]) throw posError(404, "POS terminal was not found.", "POS_TERMINAL_NOT_FOUND");
  return result.rows[0];
}

// F269: activate/inactivate/maintenance -- any transition away from
// 'active' is blocked while a shift is currently open on the terminal.
export async function setPosTerminalStatus(client, context, id, status) {
  requirePermission(context, "pos.terminal.manage");
  if (!["active", "inactive", "maintenance"].includes(status)) throw posError(400, "Invalid terminal status.", "POS_TERMINAL_STATUS_INVALID");
  if (status !== "active") {
    const openShift = await client.query(
      `SELECT 1 FROM tenant.pos_shifts WHERE organization_id=$1 AND company_id=$2 AND terminal_id=$3 AND status='open' LIMIT 1`,
      [context.organizationId, context.companyId, id],
    );
    if (openShift.rows[0]) throw posError(409, "Cannot change status while a shift is open on this terminal.", "POS_TERMINAL_HAS_OPEN_SHIFT");
  }
  const result = await client.query(`UPDATE tenant.pos_terminals SET status=$4,updated_at=now() WHERE organization_id=$1 AND company_id=$2 AND id=$3 RETURNING *`, [
    context.organizationId,
    context.companyId,
    id,
    status,
  ]);
  if (!result.rows[0]) throw posError(404, "POS terminal was not found.", "POS_TERMINAL_NOT_FOUND");
  return result.rows[0];
}
