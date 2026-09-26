import { nextDocumentNumber } from "../../core/platform/numbering/index.js";
import { MfgError, dateOrNull, has, need, positive, recordEvent, uuid } from "./common.js";
import { explodeBom } from "./engineering.js";
import { getCapacityPlan } from "./routing.js";
import { createProductionOrder } from "./shopfloor.js";

// Planning: MRP (F158-F160), material availability (F161) and finite-capacity scheduling (F168).
const round = (n) => Math.round(n * 1e6) / 1e6;
const DAY = 86400000;
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (isoDate, n) => iso(new Date(Date.parse(isoDate) + n * DAY));

// Purchase-order lines keep their quantity and dates in JSON: read them defensively so one odd value
// cannot fail a whole planning run.
const PO_QTY = `(CASE WHEN line.data->>'quantity' ~ '^[0-9]+(\\.[0-9]+)?$' THEN (line.data->>'quantity')::numeric ELSE 0 END)`;
const PO_DAY = `(CASE WHEN line.data->>'requiredBy' ~ '^\\d{4}-\\d{2}-\\d{2}' THEN substring(line.data->>'requiredBy' from 1 for 10)::date WHEN po.data->>'deliveryDate' ~ '^\\d{4}-\\d{2}-\\d{2}' THEN substring(po.data->>'deliveryDate' from 1 for 10)::date ELSE $3::date+7 END)`;

