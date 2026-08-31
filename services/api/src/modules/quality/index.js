import { nextDocumentNumber } from "../../core/document-numbering.js";
import { beginIdempotentOperation, completeIdempotentOperation } from "../../core/idempotency.js";
import { lockInventoryItem } from "../../core/inventory-lock.js";

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

const TABLES = Object.freeze({
  plans: "quality_plans",
  "inspection-points": "quality_inspection_points",
  inspections: "quality_inspections",
  "inspection-results": "quality_inspection_results",
  holds: "quality_holds",
  "non-conformances": "quality_nonconformances",
  capa: "quality_capa",
  "supplier-quality": "quality_supplier_records",
  audits: "quality_audits",
  traceability: "quality_events",
});

const CHILD_SCOPES = Object.freeze({
  quality_inspection_points: ["quality_plans", "plan_id"],
  quality_inspection_results: ["quality_inspections", "inspection_id"],
});

const ORDER_COLUMNS = Object.freeze({
  quality_inspection_points: "sequence",
  quality_inspection_results: "recorded_at",
  quality_events: "occurred_at",
});

function table(resource) {
  const value = TABLES[resource];
  if (!value) throw new Error("Unsupported quality resource.");
  return value;
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
    `INSERT INTO tenant.quality_events
      (organization_id,company_id,aggregate_type,aggregate_id,event_type,payload,actor_user_id)
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

export async function getQualityDashboard(client, context) {
  requirePermission(context, "quality.view");
  const inspections = await client.query(
    `SELECT
       count(*) FILTER (WHERE status IN ('draft','in_progress'))::int AS open_inspections,
       count(*) FILTER (WHERE status='failed')::int AS failed_inspections,
       count(*) FILTER (WHERE created_at::date=current_date)::int AS inspections_today
     FROM tenant.quality_inspections
     WHERE organization_id=$1 AND company_id=$2`,
    [context.organizationId, context.companyId],
  );
  const issues = await client.query(
    `SELECT
       count(*) FILTER (WHERE status='active')::int AS active_holds,
       (SELECT count(*)::int
        FROM tenant.quality_nonconformances
        WHERE organization_id=$1 AND company_id=$2
          AND status NOT IN ('closed','cancelled')) AS open_nonconformances,
       (SELECT count(*)::int
        FROM tenant.quality_capa
        WHERE organization_id=$1 AND company_id=$2
          AND status NOT IN ('closed','cancelled')) AS open_capa
     FROM tenant.quality_holds
     WHERE organization_id=$1 AND company_id=$2`,
    [context.organizationId, context.companyId],
  );
  return { ...inspections.rows[0], ...issues.rows[0] };
}

export async function listQualityResource(
  client,
  context,
  resource,
  { limit = 100, offset = 0, sourceId = null } = {},
) {
  requirePermission(context, "quality.view");
  const target = table(resource);
  const values = [context.organizationId, context.companyId];
  const childScope = CHILD_SCOPES[target];
  const join = childScope
    ? ` JOIN tenant.${childScope[0]} parent ON parent.organization_id=record.organization_id AND parent.id=record.${childScope[1]}`
    : "";
  const companyFilter = childScope
    ? "parent.company_id=$2"
    : "record.company_id=$2";
  let filter = "";
  if (sourceId && target === "quality_inspections") {
    values.push(sourceId);
    filter = ` AND record.source_id=$${values.length}`;
  }
  values.push(Math.min(Number(limit) || 100, 200), Number(offset) || 0);
  const result = await client.query(
    `SELECT record.* FROM tenant.${target} record${join}
     WHERE record.organization_id=$1 AND ${companyFilter}${filter}
     ORDER BY record.${ORDER_COLUMNS[target] || "created_at"} DESC NULLS LAST,record.id DESC
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values,
  );
  return result.rows;
}

