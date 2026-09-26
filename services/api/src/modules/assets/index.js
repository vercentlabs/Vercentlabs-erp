import { createHash } from "node:crypto";

import { nextDocumentNumber } from "../../core/platform/numbering/index.js";

const TABLES = Object.freeze({
  assets: "assets",
  categories: "asset_categories",
  assignments: "asset_assignments",
  transfers: "asset_transfers",
  "maintenance-plans": "asset_maintenance_plans",
  "maintenance-orders": "asset_maintenance_orders",
  inspections: "asset_inspections",
  "depreciation-runs": "asset_depreciation_runs",
  disposals: "asset_disposals",
  "audit-events": "asset_events",
});

const ASSET_CHILD_TABLES = new Set(["asset_assignments"]);

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

function hash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function table(resource) {
  const value = TABLES[resource];
  if (!value) throw new Error("Unsupported asset resource.");
  return value;
}

async function event(client, context, assetId, eventType, payload = {}) {
  await client.query(
    `INSERT INTO tenant.asset_events
      (organization_id,company_id,asset_id,event_type,payload,actor_user_id)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6)`,
    [
      context.organizationId,
      context.companyId,
      assetId,
      eventType,
      JSON.stringify(payload),
      context.userId,
    ],
  );
}

export async function getAssetsDashboard(client, context) {
  requirePermission(context, "assets.view");
  const assets = await client.query(
    `SELECT
       count(*)::int AS total_assets,
       count(*) FILTER (WHERE status='assigned')::int AS assigned_assets,
       count(*) FILTER (WHERE status='in_maintenance')::int AS assets_in_maintenance,
       count(*) FILTER (WHERE warranty_end_date BETWEEN current_date AND current_date+30)::int AS warranties_expiring,
       coalesce(sum(net_book_value),0)::text AS total_net_book_value
     FROM tenant.assets
     WHERE organization_id=$1 AND company_id=$2
       AND status NOT IN ('disposed')`,
    [context.organizationId, context.companyId],
  );
  const due = await client.query(
    `SELECT count(*)::int AS maintenance_due
     FROM tenant.asset_maintenance_plans
     WHERE organization_id=$1 AND company_id=$2
       AND active=true AND next_due_date <= current_date+30`,
    [context.organizationId, context.companyId],
  );
  return { ...assets.rows[0], ...due.rows[0] };
}

