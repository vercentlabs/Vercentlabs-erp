import { SalesError } from "./index.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const money = (value, label = "Amount") => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new SalesError(400, `${label} must be greater than zero.`, "SALES_AMOUNT_INVALID");
  return n;
};
const uuid = (value, label) => {
  if (!UUID.test(String(value || ""))) throw new SalesError(400, `${label} is invalid.`, "SALES_REFERENCE_INVALID");
  return String(value);
};
const text = (value, max = 2000) => String(value ?? "").trim().slice(0, max);
const can = (c, permission) => c.roleSlugs?.includes("organization_owner") || c.permissions?.includes(permission);
const need = (c, permission) => { if (!can(c, permission)) throw new SalesError(403, "You do not have permission to perform this Sales operation."); };
function companySql(c, values, alias = "record") {
  if (c.allowAllCompanies) return "";
  if (c.activeCompanyId) { values.push(c.activeCompanyId); return ` AND (${alias}.company_id IS NULL OR ${alias}.company_id=$${values.length})`; }
  return " AND false";
}
async function organizationUser(client, c, userId, label = "Salesperson") {
  const id = uuid(userId, label);
  const result = await client.query(
    `SELECT users.id,users.full_name
       FROM public.organization_memberships membership
       JOIN public.users users ON users.id=membership.user_id
      WHERE membership.organization_id=$1 AND membership.user_id=$2
        AND membership.status='active' AND users.status='active'
      LIMIT 1`,
    [c.organizationId, id],
  );
  if (!result.rows[0])
    throw new SalesError(409, `${label} must be an active organisation member.`, "SALES_USER_SCOPE_INVALID");
  return result.rows[0];
}
async function order(client, c, id, { lock = false } = {}) {
  const values = [c.organizationId, uuid(id, "Sales order")];
  const result = await client.query(
    `SELECT record.*,version.currency_code,version.grand_total,version.margin_amount,version.subtotal
       FROM tenant.sales_orders record
       JOIN tenant.sales_order_versions version ON version.organization_id=record.organization_id AND version.id=record.current_version_id
      WHERE record.organization_id=$1 AND record.id=$2${companySql(c, values)} LIMIT 1${lock ? " FOR UPDATE OF record" : ""}`,
    values,
  );
  if (!result.rows[0]) throw new SalesError(404, "Sales order not found.", "SALES_ORDER_NOT_FOUND");
  return result.rows[0];
}