// ---------------------------------------------------------------- MRP
// Net requirements per item over a horizon, exploded level by level:
//   gross   = open production orders' unissued components + confirmed sales-order lines not yet
//             fulfilled + what is needed to keep the reorder minimum + safety stock
//   supply  = usable stock (not held by outbound work) + open production output + open purchase lines
//   net     = gross - supply; a manufactured item's net becomes dependent demand on its components
// Each item is recommended for manufacture (it has an approved BOM), purchase, or nothing.
export async function runMrp(client, c, input = {}) {
  need(c, "manufacturing.planning.run");
  const horizonDays = Math.min(Math.max(Math.trunc(Number(input.horizonDays ?? 30)) || 30, 1), 365);
  const today = iso(new Date());
  const horizonEnd = addDays(today, horizonDays);

  const bomRows = (await client.query(
    `SELECT bom.id,bom.item_id,bom.output_quantity,component.item_id AS component_id,component.quantity,component.scrap_percent
       FROM tenant.manufacturing_boms bom JOIN tenant.manufacturing_bom_components component ON component.bom_id=bom.id
      WHERE bom.organization_id=$1 AND bom.company_id=$2 AND bom.status='active' AND bom.is_default AND NOT bom.is_alternate
        AND (bom.effective_from IS NULL OR bom.effective_from<=$3::date) AND (bom.effective_to IS NULL OR bom.effective_to>=$3::date)`,
    [c.organizationId, c.companyId, today],
  )).rows;
  const boms = new Map();
  for (const row of bomRows) {
    const bom = boms.get(row.item_id) ?? { id: row.id, itemId: row.item_id, output: Number(row.output_quantity), components: [] };
    bom.components.push({ itemId: row.component_id, quantity: Number(row.quantity), scrap: Number(row.scrap_percent) });
    boms.set(row.item_id, bom);
  }
  // low-level code: an item is planned only after everything that uses it
  const level = new Map();
  const touch = (id) => { if (!level.has(id)) level.set(id, 0); };
  for (const bom of boms.values()) { touch(bom.itemId); for (const comp of bom.components) touch(comp.itemId); }
  for (let pass = 0; pass < 15; pass += 1) {
    let changed = false;
    for (const bom of boms.values()) for (const comp of bom.components) {
      const want = (level.get(bom.itemId) ?? 0) + 1;
      if ((level.get(comp.itemId) ?? 0) < want) { level.set(comp.itemId, want); changed = true; }
    }
    if (!changed) break;
  }

  const demand = new Map(); // item -> [{ date, quantity, sourceType, sourceId }]
  const receipts = new Map();
  const push = (map, item, entry) => { const list = map.get(item) ?? []; list.push(entry); map.set(item, list); touch(item); };

  const materials = (await client.query(
    `SELECT material.item_id,GREATEST(material.required_quantity-(material.issued_quantity-material.returned_quantity),0) AS remaining,wo.id,COALESCE(wo.planned_start_at::date,$3::date)::text AS day
       FROM tenant.manufacturing_work_order_materials material JOIN tenant.manufacturing_work_orders wo ON wo.id=material.work_order_id
      WHERE material.organization_id=$1 AND wo.company_id=$2 AND wo.status IN ('planned','released','in_progress','on_hold')`,
    [c.organizationId, c.companyId, today],
  )).rows;
  for (const m of materials) if (Number(m.remaining) > 0) push(demand, m.item_id, { date: iso(new Date(Math.max(Date.parse(m.day), Date.parse(today)))), quantity: Number(m.remaining), sourceType: "production_order", sourceId: m.id });

  const salesLines = (await client.query(
    `SELECT line.item_id,GREATEST(line.quantity-COALESCE(progress.fulfilled_quantity,0)-COALESCE(progress.cancelled_quantity,0),0) AS remaining,so.id,COALESCE(line.requested_delivery_date,so.requested_delivery_date,$3::date)::text AS day
       FROM tenant.sales_orders so JOIN tenant.sales_order_lines line ON line.sales_order_version_id=so.current_version_id LEFT JOIN tenant.sales_order_line_progress progress ON progress.sales_order_line_id=line.id
      WHERE so.organization_id=$1 AND so.company_id=$2 AND so.lifecycle_status IN ('approved','confirmed') AND line.item_id IS NOT NULL`,
    [c.organizationId, c.companyId, today],
  )).rows;
  for (const l of salesLines) if (Number(l.remaining) > 0) push(demand, l.item_id, { date: iso(new Date(Math.max(Date.parse(l.day), Date.parse(today)))), quantity: Number(l.remaining), sourceType: "sales_order", sourceId: l.id });

  const outputs = (await client.query(`SELECT wo.id,wo.item_id,GREATEST(wo.quantity_planned-wo.quantity_completed-wo.quantity_scrapped,0) AS remaining,COALESCE(wo.planned_end_at::date,wo.planned_start_at::date,$3::date)::text AS day FROM tenant.manufacturing_work_orders wo WHERE wo.organization_id=$1 AND wo.company_id=$2 AND wo.status IN ('planned','released','in_progress')`, [c.organizationId, c.companyId, today])).rows;
  for (const o of outputs) if (Number(o.remaining) > 0) push(receipts, o.item_id, { date: iso(new Date(Math.max(Date.parse(o.day), Date.parse(today)))), quantity: Number(o.remaining), sourceType: "production_order", sourceId: o.id });
  const poLines = (await client.query(
    `SELECT line.item_id,GREATEST(${PO_QTY}-line.received_quantity,0) AS remaining,po.id,${PO_DAY}::text AS day
       FROM tenant.procurement_purchase_order_lines line JOIN tenant.procurement_purchase_orders po ON po.id=line.parent_id
      WHERE line.organization_id=$1 AND po.company_id=$2 AND po.status IN ('approved','dispatched','acknowledged','partially_received') AND line.item_id IS NOT NULL`,
    [c.organizationId, c.companyId, today],
  )).rows;
  for (const l of poLines) if (Number(l.remaining) > 0) push(receipts, l.item_id, { date: iso(new Date(Math.max(Date.parse(l.day), Date.parse(today)))), quantity: Number(l.remaining), sourceType: "purchase_order", sourceId: l.id });

  // Usable stock: physical quantity less what outbound work (picks, transfers) holds. Holds by
  // production orders and sales orders are the demand itself, so they are not deducted twice.
  const stock = new Map((await client.query(`SELECT item_id,sum(quantity) AS q FROM tenant.stock_balances WHERE organization_id=$1 AND company_id=$2 GROUP BY item_id`, [c.organizationId, c.companyId])).rows.map((r) => [r.item_id, Number(r.q)]));
  const otherHolds = new Map((await client.query(`SELECT item_id,sum(quantity) AS q FROM tenant.stock_reservations WHERE organization_id=$1 AND company_id=$2 AND status='active' AND reference_type NOT IN ('manufacturing_work_order','sales_order') GROUP BY item_id`, [c.organizationId, c.companyId])).rows.map((r) => [r.item_id, Number(r.q)]));
  const safety = new Map((await client.query(`SELECT item_id,sum(minimum_quantity+safety_quantity) AS target FROM tenant.stock_reorder_rules WHERE organization_id=$1 AND company_id=$2 AND active GROUP BY item_id`, [c.organizationId, c.companyId])).rows.map((r) => [r.item_id, Number(r.target)]));
  for (const id of safety.keys()) touch(id);

  const rows = [];
  const items = [...level.entries()].sort((a, b) => a[1] - b[1]);
  for (const [itemId, lvl] of items) {
    const list = (demand.get(itemId) ?? []).filter((d) => d.date <= horizonEnd);
    const gross = round(list.reduce((t, d) => t + d.quantity, 0));
    const incoming = round((receipts.get(itemId) ?? []).filter((r) => r.date <= horizonEnd).reduce((t, r) => t + r.quantity, 0));
    const usable = round(Math.max((stock.get(itemId) ?? 0) - (otherHolds.get(itemId) ?? 0), 0));
    const supply = round(usable + incoming);
    const target = safety.get(itemId) ?? 0;
    // what must be added to end the horizon with the reorder minimum + safety stock still on hand
    const netFromDemand = round(Math.max(gross - supply, 0));
    const total = round(Math.max(gross + target - supply, 0));
    if (!gross && !target) continue;
    const bom = boms.get(itemId);
    const action = total > 0 ? (bom ? "manufacture" : "purchase") : "none";
    const earliest = list.length ? list.map((d) => d.date).sort()[0] : today;
    rows.push({ itemId, level: lvl, requiredDate: earliest, gross, usable, supply, incoming, safetyShortfall: round(Math.max(total - netFromDemand, 0)), net: total, action, hasBom: Boolean(bom), pegging: list.slice(0, 20).map((d) => ({ type: d.sourceType, id: d.sourceId, quantity: round(d.quantity), date: d.date })) });
    if (action === "manufacture" && bom) {
      for (const comp of bom.components) push(demand, comp.itemId, { date: earliest, quantity: round(((comp.quantity * total) / bom.output) / (1 - comp.scrap / 100)), sourceType: "mrp_planned_order", sourceId: bom.id });
    }
  }

  const number = await nextDocumentNumber(client, c, { documentType: "manufacturing_mrp_run", prefix: "MRP" });
  const summary = { items: rows.length, manufacture: rows.filter((r) => r.action === "manufacture").length, purchase: rows.filter((r) => r.action === "purchase").length, none: rows.filter((r) => r.action === "none").length };
  const run = (await client.query(`INSERT INTO tenant.manufacturing_planning_runs(organization_id,company_id,run_number,horizon_start,horizon_end,status,parameters,summary,started_by,completed_at,note) VALUES($1,$2,$3,$4,$5,'completed',$6::jsonb,$7::jsonb,$8,now(),$9) RETURNING *`, [c.organizationId, c.companyId, number, today, horizonEnd, JSON.stringify({ horizonDays }), JSON.stringify(summary), c.userId, String(input.note ?? "").slice(0, 500) || null])).rows[0];
  for (const r of rows) {
    await client.query(
      `INSERT INTO tenant.manufacturing_material_requirements(organization_id,planning_run_id,item_id,required_date,gross_requirement,available_quantity,reserved_quantity,net_requirement,recommended_action,supply_quantity,safety_shortfall,has_bom,pegging,level)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14)`,
      [c.organizationId, run.id, r.itemId, r.requiredDate, r.gross, r.usable, r.incoming, r.net, r.action, r.supply, r.safetyShortfall, r.hasBom, JSON.stringify(r.pegging), r.level],
    );
  }
  await recordEvent(client, c, "planning_run", run.id, "manufacturing.mrp.completed", summary);
  return { ...run, summary };
}

