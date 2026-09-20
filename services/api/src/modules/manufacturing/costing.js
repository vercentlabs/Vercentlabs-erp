import { MfgError, dateOrNull, has, need, positive, uuid } from "./common.js";
import { resolveBomForItem } from "./engineering.js";
import { getCapacityPlan } from "./routing.js";

// Costing, variance, yield, efficiency, reports and the dashboard (F183-F187, F191, F192).
// Everything here is read-only over what production actually recorded. Cost figures need
// manufacturing.costing.view; quantities, yield and efficiency do not.
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
// standard is set), and routing time at the work center's labour and machine rates.
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
  const routing = (await client.query(`SELECT id FROM tenant.manufacturing_routings WHERE organization_id=$1 AND company_id=$2 AND item_id=$3 AND status='active' AND is_default LIMIT 1`, [c.organizationId, c.companyId, bom.item_id])).rows[0];
  const ops = routing
    ? (await client.query(`SELECT o.sequence,o.name,o.setup_minutes,o.queue_minutes,o.move_minutes,o.run_minutes_per_unit,COALESCE(wc.hourly_rate,0) AS hourly_rate,COALESCE(wc.overhead_rate,0) AS overhead_rate FROM tenant.manufacturing_routing_operations o LEFT JOIN tenant.manufacturing_work_centers wc ON wc.id=o.work_center_id WHERE o.organization_id=$1 AND o.routing_id=$2 ORDER BY o.sequence`, [c.organizationId, routing.id])).rows
    : [];
  const operationLines = ops.map((o) => {
    const minutes = Number(o.setup_minutes) + Number(o.queue_minutes) + Number(o.move_minutes) + Number(o.run_minutes_per_unit) * qty;
    return { sequence: o.sequence, name: o.name, minutes: round(minutes, 2), labor: round((minutes / 60) * Number(o.hourly_rate)), overhead: round((minutes / 60) * Number(o.overhead_rate)) };
  });
  const material = round(materialLines.reduce((t, l) => t + l.cost, 0));
  const labor = round(operationLines.reduce((t, l) => t + l.labor, 0));
  const overhead = round(operationLines.reduce((t, l) => t + l.overhead, 0));
  return { bomCode: bom.code, quantity: String(qty), material: String(material), labor: String(labor), overhead: String(overhead), total: String(round(material + labor + overhead)), perUnit: String(round((material + labor + overhead) / qty)), materialLines, operationLines, note: "Standard is computed from the current BOM, routing, item standard costs and work center rates; it is not stored per order." };
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
    return { orderId: o.id, orderNumber: o.work_order_number, itemCode: o.item_code, itemName: o.item_name, quantity: String(Number(o.quantity_completed)), material: o.material_cost, labor: o.labor_cost, overhead: o.overhead_cost, subcontract: o.subcontract_cost, total: String(round(total)), perUnit: String(round(total / Number(o.quantity_completed))), finishedAt: o.actual_end_at };
  });
  const sum = (key) => lines.reduce((t, l) => t + Number(l[key]), 0);
  return { from, to, lines, totals: { orders: lines.length, material: String(round(sum("material"))), labor: String(round(sum("labor"))), overhead: String(round(sum("overhead"))), subcontract: String(round(sum("subcontract"))), total: String(round(sum("total"))) } };
}

// Standard vs actual per completed order (F184), split into the variances that explain it:
//   material price   = (actual cost - actual quantity x standard price)
//   material usage   = (actual quantity - standard quantity) x standard price
//   labour / overhead = actual booked less standard time x rate
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
    const ops = (await client.query(`SELECT op.planned_minutes,COALESCE(wc.hourly_rate,0) AS hourly_rate,COALESCE(wc.overhead_rate,0) AS overhead_rate FROM tenant.manufacturing_work_order_operations op LEFT JOIN tenant.manufacturing_work_centers wc ON wc.id=op.work_center_id WHERE op.organization_id=$1 AND op.work_order_id=$2 AND op.status='completed'`, [c.organizationId, o.id])).rows;
    const stdLabor = ops.reduce((t, p) => t + (Number(p.planned_minutes) * share / 60) * Number(p.hourly_rate), 0);
    const stdOverhead = ops.reduce((t, p) => t + (Number(p.planned_minutes) * share / 60) * Number(p.overhead_rate), 0);
    const actual = Number(o.material_cost) + Number(o.labor_cost) + Number(o.overhead_cost) + Number(o.subcontract_cost);
    const standard = stdMaterial + stdLabor + stdOverhead;
    rows.push({
      orderId: o.id, orderNumber: o.work_order_number, itemCode: o.item_code, itemName: o.item_name, quantity: String(Number(o.quantity_completed)),
      standard: String(round(standard)), actual: String(round(actual)), variance: String(round(actual - standard)), variancePercent: standard ? round(((actual - standard) / standard) * 100, 1) : null,
      materialPrice: String(round(price)), materialUsage: String(round(usage)), labor: String(round(Number(o.labor_cost) - stdLabor)), overhead: String(round(Number(o.overhead_cost) - stdOverhead)), subcontract: String(round(Number(o.subcontract_cost))),
    });
  }
  rows.sort((a, b) => Math.abs(Number(b.variance)) - Math.abs(Number(a.variance)));
  return { from, to, lines: rows, totals: { standard: String(round(rows.reduce((t, r) => t + Number(r.standard), 0))), actual: String(round(rows.reduce((t, r) => t + Number(r.actual), 0))), variance: String(round(rows.reduce((t, r) => t + Number(r.variance), 0))) } };
}

