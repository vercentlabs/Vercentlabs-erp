import { randomUUID } from "node:crypto";

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
      input.shiftNumber || `SHIFT-${Date.now()}`,
      input.cashierUserId || context.userId,
      String(input.openingCash || 0),
      context.userId,
    ],
  );
  if (Number(input.openingCash || 0) > 0) {
    await client.query(
      `INSERT INTO tenant.pos_cash_movements
        (organization_id,company_id,shift_id,movement_number,movement_type,
         amount,reason,created_by)
       VALUES ($1,$2,$3,$4,'opening',$5,'Opening float',$6)`,
      [
        context.organizationId,
        context.companyId,
        shift.rows[0].id,
        `CASH-${randomUUID()}`,
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

export async function completePointOfSale(client, context, input) {
  requirePermission(context, "pos.sale.create");
  if (!Array.isArray(input.lines) || input.lines.length === 0) {
    throw new Error("At least one sale line is required.");
  }
  if (!Array.isArray(input.payments) || input.payments.length === 0) {
    throw new Error("At least one payment is required.");
  }

  const shift = await client.query(
    `SELECT shift.*,store.warehouse_id,store.currency_code,terminal.receipt_prefix
     FROM tenant.pos_shifts shift
     JOIN tenant.pos_stores store ON store.id=shift.store_id
     JOIN tenant.pos_terminals terminal ON terminal.id=shift.terminal_id
     WHERE shift.organization_id=$1 AND shift.company_id=$2
       AND shift.id=$3 AND shift.status='open'
     FOR UPDATE`,
    [context.organizationId, context.companyId, input.shiftId],
  );
  if (!shift.rows[0]) throw new Error("An open POS shift is required.");

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

  for (const [index, line] of input.lines.entries()) {
    const quantity = Number(line.quantity);
    const unitPrice = Number(line.unitPrice);
    const discountAmount = Number(line.discountAmount || 0);
    const taxAmount = Number(line.taxAmount || 0);
    if (!(quantity > 0) || unitPrice < 0) throw new Error("Invalid sale line.");
    if (line.priceOverride && !policy.allow_price_override) {
      requirePermission(context, "pos.price.override");
    }
    const warehouseId = line.warehouseId || shift.rows[0].warehouse_id;
    const available = await stockAvailable(
      client,
      context,
      line.itemId,
      warehouseId,
    );
    if (!policy.allow_negative_stock && available < quantity) {
      const error = new Error("Insufficient stock for POS sale.");
      error.code = "INSUFFICIENT_STOCK";
      error.itemId = line.itemId;
      throw error;
    }
    const lineSubtotal = quantity * unitPrice;
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
    });
  }

  const roundingAdjustment = Number(input.roundingAdjustment || 0);
  const grandTotal = subtotal - discountTotal + taxTotal + roundingAdjustment;
  const paidTotal = input.payments.reduce(
    (sum, payment) => sum + Number(payment.amount),
    0,
  );
  if (paidTotal < grandTotal) {
    const error = new Error("Payment total is less than sale total.");
    error.code = "UNDERPAYMENT";
    throw error;
  }

  const receiptNumber =
    input.receiptNumber || `${shift.rows[0].receipt_prefix}-${Date.now()}`;

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
      shift.rows[0].store_id,
      shift.rows[0].terminal_id,
      input.shiftId,
      receiptNumber,
      input.customerId || null,
      input.customerName || null,
      input.currencyCode || shift.rows[0].currency_code,
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
      { ...context, permissions: [...(context.permissions || []), "stock.issue"] },
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
    const movementId = stockMovement.id;

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
        movementId,
      ],
    );
  }

  for (const payment of input.payments) {
    await client.query(
      `INSERT INTO tenant.pos_payments
        (organization_id,company_id,sale_id,shift_id,payment_method,amount,
         provider_reference,authorization_reference,status,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'captured',$9)`,
      [
        context.organizationId,
        context.companyId,
        sale.rows[0].id,
        input.shiftId,
        payment.method,
        String(payment.amount),
        payment.providerReference || null,
        payment.authorizationReference || null,
        context.userId,
      ],
    );
    if (payment.method === "cash") {
      await client.query(
        `INSERT INTO tenant.pos_cash_movements
          (organization_id,company_id,shift_id,movement_number,movement_type,
           amount,reference_type,reference_id,created_by)
         VALUES ($1,$2,$3,$4,'sale',$5,'pos_sale',$6,$7)`,
        [
          context.organizationId,
          context.companyId,
          input.shiftId,
          `CASH-${randomUUID()}`,
          String(Math.min(Number(payment.amount), grandTotal)),
          sale.rows[0].id,
          context.userId,
        ],
      );
    }
  }

  await event(client, context, "sale", sale.rows[0].id, "pos.sale.completed", {
    receiptNumber,
    grandTotal,
  });
  return sale.rows[0];
}

export async function createPointOfSaleReturn(client, context, input) {
  requirePermission(context, "pos.return.create");
  const sale = await client.query(
    `SELECT * FROM tenant.pos_sales
     WHERE organization_id=$1 AND company_id=$2 AND id=$3
       AND status IN ('completed','partially_returned')
     FOR UPDATE`,
    [context.organizationId, context.companyId, input.saleId],
  );
  if (!sale.rows[0]) throw new Error("Eligible sale not found.");

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

  const status = policy.require_return_approval
    ? "pending_approval"
    : "approved";

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
      sale.rows[0].store_id,
      sale.rows[0].terminal_id,
      sale.rows[0].shift_id,
      sale.rows[0].id,
      input.returnNumber || `RET-${Date.now()}`,
      input.reason,
      status,
      String(input.refundTotal),
      context.userId,
    ],
  );

  for (const line of input.lines) {
    await client.query(
      `INSERT INTO tenant.pos_return_lines
        (organization_id,return_id,sale_line_id,quantity,refund_amount,restock)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        context.organizationId,
        result.rows[0].id,
        line.saleLineId,
        String(line.quantity),
        String(line.refundAmount),
        line.restock !== false,
      ],
    );
  }

  await event(
    client,
    context,
    "return",
    result.rows[0].id,
    "pos.return.created",
  );
  return result.rows[0];
}

export async function closeShift(client, context, shiftId, input) {
  requirePermission(context, "pos.shift.close");
  const shift = await client.query(
    `SELECT * FROM tenant.pos_shifts
     WHERE organization_id=$1 AND company_id=$2 AND id=$3
       AND status='open' FOR UPDATE`,
    [context.organizationId, context.companyId, shiftId],
  );
  if (!shift.rows[0]) throw new Error("Open shift not found.");

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
