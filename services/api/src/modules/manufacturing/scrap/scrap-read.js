// Manufacturing Scrap — the reads: one note (lines, identities, value, approval, posting, corrections, timeline), the list, what an order can
// scrap (issued material in custody per batch and serial unit; rejected output per entry), an order's scrap history, the posting check, the
// exceptions queue and the reports (by order, component, reason, production batch, date; planned against actual; cost; normal against
// abnormal; rejected-output disposition; recoverable scrap; by location; approvals and corrections). Values only with the cost permission.
import { custodyOf } from "../consumption/consumption-core.js";
import {
  D, REASONS, SCRAP, SCRAP_STATUS_LABEL, STATUS_LABEL, UNPOSTED, ZERO, add, approvalReasons, canSeeScrapCost, div, has, isoDay, lineFigures, loadMaterials, loadScrap, loadScrapLines,
  loadScrapOrder, money, mul, needScrap, plannedAllowance, q, rejectedSources, requireScrappable, scrapError, scrapSettings, sub, uuid,
} from "./scrap-core.js";

const names = async (client, ids) => {
  const list = [...new Set(ids.filter(Boolean))];
  if (!list.length) return new Map();
  return new Map((await client.query(`SELECT id, COALESCE(NULLIF(full_name, ''), email) AS name FROM public.users WHERE id = ANY($1::uuid[])`, [list])).rows.map((row) => [row.id, row.name]));
};
const ACTION_LABEL = Object.freeze({ CREATED: "Draft created", EDITED: "Draft edited", SUBMITTED: "Submitted for approval", APPROVED: "Approved", REJECTED: "Rejected", POSTED: "Posted",
  CANCELLED: "Cancelled", CORRECTION_REQUESTED: "Correction requested", CORRECTION_REJECTED: "Correction rejected", REVERSED: "Reversed", PRINTED: "Printed", REPRINTED: "Reprinted",
  RECOVERY_REQUIRED: "Marked for recovery", RECOVERED: "Recovered: Inventory and Finance agree" });
const pct = (part, whole) => (whole > ZERO ? (Number(part) / Number(whole) * 100).toFixed(2) : null);