export async function listAssetResource(
  client,
  context,
  resource,
  { limit = 100, offset = 0, assetId = null } = {},
) {
  requirePermission(context, "assets.view");
  const target = table(resource);
  const values = [context.organizationId, context.companyId];
  const childTable = ASSET_CHILD_TABLES.has(target);
  const from = childTable
    ? `tenant.${target} record JOIN tenant.assets asset ON asset.id=record.asset_id AND asset.organization_id=record.organization_id`
    : `tenant.${target} record`;
  const companyFilter = childTable
    ? "asset.company_id=$2"
    : "record.company_id=$2";
  const orderColumn = target === "asset_events" ? "occurred_at" : "created_at";
  let filter = "";
  if (assetId && target !== "assets" && target !== "asset_categories") {
    values.push(assetId);
    filter = ` AND record.asset_id=$${values.length}`;
  }
  values.push(Math.min(Number(limit) || 100, 200), Number(offset) || 0);
  const result = await client.query(
    `SELECT record.* FROM ${from}
     WHERE record.organization_id=$1 AND ${companyFilter}${filter}
     ORDER BY record.${orderColumn} DESC NULLS LAST,record.id DESC
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values,
  );
  return result.rows;
}

export async function createManagedAssetCategory(client, context, input) {
  requirePermission(context, "assets.settings.manage");
  const result = await client.query(
    `INSERT INTO tenant.asset_categories
      (organization_id,company_id,code,name,description,capitalization_threshold,
       useful_life_months,depreciation_method,residual_value_percent,
       asset_account_id,accumulated_depreciation_account_id,
       depreciation_expense_account_id,gain_loss_account_id,created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     RETURNING *`,
    [
      context.organizationId,
      context.companyId,
      input.code,
      input.name,
      input.description || null,
      String(input.capitalizationThreshold || 0),
      Number(input.usefulLifeMonths || 60),
      input.depreciationMethod || "straight_line",
      String(input.residualValuePercent || 0),
      input.assetAccountId || null,
      input.accumulatedDepreciationAccountId || null,
      input.depreciationExpenseAccountId || null,
      input.gainLossAccountId || null,
      context.userId,
    ],
  );
  return result.rows[0];
}

export async function createManagedAsset(client, context, input) {
  requirePermission(context, "assets.create");
  const category = await client.query(
    `SELECT * FROM tenant.asset_categories
     WHERE organization_id=$1 AND company_id=$2 AND id=$3 AND active=true`,
    [context.organizationId, context.companyId, input.categoryId],
  );
  if (!category.rows[0]) throw new Error("Active asset category not found.");

  const number = input.assetNumber || await nextDocumentNumber(client, context, {
    documentType: "asset",
    prefix: "AST",
  });
  const acquisitionCost = Number(input.acquisitionCost || 0);
  const residualValue =
    input.residualValue !== undefined
      ? Number(input.residualValue)
      : acquisitionCost *
        (Number(category.rows[0].residual_value_percent) / 100);
  const result = await client.query(
    `INSERT INTO tenant.assets
      (organization_id,company_id,branch_id,asset_number,name,description,
       category_id,item_id,serial_number,manufacturer,model,purchase_order_id,
       procurement_receipt_id,vendor_bill_id,acquisition_date,acquisition_cost,
       capitalized_cost,residual_value,net_book_value,currency_code,
       useful_life_months,depreciation_method,status,warranty_start_date,
       warranty_end_date,content_hash,created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
       0,$17,0,$18,$19,$20,'draft',$21,$22,$23,$24)
     RETURNING *`,
    [
      context.organizationId,
      context.companyId,
      input.branchId || null,
      number,
      input.name,
      input.description || null,
      input.categoryId,
      input.itemId || null,
      input.serialNumber || null,
      input.manufacturer || null,
      input.model || null,
      input.purchaseOrderId || null,
      input.procurementReceiptId || null,
      input.vendorBillId || null,
      input.acquisitionDate || null,
      String(acquisitionCost),
      String(residualValue),
      input.currencyCode || "INR",
      Number(input.usefulLifeMonths || category.rows[0].useful_life_months),
      input.depreciationMethod || category.rows[0].depreciation_method,
      input.warrantyStartDate || null,
      input.warrantyEndDate || null,
      hash(input),
      context.userId,
    ],
  );
  await event(client, context, result.rows[0].id, "asset.created");
  return result.rows[0];
}

export async function capitalizeManagedAsset(
  client,
  context,
  assetId,
  input = {},
) {
  requirePermission(context, "assets.capitalize");
  const current = await client.query(
    `SELECT * FROM tenant.assets
     WHERE organization_id=$1 AND company_id=$2 AND id=$3 FOR UPDATE`,
    [context.organizationId, context.companyId, assetId],
  );
  const asset = current.rows[0];
  if (!asset || asset.status !== "draft") {
    throw new Error("Only draft assets can be capitalized.");
  }
  if (asset.created_by === context.userId) {
    const error = new Error(
      "The asset creator cannot capitalize the same asset.",
    );
    error.code = "SELF_APPROVAL_BLOCKED";
    throw error;
  }
  const capitalizedCost = Number(
    input.capitalizedCost ?? asset.acquisition_cost,
  );
  const result = await client.query(
    `UPDATE tenant.assets
     SET status='available',capitalization_date=$4,
       placed_in_service_date=coalesce($5,$4),
       capitalized_cost=$6,net_book_value=$6,
       depreciation_start_date=coalesce($5,$4),
       capitalized_by=$7,capitalized_at=now(),updated_at=now()
     WHERE organization_id=$1 AND company_id=$2 AND id=$3
     RETURNING *`,
    [
      context.organizationId,
      context.companyId,
      assetId,
      input.capitalizationDate || new Date().toISOString().slice(0, 10),
      input.placedInServiceDate || null,
      String(capitalizedCost),
      context.userId,
    ],
  );
  await event(client, context, assetId, "asset.capitalized", {
    capitalizedCost,
  });
  return result.rows[0];
}

export async function assignAsset(client, context, assetId, input) {
  requirePermission(context, "assets.assign");
  const current = await client.query(
    `SELECT * FROM tenant.assets
     WHERE organization_id=$1 AND company_id=$2 AND id=$3 FOR UPDATE`,
    [context.organizationId, context.companyId, assetId],
  );
  if (
    !current.rows[0] ||
    !["available", "assigned"].includes(current.rows[0].status)
  ) {
    throw new Error("Asset is not available for assignment.");
  }

  await client.query(
    `UPDATE tenant.asset_assignments
     SET assignment_status='returned',returned_at=now(),returned_by=$3
     WHERE organization_id=$1 AND asset_id=$2 AND assignment_status='active'`,
    [context.organizationId, assetId, context.userId],
  );

  const assignment = await client.query(
    `INSERT INTO tenant.asset_assignments
      (organization_id,asset_id,assigned_to_user_id,assigned_to_department_id,
       assigned_to_cost_center_id,location_text,assigned_until,condition_out,assigned_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING *`,
    [
      context.organizationId,
      assetId,
      input.userId || null,
      input.departmentId || null,
      input.costCenterId || null,
      input.locationText || null,
      input.assignedUntil || null,
      input.conditionOut || null,
      context.userId,
    ],
  );

  await client.query(
    `UPDATE tenant.assets
     SET status='assigned',current_user_id=$4,current_department_id=$5,
       current_cost_center_id=$6,current_location_text=$7,updated_at=now()
     WHERE organization_id=$1 AND company_id=$2 AND id=$3`,
    [
      context.organizationId,
      context.companyId,
      assetId,
      input.userId || null,
      input.departmentId || null,
      input.costCenterId || null,
      input.locationText || null,
    ],
  );

  await event(client, context, assetId, "asset.assigned", {
    assignmentId: assignment.rows[0].id,
  });
  return assignment.rows[0];
}

export async function createMaintenanceOrder(client, context, assetId, input) {
  requirePermission(context, "assets.maintain");
  const workOrderNumber = input.workOrderNumber || await nextDocumentNumber(client, context, {
    documentType: "asset_maintenance_order",
    prefix: "AMO",
  });
  const result = await client.query(
    `INSERT INTO tenant.asset_maintenance_orders
      (organization_id,company_id,asset_id,maintenance_plan_id,work_order_number,
       maintenance_type,priority,status,scheduled_start_at,scheduled_end_at,
       internal_owner_user_id,supplier_id,procurement_document_id,created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'planned',$8,$9,$10,$11,$12,$13)
     RETURNING *`,
    [
      context.organizationId,
      context.companyId,
      assetId,
      input.maintenancePlanId || null,
      workOrderNumber,
      input.maintenanceType || "preventive",
      input.priority || "normal",
      input.scheduledStartAt || null,
      input.scheduledEndAt || null,
      input.internalOwnerUserId || null,
      input.supplierId || null,
      input.procurementDocumentId || null,
      context.userId,
    ],
  );
  await event(client, context, assetId, "asset.maintenance_order.created", {
    maintenanceOrderId: result.rows[0].id,
  });
  return result.rows[0];
}

export async function completeMaintenanceOrder(
  client,
  context,
  orderId,
  input,
) {
  requirePermission(context, "assets.maintain");
  const order = await client.query(
    `SELECT * FROM tenant.asset_maintenance_orders
     WHERE organization_id=$1 AND company_id=$2 AND id=$3 FOR UPDATE`,
    [context.organizationId, context.companyId, orderId],
  );
  if (
    !order.rows[0] ||
    !["planned", "scheduled", "in_progress"].includes(order.rows[0].status)
  ) {
    throw new Error("Maintenance order cannot be completed.");
  }
  const result = await client.query(
    `UPDATE tenant.asset_maintenance_orders
     SET status='completed',actual_start_at=coalesce(actual_start_at,now()),
       actual_end_at=now(),downtime_hours=$4,labor_cost=$5,parts_cost=$6,
       external_cost=$7,findings=$8,resolution=$9,updated_at=now()
     WHERE organization_id=$1 AND company_id=$2 AND id=$3
     RETURNING *`,
    [
      context.organizationId,
      context.companyId,
      orderId,
      String(input.downtimeHours || 0),
      String(input.laborCost || 0),
      String(input.partsCost || 0),
      String(input.externalCost || 0),
      input.findings || null,
      input.resolution || null,
    ],
  );
  await client.query(
    `UPDATE tenant.assets
     SET status=CASE WHEN status='in_maintenance' THEN 'available' ELSE status END,
       updated_at=now()
     WHERE organization_id=$1 AND company_id=$2 AND id=$3`,
    [context.organizationId, context.companyId, order.rows[0].asset_id],
  );
  await event(
    client,
    context,
    order.rows[0].asset_id,
    "asset.maintenance_order.completed",
    { maintenanceOrderId: orderId },
  );
  return result.rows[0];
}

export async function disposeManagedAsset(client, context, assetId, input) {
  requirePermission(context, "assets.dispose");
  const assetResult = await client.query(
    `SELECT * FROM tenant.assets
     WHERE organization_id=$1 AND company_id=$2 AND id=$3 FOR UPDATE`,
    [context.organizationId, context.companyId, assetId],
  );
  const asset = assetResult.rows[0];
  if (!asset || ["disposed", "draft"].includes(asset.status)) {
    throw new Error("Asset cannot be disposed in its current state.");
  }
  if (asset.created_by === context.userId) {
    const error = new Error("The asset creator cannot approve its disposal.");
    error.code = "SELF_APPROVAL_BLOCKED";
    throw error;
  }
  const proceeds = Number(input.proceedsAmount || 0);
  const disposalCost = Number(input.disposalCost || 0);
  const netBookValue = Number(asset.net_book_value);
  const gainLoss = proceeds - disposalCost - netBookValue;
  const disposalNumber = input.disposalNumber || await nextDocumentNumber(client, context, {
    documentType: "asset_disposal",
    prefix: "DSP",
  });

  const disposal = await client.query(
    `INSERT INTO tenant.asset_disposals
      (organization_id,company_id,asset_id,disposal_number,disposal_date,
       disposal_method,proceeds_amount,disposal_cost,net_book_value,gain_loss_amount,
       buyer_party_id,reason,status,requested_by,approved_by,approved_at,
       completed_by,completed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'completed',
       $13,$13,now(),$13,now())
     RETURNING *`,
    [
      context.organizationId,
      context.companyId,
      assetId,
      disposalNumber,
      input.disposalDate || new Date().toISOString().slice(0, 10),
      input.disposalMethod,
      String(proceeds),
      String(disposalCost),
      String(netBookValue),
      String(gainLoss),
      input.buyerPartyId || null,
      input.reason,
      context.userId,
    ],
  );

  await client.query(
    `UPDATE tenant.assets
     SET status='disposed',current_user_id=NULL,current_department_id=NULL,
       current_cost_center_id=NULL,updated_at=now()
     WHERE organization_id=$1 AND company_id=$2 AND id=$3`,
    [context.organizationId, context.companyId, assetId],
  );
  await event(client, context, assetId, "asset.disposed", {
    disposalId: disposal.rows[0].id,
    gainLoss,
  });
  return disposal.rows[0];
}