export async function listSalesPass1Operations(client, c, { kind = "advances", limit = 100 } = {}) {
  need(c, "sales.view");
  const tables = {
    advances: "sales_advance_payments",
    adjustments: "sales_credit_adjustment_requests",
    "drop-ships": "sales_drop_ship_requests",
    "commission-rules": "sales_commission_rules",
    commissions: "sales_commission_entries",
    "pricing-rules": "sales_pricing_rules",
  };
  if (kind === "price-list-items") {
    const values = [c.organizationId];
    let itemScope = "";
    if (c.activeCompanyId) { values.push(c.activeCompanyId); itemScope = ` AND (item.company_id IS NULL OR item.company_id=$${values.length})`; }
    else if (!c.allowAllCompanies) itemScope = " AND false";
    values.push(Math.min(Math.max(Number(limit) || 100, 1), 250));
    const { rows } = await client.query(
      `SELECT pli.*,pl.code AS price_list_code,pl.name AS price_list_name,item.code AS item_code,item.name AS item_name
         FROM tenant.price_list_items pli
         JOIN tenant.price_lists pl ON pl.organization_id=pli.organization_id AND pl.id=pli.price_list_id
         JOIN tenant.items item ON item.organization_id=pli.organization_id AND item.id=pli.item_id
        WHERE pli.organization_id=$1 AND pl.price_list_type='sales'${itemScope}
        ORDER BY pli.updated_at DESC LIMIT $${values.length}`,
      values,
    );
    return rows;
  }
  // Registers that span orders: each row carries its order number and customer so
  // the register is usable on its own, and is scoped to the caller's company through
  // the order (these child tables carry no company column of their own).
  const REGISTERS = {
    "fulfillment-requests": `SELECT record.id,record.request_number,record.status,record.retry_count,record.last_error,record.requested_at,record.completed_at,record.sales_order_id,orders.sales_order_number,orders.company_id,version.currency_code,version.customer_snapshot->>'displayName' AS customer_name FROM tenant.sales_fulfillment_requests record`,
    "invoice-requests": `SELECT record.id,record.request_number,record.status,record.quantity_basis,record.retry_count,record.last_error,record.requested_at,record.completed_at,record.sales_order_id,orders.sales_order_number,orders.company_id,version.currency_code,version.grand_total,version.customer_snapshot->>'displayName' AS customer_name FROM tenant.sales_invoice_requests record`,
    returns: `SELECT record.id,record.request_number,record.status,record.reason,record.lines,record.requested_at,record.decided_at,record.decision_note,record.completed_at,record.sales_order_id,orders.sales_order_number,orders.company_id,version.customer_snapshot->>'displayName' AS customer_name FROM tenant.sales_return_requests record`,
  };
  if (REGISTERS[kind]) {
    const values = [c.organizationId];
    const scope = companySql(c, values, "orders");
    values.push(Math.min(Math.max(Number(limit) || 100, 1), 250));
    const { rows } = await client.query(
      `${REGISTERS[kind]}
         JOIN tenant.sales_orders orders ON orders.organization_id=record.organization_id AND orders.id=record.sales_order_id
         JOIN tenant.sales_order_versions version ON version.organization_id=orders.organization_id AND version.id=orders.current_version_id
        WHERE record.organization_id=$1${scope} ORDER BY record.requested_at DESC LIMIT $${values.length}`,
      values,
    );
    return rows;
  }
  const table = tables[kind];
  if (!table) throw new SalesError(404, "Unknown Sales operation resource.");
  const values = [c.organizationId];
  const scope = companySql(c, values, "record");
  const { rows } = await client.query(`SELECT * FROM tenant.${table} record WHERE record.organization_id=$1${scope} ORDER BY record.created_at DESC LIMIT $${values.length + 1}`, [...values, Math.min(Math.max(Number(limit) || 100, 1), 250)]);
  return rows;
}

export async function recordSalesAdvancePayment(client, c, input = {}) {
  need(c, "sales.invoice.request");
  const target = await order(client, c, input.salesOrderId, { lock: true });
  if (["cancelled", "closed"].includes(target.lifecycle_status)) throw new SalesError(409, "Advance payments cannot be added to a closed or cancelled order.", "SALES_ADVANCE_ORDER_CLOSED");
  const amount = money(input.amount);
  const existing = await client.query(`SELECT COALESCE(sum(amount),0)::numeric AS total FROM tenant.sales_advance_payments WHERE organization_id=$1 AND sales_order_id=$2 AND status IN ('recorded','applied')`, [c.organizationId, target.id]);
  if (Number(existing.rows[0]?.total || 0) + amount > Number(target.grand_total) + 0.000001)
    throw new SalesError(409, "Advance payments cannot exceed the Sales order total.", "SALES_ADVANCE_EXCEEDS_ORDER");
  const reference = text(input.paymentReference, 200);
  if (!reference) throw new SalesError(400, "Payment reference is required.", "SALES_ADVANCE_REFERENCE_REQUIRED");
  const result = await client.query(`INSERT INTO tenant.sales_advance_payments(organization_id,company_id,sales_order_id,amount,currency_code,payment_reference,received_at,note,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,COALESCE($7::timestamptz,now()),$8,$9,$9) RETURNING *`, [c.organizationId,target.company_id,target.id,amount,target.currency_code,reference,input.receivedAt || null,text(input.note,2000)||null,c.userId]);
  return result.rows[0];
}

