// Lead stages: where a lead is in the process (New → Attempting Contact →
// Contacted → Nurturing → Qualification). Stage is separate from status (the
// outcome), rating and disqualification reason.
//
// Every organization has the five system stages. An administrator can
// rename and reorder them and add stages of their own; the code tests the
// stable stage code (QUALIFICATION_STAGE), never the display name.
//
// While a lead is open its stage moves freely, forwards or backwards. Every
// move is one row in the stage history, so "how long did it sit in New?" can
// be answered later.
import { CrmError } from "../data-management/errors.js";
import { leadCan, requireLeadPermission } from "./access.js";
import { DEFAULT_LEAD_STAGES, LEAD_PERMISSIONS } from "./constants.js";
import { recordLeadHistory } from "./history.js";
import { isUuid, requireUuid } from "./validation.js";

export const NEW_STAGE = "new";
export const QUALIFICATION_STAGE = "qualification";

const text = (value) => String(value ?? "").trim();

function requireStageManager(context) {
  if (!leadCan(context, LEAD_PERMISSIONS.manageStages) && !leadCan(context, "crm.settings.manage"))
    throw new CrmError(403, "You do not have permission to manage lead stages.", "PERMISSION_DENIED");
}

function toStage(row) {
  return {
    id: row.id,
    code: row.code,
    // `label` is what pickers show; it is the administrator's name for the stage.
    label: row.name,
    name: row.name,
    sequence: row.sequence,
    isActive: row.is_active,
    isSystem: row.is_system,
    leadCount: row.lead_count === undefined ? undefined : Number(row.lead_count),
  };
}

// Idempotent: adds the system stages an organization does not have yet.
export async function ensureDefaultLeadStages(client, context) {
  const existing = await client.query(`SELECT 1 FROM tenant.crm_lead_stages WHERE organization_id = $1 LIMIT 1`, [context.organizationId]);
  if (existing.rows[0]) return;
  for (const [index, stage] of DEFAULT_LEAD_STAGES.entries())
    await client.query(
      `INSERT INTO tenant.crm_lead_stages (organization_id, code, name, sequence, is_system, created_by, updated_by)
       VALUES ($1, $2, $3, $4, true, $5, $5) ON CONFLICT DO NOTHING`,
      [context.organizationId, stage.code, stage.label, (index + 1) * 10, context.userId ?? null],
    );
}

// In process order. leadCount is the open leads currently in the stage.
export async function listLeadStages(client, context, { includeInactive = false } = {}) {
  await ensureDefaultLeadStages(client, context);
  const { rows } = await client.query(
    `SELECT stage.*, (SELECT count(*) FROM tenant.crm_leads lead
                       WHERE lead.organization_id = stage.organization_id AND lead.stage = stage.code AND lead.status = 'open' AND lead.archived_at IS NULL) AS lead_count
       FROM tenant.crm_lead_stages stage
      WHERE stage.organization_id = $1 AND ($2 OR stage.is_active)
      ORDER BY stage.sequence, stage.created_at`,
    [context.organizationId, includeInactive],
  );
  return rows.map(toStage);
}

async function stageName(client, context, value, excludeId = null) {
  const name = text(value);
  if (!name || name.length > 60) throw new CrmError(400, "Enter a stage name of up to 60 characters.", "CRM_LEAD_STAGE_VALIDATION");
  const clash = await client.query(
    `SELECT 1 FROM tenant.crm_lead_stages WHERE organization_id = $1 AND lower(btrim(name)) = lower($2) AND ($3::uuid IS NULL OR id <> $3)`,
    [context.organizationId, name, excludeId],
  );
  if (clash.rows[0]) throw new CrmError(409, `There is already a stage called "${name}".`, "CRM_LEAD_STAGE_DUPLICATE");
  return name;
}

// A new stage goes to the end; use reorder to place it.
export async function createLeadStage(client, context, input = {}) {
  requireStageManager(context);
  await ensureDefaultLeadStages(client, context);
  const name = await stageName(client, context, input.name);
  const { rows } = await client.query(
    `INSERT INTO tenant.crm_lead_stages (organization_id, code, name, sequence, created_by, updated_by)
     VALUES ($1, 'custom_' || replace(gen_random_uuid()::text, '-', ''), $2,
             (SELECT COALESCE(max(sequence), 0) + 10 FROM tenant.crm_lead_stages WHERE organization_id = $1), $3, $3)
     RETURNING *`,
    [context.organizationId, name, context.userId ?? null],
  );
  return toStage(rows[0]);
}

// input: { name?, isActive? }. A system stage can be renamed but not
// deactivated; a stage with open leads in it cannot be deactivated.
export async function updateLeadStage(client, context, id, input = {}) {
  requireStageManager(context);
  const stage = (await client.query(`SELECT * FROM tenant.crm_lead_stages WHERE organization_id = $1 AND id = $2 FOR UPDATE`,
    [context.organizationId, requireUuid(id, "Stage")])).rows[0];
  if (!stage) throw new CrmError(404, "Stage not found.", "CRM_LEAD_STAGE_NOT_FOUND");
  const name = Object.hasOwn(input, "name") ? await stageName(client, context, input.name, stage.id) : stage.name;
  const isActive = Object.hasOwn(input, "isActive") ? input.isActive === true : stage.is_active;
  if (!isActive && stage.is_system) throw new CrmError(409, `${stage.name} is a standard stage. It can be renamed, but not deactivated.`, "CRM_LEAD_STAGE_SYSTEM");
  if (!isActive && stage.is_active) {
    const inUse = await client.query(
      `SELECT count(*)::int AS n FROM tenant.crm_leads WHERE organization_id = $1 AND stage = $2 AND status = 'open' AND archived_at IS NULL`,
      [context.organizationId, stage.code],
    );
    if (inUse.rows[0].n > 0)
      throw new CrmError(409, `${inUse.rows[0].n} open ${inUse.rows[0].n === 1 ? "lead is" : "leads are"} in ${stage.name}. Move them to another stage first.`, "CRM_LEAD_STAGE_IN_USE");
  }
  const { rows } = await client.query(
    `UPDATE tenant.crm_lead_stages SET name = $3, is_active = $4, updated_by = $5 WHERE organization_id = $1 AND id = $2 RETURNING *`,
    [context.organizationId, stage.id, name, isActive, context.userId ?? null],
  );
  return toStage(rows[0]);
}

