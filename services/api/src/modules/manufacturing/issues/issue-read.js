// Material Issue — the reads: one note (with what each line would take, or took), the list, what an order may still issue, an order's
// issue history, the posting check against Inventory and Finance, the reconciliation queue and the reports. Costs only with the cost
// permission. Nothing here moves stock or posts.
import { USABLE_ROW } from "../../stock/index.js";
import { freeStock, money, reservedByItem, reservedPerLine } from "../orders/mo-core.js";
import {
  D, ISSUE, ISSUE_STATUS_LABEL, MO, STATUS_LABEL, UNPOSTED, ZERO, add, approvalState, excessOf, has, issueError, issueSettings, lineFigures, loadIssue, loadIssueLines, loadIssueOrder,
  loadMaterials, max, needIssueView, orderReservations, q, requireIssuable, storedLines, sub, uuid,
} from "./issue-core.js";

const names = async (client, ids) => {
  const list = [...new Set(ids.filter(Boolean))];
  if (!list.length) return new Map();
  return new Map((await client.query(`SELECT id, COALESCE(NULLIF(full_name, ''), email) AS name FROM public.users WHERE id = ANY($1::uuid[])`, [list])).rows.map((row) => [row.id, row.name]));
};
const ACTION_LABEL = Object.freeze({ CREATED: "Draft created", EDITED: "Draft edited", VALIDATED: "Checked: ready to post", APPROVAL_REQUESTED: "Approval requested", APPROVED: "Additional material approved",
  REJECTED: "Additional material rejected", POSTED: "Posted to Inventory", CANCELLED: "Cancelled", REVERSED: "Posting error reversed", PRINTED: "Printed", REPRINTED: "Reprinted",
  RECOVERY_REQUIRED: "Marked for recovery", RECOVERED: "Recovered: Inventory and Finance agree" });