export async function requestSalesCreditAdjustment(client, c, input = {}) {
  need(c, "sales.invoice.request");
  const target = await order(client, c, input.salesOrderId);
  const type = String(input.adjustmentType || "").toLowerCase();
  if (!new Set(["credit_note", "refund"]).has(type)) throw new SalesError(400, "Adjustment type must be credit_note or refund.", "SALES_ADJUSTMENT_TYPE_INVALID");
  const amount = money(input.amount);
  if (amount > Number(target.grand_total) + 0.000001) throw new SalesError(409, "Adjustment cannot exceed the Sales order total.", "SALES_ADJUSTMENT_EXCEEDS_ORDER");
  const reason = text(input.reason, 2000);
  if (!reason) throw new SalesError(400, "Adjustment reason is required.", "SALES_ADJUSTMENT_REASON_REQUIRED");
  const result = await client.query(`INSERT INTO tenant.sales_credit_adjustment_requests(organization_id,company_id,sales_order_id,return_request_id,adjustment_type,amount,currency_code,reason,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$9) RETURNING *`, [c.organizationId,target.company_id,target.id,input.returnRequestId ? uuid(input.returnRequestId,"Return request") : null,type,amount,target.currency_code,reason,c.userId]);
  return result.rows[0];
}

export async function createSalesDropShipRequest(client, c, input = {}) {
  need(c, "sales.fulfillment.request");
  const target = await order(client, c, input.salesOrderId);
  if (!new Set(["confirmed", "on_hold"]).has(target.lifecycle_status)) throw new SalesError(409, "Only confirmed Sales orders can create drop-ship requests.", "SALES_DROP_SHIP_ORDER_INVALID");
  const lineId = uuid(input.salesOrderLineId, "Sales order line");
  const line = await client.query(`SELECT line.* FROM tenant.sales_order_lines line WHERE line.organization_id=$1 AND line.sales_order_version_id=$2 AND line.id=$3`, [c.organizationId,target.current_version_id,lineId]);
  if (!line.rows[0]) throw new SalesError(409, "Sales order line does not belong to the current order version.", "SALES_DROP_SHIP_LINE_INVALID");
  const quantity = money(input.quantity, "Quantity");
  if (quantity > Number(line.rows[0].quantity) + 0.000001) throw new SalesError(409, "Drop-ship quantity exceeds the order line quantity.", "SALES_DROP_SHIP_QUANTITY_INVALID");
  const supplierId = uuid(input.supplierId, "Supplier");
  const key = text(input.idempotencyKey, 200) || null;
  if (key) {
    const replay = await client.query(`SELECT * FROM tenant.sales_drop_ship_requests WHERE organization_id=$1 AND idempotency_key=$2`, [c.organizationId,key]);
    if (replay.rows[0]) return replay.rows[0];
  }
  const result = await client.query(`INSERT INTO tenant.sales_drop_ship_requests(organization_id,company_id,sales_order_id,sales_order_line_id,supplier_id,quantity,ship_to_address_id,idempotency_key,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$9) RETURNING *`, [c.organizationId,target.company_id,target.id,lineId,supplierId,quantity,input.shipToAddressId ? uuid(input.shipToAddressId,"Ship-to address") : null,key,c.userId]);
  return result.rows[0];
}

