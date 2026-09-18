// POS-CAP-005 (F291-F293 returns, refunds and exchanges). The real return
// lifecycle: request (create) -> supervisor decision (approve/reject) ->
// completion (refund + restock + sale-status update). Reaches into Stock
// (restock via postCanonicalStockMovement) and this module's own
// promotions/coupons capability (releasing a coupon redemption on a full
// return) the same way sale-completion.js's completePosCart reaches into
// Stock and tender-and-payment-execution -- a capability's own lifecycle
// capstone composing other capabilities' primitives is expected, not a
// layering violation.
import { nextDocumentNumber } from "../../../core/document-numbering.js";
import { beginIdempotentOperation, completeIdempotentOperation } from "../../../core/idempotency.js";
import { add, sub, decimal, asDatabaseDecimal, allocate } from "../../../core/decimal.js";
import { postStockMovement as postCanonicalStockMovement } from "../../stock/index.js";
import { posError } from "../shared/errors.js";
import { requirePermission, assertPosStoreAccess } from "../shared/access-control.js";
import { event } from "../shared/audit.js";
import { releasePosCouponRedemptionForFullReturn } from "../assortment-pricing-customer-and-cart/coupons.js";
import { reversePosLoyaltyForReturn } from "../assortment-pricing-customer-and-cart/loyalty.js";
import { refundPosPayment } from "../tender-and-payment-execution/payments.js";

// F292 non-cash refunds: the return's own refund_total is split across the
// sale's captured payment legs proportionally to each leg's ORIGINAL
// captured amount (a split-tender sale is refunded in the same proportions
// it was paid in — the same "allocate a total across tender legs"
// primitive F285 split-payment capture already uses), then capped at each
// leg's own remaining refundable amount (capturedAmount-refundedAmount).
// Any excess a cap creates is redistributed across legs that still have
// headroom in a second pass; if headroom is exhausted across every leg
// (only possible if an earlier, separate partial return already consumed
// it disproportionately), this fails loud rather than silently
// under-refunding one tender or fabricating headroom that doesn't exist.
function allocateRefundAcrossPayments(refundTotal, legs) {
  const shareByPaymentId = new Map(legs.map((leg) => [leg.payment.id, 0n]));
  let remaining = refundTotal;
  let pool = legs.filter((leg) => sub(leg.capturedAmount, leg.alreadyRefunded) > 0n);
  let iterations = 0;
  while (remaining > 0n && pool.length > 0 && iterations < legs.length + 1) {
    iterations += 1;
    const weights = pool.map((leg) => leg.capturedAmount);
    const proposedShares = allocate(remaining, weights);
    let distributed = 0n;
    const nextPool = [];
    for (let index = 0; index < pool.length; index += 1) {
      const leg = pool[index];
      const cap = sub(leg.capturedAmount, add(leg.alreadyRefunded, shareByPaymentId.get(leg.payment.id)));
      const proposed = proposedShares[index];
      const applied = proposed > cap ? cap : proposed;
      if (applied > 0n) {
        shareByPaymentId.set(leg.payment.id, add(shareByPaymentId.get(leg.payment.id), applied));
        distributed = add(distributed, applied);
      }
      if (applied < proposed || (applied === cap && applied > 0n && proposed >= cap)) {
        // This leg hit its cap this round -- it has no more headroom for
        // a later round even though it may have "accepted" its full cap.
        continue;
      }
      nextPool.push(leg);
    }
    remaining = sub(remaining, distributed);
    pool = nextPool.filter((leg) => sub(leg.capturedAmount, add(leg.alreadyRefunded, shareByPaymentId.get(leg.payment.id))) > 0n);
    if (distributed === 0n) break;
  }
  if (remaining > 0n) {
    throw posError(
      409,
      "This return's refund total exceeds what remains refundable across the sale's payment methods.",
      "POS_REFUND_EXCEEDS_CAPTURED",
    );
  }
  return legs.map((leg) => shareByPaymentId.get(leg.payment.id));
}

