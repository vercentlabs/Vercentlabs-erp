import { CrmError, queueOutboxEvent } from "./index.js";

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const dto = (row) =>
  Object.fromEntries(
    Object.entries(row || {}).map(([key, value]) => [
      key.replace(/_([a-z])/g, (_match, character) => character.toUpperCase()),
      value,
    ]),
  );
const text = (value) => String(value ?? "").trim();

function lifecycleError(error) {
  if (error instanceof CrmError) return error;
  if (error?.code === "23505")
    return new CrmError(
      409,
      "A Lead lifecycle stage with that name already exists.",
      "CRM_LEAD_STAGE_DUPLICATE",
      { errors: { name: ["Use a unique stage name."] } },
    );
  if (["23503", "23514", "22P02", "P0001"].includes(error?.code))
    return new CrmError(
      409,
      error?.code === "P0001"
        ? "Use the governed Lead lifecycle transition action."
        : "Review the Lead lifecycle values and try again.",
      "CRM_LEAD_STAGE_VALIDATION_ERROR",
    );
  return error;
}

function normalizeStageInput(input, { create = false } = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new CrmError(400, "Provide a Lead lifecycle stage object.", "CRM_LEAD_STAGE_INPUT_INVALID");
  const governed = ["id", "code", "status", "isSystem", "isInitial", "organizationId"];
  if (governed.some((field) => hasOwn(input, field)))
    throw new CrmError(
      409,
      "Stage code, lifecycle state and system flags are governed by the system.",
      "CRM_LEAD_STAGE_GOVERNED_FIELD",
    );
  const result = {};
  if (create || hasOwn(input, "name")) {
    const name = text(input.name);
    if (!name || name.length > 120)
      throw new CrmError(400, "Stage name must contain 1 to 120 characters.", "CRM_LEAD_STAGE_NAME_INVALID", {
        errors: { name: ["Enter a stage name between 1 and 120 characters."] },
      });
    result.name = name;
  }
  if (hasOwn(input, "description")) {
    const description = text(input.description);
    if (description.length > 1000)
      throw new CrmError(400, "Stage description is too long.", "CRM_LEAD_STAGE_DESCRIPTION_INVALID");
    result.description = description || null;
  }
  if (hasOwn(input, "sortOrder")) {
    const sortOrder = Number(input.sortOrder);
    if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 100000)
      throw new CrmError(400, "Stage order must be a whole number between 0 and 100000.", "CRM_LEAD_STAGE_ORDER_INVALID");
    result.sortOrder = sortOrder;
  }
  return result;
}

