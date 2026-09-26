import { createHash, randomUUID } from "node:crypto";

import { nextDocumentNumber } from "../../core/platform/numbering/index.js";
import { beginIdempotentOperation, completeIdempotentOperation } from "../../core/idempotency.js";
import { postStockMovement as postCanonicalStockMovement } from "../stock/index.js";

const RESOURCE_TABLES = Object.freeze({
  boms: "manufacturing_boms",
  routings: "manufacturing_routings",
  "work-centers": "manufacturing_work_centers",
  "work-orders": "manufacturing_work_orders",
  operations: "manufacturing_work_order_operations",
  "material-requirements": "manufacturing_material_requirements",
  "production-postings": "manufacturing_production_postings",
  scrap: "manufacturing_production_postings",
  "planning-runs": "manufacturing_planning_runs",
});

function assertPermission(context, permission) {
  if (
    !context.roleSlugs?.includes("organization_owner") &&
    !context.permissions?.includes(permission)
  ) {
    const error = new Error(`Missing permission: ${permission}`);
    error.code = "FORBIDDEN";
    throw error;
  }
}

function tableFor(resource) {
  const table = RESOURCE_TABLES[resource];
  if (!table) {
    const error = new Error("Unsupported manufacturing resource.");
    error.code = "INVALID_RESOURCE";
    throw error;
  }
  return table;
}

function contentHash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
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
    `INSERT INTO tenant.manufacturing_events
      (organization_id, company_id, aggregate_type, aggregate_id, event_type, payload, actor_user_id)
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

export async function getManufacturingDashboard(client, context) {
  assertPermission(context, "manufacturing.view");
  const result = await client.query(
    `SELECT
       count(*) FILTER (WHERE status IN ('released','in_progress'))::int AS active_work_orders,
       count(*) FILTER (WHERE status='planned')::int AS planned_work_orders,
       count(*) FILTER (WHERE status='completed')::int AS completed_work_orders,
       coalesce(sum(quantity_planned-quantity_completed)
         FILTER (WHERE status IN ('released','in_progress')),0)::text AS remaining_quantity
     FROM tenant.manufacturing_work_orders
     WHERE organization_id=$1 AND company_id=$2`,
    [context.organizationId, context.companyId],
  );
  const shortages = await client.query(
    `SELECT count(*)::int AS shortage_count
     FROM tenant.manufacturing_work_order_materials material
     LEFT JOIN tenant.stock_balances balance
       ON balance.organization_id=material.organization_id
      AND balance.item_id=material.item_id
      AND balance.warehouse_id=material.warehouse_id
     WHERE material.organization_id=$1
       AND coalesce(balance.quantity-balance.reserved_quantity,0)
         < greatest(material.required_quantity-material.issued_quantity,0)`,
    [context.organizationId],
  );
  return {
    ...result.rows[0],
    shortage_count: shortages.rows[0].shortage_count,
  };
}

export async function listManufacturingResource(
  client,
  context,
  resource,
  { limit = 100, offset = 0 } = {},
) {
  assertPermission(context, "manufacturing.view");
  const table = tableFor(resource);
  const result = await client.query(
    `SELECT * FROM tenant.${table}
     WHERE organization_id=$1
     ORDER BY created_at DESC NULLS LAST, id DESC
     LIMIT $2 OFFSET $3`,
    [
      context.organizationId,
      Math.min(Number(limit) || 100, 200),
      Number(offset) || 0,
    ],
  );
  return result.rows;
}

export async function createBillOfMaterial(client, context, input) {
  assertPermission(context, "manufacturing.bom.manage");
  if (
    !input.itemId ||
    !input.code ||
    !Array.isArray(input.components) ||
    input.components.length === 0
  ) {
    const error = new Error(
      "Item, BOM code and at least one component are required.",
    );
    error.code = "VALIDATION_ERROR";
    throw error;
  }

  const bom = await client.query(
    `INSERT INTO tenant.manufacturing_boms
      (organization_id,company_id,item_id,code,version,status,output_quantity,
       output_uom_id,effective_from,effective_to,is_default,notes,created_by)
     VALUES ($1,$2,$3,$4,$5,'draft',$6,$7,$8,$9,false,$10,$11)
     RETURNING *`,
    [
      context.organizationId,
      context.companyId,
      input.itemId,
      input.code,
      Number(input.version || 1),
      String(input.outputQuantity || 1),
      input.outputUomId || null,
      input.effectiveFrom || null,
      input.effectiveTo || null,
      input.notes || null,
      context.userId,
    ],
  );

  for (let index = 0; index < input.components.length; index += 1) {
    const component = input.components[index];
    await client.query(
      `INSERT INTO tenant.manufacturing_bom_components
        (organization_id,bom_id,line_number,item_id,quantity,uom_id,scrap_percent,
         issue_method,warehouse_id,operation_sequence,notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        context.organizationId,
        bom.rows[0].id,
        index + 1,
        component.itemId,
        String(component.quantity),
        component.uomId || null,
        String(component.scrapPercent || 0),
        component.issueMethod || "manual",
        component.warehouseId || null,
        component.operationSequence || null,
        component.notes || null,
      ],
    );
  }

  await event(
    client,
    context,
    "bom",
    bom.rows[0].id,
    "manufacturing.bom.created",
    {
      componentCount: input.components.length,
    },
  );
  return bom.rows[0];
}