export async function createPointOfSaleReturn(client, context, input) {
  requirePermission(context, "pos.return.create");
  if (!Array.isArray(input.lines) || input.lines.length === 0) {
    throw posError(400, "At least one return line is required.", "POS_RETURN_LINES_REQUIRED");
  }
  const idempotency = await beginIdempotentOperation(client, context, {
    operation: "pos.return.create",
    key: input.idempotencyKey,
    payload: { ...input, idempotencyKey: undefined },
    required: true,
  });
  if (idempotency.replayed) return { ...idempotency.response, replayed: true };

  const saleResult = await client.query(
    `SELECT * FROM tenant.pos_sales
     WHERE organization_id=$1 AND company_id=$2 AND id=$3
       AND status IN ('completed','partially_returned')
     FOR UPDATE`,
    [context.organizationId, context.companyId, input.saleId],
  );
  const sale = saleResult.rows[0];
  if (!sale) throw posError(404, "Eligible sale not found.", "POS_RETURN_SALE_NOT_FOUND");
  await assertPosStoreAccess(client, context, sale.store_id);

  const uniqueLineIds = [...new Set(input.lines.map((line) => line.saleLineId))];
  if (uniqueLineIds.length !== input.lines.length) {
    throw posError(400, "A sale line can appear only once in one return request.", "POS_RETURN_DUPLICATE_LINE");
  }
  const saleLines = await client.query(
    `SELECT * FROM tenant.pos_sale_lines
     WHERE organization_id=$1 AND sale_id=$2 AND id=ANY($3::uuid[])
     ORDER BY line_number
     FOR UPDATE`,
    [context.organizationId, sale.id, uniqueLineIds],
  );
  if (saleLines.rows.length !== uniqueLineIds.length) {
    throw posError(409, "One or more return lines do not belong to the selected sale.", "POS_RETURN_LINE_MISMATCH");
  }
  const byId = new Map(saleLines.rows.map((line) => [line.id, line]));
  const normalizedLines = [];
  let refundTotal = 0;
  for (const requestedLine of input.lines) {
    const saleLine = byId.get(requestedLine.saleLineId);
    const quantity = Number(requestedLine.quantity);
    const soldQuantity = Number(saleLine.quantity);
    const returnedQuantity = Number(saleLine.returned_quantity || 0);
    const remaining = soldQuantity - returnedQuantity;
    if (!(quantity > 0) || quantity > remaining) {
      throw posError(409, "Return quantity exceeds the remaining returnable quantity.", "POS_RETURN_QUANTITY_EXCEEDED");
    }
    const perUnitRefund = soldQuantity > 0 ? Number(saleLine.line_total) / soldQuantity : 0;
    const refundAmount = Number((perUnitRefund * quantity).toFixed(6));
    if (
      requestedLine.refundAmount != null &&
      Math.abs(Number(requestedLine.refundAmount) - refundAmount) > 0.01
    ) {
      throw posError(409, "Client refund amount does not match the authoritative sale-line amount.", "POS_REFUND_AMOUNT_MISMATCH");
    }
    refundTotal += refundAmount;
    normalizedLines.push({
      saleLine,
      quantity,
      refundAmount,
      restock: requestedLine.restock !== false,
    });
  }
  refundTotal = Number(refundTotal.toFixed(6));
  if (input.refundTotal != null && Math.abs(Number(input.refundTotal) - refundTotal) > 0.01) {
    throw posError(409, "Client refund total does not match the authoritative return total.", "POS_REFUND_TOTAL_MISMATCH");
  }

  const settings = await client.query(
    `SELECT require_return_approval,prohibit_self_return_approval
     FROM tenant.pos_settings
     WHERE organization_id=$1 AND company_id=$2`,
    [context.organizationId, context.companyId],
  );
  const policy = settings.rows[0] || {
    require_return_approval: true,
    prohibit_self_return_approval: true,
  };
  const status = policy.require_return_approval ? "pending_approval" : "approved";
  const returnNumber = input.returnNumber || await nextDocumentNumber(client, context, {
    documentType: "pos_return",
    prefix: "RET",
  });

  const result = await client.query(
    `INSERT INTO tenant.pos_returns
      (organization_id,company_id,store_id,terminal_id,shift_id,sale_id,
       return_number,reason,status,refund_total,requested_by,
       approved_by,approved_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::uuid,
       CASE WHEN $9='approved' THEN $11::uuid ELSE NULL END,
       CASE WHEN $9='approved' THEN now() ELSE NULL END)
     RETURNING *`,
    [
      context.organizationId,
      context.companyId,
      sale.store_id,
      sale.terminal_id,
      sale.shift_id,
      sale.id,
      returnNumber,
      input.reason,
      status,
      String(refundTotal),
      context.userId,
    ],
  );

  for (const line of normalizedLines) {
    await client.query(
      `INSERT INTO tenant.pos_return_lines
        (organization_id,return_id,sale_line_id,quantity,refund_amount,restock)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        context.organizationId,
        result.rows[0].id,
        line.saleLine.id,
        String(line.quantity),
        String(line.refundAmount),
        line.restock,
      ],
    );
  }

  await event(client, context, "return", result.rows[0].id, "pos.return.created", {
    refundTotal,
    status,
  });
  const response = { ...result.rows[0], replayed: false };
  await completeIdempotentOperation(client, context, idempotency, {
    response,
    aggregateType: "pos_return",
    aggregateId: result.rows[0].id,
  });
  return response;
}

export async function approvePointOfSaleReturn(client, context, returnId, input = {}) {
  requirePermission(context, "pos.return.approve");
  const idempotency = await beginIdempotentOperation(client, context, {
    operation: "pos.return.approve",
    key: input.idempotencyKey,
    payload: { returnId, reason: input.reason || null },
    required: true,
  });
  if (idempotency.replayed) return { ...idempotency.response, replayed: true };

  const found = await client.query(
    `SELECT * FROM tenant.pos_returns
     WHERE organization_id=$1 AND company_id=$2 AND id=$3 FOR UPDATE`,
    [context.organizationId, context.companyId, returnId],
  );
  const row = found.rows[0];
  if (!row) throw posError(404, "POS return was not found.", "POS_RETURN_NOT_FOUND");
  await assertPosStoreAccess(client, context, row.store_id);
  if (row.status === "approved" || row.status === "completed") {
    const response = { ...row, replayed: true };
    await completeIdempotentOperation(client, context, idempotency, {
      response,
      aggregateType: "pos_return",
      aggregateId: returnId,
    });
    return response;
  }
  if (row.status !== "pending_approval") {
    throw posError(409, "Only a pending POS return can be approved.", "POS_RETURN_STATE_INVALID");
  }
  const settings = await client.query(
    `SELECT prohibit_self_return_approval FROM tenant.pos_settings
     WHERE organization_id=$1 AND company_id=$2`,
    [context.organizationId, context.companyId],
  );
  if (settings.rows[0]?.prohibit_self_return_approval !== false && row.requested_by === context.userId) {
    throw posError(409, "The return requester cannot approve the same return.", "SELF_APPROVAL_BLOCKED");
  }
  const approved = await client.query(
    `UPDATE tenant.pos_returns
     SET status='approved',approved_by=$4,approved_at=now()
     WHERE organization_id=$1 AND company_id=$2 AND id=$3 AND status='pending_approval'
     RETURNING *`,
    [context.organizationId, context.companyId, returnId, context.userId],
  );
  if (!approved.rows[0]) throw posError(409, "POS return state changed before approval.", "POS_RETURN_STATE_CONFLICT");
  await event(client, context, "return", returnId, "pos.return.approved", {
    reason: input.reason || null,
  });
  const response = { ...approved.rows[0], replayed: false };
  await completeIdempotentOperation(client, context, idempotency, {
    response,
    aggregateType: "pos_return",
    aggregateId: returnId,
  });
  return response;
}

export async function completePointOfSaleReturn(client, context, returnId, input = {}) {
  requirePermission(context, "pos.return.approve");
  const idempotency = await beginIdempotentOperation(client, context, {
    operation: "pos.return.complete",
    key: input.idempotencyKey,
    payload: { returnId },
    required: true,
  });
  if (idempotency.replayed) return { ...idempotency.response, replayed: true };

  const found = await client.query(
    `SELECT return_record.*,sale.status AS sale_status,sale.customer_id AS sale_customer_id,sale.loyalty_program_id AS sale_loyalty_program_id
     FROM tenant.pos_returns return_record
     JOIN tenant.pos_sales sale
       ON sale.organization_id=return_record.organization_id
      AND sale.id=return_record.sale_id
      AND sale.company_id=return_record.company_id
     WHERE return_record.organization_id=$1 AND return_record.company_id=$2
       AND return_record.id=$3
     FOR UPDATE OF return_record,sale`,
    [context.organizationId, context.companyId, returnId],
  );
  const returnRecord = found.rows[0];
  if (!returnRecord) throw posError(404, "POS return was not found.", "POS_RETURN_NOT_FOUND");
  await assertPosStoreAccess(client, context, returnRecord.store_id);
  if (returnRecord.status === "completed") {
    const response = { ...returnRecord, replayed: true };
    await completeIdempotentOperation(client, context, idempotency, {
      response,
      aggregateType: "pos_return",
      aggregateId: returnId,
    });
    return response;
  }
  if (returnRecord.status !== "approved") {
    throw posError(409, "Only an approved POS return can be completed.", "POS_RETURN_STATE_INVALID");
  }

  // F292: every captured/partially_refunded tender leg on the sale is a
  // real refund candidate now, not just cash -- see
  // allocateRefundAcrossPayments below. Locked here (not just read) so a
  // concurrent refund attempt against the same payment (e.g. a supervisor
  // double-clicking "complete") serializes rather than racing on the same
  // remaining-refundable headroom.
  const payments = await client.query(
    `SELECT * FROM tenant.pos_payments
     WHERE organization_id=$1 AND company_id=$2 AND sale_id=$3
       AND status IN ('captured','partially_refunded')
     ORDER BY id FOR UPDATE`,
    [context.organizationId, context.companyId, returnRecord.sale_id],
  );
  if (!payments.rows.length) {
    throw posError(409, "This sale has no captured payment left to refund.", "POS_REFUND_NO_PAYMENT");
  }

  const lines = await client.query(
    `SELECT return_line.*,sale_line.quantity AS sold_quantity,
            sale_line.returned_quantity,sale_line.item_id,sale_line.warehouse_id,
            sale_line.warehouse_location_id,sale_line.batch_id,sale_line.serial_id,
            sale_line.loyalty_redeem_points AS sale_line_loyalty_redeem_points,
            stock_movement.unit_cost
     FROM tenant.pos_return_lines return_line
     JOIN tenant.pos_sale_lines sale_line
       ON sale_line.organization_id=return_line.organization_id
      AND sale_line.id=return_line.sale_line_id
     LEFT JOIN tenant.stock_movements stock_movement
       ON stock_movement.organization_id=sale_line.organization_id
      AND stock_movement.id=sale_line.stock_movement_id
     WHERE return_line.organization_id=$1 AND return_line.return_id=$2
     ORDER BY return_line.id
     FOR UPDATE OF return_line,sale_line`,
    [context.organizationId, returnId],
  );
  if (!lines.rows.length) throw posError(409, "POS return has no return lines.", "POS_RETURN_LINES_REQUIRED");

  for (const line of lines.rows) {
    const nextReturned = Number(line.returned_quantity || 0) + Number(line.quantity);
    if (nextReturned > Number(line.sold_quantity)) {
      throw posError(409, "Return would exceed the quantity sold on a sale line.", "POS_RETURN_QUANTITY_EXCEEDED");
    }

    let stockMovementId = line.stock_movement_id || null;
    if (line.restock && !stockMovementId) {
      const stockMovement = await postCanonicalStockMovement(
        client,
        { ...context, permissions: [...new Set([...(context.permissions || []), "stock.receive"])] },
        {
          movementType: "receipt",
          itemId: line.item_id,
          warehouseId: line.warehouse_id,
          warehouseLocationId: line.warehouse_location_id,
          batchId: line.batch_id,
          serialId: line.serial_id,
          quantity: line.quantity,
          unitCost: Number(line.unit_cost || 0),
          referenceType: "pos_return",
          referenceId: returnId,
          reason: "POS return restock",
          idempotencyKey: `pos-return:${returnId}:line:${line.id}:restock`,
        },
      );
      stockMovementId = stockMovement.id;
      await client.query(
        `UPDATE tenant.pos_return_lines SET stock_movement_id=$3
         WHERE organization_id=$1 AND id=$2`,
        [context.organizationId, line.id, stockMovementId],
      );
    }

    const updatedLine = await client.query(
      `UPDATE tenant.pos_sale_lines
       SET returned_quantity=returned_quantity+$4
       WHERE organization_id=$1 AND id=$2 AND sale_id=$3
         AND returned_quantity+$4 <= quantity
       RETURNING id`,
      [context.organizationId, line.sale_line_id, returnRecord.sale_id, line.quantity],
    );
    if (!updatedLine.rows[0]) {
      throw posError(409, "Sale-line return quantity changed concurrently. Reload and retry.", "POS_RETURN_QUANTITY_CONFLICT");
    }
  }

  const saleState = await client.query(
    `SELECT bool_and(returned_quantity >= quantity) AS fully_returned
     FROM tenant.pos_sale_lines
     WHERE organization_id=$1 AND sale_id=$2`,
    [context.organizationId, returnRecord.sale_id],
  );
  const fullyReturned = Boolean(saleState.rows[0]?.fully_returned);
  const nextSaleStatus = fullyReturned ? "returned" : "partially_returned";
  await client.query(
    `UPDATE tenant.pos_sales SET status=$4
     WHERE organization_id=$1 AND company_id=$2 AND id=$3`,
    [context.organizationId, context.companyId, returnRecord.sale_id, nextSaleStatus],
  );

  // F281 reversal dependency (PHASE 9): a coupon redeemed on this sale is
  // released back to the pool only when the ENTIRE sale is returned — see
  // coupons.js's own comment for why a partial return is left PARTIAL
  // rather than inventing an unspecified fractional-usage-credit model.
  if (fullyReturned) {
    await releasePosCouponRedemptionForFullReturn(client, context, returnRecord.sale_id);
  }

  // F306: reverse the PROPORTIONAL share of points this return event's own
  // lines earned/redeemed — see loyalty.js's PARTIAL-RETURN
  // PROPORTIONALITY comment. Unlike the coupon release above, this is NOT
  // gated on fullyReturned: it runs for every return (partial or full) and
  // is proportionally correct in both cases (a full return's per-line
  // ratio is exactly 1, reversing exactly 100% of that line's points).
  if (returnRecord.sale_customer_id) {
    await reversePosLoyaltyForReturn(client, context, {
      returnId,
      saleId: returnRecord.sale_id,
      customerId: returnRecord.sale_customer_id,
      programId: returnRecord.sale_loyalty_program_id,
      returnedLines: lines.rows.map((line) => ({
        saleLineId: line.sale_line_id,
        soldQuantity: line.sold_quantity,
        returnQuantity: line.quantity,
        redeemPoints: line.sale_line_loyalty_redeem_points,
      })),
    });
  }

  // F292: allocate the return's own authoritative refund_total across
  // every captured tender leg on the sale, proportionally to how the sale
  // was originally paid, then refund each leg through its own real
  // mechanism -- a cash movement for cash, refundPosPayment's real
  // provider-adapter call (tender-and-payment-execution/payments.js, the
  // same idempotent/capped function F283-F286's own operator-facing
  // refund action already uses) for everything else. Never a fabricated
  // "refunded" status with no corresponding provider call.
  const refundTotal = decimal(returnRecord.refund_total);
  if (refundTotal > 0n) {
    const legs = payments.rows.map((payment) => ({
      payment,
      capturedAmount: decimal(payment.amount),
      alreadyRefunded: decimal(payment.refunded_amount || 0),
    }));
    const shares = allocateRefundAcrossPayments(refundTotal, legs);
    for (let index = 0; index < legs.length; index += 1) {
      const { payment } = legs[index];
      const share = shares[index];
      if (share <= 0n) continue;
      if (payment.payment_method === "cash") {
        const cashMovementNumber = await nextDocumentNumber(client, context, {
          documentType: "pos_cash_movement",
          prefix: "CASH",
        });
        await client.query(
          `INSERT INTO tenant.pos_cash_movements
            (organization_id,company_id,shift_id,movement_number,movement_type,
             amount,reason,reference_type,reference_id,created_by)
           VALUES ($1,$2,$3,$4,'refund',$5,$6,'pos_return',$7,$8)`,
          [
            context.organizationId,
            context.companyId,
            returnRecord.shift_id,
            cashMovementNumber,
            asDatabaseDecimal(sub(decimal(0), share)),
            returnRecord.reason,
            returnId,
            context.userId,
          ],
        );
        const newRefunded = add(decimal(payment.refunded_amount || 0), share);
        const fullyRefundedLeg = newRefunded >= decimal(payment.amount);
        await client.query(
          `UPDATE tenant.pos_payments SET refunded_amount=$3,status=$4,updated_at=now()
           WHERE organization_id=$1 AND id=$2`,
          [context.organizationId, payment.id, asDatabaseDecimal(newRefunded), fullyRefundedLeg ? "refunded" : "partially_refunded"],
        );
      } else {
        await refundPosPayment(client, context, {
          paymentId: payment.id,
          amount: asDatabaseDecimal(share),
          idempotencyKey: `${input.idempotencyKey}:refund:${payment.id}`,
          outcome: input.refundOutcome,
        });
      }
    }
  }

  const completed = await client.query(
    `UPDATE tenant.pos_returns
     SET status='completed',completed_by=$4,completed_at=now()
     WHERE organization_id=$1 AND company_id=$2 AND id=$3 AND status='approved'
     RETURNING *`,
    [context.organizationId, context.companyId, returnId, context.userId],
  );
  if (!completed.rows[0]) throw posError(409, "POS return state changed before completion.", "POS_RETURN_STATE_CONFLICT");
  await event(client, context, "return", returnId, "pos.return.completed", {
    refundTotal: asDatabaseDecimal(refundTotal),
    saleStatus: nextSaleStatus,
  });
  const response = { ...completed.rows[0], saleStatus: nextSaleStatus, replayed: false };
  await completeIdempotentOperation(client, context, idempotency, {
    response,
    aggregateType: "pos_return",
    aggregateId: returnId,
  });
  return response;
}
