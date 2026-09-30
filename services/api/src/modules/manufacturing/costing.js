import { MfgError, dateOrNull, has, need, positive, uuid } from "./common.js";
import { resolveBomForItem } from "./engineering.js";

// Production costing -- standard cost, actual cost and variance -- and the dashboard (F183-F185, F192).
// Everything here is read-only over what production actually recorded. Cost figures need
// manufacturing.costing.view; the dashboard's counts do not.
const round = (n, d = 4) => Math.round(n * 10 ** d) / 10 ** d;
const iso = (d) => d.toISOString().slice(0, 10);
const seeCost = (c) => has(c, "manufacturing.costing.view");
const needCost = (c) => need(c, "manufacturing.costing.view");
const period = (input = {}, fallbackDays = 30) => {
  const to = dateOrNull(input.to, "To date") || iso(new Date());
  const from = dateOrNull(input.from, "From date") || iso(new Date(Date.parse(to) - fallbackDays * 86400000));
  if (from > to) throw new MfgError(400, "From date cannot be after the to date.", "MFG_DATE_INVALID");
  return { from, to };
};

// ---------------------------------------------------------------- standard cost (F184)
// What one unit SHOULD cost: components at their standard cost (or the stock's average when no
// standard is set).
export async function getStandardCost(client, c, { itemId, quantity = 1 } = {}) {
  needCost(c);
  const qty = positive(quantity, "Quantity");
  const bom = await resolveBomForItem(client, c, uuid(itemId, "Product"));
  if (!bom) throw new MfgError(404, "No active BOM applies to that product.", "MFG_NO_ACTIVE_BOM");
  const components = (
    await client.query(
      `SELECT component.item_id,item.code,item.name,component.quantity,component.scrap_percent,
              CASE WHEN item.standard_cost>0 THEN item.standard_cost ELSE COALESCE((SELECT sum(b.quantity*b.average_cost)/NULLIF(sum(b.quantity),0) FROM tenant.stock_balances b WHERE b.organization_id=item.organization_id AND b.company_id=$3 AND b.item_id=item.id),0) END AS price,
              (item.standard_cost>0) AS has_standard
         FROM tenant.manufacturing_bom_components component JOIN tenant.items item ON item.id=component.item_id WHERE component.organization_id=$1 AND component.bom_id=$2 ORDER BY component.line_number`,
      [c.organizationId, bom.id, c.companyId],
    )
  ).rows;
  const materialLines = components.map((k) => {
    const perUnit = (Number(k.quantity) / Number(bom.output_quantity)) / (1 - Number(k.scrap_percent) / 100);
    return { itemCode: k.code, itemName: k.name, quantityPerUnit: round(perUnit, 6), unitPrice: round(Number(k.price), 6), basis: k.has_standard ? "standard cost" : "average stock cost", cost: round(perUnit * Number(k.price) * qty) };
  });
  const material = round(materialLines.reduce((t, l) => t + l.cost, 0));
  return { bomCode: bom.code, quantity: String(qty), material: String(material), total: String(material), perUnit: String(round(material / qty)), materialLines, note: "Standard is computed from the current BOM and item standard costs; it is not stored per order." };
}

// ---------------------------------------------------------------- actual cost and variance (F183, F185)
async function completedOrders(client, c, { from, to, itemId = null }) {
  const values = [c.organizationId, c.companyId, from, to];
  let filter = "";
  if (itemId) { values.push(uuid(itemId, "Product")); filter = ` AND wo.item_id=$${values.length}`; }
  return (
    await client.query(
      `SELECT wo.id,wo.work_order_number,wo.item_id,item.code AS item_code,item.name AS item_name,wo.quantity_planned,wo.quantity_completed,wo.quantity_scrapped,wo.material_cost,wo.labor_cost,wo.overhead_cost,wo.subcontract_cost,wo.cost_absorbed,wo.actual_end_at
         FROM tenant.manufacturing_work_orders wo JOIN tenant.items item ON item.id=wo.item_id
        WHERE wo.organization_id=$1 AND wo.company_id=$2 AND wo.status='completed' AND wo.quantity_completed>0 AND wo.actual_end_at>=$3::date AND wo.actual_end_at<($4::date+1)${filter} ORDER BY wo.actual_end_at DESC LIMIT 500`,
      values,
    )
  ).rows;
}

export async function getProductionCostReport(client, c, input = {}) {
  needCost(c);
  const { from, to } = period(input);
  const orders = await completedOrders(client, c, { from, to, itemId: input.itemId });
  const lines = orders.map((o) => {
    const total = Number(o.material_cost) + Number(o.labor_cost) + Number(o.overhead_cost) + Number(o.subcontract_cost);
    return { orderId: o.id, orderNumber: o.work_order_number, itemCode: o.item_code, itemName: o.item_name, quantity: String(Number(o.quantity_completed)), material: o.material_cost, total: String(round(total)), perUnit: String(round(total / Number(o.quantity_completed))), finishedAt: o.actual_end_at };
  });
  const sum = (key) => lines.reduce((t, l) => t + Number(l[key]), 0);
  return { from, to, lines, totals: { orders: lines.length, material: String(round(sum("material"))), total: String(round(sum("total"))) } };
}