export async function activateBillOfMaterial(client, context, bomId) {
  assertPermission(context, "manufacturing.bom.manage");
  const current = await client.query(
    `SELECT * FROM tenant.manufacturing_boms
     WHERE organization_id=$1 AND company_id=$2 AND id=$3
     FOR UPDATE`,
    [context.organizationId, context.companyId, bomId],
  );
  if (!current.rows[0]) throw new Error("BOM not found.");

  await client.query(
    `UPDATE tenant.manufacturing_boms
     SET status='inactive',is_default=false,updated_at=now()
     WHERE organization_id=$1 AND company_id=$2
       AND item_id=$3 AND status='active' AND id<>$4`,
    [context.organizationId, context.companyId, current.rows[0].item_id, bomId],
  );
  const updated = await client.query(
    `UPDATE tenant.manufacturing_boms
     SET status='active',is_default=true,approved_by=$4,approved_at=now(),updated_at=now()
     WHERE organization_id=$1 AND company_id=$2 AND id=$3
     RETURNING *`,
    [context.organizationId, context.companyId, bomId, context.userId],
  );
  await event(client, context, "bom", bomId, "manufacturing.bom.activated");
  return updated.rows[0];
}

export async function createWorkOrder(client, context, input) {
  assertPermission(context, "manufacturing.work_order.manage");
  const bom = await client.query(
    `SELECT * FROM tenant.manufacturing_boms
     WHERE organization_id=$1 AND company_id=$2 AND id=$3 AND status='active'`,
    [context.organizationId, context.companyId, input.bomId],
  );
  if (!bom.rows[0]) {
    const error = new Error("An active BOM is required.");
    error.code = "ACTIVE_BOM_REQUIRED";
    throw error;
  }

  const workOrderNumber = input.workOrderNumber || await nextDocumentNumber(client, context, {
    documentType: "manufacturing_work_order",
    prefix: "WO",
  });
  const snapshot = {
    bomId: input.bomId,
    routingId: input.routingId || null,
    quantity: String(input.quantity),
    plannedStartAt: input.plannedStartAt || null,
    plannedEndAt: input.plannedEndAt || null,
  };

  const workOrder = await client.query(
    `INSERT INTO tenant.manufacturing_work_orders
      (organization_id,company_id,branch_id,work_order_number,item_id,bom_id,routing_id,
       quantity_planned,status,source_type,source_id,priority,planned_start_at,planned_end_at,
       wip_warehouse_id,finished_goods_warehouse_id,content_hash,created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'planned',$9,$10,$11,$12,$13,$14,$15,$16,$17)
     RETURNING *`,
    [
      context.organizationId,
      context.companyId,
      input.branchId || null,
      workOrderNumber,
      bom.rows[0].item_id,
      input.bomId,
      input.routingId || null,
      String(input.quantity),
      input.sourceType || null,
      input.sourceId || null,
      input.priority || "normal",
      input.plannedStartAt || null,
      input.plannedEndAt || null,
      input.wipWarehouseId,
      input.finishedGoodsWarehouseId,
      contentHash(snapshot),
      context.userId,
    ],
  );

  await client.query(
    `INSERT INTO tenant.manufacturing_work_order_materials
      (organization_id,work_order_id,bom_component_id,item_id,warehouse_id,
       required_quantity,issue_method)
     SELECT component.organization_id,$1,component.id,component.item_id,
       coalesce(component.warehouse_id,$2),
       component.quantity * ($3::numeric / bom.output_quantity),
       component.issue_method
     FROM tenant.manufacturing_bom_components component
     JOIN tenant.manufacturing_boms bom ON bom.id=component.bom_id
     WHERE component.organization_id=$4 AND component.bom_id=$5`,
    [
      workOrder.rows[0].id,
      input.materialWarehouseId || input.wipWarehouseId,
      String(input.quantity),
      context.organizationId,
      input.bomId,
    ],
  );

  if (input.routingId) {
    await client.query(
      `INSERT INTO tenant.manufacturing_work_order_operations
        (organization_id,work_order_id,routing_operation_id,sequence,name,
         work_center_id,planned_minutes)
       SELECT operation.organization_id,$1,operation.id,operation.sequence,operation.name,
         operation.work_center_id,
         operation.setup_minutes + operation.queue_minutes + operation.move_minutes
           + operation.run_minutes_per_unit * $2::numeric
       FROM tenant.manufacturing_routing_operations operation
       WHERE operation.organization_id=$3 AND operation.routing_id=$4
       ORDER BY operation.sequence`,
      [
        workOrder.rows[0].id,
        String(input.quantity),
        context.organizationId,
        input.routingId,
      ],
    );
  }

  await event(
    client,
    context,
    "work_order",
    workOrder.rows[0].id,
    "manufacturing.work_order.created",
    snapshot,
  );
  return workOrder.rows[0];
}

