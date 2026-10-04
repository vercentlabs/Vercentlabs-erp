// Configuring the sales stages: name, description, guidance, order, default
// probability, and whether a stage is in use.
//
// There is one sales pipeline per organization. A stage is identified by its
// id and carries a stable code; nothing depends on its name, so renaming or
// reordering never breaks the opportunities in it or their history. A stage
// is never deleted: it is deactivated, and the history that mentions it stays
// readable. Won and Lost are outcomes reached through Mark won and Mark lost;
// they are not configured here.
import { CrmError } from "../data-management/errors.js";
import { requireOpportunityPermission } from "../opportunities/access.js";
import { OPPORTUNITY_PERMISSIONS } from "../opportunities/constants.js";
import { recordOpportunityHistory } from "../opportunities/history.js";
import { requireUuid } from "../opportunities/records.js";
import { withLifecycleWrite, writeStage } from "../opportunities/stages.js";
import { DEFAULT_STAGE_CODES, ensureDefaultSalesPipeline } from "./defaults.js";

const text = (value) => String(value ?? "").trim();
const has = (input, field) => Object.prototype.hasOwnProperty.call(input, field);
const invalid = (message, field) => new CrmError(400, message, "CRM_SALES_STAGE_VALIDATION", { issues: [{ field, message }] });
const requireManage = (context) =>
  requireOpportunityPermission(context, OPPORTUNITY_PERMISSIONS.manageStages, "You do not have permission to manage the sales stages.");

async function salesPipelineId(client, context) {
  await ensureDefaultSalesPipeline(client, context);
  const { rows } = await client.query(
    `SELECT id FROM tenant.crm_pipelines WHERE organization_id = $1 AND status = 'active' ORDER BY is_default DESC, created_at LIMIT 1`,
    [context.organizationId],
  );
  return rows[0].id;
}

function toStage(row) {
  return {
    id: row.id, code: row.code, name: row.name, description: row.description ?? null, guidance: row.guidance ?? null, sequence: row.sequence,
    probability: Number(row.probability), isActive: row.status === "active",
    // one of the five stages every organization starts with
    isStandard: DEFAULT_STAGE_CODES.includes(row.code),
    openCount: Number(row.open_count ?? 0),
    // opportunities that are in the stage or have ever been through it
    isUsed: row.is_used === true,
    updatedAt: row.updated_at,
  };
}

async function readStages(client, context, pipelineId, { lock = false } = {}) {
  if (lock) await client.query(`SELECT id FROM tenant.crm_pipeline_stages WHERE organization_id = $1 AND pipeline_id = $2 FOR UPDATE`, [context.organizationId, pipelineId]);
  const { rows } = await client.query(
    `SELECT stage.*,
            (SELECT count(*) FROM tenant.crm_opportunities opportunity
              WHERE opportunity.organization_id = stage.organization_id AND opportunity.stage_id = stage.id AND opportunity.status = 'open'
                AND opportunity.archived_at IS NULL) AS open_count,
            EXISTS (SELECT 1 FROM tenant.crm_opportunity_stage_history history
                     WHERE history.organization_id = stage.organization_id AND history.to_stage_id = stage.id) AS is_used
       FROM tenant.crm_pipeline_stages stage
      WHERE stage.organization_id = $1 AND stage.pipeline_id = $2
      ORDER BY (stage.status = 'active') DESC, stage.sequence, stage.name`,
    [context.organizationId, pipelineId],
  );
  return rows;
}

// Gives the active stages the sequence 10, 20, 30…: the sales stages in the
// given order, then Won and Lost. Two steps, because two active stages can
// never hold the same sequence, even for a moment.
async function resequence(client, context, pipelineId, orderedIds) {
  const rows = await readStages(client, context, pipelineId);
  const outcomes = rows.filter((row) => row.status === "active" && (row.is_won || row.is_lost)).sort((a, b) => Number(a.is_lost) - Number(b.is_lost));
  await client.query(
    `UPDATE tenant.crm_pipeline_stages SET sequence = sequence + 100000 WHERE organization_id = $1 AND pipeline_id = $2 AND status = 'active'`,
    [context.organizationId, pipelineId],
  );
  for (const [index, id] of [...orderedIds, ...outcomes.map((row) => row.id)].entries())
    await client.query(
      `UPDATE tenant.crm_pipeline_stages SET sequence = $3, updated_by = $4 WHERE organization_id = $1 AND id = $2`,
      [context.organizationId, id, (index + 1) * 10, context.userId ?? null],
    );
}

const isSalesStage = (row) => !row.is_won && !row.is_lost;
const activeIds = (rows) => rows.filter((row) => row.status === "active" && isSalesStage(row)).map((row) => row.id);

