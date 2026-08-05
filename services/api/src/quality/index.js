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
      input.inspectionNumber || `QI-${Date.now()}`,
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
    if (settings.rows[0]?.auto_hold_on_failure !== false) {
      await client.query(
        `INSERT INTO tenant.quality_holds
          (organization_id,company_id,hold_number,hold_type,source_type,source_id,
           item_id,warehouse_id,batch_id,serial_id,quantity,reason,placed_by)
         VALUES ($1,$2,$3,'inventory',$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          context.organizationId,
          context.companyId,
          `QH-${Date.now()}`,
          inspection.rows[0].source_type,
          inspection.rows[0].source_id || inspectionId,
          inspection.rows[0].item_id,
          inspection.rows[0].warehouse_id,
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
      input.nonconformanceNumber || `NC-${Date.now()}`,
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
      input.capaNumber || `CAPA-${Date.now()}`,
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
