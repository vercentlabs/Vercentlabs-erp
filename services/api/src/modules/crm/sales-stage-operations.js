import { CrmError, queueOutboxEvent } from "./index.js";

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const text = (value) => String(value ?? "").trim();
const dto = (row) =>
  Object.fromEntries(
    Object.entries(row || {}).map(([key, value]) => [
      key.replace(/_([a-z])/g, (_match, character) => character.toUpperCase()),
      value,
    ]),
  );

function sameTimestamp(left, right) {
  if (!left || !right) return false;
  try {
    return new Date(left).toISOString() === new Date(right).toISOString();
  } catch {
    return false;
  }
}

function pipelineScope(context, values, alias = "pipeline") {
  if (context.activeCompanyId) {
    values.push(context.activeCompanyId);
    return ` AND (${alias}.company_id IS NULL OR ${alias}.company_id=$${values.length})`;
  }
  return context.allowAllCompanies ? "" : " AND false";
}

function stageType(row) {
  if (row?.is_won ?? row?.isWon) return "won";
  if (row?.is_lost ?? row?.isLost) return "lost";
  return "open";
}

function stageSnapshot(row) {
  if (!row) return null;
  return {
    id: row.id,
    pipelineId: row.pipelineId,
    name: row.name,
    code: row.code,
    sequence: Number(row.sequence),
    probability: Number(row.probability),
    forecastCategory: row.forecastCategory,
    stageType: row.stageType || stageType(row),
    staleAfterDays: row.staleAfterDays == null ? null : Number(row.staleAfterDays),
    status: row.status,
  };
}

function stageError(error) {
  if (error instanceof CrmError) return error;
  if (error?.code === "23505")
    return new CrmError(
      409,
      "A sales stage with the same stable identity already exists in this pipeline.",
      "CRM_SALES_STAGE_DUPLICATE",
    );
  if (["23503", "23514", "22P02"].includes(error?.code))
    return new CrmError(
      409,
      "Review the sales-stage values and try again.",
      "CRM_SALES_STAGE_VALIDATION_ERROR",
    );
  return error;
}

