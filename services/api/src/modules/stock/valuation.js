import { StockError } from "./index.js";

// Valuation, aging and movement reports plus landed-cost allocation (F133-F138).
// Value is read from the FIFO layers for FIFO items (newest layers make up the quantity on hand, the
// same result as consuming the oldest first) and from the carried average / standard cost otherwise.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uuid = (value, label) => {
  if (!UUID.test(String(value || ""))) throw new StockError(400, `${label} is invalid.`, "STOCK_REFERENCE_INVALID");
  return String(value);
};
const has = (c, p) => c.roleSlugs?.includes("organization_owner") || c.roleSlugs?.includes("system_administrator") || c.permissions?.includes(p);
const need = (c, p) => {
  if (!has(c, p)) throw new StockError(403, "You do not have permission to perform this stock operation.", "STOCK_FORBIDDEN");
};
const whole = (value, fallback, max = 3650) => {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) && n >= 0 ? Math.min(n, max) : fallback;
};

// Per (item, warehouse): quantity on hand, and its value. FIFO items are valued from layers:
// walking layers newest -> oldest, each contributes min(remaining, still-needed) at its unit cost.
const POSITION_SQL = `
  WITH position AS (
    SELECT balance.item_id,balance.warehouse_id,sum(balance.quantity) AS on_hand,sum(balance.reserved_quantity) AS reserved,
           sum(balance.quantity*balance.average_cost) AS carried_value
      FROM tenant.stock_balances balance
     WHERE balance.organization_id=$1 AND balance.company_id=$2
     GROUP BY balance.item_id,balance.warehouse_id
    HAVING sum(balance.quantity)<>0
  ),
  layered AS (
    SELECT layer.item_id,layer.warehouse_id,layer.remaining_quantity,layer.unit_cost,layer.created_at,
           COALESCE(sum(layer.remaining_quantity) OVER (PARTITION BY layer.item_id,layer.warehouse_id ORDER BY layer.created_at DESC,layer.id DESC ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0) AS newer_quantity
      FROM tenant.stock_valuation_layers layer
     WHERE layer.organization_id=$1 AND layer.company_id=$2 AND layer.remaining_quantity>0
  ),
  fifo AS (
    SELECT layered.item_id,layered.warehouse_id,layered.created_at,layered.unit_cost,
           LEAST(layered.remaining_quantity,GREATEST(position.on_hand-layered.newer_quantity,0)) AS quantity
      FROM layered JOIN position ON position.item_id=layered.item_id AND position.warehouse_id=layered.warehouse_id
  )`;

export async function getStockValuationReport(client, c, { warehouseId = null, groupId = null } = {}) {
  need(c, "stock.valuation.view");
  const values = [c.organizationId, c.companyId];
  let filter = "";
  if (warehouseId) { values.push(uuid(warehouseId, "Warehouse")); filter += ` AND position.warehouse_id=$${values.length}`; }
  if (groupId) { values.push(uuid(groupId, "Category")); filter += ` AND item.group_id=$${values.length}`; }
  const { rows } = await client.query(
    `${POSITION_SQL}
     SELECT item.id AS item_id,item.code AS item_code,item.name AS item_name,warehouse.id AS warehouse_id,warehouse.name AS warehouse_name,
            CASE WHEN item.valuation_method<>'moving_average' THEN item.valuation_method ELSE COALESCE(settings.costing_method,'moving_average') END AS method,
            position.on_hand::text AS on_hand_quantity,position.reserved::text AS reserved_quantity,
            CASE WHEN CASE WHEN item.valuation_method<>'moving_average' THEN item.valuation_method ELSE COALESCE(settings.costing_method,'moving_average') END='fifo'
                 THEN COALESCE((SELECT sum(fifo.quantity*fifo.unit_cost) FROM fifo WHERE fifo.item_id=position.item_id AND fifo.warehouse_id=position.warehouse_id),position.carried_value)
                 ELSE position.carried_value END::text AS stock_value
       FROM position
       JOIN tenant.items item ON item.organization_id=$1 AND item.id=position.item_id
       JOIN tenant.warehouses warehouse ON warehouse.organization_id=$1 AND warehouse.id=position.warehouse_id
       LEFT JOIN tenant.stock_settings settings ON settings.organization_id=$1 AND settings.company_id=$2
      WHERE true${filter}
      ORDER BY item.name,warehouse.name`,
    values,
  );
  const lines = rows.map((row) => ({ ...row, unit_value: Number(row.on_hand_quantity) ? String(Number(row.stock_value) / Number(row.on_hand_quantity)) : "0" }));
  const byMethod = {};
  let total = 0;
  for (const line of lines) {
    byMethod[line.method] = (byMethod[line.method] || 0) + Number(line.stock_value);
    total += Number(line.stock_value);
  }
  return { lines, totals: { stockValue: String(total), byMethod: Object.fromEntries(Object.entries(byMethod).map(([k, v]) => [k, String(v)])) } };
}

