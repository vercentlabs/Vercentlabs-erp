// Several pipelines (CRM plan 5.1). An organization starts with one, Sales Pipeline; it can add more — projects, AMC renewals, one per
// sales team — each with its own stages and its own Won and Lost rows. One is the default. A pipeline may belong to a sales team: deals
// that team's members create start in it. A pipeline is never deleted: it is switched off, its open deals moved to another first.
import { CrmError } from "../data-management/errors.js";
import { requireOpportunityPermission } from "../opportunities/access.js";
import { OPPORTUNITY_PERMISSIONS } from "../opportunities/constants.js";
import { recordOpportunityHistory } from "../opportunities/history.js";
import { assertNotStale, assertOpen, lockOpportunity, requireUuid } from "../opportunities/records.js";
import { writeStage } from "../opportunities/stages.js";
import { DEFAULT_SALES_STAGES, ensureDefaultSalesPipeline } from "./defaults.js";
import { stageEntryBlockers } from "./rules.js";

const text = (value) => String(value ?? "").trim();
const has = (input, field) => Object.prototype.hasOwnProperty.call(input ?? {}, field);
const invalid = (message, field) => new CrmError(400, message, "CRM_PIPELINE_VALIDATION", { issues: [{ field, message }] });
const requireManage = (context) =>
  requireOpportunityPermission(context, OPPORTUNITY_PERMISSIONS.manageStages, "You do not have permission to manage the pipelines.");

function toPipeline(row) {
  return {
    id: row.id, code: row.code, name: row.name, description: row.description ?? null, isDefault: row.is_default, isActive: row.status === "active",
    teamId: row.team_id ?? null, teamName: row.team_name ?? null, sequence: row.sequence,
    openCount: Number(row.open_count ?? 0), stageCount: Number(row.stage_count ?? 0),
  };
}

async function readPipelines(client, organizationId, { includeInactive = false } = {}) {
  const { rows } = await client.query(
    `SELECT pipeline.*, team.name AS team_name,
            (SELECT count(*) FROM tenant.crm_opportunities deal WHERE deal.organization_id = pipeline.organization_id AND deal.pipeline_id = pipeline.id
                AND deal.status = 'open' AND deal.archived_at IS NULL) AS open_count,
            (SELECT count(*) FROM tenant.crm_pipeline_stages stage WHERE stage.organization_id = pipeline.organization_id AND stage.pipeline_id = pipeline.id
                AND stage.status = 'active' AND NOT stage.is_won AND NOT stage.is_lost) AS stage_count
       FROM tenant.crm_pipelines pipeline
       LEFT JOIN tenant.crm_sales_teams team ON team.organization_id = pipeline.organization_id AND team.id = pipeline.team_id
      WHERE pipeline.organization_id = $1 AND ($2 OR pipeline.status = 'active')
      ORDER BY (pipeline.status = 'active') DESC, pipeline.is_default DESC, pipeline.sequence, lower(pipeline.name)`,
    [organizationId, includeInactive]);
  return rows;
}

// The pipelines, the default first. Anyone who sees deals sees the active ones (the board's switcher); managers also the switched-off ones.
export async function listPipelines(client, context, { includeInactive = false } = {}) {
  requireOpportunityPermission(context, OPPORTUNITY_PERMISSIONS.view, "You do not have permission to view deals.");
  await ensureDefaultSalesPipeline(client, context);
  if (includeInactive) requireManage(context);
  return (await readPipelines(client, context.organizationId, { includeInactive })).map(toPipeline);
}

// An active pipeline by id, or the default when none is given.
export async function resolvePipeline(client, context, pipelineId = null) {
  await ensureDefaultSalesPipeline(client, context);
  const { rows } = await client.query(
    `SELECT * FROM tenant.crm_pipelines WHERE organization_id = $1 AND status = 'active' AND ($2::uuid IS NULL AND is_default OR id = $2::uuid)
      ORDER BY is_default DESC LIMIT 1`,
    [context.organizationId, pipelineId ? requireUuid(pipelineId, "Pipeline") : null]);
  if (!rows[0]) throw new CrmError(404, "Pipeline not found.", "CRM_PIPELINE_NOT_FOUND");
  return rows[0];
}

// The pipeline a new deal of this team starts in: the team's own, else the default.
export async function pipelineForTeam(client, context, teamId) {
  if (teamId) {
    const { rows } = await client.query("SELECT * FROM tenant.crm_pipelines WHERE organization_id = $1 AND team_id = $2 AND status = 'active'", [context.organizationId, teamId]);
    if (rows[0]) return rows[0];
  }
  return resolvePipeline(client, context, null);
}