export async function createSalesCommissionRule(client, c, input = {}) {
  need(c, "sales.settings.manage");
  const companyId = input.companyId || c.activeCompanyId || null;
  if (!companyId && !c.allowAllCompanies) throw new SalesError(403, "Select an active company first.");
  const rate = Number(input.ratePercent);
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) throw new SalesError(400, "Commission rate must be between 0 and 100.", "SALES_COMMISSION_RATE_INVALID");
  const basis = String(input.basis || "net_sales");
  if (!new Set(["net_sales", "gross_margin"]).has(basis)) throw new SalesError(400, "Commission basis is invalid.");
  const name = text(input.name, 200); if (!name) throw new SalesError(400, "Commission rule name is required.");
  const ownerUserId = input.ownerUserId ? (await organizationUser(client, c, input.ownerUserId)).id : null;
  const result = await client.query(`INSERT INTO tenant.sales_commission_rules(organization_id,company_id,name,owner_user_id,rate_percent,basis,valid_from,valid_to,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$9) RETURNING *`, [c.organizationId,companyId,name,ownerUserId,rate,basis,input.validFrom||null,input.validTo||null,c.userId]);
  return result.rows[0];
}

export async function accrueSalesCommission(client, c, input = {}) {
  need(c, "sales.settings.manage");
  const target = await order(client, c, input.salesOrderId);
  const ownerUserId = input.ownerUserId
    ? (await organizationUser(client, c, input.ownerUserId)).id
    : target.owner_user_id
      ? (await organizationUser(client, c, target.owner_user_id)).id
      : null;
  if (!ownerUserId)
    throw new SalesError(409, "Select a salesperson before accruing commission.", "SALES_COMMISSION_OWNER_REQUIRED");
  const found = input.ruleId
    ? await client.query(`SELECT * FROM tenant.sales_commission_rules WHERE organization_id=$1 AND id=$2 AND status='active' AND (company_id IS NULL OR company_id=$3)`, [c.organizationId,uuid(input.ruleId,"Commission rule"),target.company_id])
    : await client.query(`SELECT * FROM tenant.sales_commission_rules WHERE organization_id=$1 AND status='active' AND (company_id IS NULL OR company_id=$2) AND (owner_user_id IS NULL OR owner_user_id=$3) AND (valid_from IS NULL OR valid_from<=current_date) AND (valid_to IS NULL OR valid_to>=current_date) ORDER BY owner_user_id NULLS LAST,created_at DESC LIMIT 1`, [c.organizationId,target.company_id,ownerUserId]);
  const rule = found.rows[0]; if (!rule) throw new SalesError(409, "No active commission rule applies to this order.", "SALES_COMMISSION_RULE_REQUIRED");
  const basisAmount = rule.basis === "gross_margin" ? Number(target.margin_amount) : Number(target.subtotal);
  const commission = Math.round((basisAmount * Number(rule.rate_percent) / 100) * 1e6) / 1e6;
  const result = await client.query(`INSERT INTO tenant.sales_commission_entries(organization_id,company_id,sales_order_id,rule_id,owner_user_id,basis_amount,rate_percent,commission_amount,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$9) ON CONFLICT(organization_id,sales_order_id,owner_user_id,rule_id) DO UPDATE SET basis_amount=EXCLUDED.basis_amount,rate_percent=EXCLUDED.rate_percent,commission_amount=EXCLUDED.commission_amount,updated_by=EXCLUDED.updated_by,updated_at=now() RETURNING *`, [c.organizationId,target.company_id,target.id,rule.id,ownerUserId,basisAmount,rule.rate_percent,commission,c.userId]);
  return result.rows[0];
}