function validName(rows, name, exceptId = null) {
  const value = text(name);
  if (!value) throw invalid("Enter a name for the stage.", "name");
  if (value.length > 80) throw invalid("Use 80 characters or fewer.", "name");
  if (rows.some((row) => row.id !== exceptId && row.status === "active" && row.name.trim().toLowerCase() === value.toLowerCase()))
    throw invalid("Another stage already has this name.", "name");
  return value;
}

function validProbability(value) {
  const probability = Number(value);
  if (text(value) === "" || !Number.isFinite(probability) || probability < 0 || probability > 100) throw invalid("Enter a probability from 0 to 100.", "probability");
  return Math.round(probability * 100) / 100;
}

function validText(value, field, maximum) {
  const result = text(value);
  if (result.length > maximum) throw invalid(`Use ${maximum} characters or fewer.`, field);
  return result || null;
}

async function findStage(client, context, stageId, { lock = true } = {}) {
  const pipelineId = await salesPipelineId(client, context);
  const rows = await readStages(client, context, pipelineId, { lock });
  const stage = rows.find((row) => row.id === requireUuid(stageId, "Stage") && isSalesStage(row));
  if (!stage) throw new CrmError(404, "Stage not found.", "CRM_SALES_STAGE_NOT_FOUND");
  return { pipelineId, rows, stage };
}

const reread = async (client, context, id) => (await listSalesStages(client, context)).find((stage) => stage.id === id);

// The sales stages for the settings screen: active ones in process order, then the inactive ones.
export async function listSalesStages(client, context) {
  requireManage(context);
  const rows = await readStages(client, context, await salesPipelineId(client, context));
  return rows.filter(isSalesStage).map(toStage);
}

// input: { name, probability, description?, guidance? }. The new stage is added after the last one.
export async function createSalesStage(client, context, input = {}) {
  requireManage(context);
  const pipelineId = await salesPipelineId(client, context);
  const rows = await readStages(client, context, pipelineId, { lock: true });
  const name = validName(rows, input.name);
  const probability = validProbability(input.probability);
  // A stable code of its own; it never changes when the stage is renamed.
  const base = name.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "STAGE";
  const taken = new Set(rows.map((row) => row.code));
  let code = base;
  for (let suffix = 2; taken.has(code); suffix += 1) code = `${base}_${suffix}`;
  const created = await client.query(
    `INSERT INTO tenant.crm_pipeline_stages (organization_id, pipeline_id, name, code, sequence, probability, forecast_category, description, guidance, created_by, updated_by)
     VALUES ($1, $2, $3, $4, (SELECT COALESCE(max(sequence), 0) + 200000 FROM tenant.crm_pipeline_stages WHERE organization_id = $1 AND pipeline_id = $2), $5, 'pipeline', $6, $7, $8, $8)
     RETURNING id`,
    [context.organizationId, pipelineId, name, code, probability, validText(input.description, "description", 500), validText(input.guidance, "guidance", 2000), context.userId ?? null],
  );
  await resequence(client, context, pipelineId, [...activeIds(rows), created.rows[0].id]);
  return reread(client, context, created.rows[0].id);
}

// input: any of { name, description, guidance, probability, isActive }, plus moveOpenTo when deactivating.
export async function updateSalesStage(client, context, stageId, input = {}) {
  requireManage(context);
  const { rows, stage } = await findStage(client, context, stageId);
  const fields = {};
  if (has(input, "name")) fields.name = validName(rows, input.name, stage.id);
  if (has(input, "description")) fields.description = validText(input.description, "description", 500);
  if (has(input, "guidance")) fields.guidance = validText(input.guidance, "guidance", 2000);
  const assignments = Object.entries(fields);
  if (assignments.length)
    await client.query(
      `UPDATE tenant.crm_pipeline_stages SET ${assignments.map(([column], index) => `${column} = $${index + 4}`).join(", ")}, updated_by = $3 WHERE organization_id = $1 AND id = $2`,
      [context.organizationId, stage.id, context.userId ?? null, ...assignments.map(([, value]) => value)],
    );
  if (has(input, "probability")) await setStageDefaultProbability(client, context, stage.id, input.probability);
  if (has(input, "isActive") && Boolean(input.isActive) !== (stage.status === "active")) {
    if (input.isActive) await activateSalesStage(client, context, stage.id);
    else await deactivateSalesStage(client, context, stage.id, { moveOpenTo: input.moveOpenTo });
  }
  return reread(client, context, stage.id);
}