export async function releaseWorkOrder(client, context, workOrderId) {
  assertPermission(context, "manufacturing.work_order.release");
  const shortages = await client.query(
    `SELECT material.item_id,
       greatest(material.required_quantity-material.issued_quantity,0) AS required,
       coalesce(sum(balance.quantity-balance.reserved_quantity),0) AS available
     FROM tenant.manufacturing_work_order_materials material
     LEFT JOIN tenant.stock_balances balance
       ON balance.organization_id=material.organization_id
      AND balance.item_id=material.item_id
      AND balance.warehouse_id=material.warehouse_id
     WHERE material.organization_id=$1 AND material.work_order_id=$2
     GROUP BY material.item_id,material.required_quantity,material.issued_quantity
     HAVING coalesce(sum(balance.quantity-balance.reserved_quantity),0)
       < greatest(material.required_quantity-material.issued_quantity,0)`,
    [context.organizationId, workOrderId],
  );
  if (shortages.rows.length) {
    const error = new Error("Work order has material shortages.");
    error.code = "MATERIAL_SHORTAGE";
    error.details = shortages.rows;
    throw error;
  }

  const result = await client.query(
    `UPDATE tenant.manufacturing_work_orders
     SET status='released',released_by=$4,released_at=now(),updated_at=now()
     WHERE organization_id=$1 AND company_id=$2 AND id=$3 AND status='planned'
     RETURNING *`,
    [context.organizationId, context.companyId, workOrderId, context.userId],
  );
  if (!result.rows[0])
    throw new Error("Only planned work orders can be released.");
  await event(
    client,
    context,
    "work_order",
    workOrderId,
    "manufacturing.work_order.released",
  );
  return result.rows[0];
}

export async function startWorkOrder(client, context, workOrderId) {
  assertPermission(context, "manufacturing.work_order.manage");
  const result = await client.query(
    `UPDATE tenant.manufacturing_work_orders
     SET status='in_progress',actual_start_at=coalesce(actual_start_at,now()),updated_at=now()
     WHERE organization_id=$1 AND company_id=$2 AND id=$3 AND status='released'
     RETURNING *`,
    [context.organizationId, context.companyId, workOrderId],
  );
  if (!result.rows[0])
    throw new Error("Only released work orders can be started.");
  await event(
    client,
    context,
    "work_order",
    workOrderId,
    "manufacturing.work_order.started",
  );
  return result.rows[0];
}