export async function upsertSalesPriceListItem(client, c, input = {}) {
  need(c, "sales.settings.manage");
  const priceListId = uuid(input.priceListId, "Price list");
  const itemId = uuid(input.itemId, "Item");
  const minimumQuantity = Number(input.minimumQuantity ?? 1);
  const rate = Number(input.rate);
  if (!Number.isFinite(minimumQuantity) || minimumQuantity <= 0)
    throw new SalesError(400, "Minimum quantity must be greater than zero.", "SALES_PRICE_LIST_MIN_QTY_INVALID");
  if (!Number.isFinite(rate) || rate < 0)
    throw new SalesError(400, "Price-list rate cannot be negative.", "SALES_PRICE_LIST_RATE_INVALID");
  const validFrom = input.validFrom || null;
  const validTo = input.validTo || null;
  if (validFrom && validTo && String(validFrom) > String(validTo))
    throw new SalesError(400, "Price-list valid-from date cannot be after valid-to date.", "SALES_PRICE_LIST_DATE_INVALID");
  const priceList = await client.query(
    `SELECT id FROM tenant.price_lists WHERE organization_id=$1 AND id=$2 AND price_list_type='sales' AND status='active'`,
    [c.organizationId, priceListId],
  );
  if (!priceList.rows[0]) throw new SalesError(404, "Active Sales price list not found.", "SALES_PRICE_LIST_NOT_FOUND");
  const item = await client.query(
    `SELECT id,company_id,uom_id FROM tenant.items WHERE organization_id=$1 AND id=$2 AND status='active'`,
    [c.organizationId, itemId],
  );
  if (!item.rows[0] || (item.rows[0].company_id && c.activeCompanyId && item.rows[0].company_id !== c.activeCompanyId))
    throw new SalesError(404, "Active item not found in the current Sales company context.", "SALES_PRICE_ITEM_NOT_FOUND");
  const uomId = input.uomId ? uuid(input.uomId, "UOM") : null;
  if (uomId) {
    const uom = await client.query(`SELECT id FROM tenant.units_of_measure WHERE organization_id=$1 AND id=$2 AND status='active'`, [c.organizationId, uomId]);
    if (!uom.rows[0]) throw new SalesError(409, "Selected UOM is not active.", "SALES_PRICE_UOM_INVALID");
  }
  // F274 gap closure (POS Completion Program): an optional variant scopes
  // this rate to one specific variant of the item (e.g. a Large vs. a
  // Small) rather than every variant generically -- POS's own price
  // resolver (cart-pricing.js) already prefers a variant-specific row
  // over a generic one when both exist. Sales itself never sets this
  // (Sales has no variant concept on its own lines); reused here rather
  // than building a second, POS-owned price-list surface.
  const variantId = input.variantId ? uuid(input.variantId, "Variant") : null;
  if (variantId) {
    const variant = await client.query(`SELECT id FROM tenant.item_variants WHERE organization_id=$1 AND id=$2 AND item_id=$3 AND status='active'`, [
      c.organizationId,
      variantId,
      itemId,
    ]);
    if (!variant.rows[0]) throw new SalesError(404, "Active variant not found for this item.", "SALES_PRICE_VARIANT_NOT_FOUND");
  }
  const existing = await client.query(
    `SELECT id FROM tenant.price_list_items WHERE organization_id=$1 AND price_list_id=$2 AND item_id=$3
      AND uom_id IS NOT DISTINCT FROM $4 AND minimum_quantity=$5 AND valid_from IS NOT DISTINCT FROM $6::date
      AND variant_id IS NOT DISTINCT FROM $7
      ORDER BY updated_at DESC LIMIT 1 FOR UPDATE`,
    [c.organizationId, priceListId, itemId, uomId, minimumQuantity, validFrom, variantId],
  );
  if (existing.rows[0]) {
    const updated = await client.query(
      `UPDATE tenant.price_list_items SET rate=$4,valid_to=$5,status='active',updated_by=$6,updated_at=now()
        WHERE organization_id=$1 AND id=$2 AND price_list_id=$3 RETURNING *`,
      [c.organizationId, existing.rows[0].id, priceListId, rate, validTo, c.userId],
    );
    return updated.rows[0];
  }
  const created = await client.query(
    `INSERT INTO tenant.price_list_items(organization_id,price_list_id,item_id,uom_id,minimum_quantity,rate,valid_from,valid_to,status,created_by,updated_by,variant_id)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,'active',$9,$9,$10) RETURNING *`,
    [c.organizationId, priceListId, itemId, uomId, minimumQuantity, rate, validFrom, validTo, c.userId, variantId],
  );
  return created.rows[0];
}