// ------------------------------------------------------------------ one note
export async function getManufacturingScrap(client, c, id) {
  needScrap(c, SCRAP.view);
  const scrap = await loadScrap(client, c, id);
  const order = await loadScrapOrder(client, c, scrap.manufacturing_order_id);
  const rows = await loadScrapLines(client, c, scrap.id);
  const costView = canSeeScrapCost(c);
  const unposted = UNPOSTED.has(scrap.status);
  const lookups = async (sql, ids) => (ids.length ? new Map((await client.query(sql, [c.organizationId, ids])).rows.map((row) => [row.id, row])) : new Map());
  const warehouses = await lookups(`SELECT id, code, name FROM tenant.warehouses WHERE organization_id = $1 AND id = ANY($2::uuid[])`, [scrap.source_warehouse_id, scrap.destination_warehouse_id].filter(Boolean));
  const locations = await lookups(`SELECT id, code, name, disposition FROM tenant.warehouse_locations WHERE organization_id = $1 AND id = ANY($2::uuid[])`, [scrap.destination_location_id].filter(Boolean));
  const serials = await lookups(`SELECT id, serial_number FROM tenant.stock_serials WHERE organization_id = $1 AND id = ANY($2::uuid[])`, rows.flatMap((row) => row.serial_ids ?? []));
  const finished = (await client.query(`SELECT code, name FROM tenant.items WHERE id = $1`, [order.finished_item_id])).rows[0];
  const postings = (await client.query(`SELECT * FROM tenant.manufacturing_scrap_postings WHERE organization_id = $1 AND scrap_id = $2 ORDER BY created_at`, [c.organizationId, scrap.id])).rows;
  const corrections = (await client.query(`SELECT * FROM tenant.manufacturing_scrap_corrections WHERE organization_id = $1 AND scrap_id = $2 ORDER BY requested_at`, [c.organizationId, scrap.id])).rows;
  const events = (await client.query(`SELECT * FROM tenant.manufacturing_scrap_events WHERE organization_id = $1 AND scrap_id = $2 ORDER BY occurred_at`, [c.organizationId, scrap.id])).rows;
  const people = await names(client, [scrap.created_by, scrap.posted_by, scrap.approval_requested_by, scrap.approved_by, scrap.cancelled_by, ...events.map((row) => row.actor_user_id),
    ...corrections.flatMap((row) => [row.requested_by, row.decided_by])]);
  const settings = await scrapSettings(client, c);
  let live = true;
  try { requireScrappable(order, scrap.scrap_type); } catch { live = false; }
  // Where an unposted note stands now: the source quantities and its value.
  let sources = new Map();
  if (unposted) {
    if (scrap.scrap_type === "ISSUED_MATERIAL") for (const material of await loadMaterials(client, c, order.id)) sources.set(material.id, { custody: q(lineFigures(material).custody) });
    else sources = new Map((await rejectedSources(client, c, order)).map((entry) => [entry.row.id, { rejected: q(entry.figures.rejected), undisposed: q(entry.figures.undisposed) }]));
  }
  const total = scrap.total_cost !== null ? D(scrap.total_cost) : null;
  const reasons = unposted ? approvalReasons(settings, scrap, total) : (scrap.approval_reasons ?? []);
  const approved = scrap.approval_status === "APPROVED" && scrap.approval_hash === scrap.content_hash;
  const open = corrections.find((row) => row.status === "REQUESTED") ?? null;
  const posting = postings.find((row) => row.kind === "SCRAP") ?? null;
  const mayDecide = (requester) => has(c, SCRAP.approve) && (requester !== c.userId || settings.varianceSelfApproval);
  return {
    id: scrap.id, number: scrap.scrap_number, status: scrap.status, statusLabel: SCRAP_STATUS_LABEL[scrap.status], rowVersion: scrap.row_version, scrapType: scrap.scrap_type,
    reasonCode: scrap.reason_code, reasonLabel: REASONS[scrap.reason_code], description: scrap.description, disposition: scrap.disposition, lossClass: scrap.loss_class,
    recoveryValue: scrap.recovery_value === null ? null : money(D(scrap.recovery_value)), scrapDate: isoDay(scrap.scrap_date), correctionStatus: scrap.correction_status,
    createdBy: people.get(scrap.created_by) ?? null, createdAt: scrap.created_at, postedBy: people.get(scrap.posted_by) ?? null, postedAt: scrap.posted_at,
    cancelledBy: people.get(scrap.cancelled_by) ?? null, cancelledAt: scrap.cancelled_at, cancelReason: scrap.cancel_reason,
    order: { id: order.id, number: order.mo_number, status: order.status, statusLabel: STATUS_LABEL[order.status], version: order.version, finishedItem: finished, snapshotId: order.bom_snapshot_id },
    source: { warehouse: warehouses.get(scrap.source_warehouse_id) ?? null },
    destination: scrap.destination_location_id ? { warehouse: warehouses.get(scrap.destination_warehouse_id) ?? null, location: locations.get(scrap.destination_location_id) ?? null } : null,
    approval: { required: reasons.length > 0, reasons, valid: !reasons.length || approved, status: scrap.approval_status, requestedBy: people.get(scrap.approval_requested_by) ?? null,
      requestedAt: scrap.approval_requested_at, decidedBy: people.get(scrap.approved_by) ?? null, decidedAt: scrap.approved_at, note: scrap.approval_note,
      stale: scrap.approval_status === "APPROVED" && scrap.approval_hash !== scrap.content_hash },
    lines: rows.map((row) => ({
      id: row.id, lineNumber: row.line_number, itemId: row.item_id, code: row.item_code, name: row.item_name, trackingType: row.tracking_type, materialId: row.material_id,
      productionEntryId: row.production_entry_id, entryNumber: row.entry_number, productionBatch: row.production_batch, qualityDecisionId: row.quality_decision_id,
      quantity: q(D(row.quantity)), uomId: row.uom_id, uom: row.uom_code, baseQuantity: q(D(row.base_quantity)), baseUom: row.base_uom_code,
      batch: row.batch_id ? { id: row.batch_id, number: row.batch_number } : null, serials: (row.serial_ids ?? []).map((serialId) => ({ id: serialId, number: serials.get(serialId)?.serial_number ?? null })),
      notes: row.notes, now: sources.get(row.material_id ?? row.production_entry_id) ?? null,
      unitCost: costView && row.unit_cost !== null ? q(D(row.unit_cost)) : null, totalCost: costView && row.total_cost !== null ? money(D(row.total_cost)) : null, stockMovementIds: row.stock_movement_ids ?? [],
    })),
    totals: { lines: rows.length, cost: costView && total !== null ? money(total) : null, financeStatus: scrap.finance_status },
    posting: posting ? { key: posting.command_key, inventoryStatus: posting.inventory_status, stockMovementIds: posting.stock_movement_ids, financeStatus: posting.finance_status,
      journalEntryId: costView ? posting.journal_entry_id : null, at: posting.created_at } : null,
    corrections: corrections.map((row) => ({ id: row.id, number: row.correction_number, status: row.status, reason: row.reason, evidence: row.evidence, physicallyPresent: row.physically_present,
      requestedBy: people.get(row.requested_by) ?? null, requestedAt: row.requested_at, decidedBy: people.get(row.decided_by) ?? null, decidedAt: row.decided_at, note: row.decision_note,
      cost: costView && row.total_cost !== null ? money(D(row.total_cost)) : null })),
    print: { count: scrap.print_count, lastPrintedAt: scrap.last_printed_at, watermark: scrap.status === "POSTED" ? (scrap.correction_status === "REVERSED" ? "REVERSED" : null) : scrap.status === "CANCELLED" ? "CANCELLED" : "DRAFT" },
    history: events.map((row) => ({ action: row.action, label: ACTION_LABEL[row.action] ?? row.action, fromStatus: row.from_status, toStatus: row.to_status, summary: row.summary,
      actor: people.get(row.actor_user_id) ?? null, at: row.occurred_at })),
    can: {
      edit: unposted && has(c, SCRAP.editDraft) && live, cancel: unposted && has(c, SCRAP.editDraft),
      submit: scrap.status === "DRAFT" && has(c, SCRAP.submit) && live && reasons.length > 0 && !approved,
      decide: scrap.status === "PENDING_APPROVAL" && has(c, SCRAP.approve) && ((scrap.approval_requested_by !== c.userId && scrap.created_by !== c.userId) || settings.varianceSelfApproval),
      post: ["DRAFT", "APPROVED"].includes(scrap.status) && has(c, SCRAP.post) && live && (!reasons.length || approved) && (scrap.disposition !== "RECOVERABLE" || has(c, "stock.receive")),
      requestCorrection: scrap.status === "POSTED" && ["NONE", "REJECTED"].includes(scrap.correction_status) && has(c, SCRAP.correct),
      decideCorrection: Boolean(open) && mayDecide(open?.requested_by), print: has(c, SCRAP.export), viewCost: costView,
      recover: ["POSTED", "RECOVERY_REQUIRED"].includes(scrap.status) && has(c, SCRAP.approve),
    },
  };
}

