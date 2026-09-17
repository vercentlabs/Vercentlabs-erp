import { nextDocumentNumber } from "../../core/document-numbering.js";
import { beginIdempotentOperation, completeIdempotentOperation } from "../../core/idempotency.js";
import { requireCompanyRecord } from "../../core/references.js";

import { postStockMovement as postCanonicalStockMovement } from "../stock/index.js";

const TABLES = Object.freeze({
  stores: "pos_stores",
  terminals: "pos_terminals",
  shifts: "pos_shifts",
  sales: "pos_sales",
  payments: "pos_payments",
  returns: "pos_returns",
  "cash-movements": "pos_cash_movements",
  reconciliations: "pos_reconciliations",
});

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

function table(resource) {
  const value = TABLES[resource];
  if (!value) throw new Error("Unsupported POS resource.");
  return value;
}

async function event(
  client,
  context,
  aggregateType,
  aggregateId,
  eventType,
  payload = {},
) {
  await client.query(
    `INSERT INTO tenant.pos_events
      (organization_id,company_id,aggregate_type,aggregate_id,event_type,payload,actor_user_id)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)`,
    [
      context.organizationId,
      context.companyId,
      aggregateType,
      aggregateId,
      eventType,
      JSON.stringify(payload),
      context.userId,
    ],
  );
}

export async function getPointOfSaleDashboard(client, context) {
  requirePermission(context, "pos.view");
  const sales = await client.query(
    `SELECT
       count(*) FILTER (WHERE sale.sale_date::date=current_date AND sale.status='completed')::int AS sales_today,
       coalesce(sum(sale.grand_total)
         FILTER (WHERE sale.sale_date::date=current_date AND sale.status='completed'),0)::text AS revenue_today,
       count(*) FILTER (WHERE shift.status='open')::int AS open_shifts
     FROM tenant.pos_sales sale
     RIGHT JOIN tenant.pos_shifts shift
       ON shift.organization_id=sale.organization_id
      AND shift.id=sale.shift_id
     WHERE shift.organization_id=$1 AND shift.company_id=$2`,
    [context.organizationId, context.companyId],
  );
  const returns = await client.query(
    `SELECT count(*) FILTER (
       WHERE created_at::date=current_date
         AND status IN ('approved','completed')
     )::int AS returns_today
     FROM tenant.pos_returns
     WHERE organization_id=$1 AND company_id=$2`,
    [context.organizationId, context.companyId],
  );
  return { ...sales.rows[0], ...returns.rows[0] };
}