export async function upsertSalesCustomerPrice(client, c, input = {}) {
  need(c, "sales.settings.manage");
  const partyId = uuid(input.partyId, "Customer");
  const itemId = uuid(input.itemId, "Item");
  const minimumQuantity = Number(input.minimumQuantity ?? 0);
  const fixedRate = Number(input.fixedRate);
  if (!Number.isFinite(minimumQuantity) || minimumQuantity < 0)
    throw new SalesError(400, "Minimum quantity cannot be negative.", "SALES_CUSTOMER_PRICE_MIN_QTY_INVALID");
  if (!Number.isFinite(fixedRate) || fixedRate < 0)
    throw new SalesError(400, "Customer price cannot be negative.", "SALES_CUSTOMER_PRICE_RATE_INVALID");
  const partyValues = [c.organizationId, partyId];
  let partyScope = "";
  if (c.activeCompanyId) { partyValues.push(c.activeCompanyId); partyScope = ` AND (company_id IS NULL OR company_id=$${partyValues.length})`; }
  else if (!c.allowAllCompanies) partyScope = " AND false";
  const party = await client.query(
    `SELECT id,company_id,display_name FROM tenant.business_parties WHERE organization_id=$1 AND id=$2${partyScope} AND status='active' AND party_type IN ('customer','both')`,
    partyValues,
  );
  if (!party.rows[0]) throw new SalesError(404, "Active customer not found in the current Sales company context.", "SALES_CUSTOMER_PRICE_PARTY_NOT_FOUND");
  const item = await client.query(`SELECT id,company_id FROM tenant.items WHERE organization_id=$1 AND id=$2 AND status='active'`, [c.organizationId,itemId]);
  if (!item.rows[0] || (item.rows[0].company_id && c.activeCompanyId && item.rows[0].company_id !== c.activeCompanyId))
    throw new SalesError(404, "Active item not found in the current Sales company context.", "SALES_CUSTOMER_PRICE_ITEM_NOT_FOUND");
  const priceListId = input.priceListId ? uuid(input.priceListId, "Price list") : null;
  if (priceListId) {
    const pl = await client.query(`SELECT id FROM tenant.price_lists WHERE organization_id=$1 AND id=$2 AND price_list_type='sales' AND status='active'`, [c.organizationId,priceListId]);
    if (!pl.rows[0]) throw new SalesError(409, "Selected Sales price list is not active.", "SALES_CUSTOMER_PRICE_LIST_INVALID");
  }
  const validFrom = input.validFrom || null;
  const validTo = input.validTo || null;
  if (validFrom && validTo && String(validFrom) > String(validTo))
    throw new SalesError(400, "Customer-price valid-from date cannot be after valid-to date.", "SALES_CUSTOMER_PRICE_DATE_INVALID");
  // A standing negotiated price applies to every future order for this
  // customer/item - higher blast radius than the one-off manual line
  // override, which already requires a reason. Same discipline here.
  const reason = text(input.reason, 2000);
  if (!reason) throw new SalesError(400, "A reason is required to set a customer-specific price.", "SALES_CUSTOMER_PRICE_REASON_REQUIRED");
  const companyId = party.rows[0].company_id || c.activeCompanyId || null;
  const existing = await client.query(
    `SELECT id,code FROM tenant.sales_pricing_rules WHERE organization_id=$1 AND party_id=$2 AND item_id=$3
       AND price_list_id IS NOT DISTINCT FROM $4 AND minimum_quantity=$5 AND adjustment_type='fixed_rate' AND status='active'
       ORDER BY priority,id LIMIT 1 FOR UPDATE`,
    [c.organizationId,partyId,itemId,priceListId,minimumQuantity],
  );
  if (existing.rows[0]) {
    const updated = await client.query(
      `UPDATE tenant.sales_pricing_rules SET company_id=$3,name=$4,adjustment_value=$5,valid_from=$6,valid_to=$7,reason=$8,updated_by=$9,updated_at=now()
        WHERE organization_id=$1 AND id=$2 RETURNING *`,
      [c.organizationId,existing.rows[0].id,companyId,`Customer price · ${party.rows[0].display_name}`,fixedRate,validFrom,validTo,reason,c.userId],
    );
    return updated.rows[0];
  }
  const created = await client.query(
    `INSERT INTO tenant.sales_pricing_rules(organization_id,company_id,code,name,priority,party_id,party_type,item_id,price_list_id,minimum_quantity,adjustment_type,adjustment_value,valid_from,valid_to,reason,status,created_by,updated_by)
     VALUES($1,$2,'CUST-'||upper(substr(replace($3::text,'-',''),1,8))||'-'||upper(substr(replace($4::text,'-',''),1,8))||'-'||to_char(clock_timestamp(),'YYMMDDHH24MISSMS'),$5,10,$3,'customer',$4,$6,$7,'fixed_rate',$8,$9,$10,$11,'active',$12,$12) RETURNING *`,
    [c.organizationId,companyId,partyId,itemId,`Customer price · ${party.rows[0].display_name}`,priceListId,minimumQuantity,fixedRate,validFrom,validTo,reason,c.userId],
  );
  return created.rows[0];
}