// ---------------------------------------------------------------- yield (F186)
export async function getYieldReport(client, c, input = {}) {
  need(c, "manufacturing.view");
  const { from, to } = period(input);
  const { rows } = await client.query(
    `SELECT item.id AS item_id,item.code AS item_code,item.name AS item_name,count(*)::int AS orders,sum(wo.quantity_planned)::text AS planned,sum(wo.quantity_completed)::text AS completed,sum(wo.quantity_scrapped)::text AS scrapped
       FROM tenant.manufacturing_work_orders wo JOIN tenant.items item ON item.id=wo.item_id
      WHERE wo.organization_id=$1 AND wo.company_id=$2 AND wo.status IN ('completed','in_progress') AND wo.rework_of_id IS NULL AND COALESCE(wo.actual_end_at,wo.actual_start_at)>=$3::date AND COALESCE(wo.actual_end_at,wo.actual_start_at)<($4::date+1)
      GROUP BY item.id,item.code,item.name,wo.organization_id ORDER BY item.name`,
    [c.organizationId, c.companyId, from, to],
  );
  const reasons = (await client.query(`SELECT s.reason_code,s.category,sum(s.quantity)::text AS quantity,count(*)::int AS events FROM tenant.manufacturing_scrap_records s WHERE s.organization_id=$1 AND s.company_id=$2 AND s.created_at>=$3::date AND s.created_at<($4::date+1) GROUP BY s.reason_code,s.category ORDER BY sum(s.quantity) DESC`, [c.organizationId, c.companyId, from, to])).rows;
  const lines = rows.map((r) => {
    const good = Number(r.completed);
    const lost = Number(r.scrapped);
    return { itemId: r.item_id, itemCode: r.item_code, itemName: r.item_name, orders: r.orders, planned: r.planned, completed: r.completed, scrapped: r.scrapped, yieldPercent: good + lost > 0 ? round((good / (good + lost)) * 100, 1) : null, attainmentPercent: Number(r.planned) > 0 ? round((good / Number(r.planned)) * 100, 1) : null };
  });
  const totalGood = lines.reduce((t, l) => t + Number(l.completed), 0);
  const totalLost = lines.reduce((t, l) => t + Number(l.scrapped), 0);
  return { from, to, lines, reasons, overallYield: totalGood + totalLost > 0 ? round((totalGood / (totalGood + totalLost)) * 100, 1) : null };
}

// ---------------------------------------------------------------- efficiency / OEE (F187)
// Availability x performance x quality per work center over a period.
//   availability = (calendar minutes - downtime) / calendar minutes
//   performance  = planned minutes / actual minutes of operations completed
//   quality      = good / (good + scrapped) on the orders those operations belonged to
export async function getEfficiencyReport(client, c, input = {}) {
  need(c, "manufacturing.view");
  const { from, to } = period(input);
  const days = Math.min(Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1, 60);
  const capacity = await getCapacityPlan(client, c, { from, days });
  const centers = [];
  for (const center of capacity.centers) {
    const downtime = Number((await client.query(`SELECT COALESCE(sum(COALESCE(minutes,EXTRACT(EPOCH FROM (now()-started_at))/60)),0) AS m FROM tenant.manufacturing_downtime_events WHERE organization_id=$1 AND work_center_id=$2 AND started_at>=$3::date AND started_at<($4::date+1)`, [c.organizationId, center.workCenterId, from, to])).rows[0].m);
    const perf = (await client.query(`SELECT COALESCE(sum(op.planned_minutes),0) AS planned,COALESCE(sum(op.actual_minutes),0) AS actual,count(*)::int AS ops FROM tenant.manufacturing_work_order_operations op WHERE op.organization_id=$1 AND op.work_center_id=$2 AND op.status='completed' AND op.completed_at>=$3::date AND op.completed_at<($4::date+1)`, [c.organizationId, center.workCenterId, from, to])).rows[0];
    const quality = (await client.query(`SELECT COALESCE(sum(wo.quantity_completed),0) AS good,COALESCE(sum(wo.quantity_scrapped),0) AS lost FROM tenant.manufacturing_work_orders wo WHERE wo.organization_id=$1 AND wo.id IN (SELECT DISTINCT op.work_order_id FROM tenant.manufacturing_work_order_operations op WHERE op.organization_id=$1 AND op.work_center_id=$2 AND op.status='completed' AND op.completed_at>=$3::date AND op.completed_at<($4::date+1))`, [c.organizationId, center.workCenterId, from, to])).rows[0];
    const available = center.availableTotal;
    const availability = available > 0 ? Math.max(Math.min((available - downtime) / available, 1), 0) : null;
    const performance = Number(perf.actual) > 0 ? Number(perf.planned) / Number(perf.actual) : null;
    const good = Number(quality.good);
    const qualityRate = good + Number(quality.lost) > 0 ? good / (good + Number(quality.lost)) : null;
    const parts = [availability, performance, qualityRate];
    centers.push({
      workCenterId: center.workCenterId, code: center.code, name: center.name, availableMinutes: available, downtimeMinutes: round(downtime, 1), operations: perf.ops, plannedMinutes: round(Number(perf.planned), 1), actualMinutes: round(Number(perf.actual), 1),
      availabilityPercent: availability === null ? null : round(availability * 100, 1), performancePercent: performance === null ? null : round(performance * 100, 1), qualityPercent: qualityRate === null ? null : round(qualityRate * 100, 1),
      oeePercent: parts.every((p) => p !== null) ? round(parts.reduce((t, p) => t * p, 1) * 100, 1) : null,
    });
  }
  return { from, to, centers };
}