// ------------------------------------------------------------------ list
// filters: { status, type, disposition, lossClass, reason, orderId, itemId, correction, approval, from, to, search }
export async function listManufacturingScraps(client, c, filters = {}) {
  needScrap(c, SCRAP.view);
  const values = [c.organizationId];
  const where = ["scrap.organization_id = $1"];
  const bind = (value) => { values.push(value); return `$${values.length}`; };
  if (filters.status) where.push(`scrap.status = ${bind(String(filters.status).toUpperCase())}`);
  if (filters.type) where.push(`scrap.scrap_type = ${bind(String(filters.type).toUpperCase())}`);
  if (filters.disposition) where.push(`scrap.disposition = ${bind(String(filters.disposition).toUpperCase())}`);
  if (filters.lossClass) where.push(`scrap.loss_class = ${bind(String(filters.lossClass).toUpperCase())}`);
  if (filters.reason) where.push(`scrap.reason_code = ${bind(String(filters.reason).toUpperCase())}`);
  if (filters.correction) where.push(`scrap.correction_status = ${bind(String(filters.correction).toUpperCase())}`);
  if (filters.orderId) where.push(`scrap.manufacturing_order_id = ${bind(uuid(filters.orderId, "Manufacturing order"))}`);
  if (filters.itemId) where.push(`EXISTS (SELECT 1 FROM tenant.manufacturing_scrap_lines line WHERE line.scrap_id = scrap.id AND line.item_id = ${bind(uuid(filters.itemId, "Item"))})`);
  if (filters.from) where.push(`COALESCE(scrap.posted_at, scrap.created_at) >= ${bind(String(filters.from))}::date`);
  if (filters.to) where.push(`COALESCE(scrap.posted_at, scrap.created_at) < (${bind(String(filters.to))}::date + 1)`);
  if (filters.search) {
    const term = bind(`%${String(filters.search).trim().toLowerCase()}%`);
    where.push(`(lower(scrap.scrap_number) LIKE ${term} OR lower(mo.mo_number) LIKE ${term} OR EXISTS (SELECT 1 FROM tenant.manufacturing_scrap_lines line JOIN tenant.items item ON item.id = line.item_id
      WHERE line.scrap_id = scrap.id AND (lower(item.code) LIKE ${term} OR lower(item.name) LIKE ${term})))`);
  }
  const rows = (await client.query(
    `SELECT scrap.*, mo.mo_number, mo.status AS order_status, finished.code AS finished_code, finished.name AS finished_name, location.code AS location_code,
            (SELECT string_agg(item.code || ' ' || trim(trailing '.' FROM trim(trailing '0' FROM line.base_quantity::text)), ', ' ORDER BY line.line_number)
               FROM tenant.manufacturing_scrap_lines line JOIN tenant.items item ON item.id = line.item_id WHERE line.scrap_id = scrap.id) AS summary
       FROM tenant.manufacturing_scraps scrap JOIN tenant.manufacturing_orders mo ON mo.id = scrap.manufacturing_order_id JOIN tenant.items finished ON finished.id = mo.finished_item_id
       LEFT JOIN tenant.warehouse_locations location ON location.id = scrap.destination_location_id
      WHERE ${where.join(" AND ")} ORDER BY COALESCE(scrap.posted_at, scrap.created_at) DESC LIMIT 500`, values)).rows;
  const people = await names(client, rows.flatMap((row) => [row.created_by, row.posted_by]));
  const costView = canSeeScrapCost(c);
  return rows.map((row) => ({
    id: row.id, number: row.scrap_number, status: row.status, statusLabel: SCRAP_STATUS_LABEL[row.status], scrapType: row.scrap_type, reasonCode: row.reason_code, reasonLabel: REASONS[row.reason_code],
    disposition: row.disposition, lossClass: row.loss_class, correctionStatus: row.correction_status, approvalStatus: row.approval_status, orderId: row.manufacturing_order_id,
    orderNumber: row.mo_number, orderStatusLabel: STATUS_LABEL[row.order_status], finishedItem: `${row.finished_code} · ${row.finished_name}`, summary: row.summary, location: row.location_code,
    createdBy: people.get(row.created_by) ?? null, postedBy: people.get(row.posted_by) ?? null, createdAt: row.created_at, postedAt: row.posted_at,
    totalCost: costView && row.total_cost !== null ? money(D(row.total_cost)) : null, printed: row.print_count,
  }));
}
export const getMoScrapHistory = (client, c, orderId) => listManufacturingScraps(client, c, { orderId });

