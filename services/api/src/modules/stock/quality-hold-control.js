
// Quality holds follow the stock: postStockMovement calls followHeldStock for every movement the hold workflow did not post itself, so a hold
// case always explains where its held stock is and what happened to it, whichever document moved it.
//   Out of a held position  the active allocations there give up what left: returned to the supplier (purchase return), disposed of (goods
//                           issue), adjusted (adjustment, count, transit loss), issued (anything else) — the hold's unresolved quantity falls —
//                           or, for a move (location or disposition move, transfer out, out of transit), carried: the allocation travels.
//   Into a position         a movement that carries held stock (holdCarryFrom, or the transfer leg it took its value from) takes the travelling
//                           allocations with it: into another held position (or transit) the hold continues there; into available stock it is
//                           released; into damaged stock it is resolved as damaged.
// Hold workflow movements (holdOperation) are recorded by the workflow itself.

const EPS = 1e-9;
const round = (value) => Math.round(Number(value) * 1e6) / 1e6;
const MOVE_TYPES = new Set(["location_transfer_out", "disposition_out", "transfer_out", "transfer_from_transit"]);

async function dispositionOf(client, organizationId, locationId) {
  if (!locationId) return { disposition: "available", transit: false };
  const row = (await client.query(`SELECT disposition, location_type, purpose FROM tenant.warehouse_locations WHERE organization_id = $1 AND id = $2`, [organizationId, locationId])).rows[0];
  if (!row) return { disposition: "available", transit: false };
  const disposition = row.disposition === "available" && (row.location_type === "quality" || row.purpose === "quality_hold") ? "quality_hold" : row.disposition;
  return { disposition, transit: row.purpose === "transit" };
}

// The hold's status from what its lines still hold.
export async function refreshHoldStatus(client, c, holdId) {
  const row = (await client.query(
    `SELECT hold.status, COALESCE(sum(line.unresolved_base_quantity), 0) AS unresolved, COALESCE(sum(line.original_base_quantity), 0) AS original
       FROM tenant.inventory_stock_holds hold LEFT JOIN tenant.inventory_stock_hold_lines line ON line.organization_id = hold.organization_id AND line.hold_id = hold.id
      WHERE hold.organization_id = $1 AND hold.id = $2 GROUP BY hold.id`, [c.organizationId, holdId])).rows[0];
  if (!row || !["active", "partially_resolved", "resolved"].includes(row.status)) return row?.status ?? null;
  const status = Number(row.unresolved) <= EPS ? "resolved" : Number(row.unresolved) + EPS < Number(row.original) ? "partially_resolved" : "active";
  if (status !== row.status)
    await client.query(
      `UPDATE tenant.inventory_stock_holds SET status = $3, resolved_at = CASE WHEN $3 = 'resolved' THEN now() ELSE NULL END, resolved_by = CASE WHEN $3 = 'resolved' THEN $4::uuid ELSE NULL END,
              version = version + 1, updated_at = now() WHERE organization_id = $1 AND id = $2`, [c.organizationId, holdId, status, c.userId ?? null]);
  return status;
}

export async function holdEvent(client, c, holdId, eventType, summary, details = {}) {
  await client.query(`INSERT INTO tenant.inventory_stock_hold_events (organization_id, hold_id, event_type, summary, details, actor_user_id) VALUES ($1, $2, $3, $4, $5, $6)`,
    [c.organizationId, holdId, eventType, String(summary).slice(0, 1000), JSON.stringify(details), c.userId ?? null]);
}