function normalizeStageInput(input, { create = false } = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new CrmError(400, "Provide a sales stage object.", "CRM_SALES_STAGE_INPUT_INVALID");

  const allowedFields = new Set([
    "pipelineId",
    "name",
    "stageType",
    "probability",
    "forecastCategory",
    "staleAfterDays",
    ...(create ? [] : ["expectedUpdatedAt"]),
  ]);
  const governedFields = new Set(["id", "code", "status", "sequence", "organizationId", "isWon", "isLost"]);
  for (const field of Object.keys(input)) {
    if (governedFields.has(field))
      throw new CrmError(
        409,
        "Stage code, order, active state and terminal flags are governed by Sales Stages.",
        "CRM_SALES_STAGE_GOVERNED_FIELD",
      );
    if (!allowedFields.has(field))
      throw new CrmError(400, `Unsupported sales-stage field: ${field}.`, "CRM_SALES_STAGE_INPUT_INVALID");
  }

  const result = {};
  if (create || hasOwn(input, "pipelineId")) {
    const pipelineId = text(input.pipelineId);
    if (!uuid.test(pipelineId))
      throw new CrmError(400, "Choose a valid pipeline.", "CRM_SALES_STAGE_PIPELINE_INVALID", {
        errors: { pipelineId: ["Choose a valid visible pipeline."] },
      });
    result.pipelineId = pipelineId;
  }
  if (create || hasOwn(input, "name")) {
    const name = text(input.name);
    if (!name || name.length > 120)
      throw new CrmError(400, "Stage name must contain 1 to 120 characters.", "CRM_SALES_STAGE_NAME_INVALID", {
        errors: { name: ["Enter a stage name between 1 and 120 characters."] },
      });
    result.name = name;
  }
  if (create || hasOwn(input, "stageType")) {
    const value = text(input.stageType || "open").toLowerCase();
    if (!["open", "won", "lost"].includes(value))
      throw new CrmError(400, "Stage type must be Open, Won or Lost.", "CRM_SALES_STAGE_TYPE_INVALID");
    result.stageType = value;
  }
  if (create || hasOwn(input, "probability")) {
    const value = input.probability == null || input.probability === "" ? 0 : Number(input.probability);
    if (
      !Number.isFinite(value) ||
      value < 0 ||
      value > 100 ||
      Math.abs(value * 100 - Math.round(value * 100)) > 1e-9
    )
      throw new CrmError(400, "Probability must be 0 to 100 with at most two decimals.", "CRM_SALES_STAGE_PROBABILITY_INVALID", {
        errors: { probability: ["Enter a percentage from 0 to 100 with at most two decimals."] },
      });
    result.probability = value;
  }
  if (create || hasOwn(input, "forecastCategory")) {
    const value = text(input.forecastCategory || "pipeline").toLowerCase();
    if (!["omitted", "pipeline", "best_case", "committed", "closed"].includes(value))
      throw new CrmError(400, "Choose a valid forecast category.", "CRM_SALES_STAGE_FORECAST_INVALID");
    result.forecastCategory = value;
  }
  if (create || hasOwn(input, "staleAfterDays")) {
    const raw = input.staleAfterDays;
    if (raw == null || raw === "") result.staleAfterDays = null;
    else {
      const value = Number(raw);
      if (!Number.isInteger(value) || value < 1 || value > 365)
        throw new CrmError(400, "Stale-after days must be a whole number from 1 to 365.", "CRM_SALES_STAGE_STALE_DAYS_INVALID");
      result.staleAfterDays = value;
    }
  }
  if (!create && !hasOwn(input, "expectedUpdatedAt"))
    throw new CrmError(400, "Refresh the stage and submit its current version.", "CRM_SALES_STAGE_VERSION_REQUIRED");
  if (hasOwn(input, "expectedUpdatedAt")) {
    const expectedUpdatedAt = text(input.expectedUpdatedAt);
    if (!expectedUpdatedAt || Number.isNaN(Date.parse(expectedUpdatedAt)))
      throw new CrmError(400, "The sales-stage version is invalid.", "CRM_SALES_STAGE_VERSION_INVALID");
    result.expectedUpdatedAt = new Date(expectedUpdatedAt).toISOString();
  }

  const type = result.stageType;
  if (type === "won") {
    result.probability = 100;
    result.forecastCategory = "closed";
    result.staleAfterDays = null;
  } else if (type === "lost") {
    result.probability = 0;
    result.forecastCategory = "closed";
    result.staleAfterDays = null;
  } else if (type === "open" && result.forecastCategory === "closed") {
    throw new CrmError(400, "Open stages cannot use the Closed forecast category.", "CRM_SALES_STAGE_OPEN_FORECAST_INVALID");
  }
  return result;
}

async function visiblePipeline(client, context, pipelineId, { requireActive = false, lock = false } = {}) {
  const values = [context.organizationId, pipelineId];
  const scope = pipelineScope(context, values, "pipeline");
  const result = await client.query(
    `SELECT pipeline.* FROM tenant.crm_pipelines pipeline
      WHERE pipeline.organization_id=$1 AND pipeline.id=$2${scope}${requireActive ? " AND pipeline.status='active'" : ""}
      LIMIT 1${lock ? " FOR UPDATE" : ""}`,
    values,
  );
  if (!result.rows[0])
    throw new CrmError(404, "Sales pipeline not found in the active company scope.", "CRM_SALES_STAGE_PIPELINE_NOT_FOUND");
  return dto(result.rows[0]);
}

function stageSelect() {
  return `SELECT stage.*,pipeline.name AS pipeline_name,pipeline.company_id AS pipeline_company_id,pipeline.status AS pipeline_status,
    (SELECT count(*)::int FROM tenant.crm_opportunities opportunity
      WHERE opportunity.organization_id=stage.organization_id AND opportunity.stage_id=stage.id AND opportunity.status<>'archived') AS opportunity_count,
    (SELECT count(*)::int FROM tenant.crm_opportunities opportunity
      WHERE opportunity.organization_id=stage.organization_id AND opportunity.stage_id=stage.id AND opportunity.status='open') AS open_opportunity_count
    FROM tenant.crm_pipeline_stages stage
    JOIN tenant.crm_pipelines pipeline ON pipeline.organization_id=stage.organization_id AND pipeline.id=stage.pipeline_id`;
}

function enrichStage(row) {
  const value = dto(row);
  return { ...value, stageType: stageType(value) };
}