// ------------------------------------------------------------------ one note
export async function getMaterialIssue(client, c, id) {
  needIssueView(c);
  const issue = await loadIssue(client, c, id);
  const order = await loadIssueOrder(client, c, issue.manufacturing_order_id);
  const materials = await loadMaterials(client, c, order.id);
  const rows = await loadIssueLines(client, c, issue.id);
  const lines = storedLines(rows, materials);
  const costView = has(c, MO.costView);
  const settings = await issueSettings(client, c);
  const unposted = UNPOSTED.has(issue.status);
  const excess = excessOf(lines, materials);
  const approval = unposted ? approvalState(issue, lines, excess, materials, settings, order) : { required: rows.some((row) => D(row.excess_quantity) > ZERO), valid: true, status: issue.approval_status, excess: [] };
  const reserved = reservedPerLine(materials, await reservedByItem(client, c, order));
  const allocations = rows.length ? (await client.query(
    `SELECT allocation.*, batch.batch_number, batch.expires_on, serial.serial_number, location.code AS location_code FROM tenant.manufacturing_material_issue_allocations allocation
       LEFT JOIN tenant.stock_batches batch ON batch.id = allocation.batch_id LEFT JOIN tenant.stock_serials serial ON serial.id = allocation.serial_id
       LEFT JOIN tenant.warehouse_locations location ON location.id = allocation.warehouse_location_id
      WHERE allocation.organization_id = $1 AND allocation.issue_line_id = ANY($2::uuid[]) ORDER BY allocation.created_at`, [c.organizationId, rows.map((row) => row.id)])).rows : [];
  const lookups = async (sql, ids) => (ids.length ? new Map((await client.query(sql, [c.organizationId, ids])).rows.map((row) => [row.id, row])) : new Map());
  const batches = await lookups(`SELECT id, batch_number, expires_on FROM tenant.stock_batches WHERE organization_id = $1 AND id = ANY($2::uuid[])`, rows.map((row) => row.batch_id).filter(Boolean));
  const serials = await lookups(`SELECT id, serial_number FROM tenant.stock_serials WHERE organization_id = $1 AND id = ANY($2::uuid[])`, rows.flatMap((row) => row.serial_ids ?? []));
  const locations = await lookups(`SELECT id, code, name FROM tenant.warehouse_locations WHERE organization_id = $1 AND id = ANY($2::uuid[])`,
    [issue.source_location_id, issue.production_location_id, ...rows.map((row) => row.source_location_id)].filter(Boolean));
  const warehouses = await lookups(`SELECT id, code, name FROM tenant.warehouses WHERE organization_id = $1 AND id = ANY($2::uuid[])`, [issue.source_warehouse_id, issue.production_warehouse_id]);
  const movementNumbers = await lookups(`SELECT id, movement_number FROM tenant.manufacturing_order_material_movements WHERE organization_id = $1 AND id = ANY($2::uuid[])`, rows.map((row) => row.movement_id).filter(Boolean));
  const free = new Map();
  if (unposted) for (const itemId of new Set(rows.map((row) => row.item_id))) free.set(itemId, await freeStock(client, c, itemId, issue.source_warehouse_id));
  const postings = (await client.query(`SELECT * FROM tenant.manufacturing_material_issue_postings WHERE organization_id = $1 AND material_issue_id = $2 ORDER BY created_at`, [c.organizationId, issue.id])).rows;
  const reversals = (await client.query(`SELECT reversal.*, line.line_number FROM tenant.manufacturing_material_issue_reversals reversal JOIN tenant.manufacturing_material_issue_lines line ON line.id = reversal.issue_line_id
      WHERE reversal.organization_id = $1 AND reversal.material_issue_id = $2 ORDER BY reversal.reversed_at`, [c.organizationId, issue.id])).rows;
  const events = (await client.query(`SELECT * FROM tenant.manufacturing_material_issue_events WHERE organization_id = $1 AND material_issue_id = $2 ORDER BY occurred_at`, [c.organizationId, issue.id])).rows;
  const people = await names(client, [issue.created_by, issue.posted_by, issue.approval_requested_by, issue.approved_by, issue.cancelled_by, ...events.map((row) => row.actor_user_id),
    ...reversals.map((row) => row.reversed_by)]);
  const finished = (await client.query(`SELECT code, name FROM tenant.items WHERE id = $1`, [order.finished_item_id])).rows[0];
  const revision = order.bom_revision_id ? (await client.query(`SELECT revision_number FROM tenant.manufacturing_bom_revisions WHERE id = $1`, [order.bom_revision_id])).rows[0] : null;
  const issuePosting = postings.find((row) => row.kind === "ISSUE") ?? null;
  const place = (warehouseId, locationId) => ({ warehouse: warehouses.get(warehouseId) ?? null, location: locationId ? locations.get(locationId) ?? null : null });
  const mayIssue = has(c, MO.issue);
  const live = ["RELEASED", "IN_PROGRESS"].includes(order.status);
  return {
    id: issue.id, number: issue.issue_number, status: issue.status, statusLabel: ISSUE_STATUS_LABEL[issue.status], rowVersion: issue.row_version, issueReason: issue.issue_reason,
    issueDate: issue.issue_date, notes: issue.notes, receivedBy: issue.received_by, createdBy: people.get(issue.created_by) ?? null, createdAt: issue.created_at,
    postedBy: people.get(issue.posted_by) ?? null, postedAt: issue.posted_at, cancelledBy: people.get(issue.cancelled_by) ?? null, cancelledAt: issue.cancelled_at, cancelReason: issue.cancel_reason,
    order: { id: order.id, number: order.mo_number, status: order.status, statusLabel: STATUS_LABEL[order.status], version: order.version, finishedItem: finished,
      revisionNumber: revision?.revision_number ?? null, snapshotId: order.bom_snapshot_id },
    source: place(issue.source_warehouse_id, issue.source_location_id), production: place(issue.production_warehouse_id, issue.production_location_id),
    approval: { ...approval, reason: issue.approval_reason, varianceType: issue.variance_type, requestedBy: people.get(issue.approval_requested_by) ?? null, requestedAt: issue.approval_requested_at,
      decidedBy: people.get(issue.approved_by) ?? null, decidedAt: issue.approved_at, note: issue.approval_note },
    lines: rows.map((row, index) => {
      const material = materials.find((line) => line.id === row.material_id);
      const figures = lineFigures(material);
      const own = allocations.filter((part) => part.issue_line_id === row.id);
      return {
        id: row.id, lineNumber: row.line_number, materialId: row.material_id, itemId: row.item_id, code: row.item_code, name: row.item_name, trackingType: row.tracking_type,
        quantity: q(D(row.quantity)), uomId: row.uom_id, uom: row.uom_code, baseQuantity: q(D(row.base_quantity)), baseUom: row.base_uom_code, factor: q(D(row.conversion_factor), 9),
        required: q(figures.required), netIssued: q(figures.netIssued), remainingToIssue: q(figures.toIssue), consumed: q(figures.consumed), scrapped: q(figures.scrapped), inCustody: q(figures.custody),
        reservedForOrder: q(reserved.get(row.material_id) ?? ZERO), freeEligible: unposted ? q(free.get(row.item_id) ?? ZERO) : null,
        excess: q(unposted ? excess[index] : D(row.excess_quantity)), excessApproved: q(D(row.excess_quantity)),
        batch: row.batch_id ? { id: row.batch_id, number: batches.get(row.batch_id)?.batch_number ?? null, expiresOn: batches.get(row.batch_id)?.expires_on ?? null } : null,
        serials: (row.serial_ids ?? []).map((serialId) => ({ id: serialId, number: serials.get(serialId)?.serial_number ?? null })),
        sourceLocation: row.source_location_id ? locations.get(row.source_location_id) ?? null : null, notes: row.notes,
        posted: row.movement_id ? { movementNumber: movementNumbers.get(row.movement_id)?.movement_number ?? null, fromReservation: q(D(row.from_reservation_quantity ?? 0)),
          unitCost: costView ? q(D(row.unit_cost ?? 0)) : null, totalCost: costView ? money(D(row.total_cost ?? 0)) : null } : null,
        reversed: q(D(row.reversed_quantity)),
        allocations: own.map((part) => ({ stockMovementId: part.stock_movement_id, batch: part.batch_number, expiresOn: part.expires_on, serial: part.serial_number, location: part.location_code,
          quantity: q(D(part.quantity)), fromReservation: Boolean(part.reservation_id) })),
      };
    }),
    totals: { lines: rows.length, cost: costView && issue.total_cost !== null ? money(D(issue.total_cost)) : null, costStatus: issue.cost_status },
    posting: issuePosting ? { key: issuePosting.command_key, documentVersion: issuePosting.document_version, inventoryStatus: issuePosting.inventory_status, stockMovementIds: issuePosting.stock_movement_ids,
      financeStatus: issuePosting.finance_status, journalEntryId: costView ? issuePosting.journal_entry_id : null, at: issuePosting.created_at } : null,
    reversals: reversals.map((row) => ({ id: row.id, number: row.reversal_number, lineNumber: row.line_number, quantity: q(D(row.quantity)), reason: row.reason, evidence: row.evidence,
      cost: costView ? money(D(row.total_cost ?? 0)) : null, by: people.get(row.reversed_by) ?? null, at: row.reversed_at })),
    print: { count: issue.print_count, lastPrintedAt: issue.last_printed_at, watermark: issue.status === "POSTED" ? null : issue.status === "CANCELLED" ? "CANCELLED" : "DRAFT" },
    history: events.map((row) => ({ action: row.action, label: ACTION_LABEL[row.action] ?? row.action, fromStatus: row.from_status, toStatus: row.to_status, summary: row.summary,
      actor: people.get(row.actor_user_id) ?? null, at: row.occurred_at })),
    can: {
      edit: unposted && mayIssue && live, cancel: unposted && mayIssue, validate: unposted && mayIssue && live, requestApproval: unposted && has(c, MO.extra) && live && approval.required && !approval.valid,
      decideApproval: issue.status === "PENDING_APPROVAL" && has(c, MO.approveVariance) && (issue.approval_requested_by !== c.userId || settings.selfApproval),
      post: unposted && mayIssue && has(c, "stock.issue") && live && issue.status !== "PENDING_APPROVAL",
      reverse: issue.status === "POSTED" && has(c, ISSUE.reverse) && has(c, "stock.receive") && ["RELEASED", "IN_PROGRESS", "ON_HOLD"].includes(order.status) && rows.some((row) => D(row.reversed_quantity) === ZERO),
      print: has(c, ISSUE.export), viewCost: costView, recover: ["POSTED", "RECOVERY_REQUIRED"].includes(issue.status) && has(c, ISSUE.reverse),
    },
  };
}