async function validTeam(client, context, teamId) {
  if (!teamId) return null;
  const { rows } = await client.query("SELECT id FROM tenant.crm_sales_teams WHERE organization_id = $1 AND id = $2 AND status = 'active'", [context.organizationId, requireUuid(teamId, "Sales team")]);
  if (!rows[0]) throw invalid("Choose an active sales team.", "teamId");
  const taken = (await client.query("SELECT name FROM tenant.crm_pipelines WHERE organization_id = $1 AND team_id = $2 AND status = 'active'", [context.organizationId, teamId])).rows[0];
  return { id: rows[0].id, takenBy: taken?.name ?? null };
}

function validName(rows, name, exceptId = null) {
  const value = text(name);
  if (!value) throw invalid("Name the pipeline.", "name");
  if (value.length > 80) throw invalid("Use 80 characters or fewer.", "name");
  if (rows.some((row) => row.id !== exceptId && row.status === "active" && row.name.trim().toLowerCase() === value.toLowerCase()))
    throw invalid("Another pipeline already has this name.", "name");
  return value;
}

// input: { name, description?, teamId?, copyStagesFrom? } — the new pipeline gets the standard stages, or a copy of another
// pipeline's stages (names, order, probability, guidance, rules and time limits), plus its own Won and Lost.
export async function createPipeline(client, context, input = {}) {
  requireManage(context);
  await ensureDefaultSalesPipeline(client, context);
  const rows = await readPipelines(client, context.organizationId, { includeInactive: true });
  const name = validName(rows, input.name);
  const team = await validTeam(client, context, input.teamId);
  if (team?.takenBy) throw invalid(`That team already works in the pipeline ${team.takenBy}.`, "teamId");
  const base = name.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 30) || "PIPELINE";
  const taken = new Set(rows.map((row) => row.code));
  let code = base;
  for (let suffix = 2; taken.has(code); suffix += 1) code = `${base}_${suffix}`;
  const pipeline = (await client.query(
    `INSERT INTO tenant.crm_pipelines (organization_id, name, code, description, is_default, team_id, sequence, created_by, updated_by)
     VALUES ($1, $2, $3, $4, false, $5, (SELECT COALESCE(max(sequence), 0) + 10 FROM tenant.crm_pipelines WHERE organization_id = $1), $6, $6) RETURNING id`,
    [context.organizationId, name, code, text(input.description).slice(0, 500) || null, team?.id ?? null, context.userId ?? null])).rows[0];

  let stages = DEFAULT_SALES_STAGES.map((stage) => ({ ...stage, entryRules: null, timeLimitDays: null }));
  // An industry starter pack (workspace/starter-packs.js) gives its own open stages; won and lost are the standard ones.
  if (Array.isArray(input.stages) && input.stages.length) {
    stages = [...input.stages.map((stage) => ({ ...stage, isWon: false, isLost: false, entryRules: null, timeLimitDays: null })),
      ...DEFAULT_SALES_STAGES.filter((stage) => stage.isWon || stage.isLost).map((stage) => ({ ...stage, entryRules: null, timeLimitDays: null }))];
  } else if (input.copyStagesFrom) {
    const source = await resolvePipeline(client, context, input.copyStagesFrom);
    const copied = (await client.query(
      `SELECT stage.*, sla.maximum_days FROM tenant.crm_pipeline_stages stage
         LEFT JOIN tenant.crm_opportunity_stage_sla_policies sla ON sla.organization_id = stage.organization_id AND sla.stage_id = stage.id AND sla.status = 'active'
        WHERE stage.organization_id = $1 AND stage.pipeline_id = $2 AND stage.status = 'active' ORDER BY stage.sequence`,
      [context.organizationId, source.id])).rows;
    stages = copied.map((row) => ({ code: row.code, name: row.name, probability: Number(row.probability), forecastCategory: row.forecast_category, isWon: row.is_won,
      isLost: row.is_lost, description: row.description, guidance: row.guidance, staleAfterDays: row.stale_after_days, entryRules: row.entry_rules, timeLimitDays: row.maximum_days }));
    if (!stages.some((stage) => stage.isWon)) stages.push(DEFAULT_SALES_STAGES.find((stage) => stage.isWon));
    if (!stages.some((stage) => stage.isLost)) stages.push(DEFAULT_SALES_STAGES.find((stage) => stage.isLost));
  }
  for (const [index, stage] of stages.entries()) {
    const created = (await client.query(
      `INSERT INTO tenant.crm_pipeline_stages (organization_id, pipeline_id, name, code, sequence, probability, forecast_category, is_won, is_lost,
                                               description, guidance, stale_after_days, entry_rules, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14, $14) RETURNING id`,
      [context.organizationId, pipeline.id, stage.name, stage.code, (index + 1) * 10, stage.probability, stage.forecastCategory, Boolean(stage.isWon), Boolean(stage.isLost),
        stage.description ?? null, stage.guidance ?? null, stage.isWon || stage.isLost ? null : stage.staleAfterDays ?? null,
        stage.entryRules === null || stage.entryRules === undefined ? null : JSON.stringify(stage.entryRules), context.userId ?? null])).rows[0];
    if (stage.timeLimitDays)
      await client.query(
        `INSERT INTO tenant.crm_opportunity_stage_sla_policies (organization_id, pipeline_id, stage_id, maximum_days, created_by, updated_by) VALUES ($1, $2, $3, $4, $5, $5)`,
        [context.organizationId, pipeline.id, created.id, stage.timeLimitDays, context.userId ?? null]);
  }
  return toPipeline((await readPipelines(client, context.organizationId, { includeInactive: true })).find((row) => row.id === pipeline.id));
}