// Aging (F138-F140): the age of what is on hand, in buckets, plus slow / dead classification.
//   slow: on hand, but not issued for `slowDays` (default 90)
//   dead: nothing at all moved for `deadDays` (default 180)
export async function getStockAgingReport(client, c, { slowDays = 90, deadDays = 180, warehouseId = null } = {}) {
  need(c, "stock.reports.view");
  const slow = whole(slowDays, 90);
  const dead = Math.max(whole(deadDays, 180), slow);
  const values = [c.organizationId, c.companyId];
  let filter = "";
  if (warehouseId) { values.push(uuid(warehouseId, "Warehouse")); filter += ` AND position.warehouse_id=$${values.length}`; }
  const { rows } = await client.query(
    `${POSITION_SQL}
     SELECT item.id AS item_id,item.code AS item_code,item.name AS item_name,warehouse.id AS warehouse_id,warehouse.name AS warehouse_name,position.on_hand::text AS on_hand_quantity,
            COALESCE(sum(fifo.quantity) FILTER (WHERE current_date-fifo.created_at::date<=30),0)::text AS age_0_30,
            COALESCE(sum(fifo.quantity) FILTER (WHERE current_date-fifo.created_at::date BETWEEN 31 AND 60),0)::text AS age_31_60,
            COALESCE(sum(fifo.quantity) FILTER (WHERE current_date-fifo.created_at::date BETWEEN 61 AND 90),0)::text AS age_61_90,
            COALESCE(sum(fifo.quantity) FILTER (WHERE current_date-fifo.created_at::date BETWEEN 91 AND 180),0)::text AS age_91_180,
            COALESCE(sum(fifo.quantity) FILTER (WHERE current_date-fifo.created_at::date BETWEEN 181 AND 365),0)::text AS age_181_365,
            COALESCE(sum(fifo.quantity) FILTER (WHERE current_date-fifo.created_at::date>365),0)::text AS age_over_365,
            COALESCE(sum(fifo.quantity*fifo.unit_cost),0)::text AS stock_value,
            (current_date-(SELECT max(m.occurred_at)::date FROM tenant.stock_movements m WHERE m.organization_id=$1 AND m.company_id=$2 AND m.item_id=position.item_id AND m.warehouse_id=position.warehouse_id AND m.movement_type='issue')) AS days_since_issue,
            (current_date-(SELECT max(m.occurred_at)::date FROM tenant.stock_movements m WHERE m.organization_id=$1 AND m.company_id=$2 AND m.item_id=position.item_id AND m.warehouse_id=position.warehouse_id)) AS days_since_movement,
            (current_date-min(fifo.created_at)::date) AS oldest_days
       FROM position
       JOIN tenant.items item ON item.organization_id=$1 AND item.id=position.item_id
       JOIN tenant.warehouses warehouse ON warehouse.organization_id=$1 AND warehouse.id=position.warehouse_id
       LEFT JOIN fifo ON fifo.item_id=position.item_id AND fifo.warehouse_id=position.warehouse_id
      WHERE position.on_hand>0${filter}
      GROUP BY item.id,item.code,item.name,warehouse.id,warehouse.name,position.item_id,position.warehouse_id,position.on_hand
      ORDER BY oldest_days DESC NULLS LAST,item.name`,
    values,
  );
  const showValue = has(c, "stock.valuation.view");
  const lines = rows.map((row) => {
    const sinceMovement = row.days_since_movement === null ? null : Number(row.days_since_movement);
    const sinceIssue = row.days_since_issue === null ? null : Number(row.days_since_issue);
    const classification = sinceMovement === null || sinceMovement >= dead ? "dead" : sinceIssue === null || sinceIssue >= slow ? "slow" : "active";
    return { ...row, stock_value: showValue ? row.stock_value : null, classification };
  });
  return { slowDays: slow, deadDays: dead, lines };
}