export async function listSalesStagePipelines(client, context, options = {}) {
  const values = [context.organizationId];
  let where = "pipeline.organization_id=$1" + pipelineScope(context, values, "pipeline");
  const status = ["active", "inactive", "all"].includes(String(options.status)) ? String(options.status) : "all";
  if (status !== "all") {
    values.push(status);
    where += ` AND pipeline.status=$${values.length}`;
  }
  const result = await client.query(
    `SELECT pipeline.id,pipeline.name,pipeline.code,pipeline.company_id,pipeline.is_default,pipeline.status,pipeline.updated_at,
      (SELECT count(*)::int FROM tenant.crm_pipeline_stages stage WHERE stage.organization_id=pipeline.organization_id AND stage.pipeline_id=pipeline.id AND stage.status='active' AND NOT stage.is_won AND NOT stage.is_lost) AS active_open_stage_count,
      (SELECT count(*)::int FROM tenant.crm_pipeline_stages stage WHERE stage.organization_id=pipeline.organization_id AND stage.pipeline_id=pipeline.id AND stage.status='active' AND stage.is_won) AS active_won_stage_count,
      (SELECT count(*)::int FROM tenant.crm_pipeline_stages stage WHERE stage.organization_id=pipeline.organization_id AND stage.pipeline_id=pipeline.id AND stage.status='active' AND stage.is_lost) AS active_lost_stage_count
      FROM tenant.crm_pipelines pipeline WHERE ${where}
      ORDER BY pipeline.status='active' DESC,pipeline.is_default DESC,pipeline.name,pipeline.id`,
    values,
  );
  return result.rows.map(dto);
}

export async function listSalesStages(client, context, options = {}) {
  const pipelineId = text(options.pipelineId || "");
  if (!uuid.test(pipelineId))
    throw new CrmError(400, "Choose a valid pipeline.", "CRM_SALES_STAGE_PIPELINE_INVALID");
  await visiblePipeline(client, context, pipelineId);
  const status = ["active", "inactive", "all"].includes(String(options.status)) ? String(options.status) : "all";
  const values = [context.organizationId, pipelineId];
  let where = "stage.organization_id=$1 AND stage.pipeline_id=$2";
  if (status !== "all") {
    values.push(status);
    where += ` AND stage.status=$${values.length}`;
  }
  const result = await client.query(
    `${stageSelect()} WHERE ${where} ORDER BY stage.status='active' DESC,stage.sequence,stage.id`,
    values,
  );
  return { rows: result.rows.map(enrichStage), total: result.rowCount || 0 };
}

export async function getSalesStage(client, context, id, { lock = false } = {}) {
  if (!uuid.test(String(id))) throw new CrmError(404, "Sales stage not found.", "CRM_SALES_STAGE_NOT_FOUND");
  const values = [context.organizationId, id];
  const scope = pipelineScope(context, values, "pipeline");
  const result = await client.query(
    `${stageSelect()} WHERE stage.organization_id=$1 AND stage.id=$2${scope} LIMIT 1${lock ? " FOR UPDATE OF stage" : ""}`,
    values,
  );
  if (!result.rows[0]) throw new CrmError(404, "Sales stage not found.", "CRM_SALES_STAGE_NOT_FOUND");
  return enrichStage(result.rows[0]);
}

async function assertUniqueName(client, organizationId, pipelineId, name, excludeId = null) {
  const result = await client.query(
    `SELECT id FROM tenant.crm_pipeline_stages
      WHERE organization_id=$1 AND pipeline_id=$2 AND lower(btrim(name))=lower(btrim($3))
        AND ($4::uuid IS NULL OR id<>$4) LIMIT 1`,
    [organizationId, pipelineId, name, excludeId],
  );
  if (result.rows[0])
    throw new CrmError(409, "A stage with that name already exists in this pipeline.", "CRM_SALES_STAGE_DUPLICATE_NAME", {
      errors: { name: ["Use a unique stage name inside this pipeline."] },
    });
}

async function uniqueCode(client, organizationId, pipelineId, name) {
  const root = text(name).normalize("NFKD").replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").toUpperCase().slice(0, 52) || "STAGE";
  for (let suffix = 0; suffix < 1000; suffix += 1) {
    const code = suffix ? `${root.slice(0, 52)}_${suffix + 1}` : root;
    const found = await client.query(
      "SELECT 1 FROM tenant.crm_pipeline_stages WHERE organization_id=$1 AND pipeline_id=$2 AND code=$3",
      [organizationId, pipelineId, code],
    );
    if (!found.rows[0]) return code;
  }
  throw new CrmError(409, "A stable stage code could not be allocated.", "CRM_SALES_STAGE_CODE_CONFLICT");
}