// orderedIds: every stage id, in process order.
export async function reorderLeadStages(client, context, orderedIds) {
  requireStageManager(context);
  const ids = [...new Set((Array.isArray(orderedIds) ? orderedIds : []).filter(isUuid))];
  const existing = await client.query(`SELECT id FROM tenant.crm_lead_stages WHERE organization_id = $1 FOR UPDATE`, [context.organizationId]);
  const known = new Set(existing.rows.map((row) => row.id));
  if (ids.length !== known.size || ids.some((id) => !known.has(id)))
    throw new CrmError(409, "The stages changed while you were reordering them. Reload and try again.", "CRM_LEAD_STAGE_ORDER_STALE");
  for (const [index, id] of ids.entries())
    await client.query(`UPDATE tenant.crm_lead_stages SET sequence = $3, updated_by = $4 WHERE organization_id = $1 AND id = $2`,
      [context.organizationId, id, (index + 1) * 10, context.userId ?? null]);
  return listLeadStages(client, context, { includeInactive: true });
}

// ------------------------------------------------------------------ moving a lead

export async function recordLeadStageEntry(client, context, leadId, { from = null, to, note = null, automatic = false }) {
  await client.query(
    `INSERT INTO tenant.crm_lead_stage_history (organization_id, lead_id, from_stage, to_stage, note, is_automatic, changed_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [context.organizationId, leadId, from, to, text(note).slice(0, 500) || null, automatic, context.userId ?? null],
  );
}

// Moves a lead row the caller has already locked. Returns true when the
// stage changed. options: note, automatic (an operation moved it, not a
// person choosing a stage), allowStatus (statuses other than open in which
// the move is still valid: Qualify moves the lead as it changes the status).
export async function applyLeadStage(client, context, lead, stageCode, { note = null, automatic = false, allowAnyStatus = false } = {}) {
  if (lead.stage === stageCode) return false;
  if (lead.status === "converted") throw new CrmError(409, "A converted lead is historical; its stage cannot change.", "CRM_LEAD_CONVERTED");
  if (lead.status !== "open" && !allowAnyStatus)
    throw new CrmError(409, `The stage cannot change while the lead is ${lead.status}. Reopen the lead first.`, "CRM_LEAD_STAGE_STATUS_CONFLICT");
  const stages = (await client.query(`SELECT code, name, is_active FROM tenant.crm_lead_stages WHERE organization_id = $1 AND code = ANY ($2::text[])`,
    [context.organizationId, [lead.stage, stageCode]])).rows;
  const target = stages.find((stage) => stage.code === stageCode);
  if (!target || !target.is_active) throw new CrmError(400, "Choose a stage.", "CRM_LEAD_STAGE_INVALID");
  const previous = stages.find((stage) => stage.code === lead.stage);

  await client.query(
    `UPDATE tenant.crm_leads SET stage = $3, stage_changed_at = now(), updated_by = $4 WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, lead.id, stageCode, context.userId ?? null],
  );
  await recordLeadStageEntry(client, context, lead.id, { from: lead.stage, to: stageCode, note, automatic });
  await recordLeadHistory(client, context, lead.id, "stage_changed", `Stage: ${previous?.name ?? lead.stage} → ${target.name}`, {
    from: lead.stage, to: stageCode, note: text(note).slice(0, 500) || null, automatic,
  });
  return true;
}

export function requireStageChangePermission(context) {
  requireLeadPermission(context, LEAD_PERMISSIONS.changeStage, "You do not have permission to change the stage of leads.");
}

// Each stage the lead has been in, newest first, with how long it stayed.
// Callers load the lead first (getLead), which is what enforces visibility.
export async function listLeadStageEntries(client, context, leadId) {
  const { rows } = await client.query(
    `SELECT history.id, history.from_stage, history.to_stage, history.note, history.is_automatic, history.changed_at,
            actor.full_name AS changed_by_name, from_stage.name AS from_name, to_stage.name AS to_name,
            lead(history.changed_at) OVER (ORDER BY history.changed_at, history.id) AS left_at
       FROM tenant.crm_lead_stage_history history
       LEFT JOIN public.users actor ON actor.id = history.changed_by
       LEFT JOIN tenant.crm_lead_stages from_stage ON from_stage.organization_id = history.organization_id AND from_stage.code = history.from_stage
       LEFT JOIN tenant.crm_lead_stages to_stage ON to_stage.organization_id = history.organization_id AND to_stage.code = history.to_stage
      WHERE history.organization_id = $1 AND history.lead_id = $2
      ORDER BY history.changed_at DESC, history.id DESC`,
    [context.organizationId, requireUuid(leadId, "Lead")],
  );
  return rows.map((row) => ({
    id: row.id,
    fromStage: row.from_stage,
    fromStageName: row.from_name ?? row.from_stage,
    toStage: row.to_stage,
    toStageName: row.to_name ?? row.to_stage,
    note: row.note,
    isAutomatic: row.is_automatic,
    enteredAt: row.changed_at,
    // null while the lead is still in this stage
    leftAt: row.left_at,
    changedByName: row.changed_by_name ?? null,
  }));
}