export async function listMrpRuns(client, c) {
  need(c, "manufacturing.view");
  const { rows } = await client.query(`SELECT id,run_number,horizon_start,horizon_end,status,summary,started_at,note FROM tenant.manufacturing_planning_runs WHERE organization_id=$1 AND company_id=$2 ORDER BY started_at DESC LIMIT 100`, [c.organizationId, c.companyId]);
  return rows;
}

export async function getMrpRun(client, c, runId) {
  need(c, "manufacturing.view");
  const run = (await client.query(`SELECT * FROM tenant.manufacturing_planning_runs WHERE organization_id=$1 AND company_id=$2 AND id=$3`, [c.organizationId, c.companyId, uuid(runId, "Run")])).rows[0];
  if (!run) throw new MfgError(404, "Planning run was not found.", "MFG_RUN_NOT_FOUND");
  const requirements = (
    await client.query(
      `SELECT r.id,r.item_id,item.code AS item_code,item.name AS item_name,r.level,r.required_date::text AS required_date,r.gross_requirement::text AS gross,r.available_quantity::text AS usable_stock,r.reserved_quantity::text AS incoming,r.supply_quantity::text AS supply,r.net_requirement::text AS net,r.safety_shortfall::text AS safety_shortfall,r.recommended_action,r.has_bom,r.pegging,r.converted_order_id,wo.work_order_number AS converted_order_number
         FROM tenant.manufacturing_material_requirements r JOIN tenant.items item ON item.id=r.item_id LEFT JOIN tenant.manufacturing_work_orders wo ON wo.id=r.converted_order_id
        WHERE r.organization_id=$1 AND r.planning_run_id=$2 ORDER BY r.level,item.name`,
      [c.organizationId, run.id],
    )
  ).rows;
  return { ...run, requirements };
}

