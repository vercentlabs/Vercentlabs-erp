// Quality hold release (F333): a partial or full, reasoned, idempotent release of an active hold. The stock
// gate (F323) reads the hold's status and released quantity inside Stock's own postStockMovement.
import { beginIdempotentOperation, completeIdempotentOperation } from "../../core/idempotency.js";
import { lockInventoryItem } from "../../core/inventory-lock.js";
import { recordEvent } from "./common.js";

function requirePermission(context, permission) {
  if (
    !context.roleSlugs?.includes("organization_owner") &&
    !context.permissions?.includes(permission)
  ) {
    const error = new Error(`Missing permission: ${permission}`);
    error.code = "FORBIDDEN";
    throw error;
  }
}

export async function releaseQualityHold(client, context, holdId, input = {}) {
  requirePermission(context, "quality.release");
  const token = await beginIdempotentOperation(client, context, {
    operation: "quality.hold.release",
    key: input.idempotencyKey,
    payload: { holdId, quantity: input.quantity ?? null, reason: input.reason, expectedVersion: input.expectedVersion ?? null },
    required: true,
  });
  if (token.replayed) return { ...token.response, replayed: true };

  const snapshot = await client.query(
    `SELECT id,item_id FROM tenant.quality_holds
     WHERE organization_id=$1 AND company_id=$2 AND id=$3`,
    [context.organizationId, context.companyId, holdId],
  );
  if (!snapshot.rows[0]) {
    const error = new Error("Quality hold was not found for the active company.");
    error.status = 404;
    error.code = "QUALITY_HOLD_NOT_FOUND";
    throw error;
  }
  if (snapshot.rows[0].item_id) {
    await lockInventoryItem(client, context, snapshot.rows[0].item_id);
  }

  const locked = await client.query(
    `SELECT * FROM tenant.quality_holds
     WHERE organization_id=$1 AND company_id=$2 AND id=$3 FOR UPDATE`,
    [context.organizationId, context.companyId, holdId],
  );
  const hold = locked.rows[0];
  if (!hold || hold.status !== "active") {
    const error = new Error("Only an active quality hold can be released.");
    error.status = hold ? 409 : 404;
    error.code = hold ? "QUALITY_HOLD_STATE_INVALID" : "QUALITY_HOLD_NOT_FOUND";
    throw error;
  }
  if (input.expectedVersion != null && Number(input.expectedVersion) !== Number(hold.version)) {
    const error = new Error("The quality hold changed before this release was applied. Reload and retry.");
    error.status = 409;
    error.code = "QUALITY_HOLD_VERSION_CONFLICT";
    throw error;
  }

  const total = Number(hold.quantity);
  const alreadyReleased = Number(hold.released_quantity || 0);
  const scopeHold = total === 0;
  const remaining = Math.max(total - alreadyReleased, 0);
  if (!scopeHold && !(remaining > 0)) {
    const error = new Error("The quality hold has no remaining held quantity.");
    error.status = 409;
    error.code = "QUALITY_HOLD_ALREADY_RELEASED";
    throw error;
  }
  if (scopeHold && input.quantity != null) {
    const error = new Error("A scope-wide quality hold must be fully released; omit quantity.");
    error.status = 400;
    error.code = "QUALITY_HOLD_RELEASE_QUANTITY_INVALID";
    throw error;
  }
  const requested = scopeHold ? 0 : (input.quantity == null ? remaining : Number(input.quantity));
  if (!scopeHold && (!(requested > 0) || requested > remaining)) {
    const error = new Error("Release quantity must be greater than zero and cannot exceed the remaining held quantity.");
    error.status = 400;
    error.code = "QUALITY_HOLD_RELEASE_QUANTITY_INVALID";
    throw error;
  }
  const reason = String(input.reason || "").trim();
  if (!reason) {
    const error = new Error("A release reason is required.");
    error.status = 400;
    error.code = "QUALITY_HOLD_RELEASE_REASON_REQUIRED";
    throw error;
  }

  await client.query(
    `INSERT INTO tenant.quality_hold_releases
      (organization_id,company_id,hold_id,quantity,reason,released_by,idempotency_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [context.organizationId, context.companyId, holdId, String(requested), reason, context.userId, input.idempotencyKey],
  );
  const nextReleased = alreadyReleased + requested;
  const fullyReleased = scopeHold || nextReleased >= total;
  const updated = await client.query(
    `UPDATE tenant.quality_holds
     SET released_quantity=$4,
       status=CASE WHEN $5 THEN 'released' ELSE 'active' END,
       released_by=CASE WHEN $5 THEN $6 ELSE released_by END,
       released_at=CASE WHEN $5 THEN now() ELSE released_at END,
       release_reason=CASE WHEN $5 THEN $7 ELSE release_reason END,
       version=version+1
     WHERE organization_id=$1 AND company_id=$2 AND id=$3
     RETURNING *`,
    [context.organizationId, context.companyId, holdId, String(nextReleased), fullyReleased, context.userId, reason],
  );
  await recordEvent(client, context, "hold", holdId, fullyReleased ? "quality.hold.released" : "quality.hold.partially_released", {
    quantity: requested,
    remainingQuantity: Math.max(total - nextReleased, 0),
    reason,
  });
  const response = { ...updated.rows[0], replayed: false };
  await completeIdempotentOperation(client, context, token, {
    response,
    aggregateType: "quality_hold",
    aggregateId: holdId,
  });
  return response;
}