export async function listPointOfSaleResource(
  client,
  context,
  resource,
  { limit = 100, offset = 0, shiftId = null } = {},
) {
  requirePermission(context, "pos.view");
  const target = table(resource);
  const values = [context.organizationId, context.companyId];
  let filter = "";
  if (
    shiftId &&
    [
      "pos_sales",
      "pos_payments",
      "pos_cash_movements",
      "pos_reconciliations",
    ].includes(target)
  ) {
    values.push(shiftId);
    filter = ` AND shift_id=$${values.length}`;
  }
  values.push(Math.min(Number(limit) || 100, 200), Number(offset) || 0);
  const result = await client.query(
    `SELECT * FROM tenant.${target}
     WHERE organization_id=$1 AND company_id=$2${filter}
     ORDER BY created_at DESC NULLS LAST,id DESC
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values,
  );
  return result.rows;
}

export async function createStore(client, context, input) {
  requirePermission(context, "pos.store.manage");
  await requireCompanyRecord(client, context, "branch", input.branchId);
  await requireCompanyRecord(client, context, "warehouse", input.warehouseId);
  const result = await client.query(
    `INSERT INTO tenant.pos_stores
      (organization_id,company_id,branch_id,code,name,warehouse_id,
       price_list_id,currency_code,timezone,created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING *`,
    [
      context.organizationId,
      context.companyId,
      input.branchId,
      input.code,
      input.name,
      input.warehouseId,
      input.priceListId || null,
      input.currencyCode || "INR",
      input.timezone || "Asia/Kolkata",
      context.userId,
    ],
  );
  return result.rows[0];
}

export async function createTerminal(client, context, input) {
  requirePermission(context, "pos.terminal.manage");
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

export async function openShift(client, context, input) {
  requirePermission(context, "pos.shift.open");
  const store = await requireCompanyRecord(client, context, "pos_store", input.storeId);
  const terminal = await requireCompanyRecord(client, context, "pos_terminal", input.terminalId);
  if (terminal.store_id !== store.id) {
    const error = new Error("The POS terminal does not belong to the selected store.");
    error.status = 409;
    error.code = "POS_TERMINAL_STORE_MISMATCH";
    throw error;
  }
  const shiftNumber = input.shiftNumber || await nextDocumentNumber(client, context, {
    documentType: `pos_shift:${input.terminalId}`,
    prefix: "SHIFT",
  });
  const shift = await client.query(
    `INSERT INTO tenant.pos_shifts
      (organization_id,company_id,store_id,terminal_id,shift_number,
       cashier_user_id,status,opening_cash,expected_cash,opened_at,opened_by)
     VALUES ($1,$2,$3,$4,$5,$6,'open',$7,$7,now(),$8)
     RETURNING *`,
    [
      context.organizationId,
      context.companyId,
      input.storeId,
      input.terminalId,
      shiftNumber,
      input.cashierUserId || context.userId,
      String(input.openingCash || 0),
      context.userId,
    ],
  );
  if (Number(input.openingCash || 0) > 0) {
    const cashMovementNumber = await nextDocumentNumber(client, context, {
      documentType: "pos_cash_movement",
      prefix: "CASH",
    });
    await client.query(
      `INSERT INTO tenant.pos_cash_movements
        (organization_id,company_id,shift_id,movement_number,movement_type,
         amount,reason,created_by)
       VALUES ($1,$2,$3,$4,'opening',$5,'Opening float',$6)`,
      [
        context.organizationId,
        context.companyId,
        shift.rows[0].id,
        cashMovementNumber,
        String(input.openingCash || 0),
        context.userId,
      ],
    );
  }
  await event(client, context, "shift", shift.rows[0].id, "pos.shift.opened");
  return shift.rows[0];
}

async function stockAvailable(client, context, itemId, warehouseId) {
  const result = await client.query(
    `SELECT coalesce(sum(quantity-reserved_quantity),0)::text AS available
     FROM tenant.stock_balances
     WHERE organization_id=$1 AND company_id=$2
       AND item_id=$3 AND warehouse_id=$4`,
    [context.organizationId, context.companyId, itemId, warehouseId],
  );
  return Number(result.rows[0].available);
}

// Sale-line stock issue routes through Stock's own postStockMovement
// (services/api/src/modules/stock/index.js) rather than a local fork, so
// stock_balances and stock_valuation_layers stay authoritative after a
// completed sale — see docs/implementation/ERP_P0_INTEGRITY_FIXES_012.md
// Section 6. The augmented-permissions pattern below mirrors the existing
// precedent in stock/index.js's own completeStockTransfer(): the caller
// already passed requirePermission(context, "pos.sale.create") above, so
// this business operation is what authorizes the resulting stock
// movement — the caller does not need to separately hold stock.issue.

function posError(status, message, code) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function safeDocumentPrefix(value, fallback = "POS") {
  const normalized = String(value || fallback)
    .toUpperCase()
    .replace(/[^A-Z0-9/_-]+/g, "")
    .slice(0, 40);
  return normalized || fallback;
}

async function resolvePointOfSaleUnitPrice(client, context, shift, policy, line) {
  const requestedPrice = Number(line.unitPrice);
  if (!Number.isFinite(requestedPrice) || requestedPrice < 0) {
    throw posError(400, "POS unit price must be zero or greater.", "POS_UNIT_PRICE_INVALID");
  }

  if (line.priceOverride) {
    if (!policy.allow_price_override) {
      throw posError(409, "Price override is disabled for this company.", "POS_PRICE_OVERRIDE_DISABLED");
    }
    requirePermission(context, "pos.price.override");
    return requestedPrice;
  }

  if (!shift.price_list_id) {
    throw posError(
      409,
      "The POS store requires an active sales price list before checkout. Configure a price list or use an authorized price override.",
      "POS_PRICE_LIST_REQUIRED",
    );
  }

  const price = await client.query(
    `SELECT price_item.rate
     FROM tenant.price_list_items price_item
     JOIN tenant.price_lists price_list
       ON price_list.organization_id=price_item.organization_id
      AND price_list.id=price_item.price_list_id
     WHERE price_item.organization_id=$1
       AND price_item.price_list_id=$2
       AND price_item.item_id=$3
       AND price_item.minimum_quantity <= $4
       AND price_item.status='active'
       AND price_list.status='active'
       AND price_list.price_list_type='sales'
       AND price_list.currency_code=$5
       AND (price_item.valid_from IS NULL OR price_item.valid_from<=current_date)
       AND (price_item.valid_to IS NULL OR price_item.valid_to>=current_date)
       AND (price_list.valid_from IS NULL OR price_list.valid_from<=current_date)
       AND (price_list.valid_to IS NULL OR price_list.valid_to>=current_date)
     ORDER BY price_item.minimum_quantity DESC,price_item.valid_from DESC NULLS LAST
     LIMIT 1`,
    [context.organizationId, shift.price_list_id, line.itemId, line.quantity, shift.currency_code],
  );
  if (!price.rows[0]) {
    throw posError(409, "No active POS price exists for this item and quantity.", "POS_PRICE_NOT_FOUND");
  }
  return Number(price.rows[0].rate);
}

export async function completePointOfSale(client, context, input) {
  requirePermission(context, "pos.sale.create");
  if (!Array.isArray(input.lines) || input.lines.length === 0) {
    throw posError(400, "At least one sale line is required.", "POS_SALE_LINES_REQUIRED");
  }
  if (!Array.isArray(input.payments) || input.payments.length === 0) {
    throw posError(400, "At least one payment is required.", "POS_PAYMENT_REQUIRED");
  }

  const idempotency = await beginIdempotentOperation(client, context, {
    operation: "pos.sale.complete",
    key: input.idempotencyKey,
    payload: { ...input, idempotencyKey: undefined },
    required: true,
  });
  if (idempotency.replayed) return { ...idempotency.response, replayed: true };

  // Wave 0 deliberately fails closed for payment methods without an
  // authoritative provider adapter. A client assertion is never enough to
  // mark card/UPI/wallet/bank/store-credit money as captured.
  for (const payment of input.payments) {
    const amount = Number(payment.amount);
    if (!(amount > 0) || !Number.isFinite(amount)) {
      throw posError(400, "POS payment amount must be greater than zero.", "POS_PAYMENT_AMOUNT_INVALID");
    }
    if (payment.method !== "cash") {
      throw posError(
        409,
        `Payment method ${payment.method} is not available until an authoritative provider adapter is configured.`,
        "POS_PAYMENT_PROVIDER_NOT_CONFIGURED",
      );
    }
  }

  const shiftResult = await client.query(
    `SELECT shift.*,store.warehouse_id,store.currency_code,store.price_list_id,
            terminal.receipt_prefix
     FROM tenant.pos_shifts shift
     JOIN tenant.pos_stores store
       ON store.id=shift.store_id
      AND store.organization_id=shift.organization_id
      AND store.company_id=shift.company_id
     JOIN tenant.pos_terminals terminal
       ON terminal.id=shift.terminal_id
      AND terminal.organization_id=shift.organization_id
      AND terminal.company_id=shift.company_id
      AND terminal.store_id=shift.store_id
     WHERE shift.organization_id=$1 AND shift.company_id=$2
       AND shift.id=$3 AND shift.status='open'
       AND store.active=true AND terminal.status='active'
     FOR UPDATE`,
    [context.organizationId, context.companyId, input.shiftId],
  );
  const shift = shiftResult.rows[0];
  if (!shift) {
    throw posError(409, "An open POS shift with a valid store and terminal is required.", "POS_SHIFT_NOT_OPEN");
  }

  const settings = await client.query(
    `SELECT allow_negative_stock,allow_price_override
     FROM tenant.pos_settings
     WHERE organization_id=$1 AND company_id=$2`,
    [context.organizationId, context.companyId],
  );
  const policy = settings.rows[0] || {
    allow_negative_stock: false,
    allow_price_override: false,
  };

  let subtotal = 0;
  let discountTotal = 0;
  let taxTotal = 0;
  const normalizedLines = [];

  // pos_sale_lines.description is NOT NULL (receipts must show a real line
  // description, not a blank line) — a caller reasonably won't always
  // override it, so batch-resolve each item's own name as the default
  // rather than requiring every checkout call to repeat it. Found via
  // direct PostgreSQL testing: the prior code passed line.description
  // straight through and only ever worked because the one existing test
  // happened to always supply one.
  const itemIds = [...new Set(input.lines.map((line) => line.itemId))];
  const itemNames = await client.query(
    `SELECT id,name FROM tenant.items WHERE organization_id=$1 AND id=ANY($2::uuid[])`,
    [context.organizationId, itemIds],
  );
  const itemNameById = new Map(itemNames.rows.map((row) => [row.id, row.name]));

  for (const [index, line] of input.lines.entries()) {
    const quantity = Number(line.quantity);
    const discountAmount = Number(line.discountAmount || 0);
    const taxAmount = Number(line.taxAmount || 0);
    if (!(quantity > 0) || !Number.isFinite(quantity)) {
      throw posError(400, "POS sale quantity must be greater than zero.", "POS_SALE_QUANTITY_INVALID");
    }
    if (discountAmount < 0 || !Number.isFinite(discountAmount) || taxAmount < 0 || !Number.isFinite(taxAmount)) {
      throw posError(400, "POS discount and tax amounts cannot be negative.", "POS_SALE_AMOUNT_INVALID");
    }
    if (discountAmount > 0) requirePermission(context, "pos.discount.apply");
    if (!itemNameById.has(line.itemId)) {
      throw posError(404, "One or more POS sale items were not found.", "POS_SALE_ITEM_NOT_FOUND");
    }

    const warehouseId = line.warehouseId || shift.warehouse_id;
    const available = await stockAvailable(client, context, line.itemId, warehouseId);
    if (!policy.allow_negative_stock && available < quantity) {
      const error = posError(409, "Insufficient stock for POS sale.", "INSUFFICIENT_STOCK");
      error.itemId = line.itemId;
      throw error;
    }

    const unitPrice = await resolvePointOfSaleUnitPrice(client, context, shift, policy, {
      ...line,
      quantity,
    });
    const lineSubtotal = quantity * unitPrice;
    if (discountAmount > lineSubtotal) {
      throw posError(400, "Discount cannot exceed the line subtotal.", "POS_DISCOUNT_INVALID");
    }
    const lineTotal = lineSubtotal - discountAmount + taxAmount;
    subtotal += lineSubtotal;
    discountTotal += discountAmount;
    taxTotal += taxAmount;
    normalizedLines.push({
      ...line,
      lineNumber: index + 1,
      quantity,
      unitPrice,
      discountAmount,
      taxAmount,
      lineTotal,
      warehouseId,
      description: line.description || itemNameById.get(line.itemId),
    });
  }

  const roundingAdjustment = Number(input.roundingAdjustment || 0);
  if (!Number.isFinite(roundingAdjustment)) {
    throw posError(400, "Rounding adjustment is invalid.", "POS_ROUNDING_INVALID");
  }
  const grandTotal = subtotal - discountTotal + taxTotal + roundingAdjustment;
  if (!(grandTotal >= 0) || !Number.isFinite(grandTotal)) {
    throw posError(400, "Calculated POS sale total is invalid.", "POS_TOTAL_INVALID");
  }
  const paidTotal = input.payments.reduce((sum, payment) => sum + Number(payment.amount), 0);
  if (paidTotal < grandTotal) {
    throw posError(409, "Payment total is less than sale total.", "UNDERPAYMENT");
  }

  const receiptNumber = input.receiptNumber || await nextDocumentNumber(client, context, {
    documentType: `pos_receipt:${shift.terminal_id}`,
    prefix: safeDocumentPrefix(shift.receipt_prefix, "POS"),
  });

  const sale = await client.query(
    `INSERT INTO tenant.pos_sales
      (organization_id,company_id,store_id,terminal_id,shift_id,receipt_number,
       customer_id,customer_name,currency_code,subtotal,discount_total,tax_total,
       rounding_adjustment,grand_total,paid_total,change_total,status,
       idempotency_key,created_by,completed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
       'completed',$17,$18,now())
     RETURNING *`,
    [
      context.organizationId,
      context.companyId,
      shift.store_id,
      shift.terminal_id,
      input.shiftId,
      receiptNumber,
      input.customerId || null,
      input.customerName || null,
      input.currencyCode || shift.currency_code,
      String(subtotal),
      String(discountTotal),
      String(taxTotal),
      String(roundingAdjustment),
      String(grandTotal),
      String(paidTotal),
      String(paidTotal - grandTotal),
      input.idempotencyKey,
      context.userId,
    ],
  );

  for (const line of normalizedLines) {
    const stockMovement = await postCanonicalStockMovement(
      client,
      { ...context, permissions: [...new Set([...(context.permissions || []), "stock.issue"])] },
      {
        movementType: "issue",
        itemId: line.itemId,
        warehouseId: line.warehouseId,
        warehouseLocationId: line.warehouseLocationId,
        batchId: line.batchId,
        serialId: line.serialId,
        quantity: line.quantity,
        unitCost: line.unitCost || 0,
        referenceType: "pos_sale",
        referenceId: sale.rows[0].id,
        reason: "POS sale issue",
        idempotencyKey: `${input.idempotencyKey}:line:${line.lineNumber}`,
      },
    );

    await client.query(
      `INSERT INTO tenant.pos_sale_lines
        (organization_id,sale_id,line_number,item_id,description,quantity,
         unit_price,discount_amount,tax_amount,line_total,warehouse_id,
         warehouse_location_id,batch_id,serial_id,stock_movement_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        context.organizationId,
        sale.rows[0].id,
        line.lineNumber,
        line.itemId,
        line.description,
        String(line.quantity),
        String(line.unitPrice),
        String(line.discountAmount),
        String(line.taxAmount),
        String(line.lineTotal),
        line.warehouseId,
        line.warehouseLocationId || null,
        line.batchId || null,
        line.serialId || null,
        stockMovement.id,
      ],
    );
  }

  for (const payment of input.payments) {
    await client.query(
      `INSERT INTO tenant.pos_payments
        (organization_id,company_id,sale_id,shift_id,payment_method,amount,
         provider_reference,authorization_reference,status,captured_at,created_by)
       VALUES ($1,$2,$3,$4,'cash',$5,NULL,NULL,'captured',now(),$6)`,
      [
        context.organizationId,
        context.companyId,
        sale.rows[0].id,
        input.shiftId,
        String(payment.amount),
        context.userId,
      ],
    );
  }

  // Cash tender may exceed the sale total when change is returned. The till
  // retains only the authoritative sale total, so record one net sale cash
  // movement rather than one movement per tender line.
  if (grandTotal > 0) {
    const cashMovementNumber = await nextDocumentNumber(client, context, {
      documentType: "pos_cash_movement",
      prefix: "CASH",
    });
    await client.query(
      `INSERT INTO tenant.pos_cash_movements
        (organization_id,company_id,shift_id,movement_number,movement_type,
         amount,reference_type,reference_id,created_by)
       VALUES ($1,$2,$3,$4,'sale',$5,'pos_sale',$6,$7)`,
      [
        context.organizationId,
        context.companyId,
        input.shiftId,
        cashMovementNumber,
        String(grandTotal),
        sale.rows[0].id,
        context.userId,
      ],
    );
  }

  await event(client, context, "sale", sale.rows[0].id, "pos.sale.completed", {
    receiptNumber,
    grandTotal,
  });
  const response = { ...sale.rows[0], replayed: false };
  await completeIdempotentOperation(client, context, idempotency, {
    response,
    aggregateType: "pos_sale",
    aggregateId: sale.rows[0].id,
  });
  return response;
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
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,
       CASE WHEN $9='approved' THEN $11 ELSE NULL END,
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
    `SELECT return_record.*,sale.status AS sale_status
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

  const payments = await client.query(
    `SELECT * FROM tenant.pos_payments
     WHERE organization_id=$1 AND company_id=$2 AND sale_id=$3
       AND status IN ('captured','partially_refunded')
     ORDER BY id FOR UPDATE`,
    [context.organizationId, context.companyId, returnRecord.sale_id],
  );
  const externalPayment = payments.rows.find((payment) => payment.payment_method !== "cash");
  if (externalPayment) {
    throw posError(
      409,
      `Refund for ${externalPayment.payment_method} requires an authoritative payment-provider refund adapter.`,
      "POS_REFUND_PROVIDER_NOT_CONFIGURED",
    );
  }

  const lines = await client.query(
    `SELECT return_line.*,sale_line.quantity AS sold_quantity,
            sale_line.returned_quantity,sale_line.item_id,sale_line.warehouse_id,
            sale_line.warehouse_location_id,sale_line.batch_id,sale_line.serial_id,
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

  const refundTotal = Number(returnRecord.refund_total);
  if (refundTotal > 0) {
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
        String(-refundTotal),
        returnRecord.reason,
        returnId,
        context.userId,
      ],
    );
  }
  await client.query(
    `UPDATE tenant.pos_payments
     SET status=$4
     WHERE organization_id=$1 AND company_id=$2 AND sale_id=$3 AND payment_method='cash'
       AND status IN ('captured','partially_refunded')`,
    [
      context.organizationId,
      context.companyId,
      returnRecord.sale_id,
      fullyReturned ? "refunded" : "partially_refunded",
    ],
  );

  const completed = await client.query(
    `UPDATE tenant.pos_returns
     SET status='completed',completed_by=$4,completed_at=now()
     WHERE organization_id=$1 AND company_id=$2 AND id=$3 AND status='approved'
     RETURNING *`,
    [context.organizationId, context.companyId, returnId, context.userId],
  );
  if (!completed.rows[0]) throw posError(409, "POS return state changed before completion.", "POS_RETURN_STATE_CONFLICT");
  await event(client, context, "return", returnId, "pos.return.completed", {
    refundTotal,
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

export async function closeShift(client, context, shiftId, input) {
  requirePermission(context, "pos.shift.close");
  const shift = await client.query(
    `SELECT * FROM tenant.pos_shifts
     WHERE organization_id=$1 AND company_id=$2 AND id=$3
       AND status='open' FOR UPDATE`,
    [context.organizationId, context.companyId, shiftId],
  );
  if (!shift.rows[0]) throw posError(404, "Open shift not found.", "POS_SHIFT_NOT_OPEN");

  const cash = await client.query(
    `SELECT coalesce(sum(amount),0)::text AS expected_cash
     FROM tenant.pos_cash_movements
     WHERE organization_id=$1 AND shift_id=$2`,
    [context.organizationId, shiftId],
  );
  const expected = Number(cash.rows[0].expected_cash);
  const counted = Number(input.countedCash);
  const variance = counted - expected;

  const result = await client.query(
    `UPDATE tenant.pos_shifts
     SET status='closed',expected_cash=$4,counted_cash=$5,cash_variance=$6,
       closed_at=now(),closed_by=$7,close_notes=$8
     WHERE organization_id=$1 AND company_id=$2 AND id=$3
     RETURNING *`,
    [
      context.organizationId,
      context.companyId,
      shiftId,
      String(expected),
      String(counted),
      String(variance),
      context.userId,
      input.closeNotes || null,
    ],
  );
  await event(client, context, "shift", shiftId, "pos.shift.closed", {
    expected,
    counted,
    variance,
  });
  return result.rows[0];
}