export async function deactivateSalesPriceListItem(client, c, priceListItemId) {
  need(c, "sales.settings.manage");
  const id = uuid(priceListItemId, "Price-list item");
  const result = await client.query(
    `UPDATE tenant.price_list_items SET status='inactive',updated_by=$3,updated_at=now()
      WHERE organization_id=$1 AND id=$2
      RETURNING id,status`,
    [c.organizationId, id, c.userId],
  );
  if (!result.rows[0]) throw new SalesError(404, "Price-list item not found.", "SALES_PRICE_LIST_ITEM_NOT_FOUND");
  return result.rows[0];
}

export async function deactivateSalesPricingRule(client, c, pricingRuleId) {
  need(c, "sales.settings.manage");
  const id = uuid(pricingRuleId, "Pricing rule");
  const values = [c.organizationId, id];
  const scope = companySql(c, values, "record");
  values.push(c.userId);
  const userIdParam = values.length;
  const result = await client.query(
    `UPDATE tenant.sales_pricing_rules record SET status='inactive',updated_by=$${userIdParam},updated_at=now()
      WHERE record.organization_id=$1 AND record.id=$2${scope}
      RETURNING record.id,record.status`,
    values,
  );
  if (!result.rows[0]) throw new SalesError(404, "Pricing rule not found.", "SALES_PRICING_RULE_NOT_FOUND");
  return result.rows[0];
}