// The stage's default probability. Open deals in the stage follow it, except
// those whose probability someone set by hand.
export async function setStageDefaultProbability(client, context, stageId, value) {
  requireManage(context);
  const { stage } = await findStage(client, context, stageId);
  const probability = validProbability(value);
  if (Number(stage.probability) === probability) return reread(client, context, stage.id);
  await client.query(`UPDATE tenant.crm_pipeline_stages SET probability = $3, updated_by = $4 WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, stage.id, probability, context.userId ?? null]);
  const following = `organization_id = $1 AND stage_id = $2 AND status = 'open' AND NOT probability_overridden AND probability <> $3`;
  await client.query(
    `INSERT INTO tenant.crm_opportunity_history (organization_id, opportunity_id, event_type, summary, changes, actor_user_id)
     SELECT organization_id, id, 'probability_changed', 'Probability: ' || trim_scale(probability) || '% → ' || trim_scale($3::numeric) || '%',
            jsonb_build_object('from', probability, 'to', $3::numeric, 'reason', 'The default probability of ' || $5::text || ' changed'), $4
       FROM tenant.crm_opportunities WHERE ${following}`,
    [context.organizationId, stage.id, probability, context.userId ?? null, stage.name],
  );
  await withLifecycleWrite(client, () => client.query(`UPDATE tenant.crm_opportunities SET probability = $3 WHERE ${following}`, [context.organizationId, stage.id, probability]));
  return reread(client, context, stage.id);
}

// Takes a stage out of use. It is never deleted, so opportunities that passed
// through it keep a readable history. A stage with open opportunities in it
// can be deactivated only by saying where they go.
// options.moveOpenTo: the active stage that takes the open opportunities.
export async function deactivateSalesStage(client, context, stageId, { moveOpenTo = null } = {}) {
  requireManage(context);
  const { pipelineId, rows, stage } = await findStage(client, context, stageId);
  if (stage.status !== "active") return reread(client, context, stage.id);
  const active = activeIds(rows);
  if (active.length <= 1) throw new CrmError(409, "The pipeline needs at least one active stage.", "CRM_SALES_STAGE_REQUIRED");
  const openCount = Number(stage.open_count);
  if (openCount > 0) {
    if (!moveOpenTo)
      throw new CrmError(409, `${openCount} ${openCount === 1 ? "opportunity currently uses" : "opportunities currently use"} this stage. Choose the stage to move ${openCount === 1 ? "it" : "them"} to.`,
        "CRM_SALES_STAGE_IN_USE", { openCount });
    const target = rows.find((row) => row.id === moveOpenTo && row.id !== stage.id && row.status === "active" && isSalesStage(row));
    if (!target) throw invalid("Choose an active stage to move the opportunities to.", "moveOpenTo");
    const open = await client.query(
      `SELECT id, stage_id, probability, probability_overridden FROM tenant.crm_opportunities
        WHERE organization_id = $1 AND stage_id = $2 AND status = 'open' AND archived_at IS NULL FOR UPDATE`,
      [context.organizationId, stage.id],
    );
    for (const opportunity of open.rows) {
      const probability = await writeStage(client, context, opportunity, target, { note: `${stage.name} was deactivated` });
      await recordOpportunityHistory(client, context, opportunity.id, "stage_changed", `Stage: ${stage.name} → ${target.name}`, {
        from: stage.id, to: target.id, fromName: stage.name, toName: target.name, probabilityBefore: Number(opportunity.probability), probability,
        note: `${stage.name} was deactivated`,
      });
    }
  }
  await client.query(`UPDATE tenant.crm_pipeline_stages SET status = 'inactive', updated_by = $3 WHERE organization_id = $1 AND id = $2`, [context.organizationId, stage.id, context.userId ?? null]);
  await resequence(client, context, pipelineId, active.filter((id) => id !== stage.id));
  return reread(client, context, stage.id);
}

// Back into use, after the last stage; move it from there.
async function activateSalesStage(client, context, stageId) {
  const { pipelineId, rows, stage } = await findStage(client, context, stageId);
  await client.query(
    `UPDATE tenant.crm_pipeline_stages SET status = 'active', updated_by = $3,
            sequence = (SELECT COALESCE(max(sequence), 0) + 200000 FROM tenant.crm_pipeline_stages WHERE organization_id = $1 AND pipeline_id = $4)
      WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, stage.id, context.userId ?? null, pipelineId],
  );
  await resequence(client, context, pipelineId, [...activeIds(rows), stage.id]);
}

// orderedIds: every active stage, in the new order. Changes how the pipeline
// is displayed; it does not rewrite any opportunity's stage history.
export async function reorderSalesStages(client, context, orderedIds) {
  requireManage(context);
  const pipelineId = await salesPipelineId(client, context);
  const rows = await readStages(client, context, pipelineId, { lock: true });
  const active = activeIds(rows);
  const ids = Array.isArray(orderedIds) ? [...new Set(orderedIds)] : [];
  if (ids.length !== active.length || active.some((id) => !ids.includes(id)))
    throw new CrmError(409, "The stages changed while you were reordering them. Reload and try again.", "CRM_SALES_STAGE_ORDER_STALE");
  await resequence(client, context, pipelineId, ids);
  return listSalesStages(client, context);
}