export async function createQualityPlan(client, context, input) {
  requirePermission(context, "quality.plan.manage");
  const plan = await client.query(
    `INSERT INTO tenant.quality_plans
      (organization_id,company_id,code,name,description,plan_type,item_id,
       item_group_id,supplier_id,warehouse_id,manufacturing_operation_sequence,
       version,status,effective_from,effective_to,sampling_method,sampling_value,
       created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'draft',$13,$14,$15,$16,$17)
     RETURNING *`,
    [
      context.organizationId,
      context.companyId,
      input.code,
      input.name,
      input.description || null,
      input.planType,
      input.itemId || null,
      input.itemGroupId || null,
      input.supplierId || null,
      input.warehouseId || null,
      input.manufacturingOperationSequence || null,
      Number(input.version || 1),
      input.effectiveFrom || null,
      input.effectiveTo || null,
      input.samplingMethod || "full",
      String(input.samplingValue ?? 100),
      context.userId,
    ],
  );

  for (const [index, point] of input.points.entries()) {
    await client.query(
      `INSERT INTO tenant.quality_inspection_points
        (organization_id,plan_id,sequence,characteristic,inspection_method,
         result_type,lower_limit,target_value,upper_limit,unit,allowed_values,
         critical,destructive,instructions)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14)`,
      [
        context.organizationId,
        plan.rows[0].id,
        index + 1,
        point.characteristic,
        point.inspectionMethod,
        point.resultType,
        point.lowerLimit ?? null,
        point.targetValue ?? null,
        point.upperLimit ?? null,
        point.unit || null,
        JSON.stringify(point.allowedValues || []),
        Boolean(point.critical),
        Boolean(point.destructive),
        point.instructions || null,
      ],
    );
  }

  await event(
    client,
    context,
    "quality_plan",
    plan.rows[0].id,
    "quality.plan.created",
  );
  return plan.rows[0];
}

export async function createInspection(client, context, input) {
  requirePermission(context, "quality.inspect");
  const plan = await client.query(
    `SELECT * FROM tenant.quality_plans
     WHERE organization_id=$1 AND company_id=$2 AND id=$3 AND status='active'`,
    [context.organizationId, context.companyId, input.planId],
  );
  if (!plan.rows[0]) throw new Error("An active quality plan is required.");
  const inspectionNumber = input.inspectionNumber || await nextDocumentNumber(client, context, {
    documentType: "quality_inspection",
    prefix: "QI",
  });

  const inspection = await client.query(
    `INSERT INTO tenant.quality_inspections
      (organization_id,company_id,inspection_number,plan_id,inspection_type,
       source_type,source_id,item_id,supplier_id,warehouse_id,batch_id,serial_id,
       lot_quantity,sample_quantity,status,created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'draft',$15)
     RETURNING *`,
    [
      context.organizationId,
      context.companyId,
      inspectionNumber,
      input.planId,
      input.inspectionType,
      input.sourceType,
      input.sourceId || null,
      input.itemId || null,
      input.supplierId || null,
      input.warehouseId || null,
      input.batchId || null,
      input.serialId || null,
      String(input.lotQuantity || 0),
      String(input.sampleQuantity || 0),
      context.userId,
    ],
  );
  await event(
    client,
    context,
    "inspection",
    inspection.rows[0].id,
    "quality.inspection.created",
  );
  return inspection.rows[0];
}