// ------------------------------------------------------------------ what an order can scrap
export async function getScrappableSources(client, c, orderId) {
  needScrap(c, SCRAP.view);
  const order = await loadScrapOrder(client, c, orderId);
  const eligibility = (type) => { try { requireScrappable(order, type); return { eligible: true, reason: null }; } catch (error) { return { eligible: false, reason: error.message }; } };
  const materials = await loadMaterials(client, c, order.id);
  const held = await custodyOf(client, c, order, materials);
  const batchIds = [...new Set([...held.values()].flatMap((entry) => [...entry.pools.values()].map((pool) => pool.key)).filter((key) => key !== "-"))];
  const identities = batchIds.length ? new Map((await client.query(
    `SELECT id, batch_number AS label, 'batch' AS kind FROM tenant.stock_batches WHERE organization_id = $1 AND id = ANY($2::uuid[])
     UNION ALL SELECT id, serial_number AS label, 'serial' AS kind FROM tenant.stock_serials WHERE organization_id = $1 AND id = ANY($2::uuid[])`, [c.organizationId, batchIds])).rows.map((row) => [row.id, row])) : new Map();
  const outputs = await rejectedSources(client, c, order);
  const bins = (await client.query(`SELECT location.id, location.code, location.name, location.disposition, warehouse.code AS warehouse FROM tenant.warehouse_locations location
      JOIN tenant.warehouses warehouse ON warehouse.id = location.warehouse_id WHERE location.organization_id = $1 AND location.status = 'active' AND location.allow_stock
        AND location.disposition IN ('damaged', 'quarantined') AND warehouse.status = 'active' ORDER BY warehouse.code, location.code`, [c.organizationId])).rows;
  const finished = (await client.query(`SELECT item.code, item.name, item.tracking_type, uom.code AS uom FROM tenant.items item JOIN tenant.units_of_measure uom ON uom.id = item.uom_id WHERE item.id = $1`,
    [order.finished_item_id])).rows[0];
  const settings = await scrapSettings(client, c);
  return {
    orderId: order.id, orderNumber: order.mo_number, orderStatus: order.status, orderStatusLabel: STATUS_LABEL[order.status], orderVersion: order.version,
    material: eligibility("ISSUED_MATERIAL"), output: eligibility("REJECTED_OUTPUT"),
    policy: { valueAbove: settings.valueAbove === null ? null : money(settings.valueAbove), outputRequiresApproval: settings.outputRequiresApproval, abnormalRequiresApproval: settings.abnormalRequiresApproval },
    finishedItem: { id: order.finished_item_id, ...finished, uomId: order.output_uom_id },
    reasons: Object.entries(REASONS).map(([value, label]) => ({ value, label })), bins,
    materials: materials.map((material) => {
      const figures = lineFigures(material);
      const pools = [...(held.get(material.id)?.pools.values() ?? [])].filter((pool) => pool.key !== "-" && pool.available > ZERO);
      return { materialId: material.id, itemId: material.component_item_id, code: material.item_code, name: material.item_name, uomId: material.uom_id, uom: material.uom_code,
        trackingType: material.tracking_type, netIssued: q(figures.netIssued), consumed: q(figures.consumed), scrapped: q(figures.scrapped), returned: q(D(material.returned_quantity)),
        inCustody: q(figures.custody),
        identities: pools.map((pool) => ({ id: pool.key, label: identities.get(pool.key)?.label ?? pool.key, kind: identities.get(pool.key)?.kind ?? "batch", available: q(pool.available) })) };
    }),
    entries: outputs.map((entry) => ({ id: entry.row.id, number: entry.row.entry_number, batch: entry.row.batch_reference, producedAt: entry.row.produced_at, reported: q(entry.figures.reported),
      accepted: q(entry.figures.accepted), rejected: q(entry.figures.rejected), scrapped: q(entry.figures.scrapped), undisposed: q(entry.figures.undisposed), qualityDisposition: entry.row.quality_disposition })),
  };
}