// ------------------------------------------------------------------ list
// filters: { status, orderId, warehouseId, itemId, issuedBy, batchId, from, to, search }
export async function listMaterialIssues(client, c, filters = {}) {
  needIssueView(c);
  const values = [c.organizationId];
  const where = ["issue.organization_id = $1"];
  const bind = (value) => { values.push(value); return `$${values.length}`; };
  if (filters.status) where.push(`issue.status = ${bind(String(filters.status).toUpperCase())}`);
  if (filters.orderId) where.push(`issue.manufacturing_order_id = ${bind(uuid(filters.orderId, "Manufacturing order"))}`);
  if (filters.warehouseId) where.push(`issue.source_warehouse_id = ${bind(uuid(filters.warehouseId, "Warehouse"))}`);
  if (filters.issuedBy) where.push(`issue.posted_by = ${bind(uuid(filters.issuedBy, "User"))}`);
  if (filters.itemId) where.push(`EXISTS (SELECT 1 FROM tenant.manufacturing_material_issue_lines line WHERE line.material_issue_id = issue.id AND line.item_id = ${bind(uuid(filters.itemId, "Item"))})`);
  if (filters.batchId) where.push(`EXISTS (SELECT 1 FROM tenant.manufacturing_material_issue_lines line JOIN tenant.manufacturing_material_issue_allocations part ON part.issue_line_id = line.id
      WHERE line.material_issue_id = issue.id AND part.batch_id = ${bind(uuid(filters.batchId, "Batch"))})`);
  if (filters.from) where.push(`COALESCE(issue.posted_at, issue.created_at) >= ${bind(String(filters.from))}::date`);
  if (filters.to) where.push(`COALESCE(issue.posted_at, issue.created_at) < (${bind(String(filters.to))}::date + 1)`);
  if (filters.search) {
    const term = bind(`%${String(filters.search).trim().toLowerCase()}%`);
    where.push(`(lower(issue.issue_number) LIKE ${term} OR lower(mo.mo_number) LIKE ${term} OR EXISTS (SELECT 1 FROM tenant.manufacturing_material_issue_lines line JOIN tenant.items item ON item.id = line.item_id
      WHERE line.material_issue_id = issue.id AND (lower(item.code) LIKE ${term} OR lower(item.name) LIKE ${term})))`);
  }
  const rows = (await client.query(
    `SELECT issue.*, mo.mo_number, mo.status AS order_status, finished.code AS finished_code, finished.name AS finished_name, warehouse.code AS warehouse_code,
            (SELECT count(*)::int FROM tenant.manufacturing_material_issue_lines line WHERE line.material_issue_id = issue.id) AS line_count,
            (SELECT string_agg(item.code || ' ' || trim(trailing '.' FROM trim(trailing '0' FROM line.base_quantity::text)), ', ' ORDER BY line.line_number)
               FROM tenant.manufacturing_material_issue_lines line JOIN tenant.items item ON item.id = line.item_id WHERE line.material_issue_id = issue.id) AS summary
       FROM tenant.manufacturing_material_issues issue JOIN tenant.manufacturing_orders mo ON mo.id = issue.manufacturing_order_id JOIN tenant.items finished ON finished.id = mo.finished_item_id
       JOIN tenant.warehouses warehouse ON warehouse.id = issue.source_warehouse_id
      WHERE ${where.join(" AND ")} ORDER BY COALESCE(issue.posted_at, issue.created_at) DESC LIMIT 500`, values)).rows;
  const people = await names(client, rows.flatMap((row) => [row.created_by, row.posted_by]));
  const costView = has(c, MO.costView);
  return rows.map((row) => ({
    id: row.id, number: row.issue_number, status: row.status, statusLabel: ISSUE_STATUS_LABEL[row.status], orderId: row.manufacturing_order_id, orderNumber: row.mo_number,
    orderStatusLabel: STATUS_LABEL[row.order_status], finishedItem: `${row.finished_code} · ${row.finished_name}`, warehouse: row.warehouse_code, lines: row.line_count, summary: row.summary,
    issueReason: row.issue_reason, approvalStatus: row.approval_status, createdBy: people.get(row.created_by) ?? null, issuedBy: people.get(row.posted_by) ?? null, createdAt: row.created_at,
    postedAt: row.posted_at, totalCost: costView && row.total_cost !== null ? money(D(row.total_cost)) : null, costStatus: row.cost_status, printed: row.print_count,
  }));
}
export const getMoMaterialIssueHistory = (client, c, orderId) => listMaterialIssues(client, c, { orderId });