// Movement summary (F137): what came in, went out and was adjusted over a period, per item.
export async function getStockMovementSummary(client, c, { from = null, to = null, warehouseId = null } = {}) {
  need(c, "stock.reports.view");
  const values = [c.organizationId, c.companyId];
  let filter = "";
  const day = /^\d{4}-\d{2}-\d{2}$/;
  if (from) { if (!day.test(String(from))) throw new StockError(400, "From date is invalid.", "STOCK_DATE_INVALID"); values.push(String(from)); filter += ` AND movement.occurred_at>=$${values.length}::date`; }
  if (to) { if (!day.test(String(to))) throw new StockError(400, "To date is invalid.", "STOCK_DATE_INVALID"); values.push(String(to)); filter += ` AND movement.occurred_at<($${values.length}::date+1)`; }
  if (warehouseId) { values.push(uuid(warehouseId, "Warehouse")); filter += ` AND movement.warehouse_id=$${values.length}`; }
  const { rows } = await client.query(
    `SELECT item.id AS item_id,item.code AS item_code,item.name AS item_name,
            COALESCE(sum(movement.quantity) FILTER (WHERE movement.movement_type IN ('receipt','return') AND movement.quantity>0),0)::text AS received_quantity,
            COALESCE(-sum(movement.quantity) FILTER (WHERE movement.movement_type='issue'),0)::text AS issued_quantity,
            COALESCE(sum(movement.quantity) FILTER (WHERE movement.movement_type IN ('adjustment','count')),0)::text AS adjusted_quantity,
            COALESCE(sum(movement.quantity) FILTER (WHERE movement.movement_type='transfer'),0)::text AS transfer_quantity,
            COALESCE(sum(movement.quantity),0)::text AS net_quantity,
            COALESCE(sum(movement.cost_variance),0)::text AS cost_variance,
            count(*)::int AS movements
       FROM tenant.stock_movements movement JOIN tenant.items item ON item.organization_id=movement.organization_id AND item.id=movement.item_id
      WHERE movement.organization_id=$1 AND movement.company_id=$2${filter}
      GROUP BY item.id,item.code,item.name ORDER BY item.name`,
    values,
  );
  const showValue = has(c, "stock.valuation.view");
  return { lines: showValue ? rows : rows.map((row) => ({ ...row, cost_variance: null })) };
}

// ---------------------------------------------------------------- landed cost (F136)
export async function listStockLandedCosts(client, c) {
  need(c, "stock.valuation.view");
  const { rows } = await client.query(
    `SELECT cost.id,cost.cost_type,cost.amount::text AS amount,cost.currency_code,cost.allocation_method,cost.purchase_order_id,cost.receipt_id,cost.created_at,
            po.data->>'orderNumber' AS order_number,
            COALESCE((SELECT sum(a.capitalised_amount) FROM tenant.stock_landed_cost_allocations a WHERE a.organization_id=cost.organization_id AND a.landed_cost_id=cost.id),0)::text AS capitalised_amount,
            COALESCE((SELECT sum(a.expensed_amount) FROM tenant.stock_landed_cost_allocations a WHERE a.organization_id=cost.organization_id AND a.landed_cost_id=cost.id),0)::text AS expensed_amount,
            EXISTS (SELECT 1 FROM tenant.stock_landed_cost_allocations a WHERE a.organization_id=cost.organization_id AND a.landed_cost_id=cost.id) AS allocated
       FROM tenant.procurement_landed_costs cost
       LEFT JOIN tenant.procurement_purchase_orders po ON po.organization_id=cost.organization_id AND po.id=cost.purchase_order_id
      WHERE cost.organization_id=$1 AND cost.company_id=$2 ORDER BY cost.created_at DESC LIMIT 250`,
    [c.organizationId, c.companyId],
  );
  return rows;
}