export async function listSalesPass1Options(client, c) {
  need(c, "sales.view");
  const values = [c.organizationId];
  const scope = companySql(c, values, "record");
  const orders = await client.query(
    `SELECT record.id,record.sales_order_number,record.owner_user_id,record.lifecycle_status,record.current_version_id,
            version.currency_code,version.grand_total
       FROM tenant.sales_orders record
       JOIN tenant.sales_order_versions version ON version.organization_id=record.organization_id AND version.id=record.current_version_id
      WHERE record.organization_id=$1${scope} AND record.lifecycle_status NOT IN ('cancelled')
      ORDER BY record.updated_at DESC LIMIT 100`, values);
  const lines = orders.rows.length ? await client.query(
    `SELECT line.id,line.sales_order_version_id,line.item_name_snapshot,line.item_code_snapshot,line.quantity
       FROM tenant.sales_order_lines line
      WHERE line.organization_id=$1 AND line.sales_order_version_id=ANY($2::uuid[])
      ORDER BY line.sales_order_version_id,line.sequence`, [c.organizationId, orders.rows.map((row)=>row.current_version_id)]) : { rows: [] };
  const ruleValues = [c.organizationId];
  const ruleScope = companySql(c, ruleValues, "record");
  const rules = await client.query(
    `SELECT record.id,record.name,record.owner_user_id,record.rate_percent,record.basis FROM tenant.sales_commission_rules record WHERE record.organization_id=$1${ruleScope} AND record.status='active' ORDER BY record.name LIMIT 100`, ruleValues);
  const [priceLists, items, customers, uoms, users, suppliers] = await Promise.all([
    client.query(`SELECT id,code,name,currency_code FROM tenant.price_lists WHERE organization_id=$1 AND price_list_type='sales' AND status='active' ORDER BY name LIMIT 200`, [c.organizationId]),
    client.query(`SELECT id,code,name,uom_id,company_id FROM tenant.items WHERE organization_id=$1 AND status='active' AND ($2::uuid IS NULL OR company_id IS NULL OR company_id=$2) ORDER BY name LIMIT 500`, [c.organizationId,c.activeCompanyId || null]),
    client.query(`SELECT id,code,display_name,company_id FROM tenant.business_parties WHERE organization_id=$1 AND status='active' AND party_type IN ('customer','both') AND ($2::uuid IS NULL OR company_id IS NULL OR company_id=$2) ORDER BY display_name LIMIT 500`, [c.organizationId,c.activeCompanyId || null]),
    client.query(`SELECT id,code,name FROM tenant.units_of_measure WHERE organization_id=$1 AND status='active' ORDER BY name LIMIT 200`, [c.organizationId]),
    client.query(
      `SELECT users.id,users.full_name AS name
         FROM public.organization_memberships membership
         JOIN public.users users ON users.id=membership.user_id
        WHERE membership.organization_id=$1 AND membership.status='active' AND users.status='active'
        ORDER BY users.full_name LIMIT 500`,
      [c.organizationId],
    ),
    client.query(`SELECT id,code,display_name FROM tenant.business_parties WHERE organization_id=$1 AND status='active' AND party_type IN ('supplier','both') ORDER BY display_name LIMIT 500`, [c.organizationId]),
  ]);
  return { orders: orders.rows, lines: lines.rows, commissionRules: rules.rows, priceLists: priceLists.rows, items: items.rows, customers: customers.rows, uoms: uoms.rows, users: users.rows, suppliers: suppliers.rows };
}

export async function getSalesOrderLineReservationContext(client,c,input={}){
  need(c,"sales.fulfillment.request");
  const target=await order(client,c,input.salesOrderId);
  if(target.lifecycle_status!=="confirmed")throw new SalesError(409,"Only confirmed Sales orders can reserve stock.","SALES_ORDER_RESERVATION_STATE_INVALID");
  const lineId=uuid(input.salesOrderLineId,"Sales order line");
  const result=await client.query(`SELECT line.id,line.item_id,line.warehouse_id,line.quantity,progress.reserved_quantity,progress.fulfilled_quantity,progress.cancelled_quantity,progress.confirmed_quantity FROM tenant.sales_order_lines line JOIN tenant.sales_order_line_progress progress ON progress.organization_id=line.organization_id AND progress.sales_order_line_id=line.id WHERE line.organization_id=$1 AND line.sales_order_version_id=$2 AND line.id=$3`,[c.organizationId,target.current_version_id,lineId]);
  const line=result.rows[0];if(!line)throw new SalesError(404,"Sales order line was not found in the current order version.");
  if(!line.warehouse_id)throw new SalesError(409,"Select a warehouse on the Sales order line before checking or reserving stock.","SALES_ORDER_WAREHOUSE_REQUIRED");
  const remaining=Number(line.confirmed_quantity)-Number(line.fulfilled_quantity)-Number(line.cancelled_quantity)-Number(line.reserved_quantity);
  return {orderId:target.id,companyId:target.company_id,lineId:line.id,itemId:line.item_id,warehouseId:line.warehouse_id,lineQuantity:Number(line.quantity),reservedQuantity:Number(line.reserved_quantity),remainingReservableQuantity:Math.max(0,remaining)};
}