// ------------------------------------------------------------------ what an order may still issue
// Per material line: required, issued, used, scrapped, in custody, still to issue, reserved for the order, free usable stock, and the
// batches (earliest expiry first, with what this order holds in each) and serial units it could take.
export async function getIssuableMoMaterials(client, c, orderId) {
  needIssueView(c);
  const order = await loadIssueOrder(client, c, orderId);
  let eligible = true;
  let reason = null;
  try { requireIssuable(order); } catch (error) { eligible = false; reason = error.message; }
  const materials = await loadMaterials(client, c, order.id);
  const reserved = reservedPerLine(materials, await reservedByItem(client, c, order));
  const settings = await issueSettings(client, c);
  const out = [];
  for (const material of materials) {
    const figures = lineFigures(material);
    const own = await orderReservations(client, c, order, material.component_item_id, order.material_warehouse_id);
    const balances = (await client.query(
      `SELECT balance.warehouse_location_id, location.code AS location, balance.batch_id, batch.batch_number, batch.expires_on, sum(balance.quantity) AS quantity, sum(balance.reserved_quantity) AS reserved
         FROM tenant.stock_balances balance LEFT JOIN tenant.warehouse_locations location ON location.organization_id = balance.organization_id AND location.id = balance.warehouse_location_id
         LEFT JOIN tenant.stock_batches batch ON batch.organization_id = balance.organization_id AND batch.id = balance.batch_id
        WHERE balance.organization_id = $1 AND balance.item_id = $2 AND balance.warehouse_id = $3 AND balance.quantity > 0
          AND ${USABLE_ROW}
        GROUP BY 1, 2, 3, 4, 5 ORDER BY batch.expires_on NULLS LAST, location.code`, [c.organizationId, material.component_item_id, order.material_warehouse_id])).rows;
    const serials = material.tracking_type === "serial" ? (await client.query(
      `SELECT serial.id, serial.serial_number, location.code AS location, reservation.reference_type, reservation.reference_id
         FROM tenant.stock_serials serial LEFT JOIN tenant.warehouse_locations location ON location.id = serial.warehouse_location_id
         LEFT JOIN tenant.stock_reservations reservation ON reservation.organization_id = serial.organization_id AND reservation.serial_id = serial.id AND reservation.status = 'active'
        WHERE serial.organization_id = $1 AND serial.item_id = $2 AND serial.warehouse_id = $3 AND serial.status = 'available' AND COALESCE(location.disposition, 'available') = 'available'
        ORDER BY serial.serial_number LIMIT 500`, [c.organizationId, material.component_item_id, order.material_warehouse_id])).rows
      .filter((row) => !row.reference_type || (row.reference_type === "manufacturing_work_order" && row.reference_id === order.id))
      .map((row) => ({ id: row.id, number: row.serial_number, location: row.location, reservedForOrder: Boolean(row.reference_type) })) : null;
    out.push({
      materialId: material.id, lineNumber: material.line_number, itemId: material.component_item_id, code: material.item_code, name: material.item_name, uomId: material.uom_id, uom: material.uom_code,
      kind: material.kind, origin: material.origin, trackingType: material.tracking_type, required: q(figures.required), netIssued: q(figures.netIssued), consumed: q(figures.consumed),
      scrapped: q(figures.scrapped), inCustody: q(figures.custody), remainingToIssue: q(figures.toIssue), reservedForOrder: q(reserved.get(material.id) ?? ZERO),
      freeEligible: q(await freeStock(client, c, material.component_item_id, order.material_warehouse_id)),
      stock: balances.map((row) => {
        const held = own.filter((reservation) => (reservation.batch_id ?? null) === (row.batch_id ?? null) && (reservation.warehouse_location_id ?? null) === (row.warehouse_location_id ?? null))
          .reduce((sum, reservation) => add(sum, D(reservation.active_quantity)), ZERO);
        return { locationId: row.warehouse_location_id, location: row.location, batchId: row.batch_id, batch: row.batch_number, expiresOn: row.expires_on, onHand: q(D(row.quantity)),
          reservedForOrder: q(held), free: q(max(sub(D(row.quantity), D(row.reserved)), ZERO)) };
      }),
      serials,
    });
  }
  return { orderId: order.id, orderNumber: order.mo_number, orderStatus: order.status, orderStatusLabel: STATUS_LABEL[order.status], orderVersion: order.version, eligible, reason,
    sourceWarehouseId: order.material_warehouse_id, productionWarehouseId: order.manufacturing_warehouse_id, unreservedAllowed: settings.unreservedAllowed, tolerancePct: q(settings.tolerancePct),
    materials: out };
}