// Planned orders become real production orders (F158). Purchases are for Procurement to raise.
export async function createOrdersFromMrp(client, c, runId, input = {}) {
  need(c, "manufacturing.work_order.manage");
  const run = await getMrpRun(client, c, runId);
  const wanted = Array.isArray(input.requirementIds) && input.requirementIds.length ? new Set(input.requirementIds) : null;
  const targets = run.requirements.filter((r) => r.recommended_action === "manufacture" && Number(r.net) > 0 && !r.converted_order_id && (!wanted || wanted.has(r.id)));
  if (!targets.length) throw new MfgError(409, "There is nothing to convert: no manufacture recommendation is left in this run.", "MFG_NOTHING_TO_CONVERT");
  const created = [];
  for (const r of targets) {
    const order = await createProductionOrder(client, c, { itemId: r.item_id, quantity: Number(r.net), plannedStartAt: `${String(r.required_date).slice(0, 10)}T08:00:00Z`, notes: `From ${run.run_number}`, idempotencyKey: `mrp:${run.id}:${r.id}` });
    await client.query(`UPDATE tenant.manufacturing_material_requirements SET converted_order_id=$3 WHERE organization_id=$1 AND id=$2`, [c.organizationId, r.id, order.id]);
    created.push({ requirementId: r.id, orderId: order.id, orderNumber: order.work_order_number, itemCode: r.item_code, quantity: r.net });
  }
  return { runId: run.id, created };
}