// input: any of { name, description, teamId, isDefault }.
export async function updatePipeline(client, context, pipelineId, input = {}) {
  requireManage(context);
  const rows = await readPipelines(client, context.organizationId, { includeInactive: true });
  const pipeline = rows.find((row) => row.id === requireUuid(pipelineId, "Pipeline"));
  if (!pipeline) throw new CrmError(404, "Pipeline not found.", "CRM_PIPELINE_NOT_FOUND");
  if (pipeline.status !== "active") throw new CrmError(409, "Switch the pipeline back on before changing it.", "CRM_PIPELINE_INACTIVE");
  const fields = {};
  if (has(input, "name")) fields.name = validName(rows, input.name, pipeline.id);
  if (has(input, "description")) fields.description = text(input.description).slice(0, 500) || null;
  if (has(input, "teamId")) {
    const team = await validTeam(client, context, input.teamId || null);
    if (team?.takenBy && team.takenBy !== pipeline.name) throw invalid(`That team already works in the pipeline ${team.takenBy}.`, "teamId");
    fields.team_id = team?.id ?? null;
  }
  const assignments = Object.entries(fields);
  if (assignments.length)
    await client.query(`UPDATE tenant.crm_pipelines SET ${assignments.map(([column], index) => `${column} = $${index + 4}`).join(", ")}, updated_by = $3 WHERE organization_id = $1 AND id = $2`,
      [context.organizationId, pipeline.id, context.userId ?? null, ...assignments.map(([, value]) => value)]);
  if (input.isDefault === true && !pipeline.is_default) {
    await client.query("UPDATE tenant.crm_pipelines SET is_default = false, updated_by = $2 WHERE organization_id = $1 AND is_default", [context.organizationId, context.userId ?? null]);
    await client.query("UPDATE tenant.crm_pipelines SET is_default = true, updated_by = $3 WHERE organization_id = $1 AND id = $2", [context.organizationId, pipeline.id, context.userId ?? null]);
  }
  return toPipeline((await readPipelines(client, context.organizationId, { includeInactive: true })).find((row) => row.id === pipeline.id));
}