async function uniqueCode(client, organizationId, name) {
  const root =
    text(name)
      .normalize("NFKD")
      .replace(/[^a-zA-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .toLowerCase()
      .slice(0, 56) || "stage";
  for (let suffix = 0; suffix < 1000; suffix += 1) {
    const code = suffix ? `${root.slice(0, 56)}_${suffix + 1}` : root;
    const found = await client.query(
      "SELECT 1 FROM tenant.crm_lead_stages WHERE organization_id=$1 AND code=$2",
      [organizationId, code],
    );
    if (!found.rows[0]) return code;
  }
  throw new CrmError(409, "A stable stage code could not be allocated.", "CRM_LEAD_STAGE_CODE_CONFLICT");
}

export async function ensureDefaultLeadStages(client, context) {
  await client.query(
    `INSERT INTO tenant.crm_lead_stages(
       organization_id,code,name,description,sort_order,status,is_system,is_initial,created_by,updated_by
     ) VALUES
       ($1,'new','New','Captured and awaiting first engagement.',10,'active',true,true,$2,$2),
       ($1,'contacted','Contacted','Initial outreach has been made.',20,'active',true,false,$2,$2),
       ($1,'working','Working','Active follow-up or discovery is underway.',30,'active',true,false,$2,$2)
     ON CONFLICT (organization_id,code) DO NOTHING`,
    [context.organizationId, context.userId || null],
  );
  await rebuildLeadStageTransitions(client, context);
}

export async function rebuildLeadStageTransitions(client, context) {
  const rows = (
    await client.query(
      `SELECT id,status FROM tenant.crm_lead_stages
       WHERE organization_id=$1 ORDER BY sort_order,id FOR UPDATE`,
      [context.organizationId],
    )
  ).rows;
  await client.query("DELETE FROM tenant.crm_lead_stage_transitions WHERE organization_id=$1", [
    context.organizationId,
  ]);
  const active = rows.filter((row) => row.status === "active");
  const pairs = [];
  for (let index = 0; index < active.length - 1; index += 1) {
    pairs.push([active[index].id, active[index + 1].id], [active[index + 1].id, active[index].id]);
  }
  for (const row of rows.filter((item) => item.status === "inactive")) {
    const position = rows.findIndex((item) => item.id === row.id);
    const before = rows.slice(0, position).reverse().find((item) => item.status === "active");
    const after = rows.slice(position + 1).find((item) => item.status === "active");
    if (before) pairs.push([row.id, before.id]);
    if (after) pairs.push([row.id, after.id]);
  }
  for (const [from, to] of pairs) {
    await client.query(
      `INSERT INTO tenant.crm_lead_stage_transitions(organization_id,from_stage_id,to_stage_id,created_by)
       VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
      [context.organizationId, from, to, context.userId || null],
    );
  }
}

function stageSelect() {
  return `SELECT stage.*,
    (SELECT count(*)::int FROM tenant.crm_leads lead
      WHERE lead.organization_id=stage.organization_id AND lead.status=stage.code) AS lead_count
    FROM tenant.crm_lead_stages stage`;
}

export async function listLeadStages(client, context, options = {}) {
  await ensureDefaultLeadStages(client, context);
  const status = ["active", "inactive", "all"].includes(String(options.status))
    ? String(options.status)
    : "active";
  const values = [context.organizationId];
  let where = "WHERE stage.organization_id=$1";
  if (status !== "all") {
    values.push(status);
    where += ` AND stage.status=$${values.length}`;
  }
  const result = await client.query(
    `${stageSelect()} ${where} ORDER BY stage.status='active' DESC,stage.sort_order,stage.id`,
    values,
  );
  return { rows: result.rows.map(dto), total: result.rowCount || 0 };
}

export async function getLeadStage(client, context, idOrCode) {
  const result = await client.query(
    `${stageSelect()} WHERE stage.organization_id=$1
       AND (${uuid.test(String(idOrCode)) ? "stage.id=$2" : "stage.code=$2"}) LIMIT 1`,
    [context.organizationId, idOrCode],
  );
  if (!result.rows[0]) throw new CrmError(404, "Lead lifecycle stage not found.", "CRM_LEAD_STAGE_NOT_FOUND");
  return dto(result.rows[0]);
}

export async function createLeadStage(client, context, input = {}) {
  try {
    const value = normalizeStageInput(input, { create: true });
    const code = await uniqueCode(client, context.organizationId, value.name);
    const sortOrder = value.sortOrder ?? Number(
      (await client.query("SELECT coalesce(max(sort_order),0)+10 AS value FROM tenant.crm_lead_stages WHERE organization_id=$1", [context.organizationId])).rows[0]?.value || 10,
    );
    const created = await client.query(
      `INSERT INTO tenant.crm_lead_stages(
         organization_id,code,name,description,sort_order,status,is_system,is_initial,created_by,updated_by
       ) VALUES($1,$2,$3,$4,$5,'active',false,false,$6,$6) RETURNING id`,
      [context.organizationId, code, value.name, value.description ?? null, sortOrder, context.userId],
    );
    await rebuildLeadStageTransitions(client, context);
    const stage = await getLeadStage(client, context, created.rows[0].id);
    await queueOutboxEvent(client, context, "crm.lead_stage.created", "lead_stage", stage.id, {
      stageId: stage.id, code: stage.code, name: stage.name,
    });
    return stage;
  } catch (error) {
    throw lifecycleError(error);
  }
}

export async function updateLeadStage(client, context, id, input = {}) {
  try {
    const before = await getLeadStage(client, context, id);
    const value = normalizeStageInput(input);
    const fields = Object.keys(value);
    if (!fields.length) throw new CrmError(400, "Provide a stage field to update.", "CRM_LEAD_STAGE_EMPTY_PATCH");
    const columns = { name: "name", description: "description", sortOrder: "sort_order" };
    const values = [context.organizationId, id];
    const sets = fields.map((field) => {
      values.push(value[field]);
      return `${columns[field]}=$${values.length}`;
    });
    values.push(context.userId);
    await client.query(
      `UPDATE tenant.crm_lead_stages SET ${sets.join(",")},updated_by=$${values.length},updated_at=now()
       WHERE organization_id=$1 AND id=$2`,
      values,
    );
    await rebuildLeadStageTransitions(client, context);
    const stage = await getLeadStage(client, context, id);
    await queueOutboxEvent(client, context, "crm.lead_stage.updated", "lead_stage", id, {
      stageId: id, code: before.code, changedFields: fields,
      before: { name: before.name, sortOrder: before.sortOrder },
      after: { name: stage.name, sortOrder: stage.sortOrder },
    });
    return stage;
  } catch (error) {
    throw lifecycleError(error);
  }
}

export async function setLeadStageActive(client, context, id, active) {
  try {
    const before = await getLeadStage(client, context, id);
    const next = active ? "active" : "inactive";
    if (before.status === next) return before;
    if (!active && before.isInitial)
      throw new CrmError(409, "The initial New stage cannot be deactivated.", "CRM_LEAD_STAGE_INITIAL_REQUIRED");
    if (!active) {
      const remaining = await client.query(
        "SELECT count(*)::int AS count FROM tenant.crm_lead_stages WHERE organization_id=$1 AND status='active' AND id<>$2",
        [context.organizationId, id],
      );
      if (!Number(remaining.rows[0]?.count))
        throw new CrmError(409, "At least one active Lead lifecycle stage is required.", "CRM_LEAD_STAGE_LAST_ACTIVE");
    }
    await client.query(
      "UPDATE tenant.crm_lead_stages SET status=$3,updated_by=$4,updated_at=now() WHERE organization_id=$1 AND id=$2",
      [context.organizationId, id, next, context.userId],
    );
    await rebuildLeadStageTransitions(client, context);
    const stage = await getLeadStage(client, context, id);
    await queueOutboxEvent(
      client, context, active ? "crm.lead_stage.reactivated" : "crm.lead_stage.deactivated", "lead_stage", id,
      { stageId: id, code: before.code, leadCount: before.leadCount },
    );
    return stage;
  } catch (error) {
    throw lifecycleError(error);
  }
}

function scopedLeadWhere(context, values) {
  let sql = "";
  if (context.activeCompanyId) {
    values.push(context.activeCompanyId);
    sql += ` AND (lead.company_id IS NULL OR lead.company_id=$${values.length})`;
  } else if (!context.allowAllCompanies) sql += " AND false";
  if (context.activeBranchId) {
    values.push(context.activeBranchId);
    sql += ` AND (lead.branch_id IS NULL OR lead.branch_id=$${values.length})`;
  }
  const viewAll = context.roleSlugs?.includes("organization_owner") || context.permissions?.includes("crm.records.view_all");
  if (!viewAll) {
    values.push(context.userId);
    sql += ` AND (lead.owner_user_id IS NULL OR lead.owner_user_id=$${values.length})`;
  }
  return sql;
}

export async function listLeadStageHistory(client, context, leadId) {
  const values = [context.organizationId, leadId];
  const visible = await client.query(
    `SELECT lead.id FROM tenant.crm_leads lead WHERE lead.organization_id=$1 AND lead.id=$2${scopedLeadWhere(context, values)}`,
    values,
  );
  if (!visible.rows[0]) throw new CrmError(404, "Lead not found.", "CRM_LEAD_NOT_FOUND");
  const result = await client.query(
    `SELECT event.*,from_stage.name AS from_stage_name,to_stage.name AS to_stage_name,
            coalesce(nullif(btrim(actor.full_name),''),actor.email) AS actor_name
       FROM tenant.crm_lead_stage_events event
       JOIN tenant.crm_lead_stages from_stage ON from_stage.organization_id=event.organization_id AND from_stage.id=event.from_stage_id
       JOIN tenant.crm_lead_stages to_stage ON to_stage.organization_id=event.organization_id AND to_stage.id=event.to_stage_id
       LEFT JOIN public.users actor ON actor.id=event.changed_by_user_id
      WHERE event.organization_id=$1 AND event.lead_id=$2
      ORDER BY event.created_at DESC,event.id DESC LIMIT 200`,
    [context.organizationId, leadId],
  );
  return result.rows.map(dto);
}

export async function transitionLeadStage(client, context, leadId, input = {}) {
  try {
    const targetValue = text(input.stageId || input.stageCode || input.status);
    if (!targetValue)
      throw new CrmError(400, "Choose a destination lifecycle stage.", "CRM_LEAD_STAGE_TARGET_REQUIRED");
    const values = [context.organizationId, leadId];
    const result = await client.query(
      `SELECT lead.*,current.id AS current_stage_id,current.name AS current_stage_name,current.status AS current_stage_status
         FROM tenant.crm_leads lead
         JOIN tenant.crm_lead_stages current ON current.organization_id=lead.organization_id AND current.code=lead.status
        WHERE lead.organization_id=$1 AND lead.id=$2${scopedLeadWhere(context, values)} FOR UPDATE OF lead`,
      values,
    );
    const lead = result.rows[0];
    if (!lead) throw new CrmError(404, "Lead not found.", "CRM_LEAD_NOT_FOUND");
    if (lead.record_status !== "active")
      throw new CrmError(409, `A ${lead.record_status} Lead cannot move lifecycle stage.`, "CRM_LEAD_STAGE_RECORD_CLOSED");
    if (input.expectedUpdatedAt && new Date(input.expectedUpdatedAt).toISOString() !== new Date(lead.updated_at).toISOString())
      throw new CrmError(409, "This Lead changed after the board loaded. Refresh and try again.", "CRM_LEAD_STAGE_CONFLICT");
    const target = await getLeadStage(client, context, targetValue);
    if (target.status !== "active")
      throw new CrmError(409, "Inactive stages cannot receive new transitions.", "CRM_LEAD_STAGE_INACTIVE");
    if (target.code === lead.status) {
      return { changed: false, record: dto(lead), stage: target, history: await listLeadStageHistory(client, context, leadId) };
    }
    const allowed = await client.query(
      `SELECT 1 FROM tenant.crm_lead_stage_transitions
       WHERE organization_id=$1 AND from_stage_id=$2 AND to_stage_id=$3`,
      [context.organizationId, lead.current_stage_id, target.id],
    );
    if (!allowed.rows[0])
      throw new CrmError(
        409,
        `Lead cannot move directly from ${lead.current_stage_name} to ${target.name}.`,
        "CRM_LEAD_STAGE_TRANSITION_INVALID",
      );
    const source = ["manual", "kanban", "api", "legacy"].includes(String(input.source)) ? String(input.source) : "manual";
    const note = text(input.note) || null;
    if (note && note.length > 1000) throw new CrmError(400, "Transition note is too long.", "CRM_LEAD_STAGE_NOTE_INVALID");
    await client.query("SELECT set_config('app.crm_lead_stage_transition','allowed',true)");
    let updated;
    try {
      updated = await client.query(
        `UPDATE tenant.crm_leads SET status=$3,updated_by=$4,updated_at=now()
         WHERE organization_id=$1 AND id=$2 RETURNING *`,
        [context.organizationId, leadId, target.code, context.userId],
      );
    } finally {
      await client.query("SELECT set_config('app.crm_lead_stage_transition','',true)");
    }
    const event = await client.query(
      `INSERT INTO tenant.crm_lead_stage_events(
         organization_id,lead_id,from_stage_id,to_stage_id,from_stage_code,to_stage_code,source,note,changed_by_user_id
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [context.organizationId, leadId, lead.current_stage_id, target.id, lead.status, target.code, source, note, context.userId],
    );
    await queueOutboxEvent(client, context, "crm.lead.stage_changed", "leads", leadId, {
      before: { status: lead.status }, after: { status: target.code },
      changedFields: ["status"], eventId: event.rows[0].id, source,
    });
    return {
      changed: true,
      record: dto(updated.rows[0]),
      stage: target,
      event: dto(event.rows[0]),
      history: await listLeadStageHistory(client, context, leadId),
    };
  } catch (error) {
    throw lifecycleError(error);
  }
}
