// F007 Lead lifecycle — stage catalogue (definition, ordering, dwell SLA
// configuration). The directed transition graph itself lives in
// transition-graph.js; safe deactivation-with-migration lives in
// stage-migration.js.
import {
  CrmError,
  queueOutboxEvent,
  canViewSensitiveLeadContent,
  hasOwn,
  dto,
  text,
  lifecycleError,
  stageSelect,
  getLeadStage,
  scopedLeadWhere,
} from "./shared.js";

export { getLeadStage };

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
  for (const field of ["dwellWarningHours", "dwellBreachHours"]) {
    if (!hasOwn(input, field)) continue;
    if (input[field] === null) {
      result[field] = null;
      continue;
    }
    const hours = Number(input[field]);
    if (!Number.isInteger(hours) || hours <= 0 || hours > 100000)
      throw new CrmError(400, "Dwell SLA hours must be a positive whole number, or null to clear it.", "CRM_LEAD_STAGE_DWELL_INVALID");
    result[field] = hours;
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

// Idempotent: seeds the 3 default stages exactly once per org, and — only
// on the run that actually inserts them — seeds a sensible one-directional
// default graph (new->contacted->working) via ON CONFLICT DO NOTHING. This
// replaces the old "regenerate the whole bidirectional graph on every
// call" behavior; an admin's own edits to the graph are never overwritten
// by a later listLeadStages() call.
export async function ensureDefaultLeadStages(client, context) {
  const inserted = await client.query(
    `INSERT INTO tenant.crm_lead_stages(
       organization_id,code,name,description,sort_order,status,is_system,is_initial,created_by,updated_by
     ) VALUES
       ($1,'new','New','Captured and awaiting first engagement.',10,'active',true,true,$2,$2),
       ($1,'contacted','Contacted','Initial outreach has been made.',20,'active',true,false,$2,$2),
       ($1,'working','Working','Active follow-up or discovery is underway.',30,'active',true,false,$2,$2)
     ON CONFLICT (organization_id,code) DO NOTHING
     RETURNING id,code`,
    [context.organizationId, context.userId || null],
  );
  if (!inserted.rows.length) return;
  const byCode = Object.fromEntries(
    (
      await client.query(
        `SELECT id,code FROM tenant.crm_lead_stages WHERE organization_id=$1 AND code IN ('new','contacted','working')`,
        [context.organizationId],
      )
    ).rows.map((row) => [row.code, row.id]),
  );
  const edges = [
    [byCode.new, byCode.contacted],
    [byCode.contacted, byCode.working],
  ].filter(([from, to]) => from && to);
  for (const [from, to] of edges) {
    await client.query(
      `INSERT INTO tenant.crm_lead_stage_transitions(organization_id,from_stage_id,to_stage_id,created_by)
       VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
      [context.organizationId, from, to, context.userId || null],
    );
  }
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

export async function createLeadStage(client, context, input = {}) {
  try {
    const value = normalizeStageInput(input, { create: true });
    const code = await uniqueCode(client, context.organizationId, value.name);
    const sortOrder = value.sortOrder ?? Number(
      (await client.query("SELECT coalesce(max(sort_order),0)+10 AS value FROM tenant.crm_lead_stages WHERE organization_id=$1", [context.organizationId])).rows[0]?.value || 10,
    );
    const created = await client.query(
      `INSERT INTO tenant.crm_lead_stages(
         organization_id,code,name,description,sort_order,status,is_system,is_initial,dwell_warning_hours,dwell_breach_hours,created_by,updated_by
       ) VALUES($1,$2,$3,$4,$5,'active',false,false,$6,$7,$8,$8) RETURNING id`,
      [
        context.organizationId,
        code,
        value.name,
        value.description ?? null,
        sortOrder,
        value.dwellWarningHours ?? null,
        value.dwellBreachHours ?? null,
        context.userId,
      ],
    );
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
    const columns = {
      name: "name",
      description: "description",
      sortOrder: "sort_order",
      dwellWarningHours: "dwell_warning_hours",
      dwellBreachHours: "dwell_breach_hours",
    };
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

// Deactivation is delegated to stage-migration.js's
// deactivateLeadStageWithMigration, which performs the same status flip
// but first enforces the "no active Leads stranded on an inactive stage"
// invariant (blocking, or routing through a governed migration job).
// Reactivation has no such invariant, so it stays here.
export async function reactivateLeadStage(client, context, id) {
  try {
    const before = await getLeadStage(client, context, id);
    if (before.status === "active") return before;
    await client.query(
      "UPDATE tenant.crm_lead_stages SET status='active',updated_by=$3,updated_at=now() WHERE organization_id=$1 AND id=$2",
      [context.organizationId, id, context.userId],
    );
    const stage = await getLeadStage(client, context, id);
    await queueOutboxEvent(client, context, "crm.lead_stage.reactivated", "lead_stage", id, {
      stageId: id, code: before.code,
    });
    return stage;
  } catch (error) {
    throw lifecycleError(error);
  }
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
  return result.rows.map((row) => {
    const value = dto(row);
    if (!canViewSensitiveLeadContent(context)) delete value.note;
    return value;
  });
}

// F007-CALC-001: dwell is derived from stage_entered_at (itself a
// synchronized projection of the immutable crm_lead_stage_events log — see
// migration 093's comment), never from the mutable updated_at column.
export async function getLeadStageDwell(client, context, leadId) {
  const values = [context.organizationId, leadId];
  const result = await client.query(
    `SELECT lead.stage_entered_at,current.dwell_warning_hours,current.dwell_breach_hours
       FROM tenant.crm_leads lead
       JOIN tenant.crm_lead_stages current ON current.organization_id=lead.organization_id AND current.code=lead.status
      WHERE lead.organization_id=$1 AND lead.id=$2${scopedLeadWhere(context, values)}`,
    values,
  );
  const row = result.rows[0];
  if (!row) throw new CrmError(404, "Lead not found.", "CRM_LEAD_NOT_FOUND");
  const enteredAt = new Date(row.stage_entered_at);
  const elapsedHours = (Date.now() - enteredAt.getTime()) / 3_600_000;
  const warningHours = row.dwell_warning_hours === null ? null : Number(row.dwell_warning_hours);
  const breachHours = row.dwell_breach_hours === null ? null : Number(row.dwell_breach_hours);
  let status = "ok";
  if (breachHours !== null && elapsedHours >= breachHours) status = "breached";
  else if (warningHours !== null && elapsedHours >= warningHours) status = "warning";
  return {
    enteredAt: row.stage_entered_at,
    elapsedHours: Math.round(elapsedHours * 100) / 100,
    warningHours,
    breachHours,
    status,
  };
}