// Material issue / finished-goods receipt route through Stock's own
// postStockMovement (services/api/src/modules/stock/index.js) rather than a local
// fork, so stock_balances and stock_valuation_layers stay authoritative
// after a production posting — see docs/implementation/
// ERP_P0_INTEGRITY_FIXES_012.md Section 5. The augmented-permissions
// pattern below (`{ ...context, permissions: [...] }`) mirrors the
// existing precedent in stock/index.js's own completeStockTransfer(): the
// caller already passed assertPermission(context,
// "manufacturing.production.post") above, so this business operation is
// what authorizes the resulting stock movement — the caller does not need
// to separately hold stock.issue/stock.receive.

export async function postProduction(client, context, workOrderId, input) {
  assertPermission(context, "manufacturing.production.post");
  const idempotency = await beginIdempotentOperation(client, context, {
    operation: "manufacturing.production.post",
    key: input.idempotencyKey,
    payload: { workOrderId, ...input, idempotencyKey: undefined },
    required: true,
  });
  if (idempotency.replayed) return { ...idempotency.response, replayed: true };

  const workOrder = await client.query(
    `SELECT * FROM tenant.manufacturing_work_orders
     WHERE organization_id=$1 AND company_id=$2 AND id=$3
     FOR UPDATE`,
    [context.organizationId, context.companyId, workOrderId],
  );
  const row = workOrder.rows[0];
  if (!row || !["released", "in_progress"].includes(row.status)) {
    throw new Error("Work order must be released or in progress.");
  }

  const quantity = Number(input.quantity);
  if (!(quantity > 0))
    throw new Error("Production quantity must be greater than zero.");

  const settings = await client.query(
    `SELECT allow_overproduction,require_operation_completion
     FROM tenant.manufacturing_settings
     WHERE organization_id=$1 AND company_id=$2`,
    [context.organizationId, context.companyId],
  );
  const policy = settings.rows[0] || {
    allow_overproduction: false,
    require_operation_completion: true,
  };

  if (
    !policy.allow_overproduction &&
    Number(row.quantity_completed) + quantity > Number(row.quantity_planned)
  ) {
    const error = new Error(
      "Production quantity exceeds the planned work-order quantity.",
    );
    error.code = "OVERPRODUCTION_BLOCKED";
    throw error;
  }

  if (policy.require_operation_completion) {
    const incomplete = await client.query(
      `SELECT count(*)::int AS count
       FROM tenant.manufacturing_work_order_operations
       WHERE organization_id=$1 AND work_order_id=$2
         AND status NOT IN ('completed','skipped')`,
      [context.organizationId, workOrderId],
    );
    if (incomplete.rows[0].count > 0) {
      const error = new Error(
        "All required operations must be completed first.",
      );
      error.code = "OPERATIONS_INCOMPLETE";
      throw error;
    }
  }

  const materials = await client.query(
    `SELECT * FROM tenant.manufacturing_work_order_materials
     WHERE organization_id=$1 AND work_order_id=$2
     ORDER BY id`,
    [context.organizationId, workOrderId],
  );

  for (const material of materials.rows) {
    const requiredForPosting =
      Number(material.required_quantity) *
      (quantity / Number(row.quantity_planned));
    const balance = await client.query(
      `SELECT coalesce(sum(quantity-reserved_quantity),0)::text AS available
       FROM tenant.stock_balances
       WHERE organization_id=$1 AND company_id=$2
         AND item_id=$3 AND warehouse_id=$4`,
      [
        context.organizationId,
        context.companyId,
        material.item_id,
        material.warehouse_id,
      ],
    );
    if (Number(balance.rows[0].available) < requiredForPosting) {
      const error = new Error("Insufficient component stock for production.");
      error.code = "INSUFFICIENT_COMPONENT_STOCK";
      error.itemId = material.item_id;
      throw error;
    }

    const idempotencyKey = `${input.idempotencyKey}:material:${material.id}`;
    const stockMovement = await postCanonicalStockMovement(
      client,
      { ...context, permissions: [...(context.permissions || []), "stock.issue"] },
      {
        movementType: "issue",
        itemId: material.item_id,
        warehouseId: material.warehouse_id,
        warehouseLocationId: material.warehouse_location_id,
        batchId: material.batch_id,
        quantity: requiredForPosting,
        unitCost: input.materialUnitCosts?.[material.item_id] || 0,
        referenceType: "manufacturing_work_order",
        referenceId: workOrderId,
        reason: "Manufacturing material issue",
        idempotencyKey,
      },
    );
    const stockMovementId = stockMovement.id;

    await client.query(
      `INSERT INTO tenant.manufacturing_production_postings
        (organization_id,company_id,work_order_id,posting_number,posting_type,item_id,
         warehouse_id,warehouse_location_id,batch_id,quantity,unit_cost,
         stock_movement_id,idempotency_key,posted_by)
       VALUES ($1,$2,$3,$4,'material_issue',$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        context.organizationId,
        context.companyId,
        workOrderId,
        `MFG-ISSUE-${randomUUID()}`,
        material.item_id,
        material.warehouse_id,
        material.warehouse_location_id,
        material.batch_id,
        String(requiredForPosting),
        String(input.materialUnitCosts?.[material.item_id] || 0),
        stockMovementId,
        idempotencyKey,
        context.userId,
      ],
    );

    await client.query(
      `UPDATE tenant.manufacturing_work_order_materials
       SET issued_quantity=issued_quantity+$3
       WHERE organization_id=$1 AND id=$2`,
      [context.organizationId, material.id, String(requiredForPosting)],
    );
  }

  const receiptKey = `${input.idempotencyKey}:finished-goods`;
  const finishedStockMovement = await postCanonicalStockMovement(
    client,
    { ...context, permissions: [...(context.permissions || []), "stock.receive"] },
    {
      movementType: "receipt",
      itemId: row.item_id,
      warehouseId: row.finished_goods_warehouse_id,
      warehouseLocationId: input.warehouseLocationId,
      batchId: input.batchId,
      serialId: input.serialId,
      quantity,
      unitCost: input.unitCost || 0,
      referenceType: "manufacturing_work_order",
      referenceId: workOrderId,
      reason: "Manufacturing finished-goods receipt",
      idempotencyKey: receiptKey,
    },
  );
  const finishedMovementId = finishedStockMovement.id;

  await client.query(
    `INSERT INTO tenant.manufacturing_production_postings
      (organization_id,company_id,work_order_id,posting_number,posting_type,item_id,
       warehouse_id,warehouse_location_id,batch_id,serial_id,quantity,unit_cost,
       stock_movement_id,idempotency_key,posted_by)
     VALUES ($1,$2,$3,$4,'production_receipt',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [
      context.organizationId,
      context.companyId,
      workOrderId,
      `MFG-RECEIPT-${randomUUID()}`,
      row.item_id,
      row.finished_goods_warehouse_id,
      input.warehouseLocationId || null,
      input.batchId || null,
      input.serialId || null,
      String(quantity),
      String(input.unitCost || 0),
      finishedMovementId,
      receiptKey,
      context.userId,
    ],
  );

  const updated = await client.query(
    `UPDATE tenant.manufacturing_work_orders
     SET quantity_completed=quantity_completed+$4,
         status=CASE
           WHEN quantity_completed+$4 >= quantity_planned THEN 'completed'
           ELSE 'in_progress'
         END,
         actual_start_at=coalesce(actual_start_at,now()),
         actual_end_at=CASE
           WHEN quantity_completed+$4 >= quantity_planned THEN now()
           ELSE actual_end_at
         END,
         updated_at=now()
     WHERE organization_id=$1 AND company_id=$2 AND id=$3
     RETURNING *`,
    [context.organizationId, context.companyId, workOrderId, String(quantity)],
  );

  await event(
    client,
    context,
    "work_order",
    workOrderId,
    "manufacturing.production.posted",
    { quantity, finishedMovementId },
  );
  const response = { ...updated.rows[0], replayed: false };
  await completeIdempotentOperation(client, context, idempotency, {
    response,
    aggregateType: "manufacturing_work_order",
    aggregateId: workOrderId,
  });
  return response;
}