async function assertTerminalAvailable(client, organizationId, pipelineId, type, excludeId = null) {
  if (!["won", "lost"].includes(type)) return;
  const column = type === "won" ? "is_won" : "is_lost";
  const result = await client.query(
    `SELECT id FROM tenant.crm_pipeline_stages
      WHERE organization_id=$1 AND pipeline_id=$2 AND status='active' AND ${column}=true
        AND ($3::uuid IS NULL OR id<>$3) LIMIT 1`,
    [organizationId, pipelineId, excludeId],
  );
  if (result.rows[0])
    throw new CrmError(409, `This pipeline already has an active ${type === "won" ? "Won" : "Lost"} stage.`, "CRM_SALES_STAGE_TERMINAL_DUPLICATE");
}

function orderedTargetSequences(count) {
  return Array.from({ length: count }, (_value, index) => (index + 1) * 10);
}

function allocateTemporarySequences(rows, targetSequences = []) {
  const reserved = new Set([
    ...rows.map((row) => Number(row.sequence)),
    ...targetSequences.map((value) => Number(value)),
  ]);
  const temporary = new Map();
  let candidate = 1;
  for (const row of rows) {
    while (reserved.has(candidate)) candidate += 1;
    temporary.set(row.id, candidate);
    reserved.add(candidate);
    candidate += 1;
  }
  return temporary;
}

async function applyActiveOrder(client, context, pipelineId, rows, targetSequences) {
  const changedRows = rows.filter((row, index) => Number(row.sequence) !== Number(targetSequences[index]));
  if (!changedRows.length) return [];

  // A direct A(10)->20 / B(20)->10 swap violates a non-deferrable unique
  // sequence constraint on the first UPDATE. Park every active row on values
  // disjoint from both the current and final sets, then write the final order.
  // The temporary values stay inside this transaction and never advance
  // updated_at or create history/outbox evidence.
  const temporary = allocateTemporarySequences(rows, targetSequences);
  for (const row of rows) {
    await client.query(
      "UPDATE tenant.crm_pipeline_stages SET sequence=$3 WHERE organization_id=$1 AND id=$2",
      [context.organizationId, row.id, temporary.get(row.id)],
    );
  }

  const changedIds = [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const sequence = Number(targetSequences[index]);
    const changed = Number(row.sequence) !== sequence;
    if (!changed) {
      await client.query(
        "UPDATE tenant.crm_pipeline_stages SET sequence=$3 WHERE organization_id=$1 AND id=$2",
        [context.organizationId, row.id, sequence],
      );
      continue;
    }
    const before = enrichStage(row);
    const updated = (
      await client.query(
        "UPDATE tenant.crm_pipeline_stages SET sequence=$3,updated_by=$4,updated_at=now() WHERE organization_id=$1 AND id=$2 RETURNING *",
        [context.organizationId, row.id, sequence, context.userId],
      )
    ).rows[0];
    const after = enrichStage(updated);
    await writeHistory(client, context, row.id, pipelineId, "reordered", stageSnapshot(before), stageSnapshot(after));
    changedIds.push(row.id);
  }

  await queueOutboxEvent(client, context, "crm.sales_stages.reordered", "sales_pipeline", pipelineId, {
    pipelineId,
    stageIds: rows.map((row) => row.id),
    changedStageIds: changedIds,
  });
  return changedIds;
}

async function activeSequenceRows(client, context, pipelineId) {
  return (
    await client.query(
      `SELECT id,sequence FROM tenant.crm_pipeline_stages
        WHERE organization_id=$1 AND pipeline_id=$2 AND status='active'
        ORDER BY sequence,id FOR UPDATE`,
      [context.organizationId, pipelineId],
    )
  ).rows;
}

function nextAppendSequence(rows) {
  const values = rows
    .map((row) => Number(row.sequence))
    .filter((value) => Number.isInteger(value) && value > 0);
  return (values.length ? Math.max(...values) : 0) + 10;
}

function reusableOrAppendSequence(rows, preferredSequence) {
  const used = new Set(rows.map((row) => Number(row.sequence)));
  const preferred = Number(preferredSequence);
  if (Number.isInteger(preferred) && preferred > 0 && !used.has(preferred)) return preferred;
  return nextAppendSequence(rows);
}

