export class OpportunityOperationsError extends Error {
  constructor(status, message, code = "CRM_OPPORTUNITY_OPERATIONS_ERROR") {
    super(message);
    this.name = "OpportunityOperationsError";
    this.status = status;
    this.code = code;
  }
}
const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const text = (value) => String(value ?? "").trim();
export function evaluateOpportunityHealth(row, now = new Date()) {
  const warnings = [];
  const amount = num(row.amount);
  const probability = num(row.probability);
  const close = row.expected_close_date
    ? new Date(row.expected_close_date)
    : null;
  const last = row.last_activity_at
    ? new Date(row.last_activity_at)
    : new Date(row.updated_at || row.created_at || now);
  const inactiveDays = Math.max(0, Math.floor((now - last) / 86400000));
  if (!text(row.next_step)) warnings.push("Next step is missing.");
  if (!close || Number.isNaN(close.getTime()))
    warnings.push("Expected close date is missing.");
  if (
    close &&
    close < now &&
    !["won", "lost", "archived"].includes(String(row.status))
  )
    warnings.push("Expected close date is overdue.");
  if (inactiveDays > 14) warnings.push("Opportunity has no recent activity.");
  if (amount <= 0)
    warnings.push("Opportunity amount must be greater than zero.");
  return {
    healthy: warnings.length === 0,
    warnings,
    inactiveDays,
    weightedAmount: Number.isFinite(Number(row.expected_revenue))
      ? Number(row.expected_revenue)
      : Math.round(amount * probability) / 100,
  };
}
export function buildPipelineSummary(rows, now = new Date()) {
  const result = {
    total: rows.length,
    openAmount: 0,
    weightedAmount: 0,
    overdue: 0,
    healthy: 0,
    byStage: {},
  };
  for (const row of rows) {
    const health = evaluateOpportunityHealth(row, now);
    const amount = num(row.amount);
    if (String(row.status) === "open") result.openAmount += amount;
    if (String(row.status) === "open") result.weightedAmount += health.weightedAmount;
    if (health.warnings.includes("Expected close date is overdue."))
      result.overdue += 1;
    if (health.healthy) result.healthy += 1;
    const stage = text(row.stage_name || row.stage_id) || "Unassigned";
    result.byStage[stage] = (result.byStage[stage] || 0) + 1;
  }
  result.openAmount = Math.round(result.openAmount * 100) / 100;
  result.weightedAmount = Math.round(result.weightedAmount * 100) / 100;
  return result;
}
export async function getOpportunityDashboard(client, context) {
  const result = await client.query(
    `SELECT o.id,o.name,o.amount,o.probability,o.expected_revenue,o.expected_close_date,o.status,o.forecast_category,o.next_step,o.last_activity_at,o.created_at,o.updated_at,s.name stage_name FROM tenant.crm_opportunities o LEFT JOIN tenant.crm_pipeline_stages s ON s.organization_id=o.organization_id AND s.id=o.stage_id WHERE o.organization_id=$1 AND o.status <> 'archived'`,
    [context.organizationId],
  );
  return buildPipelineSummary(result.rows);
}
export async function getOpportunityTimeline(client, context, opportunityId) {
  const opportunity = await client.query(
    `SELECT id,name,amount,probability,expected_revenue,status,forecast_category,expected_close_date,next_step,updated_at FROM tenant.crm_opportunities WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, opportunityId],
  );
  if (!opportunity.rows[0])
    throw new OpportunityOperationsError(
      404,
      "Opportunity not found.",
      "CRM_OPPORTUNITY_NOT_FOUND",
    );
  const [stages, activities, forecasts] = await Promise.all([
    client.query(
      `SELECT id,from_stage_id,to_stage_id,probability,note,changed_at FROM tenant.crm_opportunity_stage_history WHERE organization_id=$1 AND opportunity_id=$2 ORDER BY changed_at DESC LIMIT 100`,
      [context.organizationId, opportunityId],
    ),
    client.query(
      `SELECT id,activity_type,subject,status,due_at,completed_at,created_at FROM tenant.crm_activities WHERE organization_id=$1 AND entity_type='opportunity' AND entity_id=$2 ORDER BY created_at DESC LIMIT 100`,
      [context.organizationId, opportunityId],
    ),
    client.query(
      `SELECT id,forecast_category,probability,amount,expected_close_date,captured_at FROM tenant.crm_opportunity_forecast_snapshots WHERE organization_id=$1 AND opportunity_id=$2 ORDER BY captured_at DESC LIMIT 50`,
      [context.organizationId, opportunityId],
    ),
  ]);
  return {
    opportunity: opportunity.rows[0],
    health: evaluateOpportunityHealth(opportunity.rows[0]),
    stages: stages.rows,
    activities: activities.rows,
    forecasts: forecasts.rows,
  };
}
export async function bulkUpdateOpportunities(client, context, input) {
  const ids = Array.isArray(input.ids)
    ? [...new Set(input.ids.map(String))]
    : [];
  if (!ids.length || ids.length > 200)
    throw new OpportunityOperationsError(
      400,
      "Select between 1 and 200 opportunities.",
      "CRM_OPPORTUNITY_BULK_SELECTION_INVALID",
    );
  const changes =
    input.changes && typeof input.changes === "object" ? input.changes : {};
  const allowed = new Map([
    ["ownerUserId", "owner_user_id"],
    ["forecastCategory", "forecast_category"],
    ["expectedCloseDate", "expected_close_date"],
    ["nextStep", "next_step"],
  ]);
  const sets = [];
  const values = [context.organizationId, ids];
  for (const [key, column] of allowed)
    if (Object.prototype.hasOwnProperty.call(changes, key)) {
      values.push(changes[key] || null);
      sets.push(`${column}=$${values.length}`);
    }
  if (!sets.length)
    throw new OpportunityOperationsError(
      400,
      "No supported opportunity changes were supplied.",
      "CRM_OPPORTUNITY_BULK_CHANGES_EMPTY",
    );
  values.push(context.userId);
  sets.push(`updated_by=$${values.length}`, "updated_at=now()");
  const result = await client.query(
    `UPDATE tenant.crm_opportunities SET ${sets.join(",")} WHERE organization_id=$1 AND id=ANY($2::uuid[]) AND status='open' RETURNING id,owner_user_id,forecast_category,expected_close_date,next_step,updated_at`,
    values,
  );
  return { requested: ids.length, updated: result.rowCount, rows: result.rows };
}
export async function captureForecastSnapshot(client, context, opportunityId) {
  const result = await client.query(
    `INSERT INTO tenant.crm_opportunity_forecast_snapshots (organization_id,opportunity_id,forecast_category,probability,amount,expected_close_date,captured_by) SELECT organization_id,id,forecast_category,probability,amount,expected_close_date,$3 FROM tenant.crm_opportunities WHERE organization_id=$1 AND id=$2 RETURNING *`,
    [context.organizationId, opportunityId, context.userId],
  );
  if (!result.rows[0])
    throw new OpportunityOperationsError(
      404,
      "Opportunity not found.",
      "CRM_OPPORTUNITY_NOT_FOUND",
    );
  return result.rows[0];
}