export async function allocateStockLandedCost(client, c, landedCostId) {
  need(c, "stock.manage");
  need(c, "stock.valuation.view");
  const cost = (await client.query(`SELECT * FROM tenant.procurement_landed_costs WHERE organization_id=$1 AND company_id=$2 AND id=$3 FOR UPDATE`, [c.organizationId, c.companyId, uuid(landedCostId, "Landed cost")])).rows[0];
  if (!cost) throw new StockError(404, "Landed cost was not found.", "STOCK_LANDED_COST_NOT_FOUND");
  if (cost.status === "cancelled") throw new StockError(409, "A cancelled landed cost cannot be allocated.", "STOCK_LANDED_COST_CANCELLED");
  const already = (await client.query(`SELECT 1 FROM tenant.stock_landed_cost_allocations WHERE organization_id=$1 AND landed_cost_id=$2 LIMIT 1`, [c.organizationId, cost.id])).rows[0];
  if (already) throw new StockError(409, "This landed cost has already been allocated to stock.", "STOCK_LANDED_COST_ALLOCATED");
  const amount = Number(cost.amount);
  if (!(amount > 0)) throw new StockError(409, "Only a positive landed cost can be allocated.", "STOCK_LANDED_COST_AMOUNT_INVALID");
  const method = cost.allocation_method === "quantity" ? "quantity" : "value";

  const receiptIds = cost.receipt_id
    ? [cost.receipt_id]
    : (await client.query(`SELECT id FROM tenant.procurement_receipts WHERE organization_id=$1 AND company_id=$2 AND purchase_order_id=$3`, [c.organizationId, c.companyId, cost.purchase_order_id])).rows.map((r) => r.id);
  if (!receiptIds.length) throw new StockError(409, "There is no goods receipt to allocate this cost to yet. Receive the goods first.", "STOCK_LANDED_COST_NO_RECEIPT");
  const movements = (
    await client.query(
      `SELECT movement.id,movement.item_id,movement.warehouse_id,movement.warehouse_location_id,movement.batch_id,movement.quantity,movement.unit_cost,
              layer.id AS layer_id,layer.remaining_quantity,item.valuation_method,
              CASE WHEN item.valuation_method<>'moving_average' THEN item.valuation_method ELSE COALESCE(settings.costing_method,'moving_average') END AS method
         FROM tenant.stock_movements movement
         JOIN tenant.stock_valuation_layers layer ON layer.organization_id=movement.organization_id AND layer.movement_id=movement.id
         JOIN tenant.items item ON item.organization_id=movement.organization_id AND item.id=movement.item_id
         LEFT JOIN tenant.stock_settings settings ON settings.organization_id=movement.organization_id AND settings.company_id=movement.company_id
        WHERE movement.organization_id=$1 AND movement.company_id=$2 AND movement.reference_type='procurement_receipt' AND movement.reference_id=ANY($3::uuid[]) AND movement.quantity>0
        ORDER BY movement.occurred_at,movement.id FOR UPDATE OF layer`,
      [c.organizationId, c.companyId, receiptIds],
    )
  ).rows;
  if (!movements.length) throw new StockError(409, "The goods receipt has not posted any stock yet (it may still be awaiting approval).", "STOCK_LANDED_COST_NO_STOCK");

  const weights = movements.map((m) => (method === "quantity" ? Number(m.quantity) : Number(m.quantity) * Number(m.unit_cost)));
  const weightTotal = weights.reduce((a, b) => a + b, 0);
  if (!(weightTotal > 0)) throw new StockError(409, "The receipt has no value to allocate against; allocate by quantity instead.", "STOCK_LANDED_COST_NO_BASIS");
  let capitalisedTotal = 0;
  let expensedTotal = 0;
  let allocatedSoFar = 0;
  for (let index = 0; index < movements.length; index += 1) {
    const m = movements[index];
    // the last movement takes the rounding remainder so the shares add up to the cost exactly
    const share = index === movements.length - 1 ? Number((amount - allocatedSoFar).toFixed(6)) : Number(((amount * weights[index]) / weightTotal).toFixed(6));
    allocatedSoFar += share;
    const qty = Number(m.quantity);
    const remaining = Math.min(Number(m.remaining_quantity), qty);
    // Only the part still on hand can be capitalised; the rest belongs to stock already issued.
    // Standard-costed stock carries no landed cost: it is a variance, not inventory.
    const capitalise = m.method === "standard" ? 0 : Number((share * (remaining / qty)).toFixed(6));
    const expensed = Number((share - capitalise).toFixed(6));
    if (capitalise > 0 && remaining > 0) {
      await client.query(`UPDATE tenant.stock_valuation_layers SET unit_cost=unit_cost+$2,landed_cost_total=landed_cost_total+$3 WHERE id=$1`, [m.layer_id, capitalise / remaining, share]);
      const balance = (await client.query(`SELECT quantity FROM tenant.stock_balances WHERE organization_id=$1 AND company_id=$2 AND item_id=$3 AND warehouse_id=$4 AND warehouse_location_id IS NOT DISTINCT FROM $5 AND batch_id IS NOT DISTINCT FROM $6 FOR UPDATE`, [c.organizationId, c.companyId, m.item_id, m.warehouse_id, m.warehouse_location_id, m.batch_id])).rows[0];
      if (balance && Number(balance.quantity) > 0) {
        await client.query(`UPDATE tenant.stock_balances SET average_cost=average_cost+$7,updated_at=now() WHERE organization_id=$1 AND company_id=$2 AND item_id=$3 AND warehouse_id=$4 AND warehouse_location_id IS NOT DISTINCT FROM $5 AND batch_id IS NOT DISTINCT FROM $6`, [c.organizationId, c.companyId, m.item_id, m.warehouse_id, m.warehouse_location_id, m.batch_id, capitalise / Number(balance.quantity)]);
      }
    }
    await client.query(
      `INSERT INTO tenant.stock_landed_cost_allocations(organization_id,company_id,landed_cost_id,movement_id,method,allocated_amount,capitalised_amount,expensed_amount,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [c.organizationId, c.companyId, cost.id, m.id, method, share, capitalise, expensed, c.userId],
    );
    capitalisedTotal += capitalise;
    expensedTotal += expensed;
  }
  await client.query(`UPDATE tenant.procurement_landed_costs SET status='allocated',updated_at=now() WHERE organization_id=$1 AND id=$2`, [c.organizationId, cost.id]);
  return { landedCostId: cost.id, method, movements: movements.length, allocated: String(amount), capitalised: String(Number(capitalisedTotal.toFixed(6))), expensed: String(Number(expensedTotal.toFixed(6))) };
}