// Switches a pipeline off (or, with active = true, back on). Its open deals must move first: moveOpenTo names the pipeline that takes
// them, each into that pipeline's first stage. The default pipeline stays on.
export async function setPipelineActive(client, context, pipelineId, active, { moveOpenTo = null } = {}) {
  requireManage(context);
  const rows = await readPipelines(client, context.organizationId, { includeInactive: true });
  const pipeline = rows.find((row) => row.id === requireUuid(pipelineId, "Pipeline"));
  if (!pipeline) throw new CrmError(404, "Pipeline not found.", "CRM_PIPELINE_NOT_FOUND");
  if (active) {
    if (pipeline.status !== "active") {
      if (rows.some((row) => row.id !== pipeline.id && row.status === "active" && row.name.trim().toLowerCase() === pipeline.name.trim().toLowerCase()))
        throw invalid("Another active pipeline has this name. Rename one first.", "name");
      await client.query("UPDATE tenant.crm_pipelines SET status = 'active', team_id = NULL, updated_by = $3 WHERE organization_id = $1 AND id = $2", [context.organizationId, pipeline.id, context.userId ?? null]);
    }
  } else if (pipeline.status === "active") {
    if (pipeline.is_default) throw new CrmError(409, "Make another pipeline the default before switching this one off.", "CRM_PIPELINE_DEFAULT");
    const open = (await client.query(
      `SELECT * FROM tenant.crm_opportunities WHERE organization_id = $1 AND pipeline_id = $2 AND status = 'open' AND archived_at IS NULL FOR UPDATE`,
      [context.organizationId, pipeline.id])).rows;
    if (open.length) {
      if (!moveOpenTo) throw new CrmError(409, `${open.length} open ${open.length === 1 ? "deal is" : "deals are"} in this pipeline. Choose the pipeline to move ${open.length === 1 ? "it" : "them"} to.`,
        "CRM_PIPELINE_IN_USE", { openCount: open.length });
      const target = await resolvePipeline(client, context, moveOpenTo);
      if (target.id === pipeline.id) throw invalid("Choose another pipeline.", "moveOpenTo");
      for (const row of open) await moveIntoPipeline(client, context, { ...row, stage_name: null }, target, null, `${pipeline.name} was switched off`);
    }
    await client.query("UPDATE tenant.crm_pipelines SET status = 'inactive', updated_by = $3 WHERE organization_id = $1 AND id = $2", [context.organizationId, pipeline.id, context.userId ?? null]);
  }
  return toPipeline((await readPipelines(client, context.organizationId, { includeInactive: true })).find((row) => row.id === pipeline.id));
}

async function firstOpenStage(client, context, pipelineId, stageId = null) {
  const { rows } = await client.query(
    `SELECT * FROM tenant.crm_pipeline_stages WHERE organization_id = $1 AND pipeline_id = $2 AND status = 'active' AND NOT is_won AND NOT is_lost AND ($3::uuid IS NULL OR id = $3)
      ORDER BY sequence LIMIT 1`, [context.organizationId, pipelineId, stageId ? requireUuid(stageId, "Sales stage") : null]);
  if (!rows[0]) throw new CrmError(409, stageId ? "Choose an open stage of that pipeline." : "That pipeline has no open stages.", "CRM_OPPORTUNITY_STAGE_INVALID");
  return rows[0];
}

async function moveIntoPipeline(client, context, opportunity, pipeline, stageId, note) {
  const stage = await firstOpenStage(client, context, pipeline.id, stageId);
  const fromName = opportunity.stage_name ?? (await client.query("SELECT name FROM tenant.crm_pipeline_stages WHERE organization_id = $1 AND id = $2", [context.organizationId, opportunity.stage_id])).rows[0]?.name ?? "";
  const probability = await writeStage(client, context, opportunity, stage, { note, columns: { pipeline_id: pipeline.id } });
  await recordOpportunityHistory(client, context, opportunity.id, "stage_changed", `Pipeline: moved to ${pipeline.name} · ${fromName} → ${stage.name}`, {
    from: opportunity.stage_id, to: stage.id, fromName, toName: stage.name, pipelineId: pipeline.id, pipelineName: pipeline.name,
    probabilityBefore: Number(opportunity.probability), probability, note,
  });
  return { stage, probability };
}

// Moves an open deal into another pipeline. input: { pipelineId, stageId?, note?, expectedUpdatedAt? } — into the given stage, else
// the pipeline's first. The new stage's requirements apply, as with any move.
export async function moveOpportunityToPipeline(client, context, opportunityId, input = {}) {
  requireOpportunityPermission(context, OPPORTUNITY_PERMISSIONS.changeStage, "You do not have permission to change the stage of deals.");
  const opportunity = await lockOpportunity(client, context, opportunityId);
  assertOpen(opportunity, "moved");
  assertNotStale(opportunity, input.expectedUpdatedAt);
  if (!input.pipelineId) throw invalid("Choose the pipeline.", "pipelineId");
  const pipeline = await resolvePipeline(client, context, input.pipelineId);
  if (pipeline.id === opportunity.pipeline_id) return { changed: false };
  const stage = await firstOpenStage(client, context, pipeline.id, input.stageId ?? null);
  const blockers = stageEntryBlockers(opportunity, stage);
  if (blockers.length) throw new CrmError(409, blockers[0], "CRM_OPPORTUNITY_STAGE_REQUIREMENTS", { missingRequirements: blockers });
  const moved = await moveIntoPipeline(client, context, opportunity, pipeline, stage.id, text(input.note).slice(0, 500) || null);
  return { changed: true, pipelineId: pipeline.id, stageId: moved.stage.id, probability: moved.probability };
}