// ---------------------------------------------------------------- material availability (F161)
// Can this quantity be made now? Every bought material at every level against usable stock, plus what
// is on order; and the most that could be made from stock alone.
export async function getMaterialAvailability(client, c, input = {}) {
  need(c, "manufacturing.view");
  const quantity = positive(input.quantity ?? 1, "Quantity");
  const explosion = await explodeBom(client, c, { bomId: input.bomId, itemId: input.itemId, quantity, asOf: input.asOf });
  const unit = await explodeBom(client, c, { bomId: input.bomId, itemId: input.itemId, quantity: 1, asOf: input.asOf });
  const lines = [];
  for (const total of explosion.purchasedTotals) {
    const stock = (await client.query(`SELECT COALESCE(sum(quantity),0) AS q,COALESCE(sum(quantity-reserved_quantity),0) AS free FROM tenant.stock_balances WHERE organization_id=$1 AND company_id=$2 AND item_id=$3`, [c.organizationId, c.companyId, total.itemId])).rows[0];
    const incoming = (await client.query(
      `SELECT COALESCE(sum(GREATEST(${PO_QTY}-line.received_quantity,0)),0) AS q FROM tenant.procurement_purchase_order_lines line JOIN tenant.procurement_purchase_orders po ON po.id=line.parent_id
        WHERE line.organization_id=$1 AND po.company_id=$2 AND line.item_id=$3 AND po.status IN ('approved','dispatched','acknowledged','partially_received')`,
      [c.organizationId, c.companyId, total.itemId],
    )).rows[0];
    const required = Number(total.requiredQuantity);
    const free = Number(stock.free);
    const perUnit = Number(unit.purchasedTotals.find((u) => u.itemId === total.itemId)?.requiredQuantity ?? 0);
    lines.push({ itemId: total.itemId, itemCode: total.itemCode, itemName: total.itemName, requiredQuantity: String(required), onHand: String(round(Number(stock.q))), freeQuantity: String(round(free)), incomingQuantity: String(round(Number(incoming.q))), shortageNow: String(round(Math.max(required - free, 0))), shortageAfterIncoming: String(round(Math.max(required - free - Number(incoming.q), 0))), status: required <= free + 1e-9 ? "available" : required <= free + Number(incoming.q) + 1e-9 ? "on_order" : "short", makeableFromStock: perUnit > 0 ? Math.floor(free / perUnit) : null });
  }
  const makeable = lines.length ? Math.min(...lines.filter((l) => l.makeableFromStock !== null).map((l) => l.makeableFromStock)) : null;
  return { bomCode: explosion.bomCode, quantity: String(quantity), canMakeNow: lines.every((l) => l.status === "available"), makeableFromStock: makeable === Infinity ? null : makeable, lines };
}