// Standard vs actual per completed order (F185), split into the variances that explain it:
//   material price   = (actual cost - actual quantity x standard price)
//   material usage   = (actual quantity - standard quantity) x standard price
// Negative is favourable (cost less than standard).
export async function getVarianceReport(client, c, input = {}) {
  needCost(c);
  const { from, to } = period(input);
  const orders = await completedOrders(client, c, { from, to, itemId: input.itemId });
  const rows = [];
  for (const o of orders) {
    const share = Number(o.quantity_completed) / Number(o.quantity_planned);
    const materials = (
      await client.query(
        `SELECT m.item_id,m.required_quantity,m.issued_quantity-m.returned_quantity AS net_qty,m.issued_cost-m.returned_cost AS actual_cost,
                CASE WHEN item.standard_cost>0 THEN item.standard_cost ELSE COALESCE((SELECT sum(b.quantity*b.average_cost)/NULLIF(sum(b.quantity),0) FROM tenant.stock_balances b WHERE b.organization_id=m.organization_id AND b.company_id=$3 AND b.item_id=m.item_id),0) END AS std_price
           FROM tenant.manufacturing_work_order_materials m JOIN tenant.items item ON item.id=m.item_id WHERE m.organization_id=$1 AND m.work_order_id=$2`,
        [c.organizationId, o.id, c.companyId],
      )
    ).rows;
    let price = 0;
    let usage = 0;
    let stdMaterial = 0;
    for (const m of materials) {
      const stdQty = Number(m.required_quantity) * share;
      const std = stdQty * Number(m.std_price);
      stdMaterial += std;
      usage += (Number(m.net_qty) - stdQty) * Number(m.std_price);
      price += Number(m.actual_cost) - Number(m.net_qty) * Number(m.std_price);
    }
    const actual = Number(o.material_cost) + Number(o.labor_cost) + Number(o.overhead_cost) + Number(o.subcontract_cost);
    const standard = stdMaterial;
    rows.push({
      orderId: o.id, orderNumber: o.work_order_number, itemCode: o.item_code, itemName: o.item_name, quantity: String(Number(o.quantity_completed)),
      standard: String(round(standard)), actual: String(round(actual)), variance: String(round(actual - standard)), variancePercent: standard ? round(((actual - standard) / standard) * 100, 1) : null,
      materialPrice: String(round(price)), materialUsage: String(round(usage)),
    });
  }
  rows.sort((a, b) => Math.abs(Number(b.variance)) - Math.abs(Number(a.variance)));
  return { from, to, lines: rows, totals: { standard: String(round(rows.reduce((t, r) => t + Number(r.standard), 0))), actual: String(round(rows.reduce((t, r) => t + Number(r.actual), 0))), variance: String(round(rows.reduce((t, r) => t + Number(r.variance), 0))) } };
}

// ---------------------------------------------------------------- dashboard (F192)
export async function getProductionDashboard(client, c) {
  need(c, "manufacturing.view");
  const today = iso(new Date());
  const counts = (await client.query(
    `SELECT count(*) FILTER (WHERE status='planned')::int AS planned,count(*) FILTER (WHERE status='released')::int AS released,count(*) FILTER (WHERE status='in_progress')::int AS in_progress,count(*) FILTER (WHERE status='on_hold')::int AS on_hold,
            count(*) FILTER (WHERE status IN ('planned','released','in_progress','on_hold') AND COALESCE(due_date,planned_end_at::date)<$3::date)::int AS late,
            count(*) FILTER (WHERE status='completed' AND actual_end_at>=now()-interval '30 days')::int AS completed_30d,
            COALESCE(sum(GREATEST(material_cost+labor_cost+overhead_cost+subcontract_cost-cost_absorbed,0)) FILTER (WHERE status IN ('released','in_progress','on_hold')),0)::text AS wip_value
       FROM tenant.manufacturing_work_orders WHERE organization_id=$1 AND company_id=$2`,
    [c.organizationId, c.companyId, today],
  )).rows[0];
  const shortages = (await client.query(
    `SELECT count(DISTINCT wo.id)::int AS orders FROM tenant.manufacturing_work_order_materials m JOIN tenant.manufacturing_work_orders wo ON wo.id=m.work_order_id
      WHERE m.organization_id=$1 AND wo.company_id=$2 AND wo.status IN ('planned','released','in_progress') AND GREATEST(m.required_quantity-(m.issued_quantity-m.returned_quantity),0) >
            COALESCE((SELECT sum(r.quantity) FROM tenant.stock_reservations r WHERE r.organization_id=m.organization_id AND r.reference_type='manufacturing_work_order' AND r.reference_id=wo.id AND r.item_id=m.item_id AND r.status='active'),0)+0.000001`,
    [c.organizationId, c.companyId],
  )).rows[0];
  const attention = (
    await client.query(
      `SELECT wo.id,wo.work_order_number,wo.status,item.code AS item_code,COALESCE(wo.due_date,wo.planned_end_at::date)::text AS due,wo.hold_reason
         FROM tenant.manufacturing_work_orders wo JOIN tenant.items item ON item.id=wo.item_id
        WHERE wo.organization_id=$1 AND wo.company_id=$2 AND wo.status IN ('planned','released','in_progress','on_hold') AND (wo.status='on_hold' OR COALESCE(wo.due_date,wo.planned_end_at::date)<$3::date)
        ORDER BY (wo.status='on_hold') DESC,COALESCE(wo.due_date,wo.planned_end_at::date) LIMIT 10`,
      [c.organizationId, c.companyId, today],
    )
  ).rows;
  return { orders: { planned: counts.planned, released: counts.released, inProgress: counts.in_progress, onHold: counts.on_hold, late: counts.late, completedLast30Days: counts.completed_30d }, ordersWithShortages: shortages.orders, wipValue: seeCost(c) ? counts.wip_value : null, attention };
}