export async function completeInspection(client, context, inspectionId, input) {
  requirePermission(context, "quality.inspect");
  const inspection = await client.query(
    `SELECT * FROM tenant.quality_inspections
     WHERE organization_id=$1 AND company_id=$2 AND id=$3 FOR UPDATE`,
    [context.organizationId, context.companyId, inspectionId],
  );
  if (
    !inspection.rows[0] ||
    !["draft", "in_progress"].includes(inspection.rows[0].status)
  ) {
    throw new Error("Inspection cannot be completed.");
  }

  let failed = false;
  for (const result of input.results) {
    if (result.resultStatus === "fail") failed = true;
    await client.query(
      `INSERT INTO tenant.quality_inspection_results
        (organization_id,inspection_id,inspection_point_id,sample_number,
         numeric_value,boolean_value,text_value,result_status,remarks,recorded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (inspection_id,inspection_point_id,sample_number)
       DO UPDATE SET numeric_value=EXCLUDED.numeric_value,
         boolean_value=EXCLUDED.boolean_value,text_value=EXCLUDED.text_value,
         result_status=EXCLUDED.result_status,remarks=EXCLUDED.remarks,
         recorded_by=EXCLUDED.recorded_by,recorded_at=now()`,
      [
        context.organizationId,
        inspectionId,
        result.inspectionPointId,
        Number(result.sampleNumber || 1),
        result.numericValue ?? null,
        result.booleanValue ?? null,
        result.textValue ?? null,
        result.resultStatus,
        result.remarks || null,
        context.userId,
      ],
    );
  }

  const status = failed ? "failed" : "passed";
  const updated = await client.query(
    `UPDATE tenant.quality_inspections
     SET status=$4,overall_result=$4,accepted_quantity=$5,rejected_quantity=$6,
       inspected_by=$7,inspected_at=now(),notes=$8,updated_at=now()
     WHERE organization_id=$1 AND company_id=$2 AND id=$3
     RETURNING *`,
    [
      context.organizationId,
      context.companyId,
      inspectionId,
      status,
      String(input.acceptedQuantity || 0),
      String(input.rejectedQuantity || 0),
      context.userId,
      input.notes || null,
    ],
  );

  if (failed) {
    const settings = await client.query(
      `SELECT auto_hold_on_failure
       FROM tenant.quality_settings
       WHERE organization_id=$1 AND company_id=$2`,
      [context.organizationId, context.companyId],
    );
    if (
      settings.rows[0]?.auto_hold_on_failure !== false &&
      inspection.rows[0].item_id
    ) {
      await lockInventoryItem(client, context, inspection.rows[0].item_id);
      const holdNumber = await nextDocumentNumber(client, context, {
        documentType: "quality_hold",
        prefix: "QH",
      });
      await client.query(
        `INSERT INTO tenant.quality_holds
          (organization_id,company_id,hold_number,hold_type,source_type,source_id,
           item_id,warehouse_id,warehouse_location_id,batch_id,serial_id,quantity,reason,placed_by)
         VALUES ($1,$2,$3,'inventory',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          context.organizationId,
          context.companyId,
          holdNumber,
          inspection.rows[0].source_type,
          inspection.rows[0].source_id || inspectionId,
          inspection.rows[0].item_id,
          inspection.rows[0].warehouse_id,
          null,
          inspection.rows[0].batch_id,
          inspection.rows[0].serial_id,
          String(
            input.rejectedQuantity || inspection.rows[0].lot_quantity || 0,
          ),
          "Automatic hold after failed inspection",
          context.userId,
        ],
      );
    }
  }

  await event(
    client,
    context,
    "inspection",
    inspectionId,
    "quality.inspection.completed",
    { status },
  );
  return updated.rows[0];
}

export async function releaseInspection(
  client,
  context,
  inspectionId,
  input = {},
) {
  requirePermission(context, "quality.release");
  const current = await client.query(
    `SELECT * FROM tenant.quality_inspections
     WHERE organization_id=$1 AND company_id=$2 AND id=$3 FOR UPDATE`,
    [context.organizationId, context.companyId, inspectionId],
  );
  const inspection = current.rows[0];
  if (
    !inspection ||
    !["passed", "conditionally_accepted"].includes(inspection.status)
  ) {
    throw new Error(
      "Only passed or conditionally accepted inspections can be released.",
    );
  }
  if (inspection.inspected_by === context.userId) {
    const error = new Error(
      "The inspector cannot release the same inspection.",
    );
    error.code = "SELF_RELEASE_BLOCKED";
    throw error;
  }

  const updated = await client.query(
    `UPDATE tenant.quality_inspections
     SET released_by=$4,released_at=now(),notes=coalesce($5,notes),updated_at=now()
     WHERE organization_id=$1 AND company_id=$2 AND id=$3
     RETURNING *`,
    [
      context.organizationId,
      context.companyId,
      inspectionId,
      context.userId,
      input.notes || null,
    ],
  );
  await event(
    client,
    context,
    "inspection",
    inspectionId,
    "quality.inspection.released",
  );
  return updated.rows[0];
}

export async function createNonconformance(client, context, input) {
  requirePermission(context, "quality.nonconformance.manage");
  const nonconformanceNumber = input.nonconformanceNumber || await nextDocumentNumber(client, context, {
    documentType: "quality_nonconformance",
    prefix: "NC",
  });
  const result = await client.query(
    `INSERT INTO tenant.quality_nonconformances
      (organization_id,company_id,nonconformance_number,inspection_id,source_type,
       source_id,item_id,supplier_id,batch_id,serial_id,severity,category,
       description,detected_quantity,affected_quantity,status,owner_user_id,
       due_date,created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'open',$16,$17,$18)
     RETURNING *`,
    [
      context.organizationId,
      context.companyId,
      nonconformanceNumber,
      input.inspectionId || null,
      input.sourceType,
      input.sourceId || null,
      input.itemId || null,
      input.supplierId || null,
      input.batchId || null,
      input.serialId || null,
      input.severity,
      input.category,
      input.description,
      String(input.detectedQuantity || 0),
      String(input.affectedQuantity || 0),
      input.ownerUserId || context.userId,
      input.dueDate || null,
      context.userId,
    ],
  );
  await event(
    client,
    context,
    "nonconformance",
    result.rows[0].id,
    "quality.nonconformance.created",
  );
  return result.rows[0];
}

export async function createCapa(client, context, input) {
  requirePermission(context, "quality.capa.manage");
  const capaNumber = input.capaNumber || await nextDocumentNumber(client, context, {
    documentType: "quality_capa",
    prefix: "CAPA",
  });
  const result = await client.query(
    `INSERT INTO tenant.quality_capa
      (organization_id,company_id,capa_number,nonconformance_id,title,
       root_cause_method,root_cause,correction,corrective_action,
       preventive_action,owner_user_id,due_date,status,effectiveness_criteria,
       created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'open',$13,$14)
     RETURNING *`,
    [
      context.organizationId,
      context.companyId,
      capaNumber,
      input.nonconformanceId || null,
      input.title,
      input.rootCauseMethod || null,
      input.rootCause || null,
      input.correction || null,
      input.correctiveAction || null,
      input.preventiveAction || null,
      input.ownerUserId || context.userId,
      input.dueDate || null,
      input.effectivenessCriteria || null,
      context.userId,
    ],
  );
  await event(
    client,
    context,
    "capa",
    result.rows[0].id,
    "quality.capa.created",
  );
  return result.rows[0];
}

export async function releaseQualityHold(client, context, holdId, input = {}) {
  requirePermission(context, "quality.release");
  const token = await beginIdempotentOperation(client, context, {
    operation: "quality.hold.release",
    key: input.idempotencyKey,
    payload: { holdId, quantity: input.quantity ?? null, reason: input.reason, expectedVersion: input.expectedVersion ?? null },
    required: true,
  });
  if (token.replayed) return { ...token.response, replayed: true };

  const snapshot = await client.query(
    `SELECT id,item_id FROM tenant.quality_holds
     WHERE organization_id=$1 AND company_id=$2 AND id=$3`,
    [context.organizationId, context.companyId, holdId],
  );
  if (!snapshot.rows[0]) {
    const error = new Error("Quality hold was not found for the active company.");
    error.status = 404;
    error.code = "QUALITY_HOLD_NOT_FOUND";
    throw error;
  }
  if (snapshot.rows[0].item_id) {
    await lockInventoryItem(client, context, snapshot.rows[0].item_id);
  }

  const locked = await client.query(
    `SELECT * FROM tenant.quality_holds
     WHERE organization_id=$1 AND company_id=$2 AND id=$3 FOR UPDATE`,
    [context.organizationId, context.companyId, holdId],
  );
  const hold = locked.rows[0];
  if (!hold || hold.status !== "active") {
    const error = new Error("Only an active quality hold can be released.");
    error.status = hold ? 409 : 404;
    error.code = hold ? "QUALITY_HOLD_STATE_INVALID" : "QUALITY_HOLD_NOT_FOUND";
    throw error;
  }
  if (input.expectedVersion != null && Number(input.expectedVersion) !== Number(hold.version)) {
    const error = new Error("The quality hold changed before this release was applied. Reload and retry.");
    error.status = 409;
    error.code = "QUALITY_HOLD_VERSION_CONFLICT";
    throw error;
  }

  const total = Number(hold.quantity);
  const alreadyReleased = Number(hold.released_quantity || 0);
  const scopeHold = total === 0;
  const remaining = Math.max(total - alreadyReleased, 0);
  if (!scopeHold && !(remaining > 0)) {
    const error = new Error("The quality hold has no remaining held quantity.");
    error.status = 409;
    error.code = "QUALITY_HOLD_ALREADY_RELEASED";
    throw error;
  }
  if (scopeHold && input.quantity != null) {
    const error = new Error("A scope-wide quality hold must be fully released; omit quantity.");
    error.status = 400;
    error.code = "QUALITY_HOLD_RELEASE_QUANTITY_INVALID";
    throw error;
  }
  const requested = scopeHold ? 0 : (input.quantity == null ? remaining : Number(input.quantity));
  if (!scopeHold && (!(requested > 0) || requested > remaining)) {
    const error = new Error("Release quantity must be greater than zero and cannot exceed the remaining held quantity.");
    error.status = 400;
    error.code = "QUALITY_HOLD_RELEASE_QUANTITY_INVALID";
    throw error;
  }
  const reason = String(input.reason || "").trim();
  if (!reason) {
    const error = new Error("A release reason is required.");
    error.status = 400;
    error.code = "QUALITY_HOLD_RELEASE_REASON_REQUIRED";
    throw error;
  }

  await client.query(
    `INSERT INTO tenant.quality_hold_releases
      (organization_id,company_id,hold_id,quantity,reason,released_by,idempotency_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [context.organizationId, context.companyId, holdId, String(requested), reason, context.userId, input.idempotencyKey],
  );
  const nextReleased = alreadyReleased + requested;
  const fullyReleased = scopeHold || nextReleased >= total;
  const updated = await client.query(
    `UPDATE tenant.quality_holds
     SET released_quantity=$4,
       status=CASE WHEN $5 THEN 'released' ELSE 'active' END,
       released_by=CASE WHEN $5 THEN $6 ELSE released_by END,
       released_at=CASE WHEN $5 THEN now() ELSE released_at END,
       release_reason=CASE WHEN $5 THEN $7 ELSE release_reason END,
       version=version+1
     WHERE organization_id=$1 AND company_id=$2 AND id=$3
     RETURNING *`,
    [context.organizationId, context.companyId, holdId, String(nextReleased), fullyReleased, context.userId, reason],
  );
  await event(client, context, "hold", holdId, fullyReleased ? "quality.hold.released" : "quality.hold.partially_released", {
    quantity: requested,
    remainingQuantity: Math.max(total - nextReleased, 0),
    reason,
  });
  const response = { ...updated.rows[0], replayed: false };
  await completeIdempotentOperation(client, context, token, {
    response,
    aggregateType: "quality_hold",
    aggregateId: holdId,
  });
  return response;
}