// ------------------------------------------------------------------ posting check and reconciliation
// Does Inventory hold every movement the note recorded (and only those), and does Finance hold its journal for the value posted?
export async function checkMaterialIssuePosting(client, c, id) {
  needIssueView(c);
  const issue = await loadIssue(client, c, id);
  const problems = [];
  const posting = (await client.query(`SELECT * FROM tenant.manufacturing_material_issue_postings WHERE organization_id = $1 AND material_issue_id = $2 AND kind = 'ISSUE'`, [c.organizationId, issue.id])).rows[0];
  if (["POSTED", "RECOVERY_REQUIRED"].includes(issue.status) && !posting) problems.push("No posting record exists for this posted note.");
  let inventory = { status: posting ? "CONFIRMED" : UNPOSTED.has(issue.status) ? "NOT_POSTED" : "UNKNOWN", movements: 0, quantity: "0" };
  let finance = { status: posting?.finance_status ?? "NOT_POSTED", journalEntryId: posting?.journal_entry_id ?? null, amount: null };
  if (posting) {
    const movements = (await client.query(`SELECT id, quantity FROM tenant.stock_movements WHERE organization_id = $1 AND id = ANY($2::uuid[])`, [c.organizationId, posting.stock_movement_ids])).rows;
    const allocated = (await client.query(`SELECT count(*)::int AS n, COALESCE(sum(part.quantity), 0) AS quantity FROM tenant.manufacturing_material_issue_allocations part
        JOIN tenant.manufacturing_material_issue_lines line ON line.id = part.issue_line_id WHERE part.organization_id = $1 AND line.material_issue_id = $2`, [c.organizationId, issue.id])).rows[0];
    const lines = (await client.query(`SELECT COALESCE(sum(base_quantity), 0) AS quantity, count(*) FILTER (WHERE movement_id IS NULL)::int AS unposted FROM tenant.manufacturing_material_issue_lines
        WHERE organization_id = $1 AND material_issue_id = $2`, [c.organizationId, issue.id])).rows[0];
    const stockQuantity = movements.reduce((sum, row) => add(sum, D(String(Math.abs(Number(row.quantity))))), ZERO);
    if (movements.length !== posting.stock_movement_ids.length) problems.push(`Inventory holds ${movements.length} of the ${posting.stock_movement_ids.length} movements recorded.`);
    if (allocated.n !== posting.stock_movement_ids.length) problems.push("The note's allocations do not match its Inventory movements.");
    if (D(lines.quantity) !== stockQuantity) problems.push(`The note issued ${q(D(lines.quantity))}; Inventory moved ${q(stockQuantity)}.`);
    if (lines.unposted) problems.push(`${lines.unposted} line(s) have no movement record.`);
    inventory = { status: problems.length ? "MISMATCH" : "CONFIRMED", movements: movements.length, quantity: q(stockQuantity) };
    if (posting.finance_status === "POSTED") {
      const journal = posting.journal_entry_id ? (await client.query(`SELECT status, (SELECT COALESCE(sum(line.base_debit_amount), 0) FROM tenant.accounting_journal_lines line WHERE line.journal_entry_id = entry.id) AS debit
          FROM tenant.accounting_journal_entries entry WHERE entry.organization_id = $1 AND entry.id = $2`, [c.organizationId, posting.journal_entry_id])).rows[0] : null;
      if (!journal) problems.push("Finance has no journal for this issue.");
      else if (money(D(journal.debit)) !== money(D(posting.amount))) problems.push(`Finance holds ₹${money(D(journal.debit))}; the issue posted ₹${money(D(posting.amount))}.`);
      finance = { status: journal ? (problems.length ? "MISMATCH" : "POSTED") : "MISSING", journalEntryId: posting.journal_entry_id, amount: journal ? money(D(journal.debit)) : null };
    }
    if (posting.finance_status === "COST_MISSING") problems.push("Inventory had no valuation for part of this issue: its cost is missing, not zero. Give the item a cost and review the work in progress.");
  }
  return { issueId: issue.id, issueNumber: issue.issue_number, status: issue.status, consistent: problems.length === 0, problems, inventory, finance, checkedAt: new Date().toISOString() };
}