async function normalizeActiveOrder(client, context, pipelineId) {
  const rows = (
    await client.query(
      `SELECT * FROM tenant.crm_pipeline_stages
        WHERE organization_id=$1 AND pipeline_id=$2 AND status='active'
        ORDER BY CASE WHEN is_won OR is_lost THEN 1 ELSE 0 END,sequence,id FOR UPDATE`,
      [context.organizationId, pipelineId],
    )
  ).rows;
  return applyActiveOrder(client, context, pipelineId, rows, orderedTargetSequences(rows.length));
}

async function writeHistory(client, context, stageId, pipelineId, action, before, after) {
  await client.query(
    `INSERT INTO tenant.crm_sales_stage_configuration_history
      (organization_id,pipeline_id,stage_id,action,before_data,after_data,changed_by)
     VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)`,
    [context.organizationId, pipelineId, stageId, action, JSON.stringify(before || {}), JSON.stringify(after || {}), context.userId],
  );
}


export async function listSalesStageHistory(client, context, pipelineIdValue, limitValue = 100) {
  const pipelineId = text(pipelineIdValue);
  if (!uuid.test(pipelineId)) throw new CrmError(400, "Choose a valid pipeline.", "CRM_SALES_STAGE_PIPELINE_INVALID");
  await visiblePipeline(client, context, pipelineId);
  const limit = Math.max(1, Math.min(200, Math.trunc(Number(limitValue) || 100)));
  const result = await client.query(
    `SELECT history.*,stage.name AS stage_name,stage.code AS stage_code,
            coalesce(nullif(btrim(actor.full_name),''),actor.email) AS changed_by_name
       FROM tenant.crm_sales_stage_configuration_history history
       JOIN tenant.crm_pipeline_stages stage ON stage.organization_id=history.organization_id AND stage.id=history.stage_id
       LEFT JOIN public.users actor ON actor.id=history.changed_by
      WHERE history.organization_id=$1 AND history.pipeline_id=$2
      ORDER BY history.changed_at DESC,history.id DESC LIMIT $3`,
    [context.organizationId, pipelineId, limit],
  );
  return result.rows.map(dto);
}

export async function createSalesStage(client, context, input = {}) {
  try {
    const value = normalizeStageInput(input, { create: true });
    await visiblePipeline(client, context, value.pipelineId, { requireActive: true, lock: true });
    await assertUniqueName(client, context.organizationId, value.pipelineId, value.name);
    await assertTerminalAvailable(client, context.organizationId, value.pipelineId, value.stageType);
    const code = await uniqueCode(client, context.organizationId, value.pipelineId, value.name);
    const existingActive = await activeSequenceRows(client, context, value.pipelineId);
    const temporarySequence = nextAppendSequence(existingActive);
    const result = await client.query(
      `INSERT INTO tenant.crm_pipeline_stages
        (organization_id,pipeline_id,name,code,sequence,probability,forecast_category,is_won,is_lost,stale_after_days,status,created_by,updated_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'active',$11,$11) RETURNING id`,
      [context.organizationId, value.pipelineId, value.name, code, temporarySequence, value.stageType === "won" ? 100 : value.stageType === "lost" ? 0 : value.probability, value.stageType === "open" ? value.forecastCategory : "closed", value.stageType === "won", value.stageType === "lost", value.stageType === "open" ? value.staleAfterDays : null, context.userId],
    );
    await normalizeActiveOrder(client, context, value.pipelineId);
    const stage = await getSalesStage(client, context, result.rows[0].id);
    await writeHistory(client, context, stage.id, value.pipelineId, "created", null, stageSnapshot(stage));
    await queueOutboxEvent(client, context, "crm.sales_stage.created", "sales_stage", stage.id, stageSnapshot(stage));
    return stage;
  } catch (error) {
    throw stageError(error);
  }
}