// ------------------------------------------------------------------ posting check, exceptions
export async function checkScrapPosting(client, c, id) {
  needScrap(c, SCRAP.view);
  const scrap = await loadScrap(client, c, id);
  const problems = [];
  const posting = (await client.query(`SELECT * FROM tenant.manufacturing_scrap_postings WHERE organization_id = $1 AND scrap_id = $2 AND kind = 'SCRAP'`, [c.organizationId, scrap.id])).rows[0];
  if (["POSTED", "RECOVERY_REQUIRED"].includes(scrap.status) && !posting) problems.push("No posting record exists for this posted scrap note.");
  let inventory = { status: posting?.inventory_status ?? (UNPOSTED.has(scrap.status) ? "NOT_POSTED" : "UNKNOWN"), movements: 0 };
  let finance = { status: posting?.finance_status ?? "NOT_POSTED", amount: null };
  if (posting) {
    if (posting.stock_movement_ids.length) {
      const found = Number((await client.query(`SELECT count(*) AS n FROM tenant.stock_movements WHERE organization_id = $1 AND id = ANY($2::uuid[])`, [c.organizationId, posting.stock_movement_ids])).rows[0].n);
      if (found !== posting.stock_movement_ids.length) problems.push(`Inventory holds ${found} of the ${posting.stock_movement_ids.length} scrap-bin movements recorded.`);
      inventory = { status: problems.length ? "MISMATCH" : "CONFIRMED", movements: found };
    }
    if (scrap.scrap_type === "ISSUED_MATERIAL") {
      const custody = (await client.query(`SELECT COALESCE(sum(quantity), 0) AS n FROM tenant.manufacturing_material_scrap WHERE organization_id = $1 AND scrap_id = $2`, [c.organizationId, scrap.id])).rows[0].n;
      const lines = (await client.query(`SELECT COALESCE(sum(base_quantity), 0) AS n FROM tenant.manufacturing_scrap_lines WHERE organization_id = $1 AND scrap_id = $2`, [c.organizationId, scrap.id])).rows[0].n;
      if (D(custody) !== D(lines)) problems.push(`The note scrapped ${q(D(lines))}; production custody recorded ${q(D(custody))}.`);
    }
    if (posting.finance_status === "POSTED") {
      const journal = posting.journal_entry_id ? (await client.query(`SELECT (SELECT COALESCE(sum(line.base_debit_amount), 0) FROM tenant.accounting_journal_lines line WHERE line.journal_entry_id = entry.id) AS debit
          FROM tenant.accounting_journal_entries entry WHERE entry.organization_id = $1 AND entry.id = $2`, [c.organizationId, posting.journal_entry_id])).rows[0] : null;
      if (!journal) problems.push("Finance has no journal for this scrap.");
      else if (money(D(journal.debit)) !== money(D(posting.amount))) problems.push(`Finance holds ₹${money(D(journal.debit))}; the scrap posted ₹${money(D(posting.amount))}.`);
      finance = { status: journal ? (problems.length ? "MISMATCH" : "POSTED") : "MISSING", amount: journal ? money(D(journal.debit)) : null };
    }
  }
  return { scrapId: scrap.id, scrapNumber: scrap.scrap_number, status: scrap.status, consistent: problems.length === 0, problems, inventory, finance, checkedAt: new Date().toISOString() };
}

// What needs someone: scrap waiting for approval, approved and not posted, corrections waiting, postings needing recovery, recoverable scrap
// sitting in a scrap bin, and rejected output nobody has disposed of.
export async function getScrapExceptions(client, c) {
  needScrap(c, SCRAP.view);
  const out = [];
  const waiting = (await client.query(`SELECT scrap.id, scrap.scrap_number, scrap.status, scrap.approval_requested_at, scrap.approved_at, mo.mo_number, mo.id AS order_id FROM tenant.manufacturing_scraps scrap
      JOIN tenant.manufacturing_orders mo ON mo.id = scrap.manufacturing_order_id WHERE scrap.organization_id = $1 AND scrap.status IN ('PENDING_APPROVAL', 'APPROVED') ORDER BY scrap.created_at`, [c.organizationId])).rows;
  for (const row of waiting) out.push({ kind: row.status === "PENDING_APPROVAL" ? "APPROVAL_PENDING" : "APPROVED_NOT_POSTED", scrapId: row.id, scrapNumber: row.scrap_number, orderId: row.order_id,
    orderNumber: row.mo_number, since: row.status === "PENDING_APPROVAL" ? row.approval_requested_at : row.approved_at,
    message: row.status === "PENDING_APPROVAL" ? "Waits for an approval." : "Approved but not posted." });
  const corrections = (await client.query(`SELECT correction.*, scrap.scrap_number, mo.mo_number, mo.id AS order_id FROM tenant.manufacturing_scrap_corrections correction
      JOIN tenant.manufacturing_scraps scrap ON scrap.id = correction.scrap_id JOIN tenant.manufacturing_orders mo ON mo.id = scrap.manufacturing_order_id
     WHERE correction.organization_id = $1 AND correction.status = 'REQUESTED' ORDER BY correction.requested_at`, [c.organizationId])).rows;
  for (const row of corrections) out.push({ kind: "CORRECTION_PENDING", scrapId: row.scrap_id, scrapNumber: row.scrap_number, orderId: row.order_id, orderNumber: row.mo_number, since: row.requested_at,
    message: `${row.correction_number}: ${row.reason}` });
  for (const row of (await client.query(`SELECT id FROM tenant.manufacturing_scraps WHERE organization_id = $1 AND status IN ('POSTED', 'RECOVERY_REQUIRED') ORDER BY posted_at DESC LIMIT 300`, [c.organizationId])).rows) {
    const check = await checkScrapPosting(client, c, row.id);
    if (!check.consistent || check.status === "RECOVERY_REQUIRED") {
      const scrap = await loadScrap(client, c, row.id);
      out.push({ kind: "POSTING_MISMATCH", scrapId: row.id, scrapNumber: check.scrapNumber, orderId: scrap.manufacturing_order_id, orderNumber: null, since: scrap.posted_at, message: check.problems.join(" ") || "Marked for recovery." });
    }
  }
  const undisposed = (await client.query(`SELECT entry.id, entry.entry_number, mo.id AS order_id, mo.mo_number, entry.posted_at,
        entry.rejected_quantity + COALESCE((SELECT sum(decision.rejected_quantity) FROM tenant.manufacturing_quality_decisions decision WHERE decision.production_entry_id = entry.id), 0)
          - (entry.output_scrapped_quantity - entry.output_scrap_reversed_quantity) AS open
       FROM tenant.manufacturing_production_entries entry JOIN tenant.manufacturing_orders mo ON mo.id = entry.manufacturing_order_id
      WHERE entry.organization_id = $1 AND entry.status = 'REPORTED' AND mo.status IN ('IN_PROGRESS', 'ON_HOLD', 'COMPLETION_PENDING')`, [c.organizationId])).rows.filter((row) => D(row.open) > ZERO);
  for (const row of undisposed) out.push({ kind: "REJECTED_NOT_DISPOSED", scrapId: null, scrapNumber: null, orderId: row.order_id, orderNumber: row.mo_number, since: row.posted_at,
    message: `${row.entry_number}: ${q(D(row.open))} rejected output not yet disposed of.` });
  return out;
}