// Posted notes that need attention: marked for recovery, missing cost, or disagreeing with Inventory or Finance.
export async function getUnreconciledMaterialIssues(client, c) {
  needIssueView(c);
  const rows = (await client.query(`SELECT id FROM tenant.manufacturing_material_issues WHERE organization_id = $1 AND status IN ('POSTED', 'RECOVERY_REQUIRED') ORDER BY posted_at DESC LIMIT 500`, [c.organizationId])).rows;
  const out = [];
  for (const row of rows) {
    const check = await checkMaterialIssuePosting(client, c, row.id);
    if (!check.consistent || check.status === "RECOVERY_REQUIRED") out.push(check);
  }
  return out;
}

// ------------------------------------------------------------------ reports
// kind: by-mo | by-date | by-warehouse | by-component | planned-vs-issued | issued-vs-consumed | issued-vs-returned | usage-variance |
// traceability | unreconciled-custody | approval-history | posting-exceptions. filters: { from, to, warehouseId, orderId, itemId, batchId }
export async function getMaterialIssueReport(client, c, kind = "by-date", filters = {}) {
  needIssueView(c);
  const costView = has(c, MO.costView);
  const values = [c.organizationId];
  const bind = (value) => { values.push(value); return `$${values.length}`; };
  const where = ["issue.organization_id = $1", "issue.status IN ('POSTED', 'RECOVERY_REQUIRED')"];
  if (filters.from) where.push(`issue.posted_at >= ${bind(String(filters.from))}::date`);
  if (filters.to) where.push(`issue.posted_at < (${bind(String(filters.to))}::date + 1)`);
  if (filters.warehouseId) where.push(`issue.source_warehouse_id = ${bind(uuid(filters.warehouseId, "Warehouse"))}`);
  if (filters.orderId) where.push(`issue.manufacturing_order_id = ${bind(uuid(filters.orderId, "Manufacturing order"))}`);
  if (filters.itemId) where.push(`line.item_id = ${bind(uuid(filters.itemId, "Item"))}`);
  const posted = `FROM tenant.manufacturing_material_issues issue JOIN tenant.manufacturing_material_issue_lines line ON line.material_issue_id = issue.id
    JOIN tenant.manufacturing_orders mo ON mo.id = issue.manufacturing_order_id JOIN tenant.items item ON item.id = line.item_id JOIN tenant.units_of_measure uom ON uom.id = item.uom_id
    JOIN tenant.warehouses warehouse ON warehouse.id = issue.source_warehouse_id WHERE ${where.join(" AND ")}`;
  const cost = (value) => (costView ? money(D(value ?? 0)) : null);
  if (kind === "by-mo") {
    return (await client.query(`SELECT mo.id AS order_id, mo.mo_number, count(DISTINCT issue.id)::int AS issues, count(*)::int AS lines, max(issue.posted_at) AS last_issued, sum(line.total_cost) AS cost ${posted}
      GROUP BY mo.id, mo.mo_number ORDER BY max(issue.posted_at) DESC`, values)).rows.map((row) => ({ orderId: row.order_id, orderNumber: row.mo_number, issues: row.issues, lines: row.lines, lastIssuedAt: row.last_issued, cost: cost(row.cost) }));
  }
  if (kind === "by-date") {
    return (await client.query(`SELECT to_char(issue.posted_at, 'YYYY-MM-DD') AS day, count(DISTINCT issue.id)::int AS issues, count(*)::int AS lines, count(DISTINCT mo.id)::int AS orders, sum(line.total_cost) AS cost ${posted}
      GROUP BY 1 ORDER BY 1 DESC`, values)).rows.map((row) => ({ day: row.day, issues: row.issues, lines: row.lines, orders: row.orders, cost: cost(row.cost) }));
  }
  if (kind === "by-warehouse") {
    return (await client.query(`SELECT warehouse.code AS warehouse, count(DISTINCT issue.id)::int AS issues, count(*)::int AS lines, count(DISTINCT item.id)::int AS items, sum(line.total_cost) AS cost ${posted}
      GROUP BY 1 ORDER BY 1`, values)).rows.map((row) => ({ warehouse: row.warehouse, issues: row.issues, lines: row.lines, items: row.items, cost: cost(row.cost) }));
  }
  if (kind === "by-component") {
    return (await client.query(`SELECT item.id, item.code, item.name, uom.code AS uom, sum(line.base_quantity) AS quantity, sum(line.reversed_quantity) AS reversed, count(DISTINCT issue.id)::int AS issues,
        count(DISTINCT mo.id)::int AS orders, sum(line.total_cost) AS cost ${posted} GROUP BY item.id, item.code, item.name, uom.code ORDER BY item.code`, values)).rows
      .map((row) => ({ itemId: row.id, code: row.code, name: row.name, uom: row.uom, issued: q(D(row.quantity)), reversed: q(D(row.reversed)), issues: row.issues, orders: row.orders, cost: cost(row.cost) }));
  }
  if (["planned-vs-issued", "issued-vs-consumed", "issued-vs-returned", "unreconciled-custody"].includes(kind)) {
    const lineValues = [c.organizationId];
    const lineWhere = ["material.organization_id = $1"];
    if (filters.orderId) { lineValues.push(uuid(filters.orderId, "Manufacturing order")); lineWhere.push(`material.manufacturing_order_id = $${lineValues.length}`); }
    if (filters.itemId) { lineValues.push(uuid(filters.itemId, "Item")); lineWhere.push(`material.component_item_id = $${lineValues.length}`); }
    if (filters.warehouseId) { lineValues.push(uuid(filters.warehouseId, "Warehouse")); lineWhere.push(`mo.material_warehouse_id = $${lineValues.length}`); }
    if (kind === "unreconciled-custody") lineWhere.push("mo.status IN ('RELEASED', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETION_PENDING')");
    else lineWhere.push("material.issued_quantity > 0 OR mo.status IN ('RELEASED', 'IN_PROGRESS', 'ON_HOLD')");
    const rows = (await client.query(
      `SELECT material.*, mo.mo_number, mo.status AS order_status, item.code, item.name, uom.code AS uom,
              (SELECT max(movement.posted_at) FROM tenant.manufacturing_order_material_movements movement WHERE movement.material_id = material.id AND movement.direction = 'ISSUE') AS last_issued
         FROM tenant.manufacturing_order_materials material JOIN tenant.manufacturing_orders mo ON mo.id = material.manufacturing_order_id JOIN tenant.items item ON item.id = material.component_item_id
         JOIN tenant.units_of_measure uom ON uom.id = material.uom_id WHERE ${lineWhere.map((part) => `(${part})`).join(" AND ")} ORDER BY mo.mo_number, material.line_number LIMIT 2000`, lineValues)).rows;
    const out = rows.map((row) => {
      const figures = lineFigures(row);
      return { orderId: row.manufacturing_order_id, orderNumber: row.mo_number, orderStatusLabel: STATUS_LABEL[row.order_status], code: row.code, name: row.name, uom: row.uom,
        planned: q(D(row.planned_quantity)), extra: q(D(row.authorized_extra_quantity)), required: q(figures.required), issued: q(D(row.issued_quantity)), returned: q(D(row.returned_quantity)),
        reversed: q(D(row.reversed_quantity)), netIssued: q(figures.netIssued), consumed: q(figures.consumed), scrapped: q(figures.scrapped), inCustody: q(figures.custody),
        remainingToIssue: q(figures.toIssue), lastIssuedAt: row.last_issued,
        ageDays: row.last_issued ? Math.max(0, Math.floor((Date.now() - new Date(row.last_issued).getTime()) / 86_400_000)) : null };
    });
    return kind === "unreconciled-custody" ? out.filter((row) => D(row.inCustody) > ZERO) : out;
  }
  if (kind === "usage-variance") {
    const rows = (await client.query(`SELECT variance.*, mo.mo_number, item.code, issue.issue_number FROM tenant.manufacturing_order_material_variances variance
        JOIN tenant.manufacturing_orders mo ON mo.id = variance.manufacturing_order_id JOIN tenant.items item ON item.id = variance.component_item_id
        LEFT JOIN tenant.manufacturing_material_issues issue ON issue.id = variance.material_issue_id WHERE variance.organization_id = $1 ORDER BY variance.requested_at DESC LIMIT 1000`, [c.organizationId])).rows;
    const people = await names(client, rows.flatMap((row) => [row.requested_by, row.decided_by]));
    return rows.map((row) => ({ orderId: row.manufacturing_order_id, orderNumber: row.mo_number, code: row.code, quantity: q(D(row.quantity)), type: row.variance_type, reason: row.reason, status: row.status,
      requestedBy: people.get(row.requested_by) ?? null, decidedBy: people.get(row.decided_by) ?? null, at: row.requested_at, issueNumber: row.issue_number }));
  }
  if (kind === "traceability") {
    const extra = [];
    if (filters.batchId) extra.push(`part.batch_id = ${bind(uuid(filters.batchId, "Batch"))}`);
    if (filters.serial) extra.push(`lower(serial.serial_number) = lower(${bind(String(filters.serial))})`);
    const rows = (await client.query(`SELECT issue.issue_number, issue.id AS issue_id, mo.mo_number, mo.id AS order_id, item.code, uom.code AS uom, batch.batch_number, batch.expires_on, serial.serial_number,
        location.code AS location, part.quantity, part.reservation_id, issue.posted_at, issue.posted_by, line.reversed_quantity
        FROM tenant.manufacturing_material_issue_allocations part JOIN tenant.manufacturing_material_issue_lines line ON line.id = part.issue_line_id
        JOIN tenant.manufacturing_material_issues issue ON issue.id = line.material_issue_id JOIN tenant.manufacturing_orders mo ON mo.id = issue.manufacturing_order_id
        JOIN tenant.items item ON item.id = line.item_id JOIN tenant.units_of_measure uom ON uom.id = item.uom_id JOIN tenant.warehouses warehouse ON warehouse.id = issue.source_warehouse_id
        LEFT JOIN tenant.stock_batches batch ON batch.id = part.batch_id LEFT JOIN tenant.stock_serials serial ON serial.id = part.serial_id
        LEFT JOIN tenant.warehouse_locations location ON location.id = part.warehouse_location_id
       WHERE ${[...where, ...extra].join(" AND ")} ORDER BY issue.posted_at DESC LIMIT 2000`, values)).rows;
    const people = await names(client, rows.map((row) => row.posted_by));
    return rows.map((row) => ({ issueId: row.issue_id, issueNumber: row.issue_number, orderId: row.order_id, orderNumber: row.mo_number, code: row.code, uom: row.uom, batch: row.batch_number,
      expiresOn: row.expires_on, serial: row.serial_number, location: row.location, quantity: q(D(row.quantity)), fromReservation: Boolean(row.reservation_id), reversed: D(row.reversed_quantity) > ZERO,
      issuedBy: people.get(row.posted_by) ?? null, at: row.posted_at }));
  }
  if (kind === "approval-history") {
    const rows = (await client.query(`SELECT issue.*, mo.mo_number FROM tenant.manufacturing_material_issues issue JOIN tenant.manufacturing_orders mo ON mo.id = issue.manufacturing_order_id
        WHERE issue.organization_id = $1 AND issue.approval_status <> 'NOT_REQUIRED' ORDER BY issue.approval_requested_at DESC NULLS LAST LIMIT 1000`, [c.organizationId])).rows;
    const people = await names(client, rows.flatMap((row) => [row.approval_requested_by, row.approved_by]));
    return rows.map((row) => ({ issueId: row.id, issueNumber: row.issue_number, orderId: row.manufacturing_order_id, orderNumber: row.mo_number, status: row.status, approvalStatus: row.approval_status,
      type: row.variance_type, reason: row.approval_reason, requestedBy: people.get(row.approval_requested_by) ?? null, requestedAt: row.approval_requested_at, decidedBy: people.get(row.approved_by) ?? null,
      decidedAt: row.approved_at, note: row.approval_note }));
  }
  if (kind === "posting-exceptions") return getUnreconciledMaterialIssues(client, c);
  throw issueError(400, "MFG_ISSUE_QTY_INVALID", "Unknown report.");
}

export { ISSUE };