export async function updateSalesStage(client, context, id, input = {}) {
  try {
    const visible = await getSalesStage(client, context, id);
    await visiblePipeline(client, context, visible.pipelineId, { lock: true });
    const before = await getSalesStage(client, context, id, { lock: true });
    const value = normalizeStageInput(input);
    if (hasOwn(value, "pipelineId") && value.pipelineId !== before.pipelineId)
      throw new CrmError(409, "A stage cannot be moved to another pipeline. Create a new stage there instead.", "CRM_SALES_STAGE_PIPELINE_IMMUTABLE");

    const nextType = value.stageType || before.stageType;
    if (nextType !== before.stageType && Number(before.opportunityCount || 0) > 0)
      throw new CrmError(409, "A stage already used by Opportunities cannot change between Open, Won and Lost.", "CRM_SALES_STAGE_TYPE_IN_USE");
    await assertTerminalAvailable(client, context.organizationId, before.pipelineId, nextType, id);
    if (hasOwn(value, "name") && value.name !== before.name)
      await assertUniqueName(client, context.organizationId, before.pipelineId, value.name, id);

    const nextProbability = nextType === "won" ? 100 : nextType === "lost" ? 0 : hasOwn(value, "probability") ? value.probability : Number(before.probability);
    const nextForecast = nextType === "won" || nextType === "lost" ? "closed" : hasOwn(value, "forecastCategory") ? value.forecastCategory : before.forecastCategory;
    if (nextType === "open" && nextForecast === "closed")
      throw new CrmError(400, "Open stages cannot use the Closed forecast category.", "CRM_SALES_STAGE_OPEN_FORECAST_INVALID");
    const nextStale = nextType === "open" ? (hasOwn(value, "staleAfterDays") ? value.staleAfterDays : before.staleAfterDays) : null;
    const nextName = hasOwn(value, "name") ? value.name : before.name;

    // Desired-state retry is deliberately checked before the stale token. If a
    // previous response was lost, retrying the exact same edit must not create
    // duplicate history/outbox evidence merely because updated_at advanced.
    if (nextName === before.name && nextType === before.stageType && Number(nextProbability) === Number(before.probability) && nextForecast === before.forecastCategory && (nextStale ?? null) === (before.staleAfterDays ?? null))
      return { ...before, replayed: true };

    if (!sameTimestamp(value.expectedUpdatedAt, before.updatedAt))
      throw new CrmError(409, "This stage changed after the page loaded. Refresh and try again.", "CRM_SALES_STAGE_STALE_WRITE");

    await client.query(
      `UPDATE tenant.crm_pipeline_stages SET
        name=$3,probability=$4,forecast_category=$5,is_won=$6,is_lost=$7,stale_after_days=$8,updated_by=$9,updated_at=now()
       WHERE organization_id=$1 AND id=$2`,
      [context.organizationId, id, nextName, nextProbability, nextForecast, nextType === "won", nextType === "lost", nextStale, context.userId],
    );
    if (nextType !== before.stageType) await normalizeActiveOrder(client, context, before.pipelineId);
    const stage = await getSalesStage(client, context, id);
    await writeHistory(client, context, id, before.pipelineId, "updated", stageSnapshot(before), stageSnapshot(stage));
    await queueOutboxEvent(client, context, "crm.sales_stage.updated", "sales_stage", id, {
      stageId: id,
      pipelineId: before.pipelineId,
      before: stageSnapshot(before),
      after: stageSnapshot(stage),
    });
    return stage;
  } catch (error) {
    throw stageError(error);
  }
}