export async function recordResolution(client, c, fields) {
  await client.query(
    `INSERT INTO tenant.inventory_stock_hold_resolutions (organization_id, hold_id, line_id, allocation_id, action, quantity, from_disposition, to_disposition, from_location_id, to_location_id,
       movement_id, document_type, document_id, document_number, reason, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
    [c.organizationId, fields.holdId, fields.lineId, fields.allocationId ?? null, fields.action, round(fields.quantity), fields.fromDisposition ?? null, fields.toDisposition ?? null,
      fields.fromLocationId ?? null, fields.toLocationId ?? null, fields.movementId ?? null, fields.documentType ?? null, fields.documentId ?? null, fields.documentNumber ?? null,
      fields.reason ?? null, c.userId ?? null]);
}

const ACTION_LABEL = { purchase_return: "returned to the supplier", disposed: "disposed of", adjusted: "adjusted out", issued: "issued", released: "released", damaged: "moved to damaged" };

export async function followHeldStock(client, c, { input, movement, signed, ledgerType, group }) {
  if (input.holdOperation) return;
  const document = { documentType: group?.source_document_type ?? movement.reference_type, documentId: group?.source_document_id ?? movement.reference_id,
    documentNumber: group?.source_document_number ?? movement.movement_number };
  if (signed < 0) {
    const allocations = (await client.query(
      `SELECT allocation.*, allocation.held_base_quantity - allocation.resolved_base_quantity AS remaining FROM tenant.inventory_stock_hold_allocations allocation
        WHERE allocation.organization_id = $1 AND allocation.item_id = $2 AND allocation.warehouse_id = $3 AND allocation.location_id IS NOT DISTINCT FROM $4
          AND allocation.batch_id IS NOT DISTINCT FROM $5 AND ($6::uuid IS NULL OR allocation.serial_id = $6) AND allocation.status = 'active'
          AND (allocation.carried_reference_id IS NULL OR allocation.carried_reference_id = $7)
        ORDER BY allocation.created_at, allocation.id FOR UPDATE`,
      [c.organizationId, movement.item_id, movement.warehouse_id, movement.warehouse_location_id, movement.batch_id, movement.serial_id, input.referenceId ?? null])).rows;
    if (!allocations.length) return;
    const carry = MOVE_TYPES.has(ledgerType);
    const action = carry ? "transferred" : ledgerType === "purchase_return" ? "purchase_return"
      : ledgerType === "adjustment_out" && document.documentType === "goods_issue" ? "disposed" : ["adjustment_out", "reversal"].includes(ledgerType) ? "adjusted" : "issued";
    let left = Math.abs(Number(signed));
    for (const allocation of allocations) {
      if (left <= EPS) break;
      const take = round(Math.min(left, Number(allocation.remaining)));
      if (take <= EPS) continue;
      left = round(left - take);
      const full = take + EPS >= Number(allocation.remaining);
      await client.query(`UPDATE tenant.inventory_stock_hold_allocations SET resolved_base_quantity = resolved_base_quantity + $3, status = CASE WHEN $4 THEN $5 ELSE status END,
          version = version + 1, updated_at = now() WHERE organization_id = $1 AND id = $2`, [c.organizationId, allocation.id, take, full, carry ? "moved" : "resolved"]);
      await recordResolution(client, c, { holdId: allocation.hold_id, lineId: allocation.line_id, allocationId: allocation.id, action, quantity: take, fromDisposition: allocation.current_disposition,
        fromLocationId: allocation.location_id, movementId: movement.id, ...document });
      if (!carry) {
        await client.query(`UPDATE tenant.inventory_stock_hold_lines SET unresolved_base_quantity = greatest(unresolved_base_quantity - $3, 0), version = version + 1, updated_at = now()
            WHERE organization_id = $1 AND id = $2`, [c.organizationId, allocation.line_id, take]);
        await holdEvent(client, c, allocation.hold_id, action, `${take} ${ACTION_LABEL[action]} by ${document.documentNumber}`, { movementId: movement.id, allocationId: allocation.id, ...document });
        await refreshHoldStatus(client, c, allocation.hold_id);
      }
    }
    return;
  }
  const carriedFrom = input.holdCarryFrom ?? input.valueFromMovementId ?? null;
  if (!carriedFrom) return;
  const travelling = (await client.query(
    `SELECT resolution.allocation_id, resolution.hold_id, resolution.line_id, sum(resolution.quantity) AS quantity, allocation.current_disposition
       FROM tenant.inventory_stock_hold_resolutions resolution
       JOIN tenant.inventory_stock_hold_allocations allocation ON allocation.organization_id = resolution.organization_id AND allocation.id = resolution.allocation_id
      WHERE resolution.organization_id = $1 AND resolution.movement_id = $2 AND resolution.action = 'transferred'
      GROUP BY resolution.allocation_id, resolution.hold_id, resolution.line_id, allocation.current_disposition`, [c.organizationId, carriedFrom])).rows;
  if (!travelling.length) return;
  const destination = await dispositionOf(client, c.organizationId, movement.warehouse_location_id);
  for (const entry of travelling) {
    const quantity = round(Number(entry.quantity));
    if (destination.transit || ["quality_hold", "quarantined"].includes(destination.disposition)) {
      const disposition = destination.transit ? entry.current_disposition : destination.disposition;
      await client.query(
        `INSERT INTO tenant.inventory_stock_hold_allocations (organization_id, hold_id, line_id, item_id, warehouse_id, location_id, batch_id, serial_id, held_base_quantity, current_disposition,
           carried_from_allocation_id, carried_reference_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [c.organizationId, entry.hold_id, entry.line_id, movement.item_id, movement.warehouse_id, movement.warehouse_location_id, movement.batch_id, movement.serial_id, quantity, disposition,
          entry.allocation_id, destination.transit ? input.referenceId ?? null : null]);
      if (!destination.transit && disposition !== entry.current_disposition)
        await holdEvent(client, c, entry.hold_id, "disposition_changed", `${quantity} now ${disposition.replace("_", " ")} (${document.documentNumber})`, { movementId: movement.id });
      continue;
    }
    // Into available stock: released (by the document that moved it); into damaged: resolved as damaged.
    const action = destination.disposition === "damaged" ? "damaged" : "released";
    await recordResolution(client, c, { holdId: entry.hold_id, lineId: entry.line_id, allocationId: entry.allocation_id, action, quantity, fromDisposition: entry.current_disposition,
      toDisposition: destination.disposition, toLocationId: movement.warehouse_location_id, movementId: movement.id, ...document });
    await client.query(`UPDATE tenant.inventory_stock_hold_lines SET unresolved_base_quantity = greatest(unresolved_base_quantity - $3, 0), version = version + 1, updated_at = now()
        WHERE organization_id = $1 AND id = $2`, [c.organizationId, entry.line_id, quantity]);
    await holdEvent(client, c, entry.hold_id, action, `${quantity} ${ACTION_LABEL[action]} by ${document.documentNumber}`, { movementId: movement.id });
    await refreshHoldStatus(client, c, entry.hold_id);
  }
}

// Stock still held by an active case at a position (what a new hold may not take again).
export async function heldByCases(client, organizationId, { itemId, warehouseId, locationId, batchId, serialId = null }) {
  return Number((await client.query(
    `SELECT COALESCE(sum(held_base_quantity - resolved_base_quantity), 0) AS q FROM tenant.inventory_stock_hold_allocations WHERE organization_id = $1 AND item_id = $2 AND warehouse_id = $3
        AND location_id IS NOT DISTINCT FROM $4 AND batch_id IS NOT DISTINCT FROM $5 AND ($6::uuid IS NULL OR serial_id = $6) AND status = 'active'`,
    [organizationId, itemId, warehouseId, locationId ?? null, batchId ?? null, serialId])).rows[0].q);
}