// ---------------------------------------------------------------- production summary (F191)
export async function getProductionSummary(client, c, input = {}) {
  need(c, "manufacturing.view");
  const { from, to } = period(input);
  const byProduct = (
    await client.query(
      `SELECT item.code AS item_code,item.name AS item_name,count(*)::int AS orders,sum(wo.quantity_completed)::text AS completed,sum(wo.quantity_planned)::text AS planned,
              count(*) FILTER (WHERE wo.actual_end_at IS NOT NULL AND wo.due_date IS NOT NULL AND wo.actual_end_at::date<=wo.due_date)::int AS on_time,count(*) FILTER (WHERE wo.due_date IS NOT NULL AND wo.status='completed')::int AS with_due
         FROM tenant.manufacturing_work_orders wo JOIN tenant.items item ON item.id=wo.item_id WHERE wo.organization_id=$1 AND wo.company_id=$2 AND wo.status IN ('completed','in_progress') AND COALESCE(wo.actual_end_at,wo.actual_start_at)>=$3::date AND COALESCE(wo.actual_end_at,wo.actual_start_at)<($4::date+1)
        GROUP BY item.code,item.name ORDER BY sum(wo.quantity_completed) DESC`,
      [c.organizationId, c.companyId, from, to],
    )
  ).rows;
  return { from, to, lines: byProduct };
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
  const floor = (await client.query(`SELECT count(*) FILTER (WHERE op.status='ready')::int AS ready,count(*) FILTER (WHERE op.status='in_progress')::int AS running FROM tenant.manufacturing_work_order_operations op JOIN tenant.manufacturing_work_orders wo ON wo.id=op.work_order_id WHERE op.organization_id=$1 AND wo.company_id=$2 AND wo.status IN ('released','in_progress')`, [c.organizationId, c.companyId])).rows[0];
  const down = (await client.query(`SELECT count(*)::int AS open FROM tenant.manufacturing_downtime_events WHERE organization_id=$1 AND company_id=$2 AND ended_at IS NULL`, [c.organizationId, c.companyId])).rows[0];
  const yieldRow = await getYieldReport(client, c, { from: iso(new Date(Date.now() - 30 * 86400000)), to: today });
  const mrp = (await client.query(`SELECT run_number,started_at,summary FROM tenant.manufacturing_planning_runs WHERE organization_id=$1 AND company_id=$2 ORDER BY started_at DESC LIMIT 1`, [c.organizationId, c.companyId])).rows[0] ?? null;
  const attention = (
    await client.query(
      `SELECT wo.id,wo.work_order_number,wo.status,item.code AS item_code,COALESCE(wo.due_date,wo.planned_end_at::date)::text AS due,wo.hold_reason
         FROM tenant.manufacturing_work_orders wo JOIN tenant.items item ON item.id=wo.item_id
        WHERE wo.organization_id=$1 AND wo.company_id=$2 AND wo.status IN ('planned','released','in_progress','on_hold') AND (wo.status='on_hold' OR COALESCE(wo.due_date,wo.planned_end_at::date)<$3::date)
        ORDER BY (wo.status='on_hold') DESC,COALESCE(wo.due_date,wo.planned_end_at::date) LIMIT 10`,
      [c.organizationId, c.companyId, today],
    )
  ).rows;
  return { orders: { planned: counts.planned, released: counts.released, inProgress: counts.in_progress, onHold: counts.on_hold, late: counts.late, completedLast30Days: counts.completed_30d }, ordersWithShortages: shortages.orders, wipValue: seeCost(c) ? counts.wip_value : null, shopFloor: { ready: floor.ready, running: floor.running }, openDowntime: down.open, yieldLast30Days: yieldRow.overallYield, lastMrp: mrp, attention };
}