export async function setSalesStageActive(client, context, id, active, expectedUpdatedAt) {
  try {
    const visible = await getSalesStage(client, context, id);
    await visiblePipeline(client, context, visible.pipelineId, { requireActive: active, lock: true });
    const before = await getSalesStage(client, context, id, { lock: true });
    const next = active ? "active" : "inactive";
    if (before.status === next) return { ...before, replayed: true };
    const expected = text(expectedUpdatedAt || "");
    if (!expected || Number.isNaN(Date.parse(expected)))
      throw new CrmError(400, "Refresh the stage and submit its current version.", "CRM_SALES_STAGE_VERSION_REQUIRED");
    if (!sameTimestamp(expected, before.updatedAt))
      throw new CrmError(409, "This stage changed after the page loaded. Refresh and try again.", "CRM_SALES_STAGE_STALE_WRITE");

    if (active) {
      await assertTerminalAvailable(client, context.organizationId, before.pipelineId, before.stageType, id);
    } else {
      if (Number(before.openOpportunityCount || 0) > 0)
        throw new CrmError(409, "Move open Opportunities out of this stage before deactivating it.", "CRM_SALES_STAGE_OPEN_OPPORTUNITIES");
      if (before.stageType === "open") {
        const remaining = await client.query(
          `SELECT count(*)::int AS count FROM tenant.crm_pipeline_stages
            WHERE organization_id=$1 AND pipeline_id=$2 AND status='active' AND NOT is_won AND NOT is_lost AND id<>$3`,
          [context.organizationId, before.pipelineId, id],
        );
        if (!Number(remaining.rows[0]?.count || 0))
          throw new CrmError(409, "Every active pipeline must keep at least one active Open stage.", "CRM_SALES_STAGE_OPEN_REQUIRED");
      }
    }

    let activationSequence = Number(before.sequence);
    if (active) {
      const activeRows = await activeSequenceRows(client, context, before.pipelineId);
      activationSequence = reusableOrAppendSequence(activeRows, before.sequence);
    }
    await client.query(
      "UPDATE tenant.crm_pipeline_stages SET status=$3,sequence=$4,updated_by=$5,updated_at=now() WHERE organization_id=$1 AND id=$2",
      [context.organizationId, id, next, activationSequence, context.userId],
    );
    if (active) await normalizeActiveOrder(client, context, before.pipelineId);
    const stage = await getSalesStage(client, context, id);
    const action = active ? "reactivated" : "deactivated";
    await writeHistory(client, context, id, before.pipelineId, action, stageSnapshot(before), stageSnapshot(stage));
    await queueOutboxEvent(client, context, `crm.sales_stage.${action}`, "sales_stage", id, {
      stageId: id,
      pipelineId: before.pipelineId,
      status: stage.status,
    });
    return stage;
  } catch (error) {
    throw stageError(error);
  }
}

export async function reorderSalesStages(client, context, pipelineIdValue, entries = []) {
  try {
    const pipelineId = text(pipelineIdValue);
    if (!uuid.test(pipelineId)) throw new CrmError(400, "Choose a valid pipeline.", "CRM_SALES_STAGE_PIPELINE_INVALID");
    await visiblePipeline(client, context, pipelineId, { requireActive: true, lock: true });
    if (!Array.isArray(entries) || !entries.length)
      throw new CrmError(400, "Provide the complete active stage order.", "CRM_SALES_STAGE_ORDER_REQUIRED");
    const rows = (
      await client.query(
        `SELECT * FROM tenant.crm_pipeline_stages
          WHERE organization_id=$1 AND pipeline_id=$2 AND status='active'
          ORDER BY sequence,id FOR UPDATE`,
        [context.organizationId, pipelineId],
      )
    ).rows;
    if (entries.length !== rows.length)
      throw new CrmError(409, "The active stage catalogue changed. Refresh before reordering.", "CRM_SALES_STAGE_ORDER_CONFLICT");
    const byId = new Map(rows.map((row) => [row.id, row]));
    const desiredIds = entries.map((entry) => text(entry?.id));
    const currentIds = rows.map((row) => row.id);
    if (desiredIds.length === currentIds.length && desiredIds.every((id, index) => id === currentIds[index]))
      return { changed: false, rows: (await listSalesStages(client, context, { pipelineId, status: "all" })).rows };
    const seen = new Set();
    let terminalSeen = false;
    const desiredRows = [];
    for (const entry of entries) {
      const id = text(entry?.id);
      const row = byId.get(id);
      if (!row || seen.has(id)) throw new CrmError(409, "The active stage order is stale or incomplete.", "CRM_SALES_STAGE_ORDER_CONFLICT");
      seen.add(id);
      if (!entry?.expectedUpdatedAt || !sameTimestamp(entry.expectedUpdatedAt, row.updated_at))
        throw new CrmError(409, "A stage changed after the page loaded. Refresh before reordering.", "CRM_SALES_STAGE_STALE_WRITE");
      const terminal = Boolean(row.is_won || row.is_lost);
      if (terminal) terminalSeen = true;
      else if (terminalSeen)
        throw new CrmError(409, "Open sales stages must remain before Won/Lost terminal stages.", "CRM_SALES_STAGE_TERMINAL_ORDER");
      desiredRows.push(row);
    }

    const changedIds = await applyActiveOrder(
      client,
      context,
      pipelineId,
      desiredRows,
      orderedTargetSequences(desiredRows.length),
    );
    return {
      changed: changedIds.length > 0,
      rows: (await listSalesStages(client, context, { pipelineId, status: "all" })).rows,
    };
  } catch (error) {
    throw stageError(error);
  }
}