// ---------------------------------------------------------------- scheduling (F168)
// Forward, finite-capacity: orders in priority order, operations in sequence, each poured into the
// work center's remaining daily minutes (calendar shifts x machines x efficiency, less closures).
const PRIORITY = { urgent: 0, high: 1, normal: 2, low: 3 };
export async function scheduleProductionOrders(client, c, input = {}) {
  need(c, "manufacturing.planning.run");
  const today = iso(new Date());
  const from = dateOrNull(input.from, "From date") || today;
  const horizon = 120;
  const plan = await getCapacityPlan(client, c, { from, days: Math.min(horizon, 60) });
  const more = await getCapacityPlan(client, c, { from: addDays(from, 60), days: Math.min(horizon - 60, 60) });
  const available = new Map();
  for (const part of [plan, more]) for (const center of part.centers) { const map = available.get(center.workCenterId) ?? new Map(); for (const d of center.days) map.set(d.day, d.available); available.set(center.workCenterId, map); }
  const used = new Map();

  const ids = Array.isArray(input.orderIds) && input.orderIds.length ? input.orderIds.map((id) => uuid(id, "Order")) : null;
  const orders = (await client.query(
    `SELECT wo.id,wo.work_order_number,wo.priority,wo.planned_start_at,wo.planned_end_at,wo.due_date::text AS due_date,item.code AS item_code
       FROM tenant.manufacturing_work_orders wo JOIN tenant.items item ON item.id=wo.item_id WHERE wo.organization_id=$1 AND wo.company_id=$2 AND wo.status IN ('planned','released') ${ids ? "AND wo.id=ANY($3::uuid[])" : ""}`,
    ids ? [c.organizationId, c.companyId, ids] : [c.organizationId, c.companyId],
  )).rows.sort((a, b) => (PRIORITY[a.priority] - PRIORITY[b.priority]) || String(a.planned_start_at ?? "").localeCompare(String(b.planned_start_at ?? "")) || a.work_order_number.localeCompare(b.work_order_number));

  const result = [];
  for (const wo of orders) {
    const ops = (await client.query(`SELECT id,sequence,name,work_center_id,planned_minutes FROM tenant.manufacturing_work_order_operations WHERE organization_id=$1 AND work_order_id=$2 AND status NOT IN ('completed','skipped') ORDER BY sequence`, [c.organizationId, wo.id])).rows;
    let cursor = wo.planned_start_at && iso(new Date(wo.planned_start_at)) > from ? iso(new Date(wo.planned_start_at)) : from;
    const scheduledOps = [];
    let blocked = null;
    for (const op of ops) {
      let remaining = Math.ceil(Number(op.planned_minutes));
      if (!op.work_center_id || remaining <= 0) { scheduledOps.push({ id: op.id, sequence: op.sequence, name: op.name, start: cursor, end: cursor, workCenterId: op.work_center_id }); continue; }
      const map = available.get(op.work_center_id);
      let day = cursor;
      let start = null;
      let guard = 0;
      while (remaining > 0 && guard++ < horizon) {
        const cap = (map?.get(day) ?? 0) - (used.get(`${op.work_center_id}:${day}`) ?? 0);
        if (cap > 0) {
          const take = Math.min(cap, remaining);
          used.set(`${op.work_center_id}:${day}`, (used.get(`${op.work_center_id}:${day}`) ?? 0) + take);
          remaining -= take;
          start = start ?? day;
          if (remaining <= 0) break;
        }
        day = addDays(day, 1);
      }
      if (remaining > 0) { blocked = `Operation ${op.sequence} (${op.name}) cannot be scheduled: the work center has no capacity in the next ${horizon} days (check its calendar and status).`; break; }
      scheduledOps.push({ id: op.id, sequence: op.sequence, name: op.name, start, end: day, workCenterId: op.work_center_id });
      cursor = day;
    }
    const end = scheduledOps.length ? scheduledOps[scheduledOps.length - 1].end : cursor;
    const due = wo.due_date ? iso(new Date(wo.due_date)) : wo.planned_end_at ? iso(new Date(wo.planned_end_at)) : null;
    result.push({ orderId: wo.id, orderNumber: wo.work_order_number, itemCode: wo.item_code, priority: wo.priority, start: scheduledOps[0]?.start ?? cursor, end, dueDate: due, late: due ? end > due : false, blocked, operations: scheduledOps });
  }
  if (input.apply === true) {
    for (const r of result.filter((x) => !x.blocked)) {
      for (const op of r.operations) await client.query(`UPDATE tenant.manufacturing_work_order_operations SET scheduled_start=$3,scheduled_end=$4 WHERE organization_id=$1 AND id=$2`, [c.organizationId, op.id, op.start, op.end]);
      await client.query(`UPDATE tenant.manufacturing_work_orders SET planned_start_at=$3::date+time '08:00',planned_end_at=$4::date+time '17:00',due_date=COALESCE(due_date,$5::date),updated_at=now() WHERE organization_id=$1 AND id=$2`, [c.organizationId, r.orderId, r.start, r.end, r.dueDate]);
    }
    await recordEvent(client, c, "schedule", result[0]?.orderId ?? c.companyId, "manufacturing.schedule.applied", { orders: result.length });
  }
  return { from, applied: input.apply === true, orders: result, lateOrders: result.filter((r) => r.late).length, blockedOrders: result.filter((r) => r.blocked).length };
}