// ------------------------------------------------------------------ reports
// kind: by-mo | by-component | by-reason | by-batch | by-date | planned-vs-actual | cost | normal-abnormal | rejected-disposition | recoverable | by-location | approvals
export async function getScrapReport(client, c, kind = "by-date", filters = {}) {
  needScrap(c, SCRAP.view);
  const costView = canSeeScrapCost(c);
  const cost = (value) => (costView ? money(D(value ?? 0)) : null);
  const values = [c.organizationId];
  const bind = (value) => { values.push(value); return `$${values.length}`; };
  // Posted, not reversed: a reversed note counts nothing.
  const where = ["scrap.organization_id = $1", "scrap.status IN ('POSTED', 'RECOVERY_REQUIRED')", "scrap.correction_status <> 'REVERSED'"];
  if (filters.from) where.push(`scrap.posted_at >= ${bind(String(filters.from))}::date`);
  if (filters.to) where.push(`scrap.posted_at < (${bind(String(filters.to))}::date + 1)`);
  if (filters.orderId) where.push(`scrap.manufacturing_order_id = ${bind(uuid(filters.orderId, "Manufacturing order"))}`);
  if (filters.itemId) where.push(`line.item_id = ${bind(uuid(filters.itemId, "Item"))}`);
  const posted = `FROM tenant.manufacturing_scraps scrap JOIN tenant.manufacturing_scrap_lines line ON line.scrap_id = scrap.id JOIN tenant.manufacturing_orders mo ON mo.id = scrap.manufacturing_order_id
    JOIN tenant.items item ON item.id = line.item_id JOIN tenant.units_of_measure uom ON uom.id = item.uom_id WHERE ${where.join(" AND ")}`;
  if (kind === "by-mo") {
    return (await client.query(`SELECT mo.id, mo.mo_number, count(DISTINCT scrap.id)::int AS notes, count(*) FILTER (WHERE scrap.scrap_type = 'ISSUED_MATERIAL')::int AS material_lines,
        count(*) FILTER (WHERE scrap.scrap_type = 'REJECTED_OUTPUT')::int AS output_lines, sum(line.total_cost) AS cost, max(scrap.posted_at) AS last ${posted} GROUP BY mo.id, mo.mo_number ORDER BY max(scrap.posted_at) DESC`, values)).rows
      .map((row) => ({ orderId: row.id, orderNumber: row.mo_number, notes: row.notes, materialLines: row.material_lines, outputLines: row.output_lines, cost: cost(row.cost), lastAt: row.last }));
  }
  if (kind === "by-component") {
    return (await client.query(`SELECT item.id, item.code, item.name, uom.code AS uom, sum(line.base_quantity) AS quantity, count(DISTINCT mo.id)::int AS orders, sum(line.total_cost) AS cost ${posted}
        AND scrap.scrap_type = 'ISSUED_MATERIAL' GROUP BY item.id, item.code, item.name, uom.code ORDER BY sum(line.total_cost) DESC NULLS LAST`, values)).rows
      .map((row) => ({ itemId: row.id, code: row.code, name: row.name, uom: row.uom, quantity: q(D(row.quantity)), orders: row.orders, cost: cost(row.cost) }));
  }
  if (kind === "by-reason") {
    return (await client.query(`SELECT scrap.reason_code, count(DISTINCT scrap.id)::int AS notes, sum(line.total_cost) AS cost ${posted} GROUP BY 1 ORDER BY sum(line.total_cost) DESC NULLS LAST`, values)).rows
      .map((row) => ({ reason: REASONS[row.reason_code] ?? row.reason_code, notes: row.notes, cost: cost(row.cost) }));
  }
  if (kind === "by-batch") {
    return (await client.query(
      `SELECT mo.id AS order_id, mo.mo_number, COALESCE(pbatch.batch_reference, '—') AS batch, entry.entry_number, uom.code AS uom, sum(line.base_quantity) AS quantity, sum(line.total_cost) AS cost
         FROM tenant.manufacturing_scraps scrap JOIN tenant.manufacturing_scrap_lines line ON line.scrap_id = scrap.id JOIN tenant.manufacturing_orders mo ON mo.id = scrap.manufacturing_order_id
         JOIN tenant.items item ON item.id = line.item_id JOIN tenant.units_of_measure uom ON uom.id = item.uom_id
         JOIN tenant.manufacturing_production_entries entry ON entry.id = line.production_entry_id LEFT JOIN tenant.manufacturing_production_batches pbatch ON pbatch.id = entry.production_batch_id
        WHERE ${where.join(" AND ")} GROUP BY 1, 2, 3, 4, 5 ORDER BY 2, 3`, values)).rows
      .map((row) => ({ orderId: row.order_id, orderNumber: row.mo_number, batch: row.batch, entryNumber: row.entry_number, uom: row.uom, quantity: q(D(row.quantity)), cost: cost(row.cost) }));
  }
  if (kind === "by-date") {
    return (await client.query(`SELECT to_char(scrap.posted_at, 'YYYY-MM-DD') AS day, count(DISTINCT scrap.id)::int AS notes, count(DISTINCT mo.id)::int AS orders, sum(line.total_cost) AS cost ${posted} GROUP BY 1 ORDER BY 1 DESC`, values)).rows
      .map((row) => ({ day: row.day, notes: row.notes, orders: row.orders, cost: cost(row.cost) }));
  }
  if (kind === "cost" || kind === "normal-abnormal") {
    return (await client.query(`SELECT scrap.scrap_type, scrap.disposition, scrap.loss_class, count(DISTINCT scrap.id)::int AS notes, sum(line.total_cost) AS cost ${posted} GROUP BY 1, 2, 3 ORDER BY 1, 2, 3`, values)).rows
      .map((row) => ({ type: row.scrap_type, disposition: row.disposition, lossClass: row.loss_class, notes: row.notes, cost: cost(row.cost),
        treatment: row.disposition === "RECOVERABLE" ? "In the scrap bin at source value" : row.loss_class === "ABNORMAL" ? "Written off to manufacturing variance" : "Absorbed by the order's cost" }));
  }
  if (kind === "recoverable") {
    return (await client.query(`SELECT scrap.id AS scrap_id, scrap.scrap_number, mo.id AS order_id, mo.mo_number, item.code, uom.code AS uom, line.base_quantity, line.total_cost, scrap.recovery_value,
        location.code AS location, warehouse.code AS warehouse, scrap.posted_at ${posted.replace("WHERE", `JOIN tenant.warehouse_locations location ON location.id = scrap.destination_location_id
        JOIN tenant.warehouses warehouse ON warehouse.id = scrap.destination_warehouse_id WHERE`)} AND scrap.disposition = 'RECOVERABLE' ORDER BY scrap.posted_at DESC`, values)).rows
      .map((row) => ({ scrapId: row.scrap_id, scrapNumber: row.scrap_number, orderId: row.order_id, orderNumber: row.mo_number, code: row.code, uom: row.uom, quantity: q(D(row.base_quantity)),
        sourceCost: cost(row.total_cost), recoveryValue: costView && row.recovery_value !== null ? money(D(row.recovery_value)) : null, location: `${row.warehouse} / ${row.location}`, at: row.posted_at }));
  }
  if (kind === "by-location") {
    return (await client.query(`SELECT COALESCE(warehouse.code || ' / ' || location.code, source.code || ' (disposed)') AS place, count(DISTINCT scrap.id)::int AS notes, sum(line.total_cost) AS cost
        ${posted.replace("WHERE", `JOIN tenant.warehouses source ON source.id = scrap.source_warehouse_id LEFT JOIN tenant.warehouse_locations location ON location.id = scrap.destination_location_id
        LEFT JOIN tenant.warehouses warehouse ON warehouse.id = scrap.destination_warehouse_id WHERE`)} GROUP BY 1 ORDER BY 1`, values)).rows
      .map((row) => ({ place: row.place, notes: row.notes, cost: cost(row.cost) }));
  }
  if (kind === "planned-vs-actual") {
    // Per material line: the BOM's planned allowance against actual scrap, and the material scrap rate against what was issued.
    const lineValues = [c.organizationId];
    const lineWhere = ["material.organization_id = $1", "material.issued_quantity > 0"];
    if (filters.orderId) { lineValues.push(uuid(filters.orderId, "Manufacturing order")); lineWhere.push(`material.manufacturing_order_id = $${lineValues.length}`); }
    const rows = (await client.query(`SELECT material.*, mo.mo_number, item.code, item.name, uom.code AS uom, bom.scrap_allowance_pct FROM tenant.manufacturing_order_materials material
        JOIN tenant.manufacturing_orders mo ON mo.id = material.manufacturing_order_id JOIN tenant.items item ON item.id = material.component_item_id JOIN tenant.units_of_measure uom ON uom.id = material.uom_id
        LEFT JOIN tenant.manufacturing_bom_lines bom ON bom.id = material.bom_line_id WHERE ${lineWhere.join(" AND ")} ORDER BY mo.mo_number, material.line_number LIMIT 2000`, lineValues)).rows;
    return rows.map((row) => {
      const figures = lineFigures(row);
      const allowance = plannedAllowance(row, row.scrap_allowance_pct);
      return { orderId: row.manufacturing_order_id, orderNumber: row.mo_number, code: row.code, name: row.name, uom: row.uom, planned: q(D(row.planned_quantity)),
        allowancePct: row.scrap_allowance_pct === null ? null : q(D(row.scrap_allowance_pct)), plannedScrap: q(allowance), actualScrap: q(figures.scrapped), netIssued: q(figures.netIssued),
        scrapRatePct: pct(figures.scrapped, figures.netIssued), overAllowance: figures.scrapped > allowance ? q(sub(figures.scrapped, allowance)) : "0" };
    });
  }
  if (kind === "rejected-disposition") {
    // Per order: output reported, rejected (the output rejection rate) and what became of the rejected output.
    const rows = (await client.query(`SELECT mo.id, mo.mo_number, mo.status, item.code, uom.code AS uom, mo.reported_quantity, mo.rejected_quantity,
        (SELECT COALESCE(sum(entry.output_scrapped_quantity - entry.output_scrap_reversed_quantity), 0) FROM tenant.manufacturing_production_entries entry WHERE entry.manufacturing_order_id = mo.id) AS scrapped
        FROM tenant.manufacturing_orders mo JOIN tenant.items item ON item.id = mo.finished_item_id JOIN tenant.units_of_measure uom ON uom.id = item.uom_id
       WHERE mo.organization_id = $1 AND mo.rejected_quantity > 0 ${filters.orderId ? "AND mo.id = $2" : ""} ORDER BY mo.mo_number DESC LIMIT 1000`,
      filters.orderId ? [c.organizationId, uuid(filters.orderId, "Manufacturing order")] : [c.organizationId])).rows;
    return rows.map((row) => ({ orderId: row.id, orderNumber: row.mo_number, orderStatusLabel: STATUS_LABEL[row.status], code: row.code, uom: row.uom, reported: q(D(row.reported_quantity)),
      rejected: q(D(row.rejected_quantity)), rejectionRatePct: pct(D(row.rejected_quantity), D(row.reported_quantity)), scrapped: q(D(row.scrapped)),
      undisposed: q(sub(D(row.rejected_quantity), D(row.scrapped)) > ZERO ? sub(D(row.rejected_quantity), D(row.scrapped)) : ZERO) }));
  }
  if (kind === "approvals") {
    const rows = (await client.query(`SELECT scrap.*, mo.mo_number FROM tenant.manufacturing_scraps scrap JOIN tenant.manufacturing_orders mo ON mo.id = scrap.manufacturing_order_id
        WHERE scrap.organization_id = $1 AND (scrap.approval_status <> 'NOT_REQUIRED' OR scrap.correction_status <> 'NONE') ORDER BY scrap.created_at DESC LIMIT 1000`, [c.organizationId])).rows;
    const corrections = (await client.query(`SELECT * FROM tenant.manufacturing_scrap_corrections WHERE organization_id = $1`, [c.organizationId])).rows;
    const people = await names(client, [...rows.flatMap((row) => [row.approval_requested_by, row.approved_by]), ...corrections.flatMap((row) => [row.requested_by, row.decided_by])]);
    return rows.map((row) => {
      const correction = corrections.filter((entry) => entry.scrap_id === row.id).pop();
      return { scrapId: row.id, scrapNumber: row.scrap_number, orderId: row.manufacturing_order_id, orderNumber: row.mo_number, status: row.status, approvalStatus: row.approval_status,
        reasons: (row.approval_reasons ?? []).join(", "), requestedBy: people.get(row.approval_requested_by) ?? null, decidedBy: people.get(row.approved_by) ?? null, note: row.approval_note,
        correction: correction ? `${correction.correction_number} ${correction.status.toLowerCase()}: ${correction.reason}` : null };
    });
  }
  throw scrapError(400, "MFG_SCRAP_STATE_INVALID", "Unknown report.");
}

export { SCRAP, add, div, mul };
