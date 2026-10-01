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
import { STAGE_MIGRATION_JOB_TYPE } from "./stage-migration.js";

export { getLeadStage };

// Vercentlabs standard Lead pipeline (see docs/03-modules/crm/DECISIONS.md
// "Default Lead pipeline = five operational stages"): a deliberately richer
// default than the original 3-stage new/contacted/working pipeline, while
// keeping the three-axis model intact — this is ONLY the pipeline-stage
// axis (F007). Qualification (F006: not_reviewed/qualified/unqualified) and
// record_status (active/archived/converted) remain entirely separate columns
// and are never represented as a pipeline stage here.
//
// Stable codes are chosen to preserve history: `new`, `contacted` and
// `working` are the exact codes every existing organization's Leads already
// reference (crm_leads.status), so no Lead record ever needs to change its
// stage code merely because the label/order changed. `contacted` now means
// "Connected" and `working` now means "Working / Discovery" as HUMAN-FACING
// labels only — the code, which is what history/FKs/automation key off, is
// unchanged. `attempting` and `nurturing` are new stable codes for the two
// new stages.
export const FIVE_STAGE_LEAD_TEMPLATE = Object.freeze([
  { code: "new", name: "New", description: "Captured and awaiting first engagement.", sortOrder: 10, isInitial: true },
  { code: "attempting", name: "Attempting Contact", description: "Outreach has been initiated; awaiting a response.", sortOrder: 20, isInitial: false },
  { code: "contacted", name: "Connected", description: "Two-way contact has been established with the prospect.", sortOrder: 30, isInitial: false },
  { code: "working", name: "Working / Discovery", description: "Active follow-up or discovery is underway.", sortOrder: 40, isInitial: false },
  { code: "nurturing", name: "Nurturing", description: "A real prospect worth retaining, but not currently in active discovery. Not the same as Unqualified — qualification is tracked separately.", sortOrder: 50, isInitial: false },
]);

// The recommended directed graph: a forward path from New through to
// Nurturing, plus one re-engagement edge back to Attempting Contact so a
// nurtured Lead can be worked again. Deliberately NOT an all-to-all or
// bidirectional-adjacency graph — every edge here is a real, intentional
// business transition (see docs/03-modules/crm/features/F007-lead-stages-
// and-statuses.md's transition-graph requirement).
export const FIVE_STAGE_LEAD_GRAPH = Object.freeze([
  ["new", "attempting"],
  ["attempting", "contacted"],
  ["contacted", "working"],
  ["working", "nurturing"],
  ["nurturing", "attempting"],
]);

// The exact stage rows migration 063 originally seeded for every
// organization, before this template existed. Used only to recognize an
// "untouched legacy default" organization for the safe automatic upgrade
// below — never used to seed anything new.
const LEGACY_THREE_STAGE_SEED = Object.freeze({
  new: { name: "New", description: "Captured and awaiting first engagement.", sortOrder: 10 },
  contacted: { name: "Contacted", description: "Initial outreach has been made.", sortOrder: 20 },
  working: { name: "Working", description: "Active follow-up or discovery is underway.", sortOrder: 30 },
});

// Migration 063 seeded a bidirectional adjacency graph for organizations
// that existed before migration 093 introduced the real directed-graph
// model (093's own comment: "Existing rows ... are left untouched ...
// every org's current graph keeps working exactly as before"). Organizations
// created AFTER 093 instead got the one-directional new->contacted->working
// graph this file used to seed. Both are "the untouched default" for
// classification purposes — neither represents deliberate admin
// configuration — so both are recognized here, and either is eligible for
// the safe automatic upgrade to the five-stage template.
const LEGACY_KNOWN_EDGES = new Set(["new->contacted", "contacted->new", "contacted->working", "working->contacted"]);
const LEGACY_REQUIRED_EDGES = ["new->contacted", "contacted->working"];

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

async function insertStageGraphEdges(client, context, graph, byCode) {
  for (const [from, to] of graph) {
    if (!byCode[from] || !byCode[to]) continue;
    await client.query(
      `INSERT INTO tenant.crm_lead_stage_transitions(organization_id,from_stage_id,to_stage_id,created_by)
       VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
      [context.organizationId, byCode[from], byCode[to], context.userId || null],
    );
  }
}

async function seedFreshFiveStageTemplate(client, context) {
  const actorId = context.userId || null;
  const values = [];
  const rows = FIVE_STAGE_LEAD_TEMPLATE.map((stage) => {
    const base = values.length;
    values.push(context.organizationId, stage.code, stage.name, stage.description, stage.sortOrder, stage.isInitial, actorId);
    return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},'active',true,$${base + 6},$${base + 7},$${base + 7})`;
  });
  const inserted = await client.query(
    `INSERT INTO tenant.crm_lead_stages(
       organization_id,code,name,description,sort_order,status,is_system,is_initial,created_by,updated_by
     ) VALUES ${rows.join(",")}
     ON CONFLICT (organization_id,code) DO NOTHING
     RETURNING id,code`,
    values,
  );
  if (!inserted.rows.length) return; // race: another concurrent call already seeded
  const byCode = Object.fromEntries(inserted.rows.map((row) => [row.code, row.id]));
  await insertStageGraphEdges(client, context, FIVE_STAGE_LEAD_GRAPH, byCode);
}

// Recognizes an organization whose Lead stage catalogue is EXACTLY the
// original 3-stage default with no admin customization at all — never a
// heuristic guess. Every check here must pass for an automatic upgrade to
// be safe; if any single check is ambiguous, the org is treated as
// CUSTOMIZED and left alone (see docs/03-modules/point-of-sale-unrelated
// principle applied here: fail closed toward preserving customer intent).
export async function classifyLeadStageCustomization(client, context, stages) {
  if (stages.length !== 3) return "CUSTOMIZED";
  const byCode = Object.fromEntries(stages.map((s) => [s.code, s]));
  if (!byCode.new || !byCode.contacted || !byCode.working) return "CUSTOMIZED";
  for (const [code, seed] of Object.entries(LEGACY_THREE_STAGE_SEED)) {
    const row = byCode[code];
    if (row.status !== "active" || !row.is_system) return "CUSTOMIZED";
    if (row.name !== seed.name || row.description !== seed.description) return "CUSTOMIZED";
    if (Number(row.sort_order) !== seed.sortOrder) return "CUSTOMIZED";
    if (row.dwell_warning_hours !== null || row.dwell_breach_hours !== null) return "CUSTOMIZED";
  }
  if (!byCode.new.is_initial || byCode.contacted.is_initial || byCode.working.is_initial) return "CUSTOMIZED";

  const edges = await client.query(
    `SELECT from_stage.code AS from_code,to_stage.code AS to_code,edge.reason_required
       FROM tenant.crm_lead_stage_transitions edge
       JOIN tenant.crm_lead_stages from_stage ON from_stage.organization_id=edge.organization_id AND from_stage.id=edge.from_stage_id
       JOIN tenant.crm_lead_stages to_stage ON to_stage.organization_id=edge.organization_id AND to_stage.id=edge.to_stage_id
      WHERE edge.organization_id=$1`,
    [context.organizationId],
  );
  if (edges.rows.some((edge) => edge.reason_required)) return "CUSTOMIZED";
  const edgeKeys = edges.rows.map((edge) => `${edge.from_code}->${edge.to_code}`);
  if (!edgeKeys.every((key) => LEGACY_KNOWN_EDGES.has(key))) return "CUSTOMIZED";
  if (!LEGACY_REQUIRED_EDGES.every((key) => edgeKeys.includes(key))) return "CUSTOMIZED";

  const reasons = await client.query(
    `SELECT count(*)::int AS count FROM tenant.crm_lead_stage_transition_reasons WHERE organization_id=$1`,
    [context.organizationId],
  );
  if (Number(reasons.rows[0]?.count || 0) > 0) return "CUSTOMIZED";

  const migrations = await client.query(
    `SELECT count(*)::int AS count FROM tenant.background_jobs WHERE organization_id=$1 AND job_type=$2`,
    [context.organizationId, STAGE_MIGRATION_JOB_TYPE],
  );
  if (Number(migrations.rows[0]?.count || 0) > 0) return "CUSTOMIZED";

  return "UNTOUCHED_STANDARD_3_STAGE";
}

// Safe automatic upgrade for a classified-untouched organization: relabels
// the 3 existing stages to the new template's names/descriptions/order
// (safe — we've just proven these are unmodified defaults, not customer
// text), adds the two new stages, and REBUILDS the transition graph from
// scratch with the new 5-edge cycle. Rebuilding (not merely appending) the
// graph is safe specifically because classifyLeadStageCustomization already
// proved every existing edge is auto-generated, not admin-added — the
// caller must never call this without that proof. Never touches
// crm_leads.status or crm_lead_stage_events: existing Leads keep whatever
// stage code they already have (the codes themselves never change), and
// history remains exactly as it was.
async function upgradeUntouchedThreeStageToFive(client, context, existingStages) {
  const byCode = Object.fromEntries(existingStages.map((s) => [s.code, s]));
  for (const stage of FIVE_STAGE_LEAD_TEMPLATE) {
    if (!byCode[stage.code]) continue;
    await client.query(
      `UPDATE tenant.crm_lead_stages SET name=$3,description=$4,sort_order=$5,updated_at=now()
        WHERE organization_id=$1 AND code=$2`,
      [context.organizationId, stage.code, stage.name, stage.description, stage.sortOrder],
    );
  }
  const newStages = FIVE_STAGE_LEAD_TEMPLATE.filter((stage) => !byCode[stage.code]);
  for (const stage of newStages) {
    await client.query(
      `INSERT INTO tenant.crm_lead_stages(organization_id,code,name,description,sort_order,status,is_system,is_initial,created_by,updated_by)
       VALUES ($1,$2,$3,$4,$5,'active',true,false,$6,$6)
       ON CONFLICT (organization_id,code) DO NOTHING`,
      [context.organizationId, stage.code, stage.name, stage.description, stage.sortOrder, context.userId || null],
    );
  }
  await client.query(`DELETE FROM tenant.crm_lead_stage_transitions WHERE organization_id=$1`, [context.organizationId]);
  const byCodeAfter = Object.fromEntries(
    (await client.query(`SELECT id,code FROM tenant.crm_lead_stages WHERE organization_id=$1`, [context.organizationId])).rows.map((row) => [
      row.code,
      row.id,
    ]),
  );
  await insertStageGraphEdges(client, context, FIVE_STAGE_LEAD_GRAPH, byCodeAfter);
  await queueOutboxEvent(client, context, "crm.lead_stage_template.auto_upgraded", "lead_stage_template", context.organizationId, {
    stagesAdded: newStages.map((stage) => stage.code),
  });
}

// Idempotent seeding/upgrade entry point, called on every listLeadStages()
// and (see resource-mutation-service.js) before the very first Lead a new
// organization ever creates — a truly fresh organization otherwise has no
// 'new' stage row for crm_leads_lifecycle_stage_fkey to reference at all.
//
// Three outcomes, computed fresh every call (never cached, never assumed):
//   1. No stages exist yet -> seed the standard five-stage template.
//   2. Stages exist and classify as UNTOUCHED_STANDARD_3_STAGE -> safe
//      automatic upgrade to the five-stage template (see the function
//      above for exactly what "safe" means here).
//   3. Anything else (already five-stage, or genuinely customized) -> do
//      nothing. An admin's own configuration, or a prior upgrade, is never
//      overwritten by a later call.
export async function ensureDefaultLeadStages(client, context) {
  const existing = await client.query(
    `SELECT code,name,description,sort_order,status,is_system,is_initial,dwell_warning_hours,dwell_breach_hours
       FROM tenant.crm_lead_stages WHERE organization_id=$1`,
    [context.organizationId],
  );
  if (!existing.rows.length) {
    await seedFreshFiveStageTemplate(client, context);
    return;
  }
  const classification = await classifyLeadStageCustomization(client, context, existing.rows);
  if (classification === "UNTOUCHED_STANDARD_3_STAGE") {
    await upgradeUntouchedThreeStageToFive(client, context, existing.rows);
  }
}

// Administrative "Apply recommended Vercentlabs 5-stage template" workflow
// for CUSTOMIZED organizations (ensureDefaultLeadStages never touches these
// automatically). Purely additive: reports/creates only stages and edges
// that are genuinely missing, never renames, removes or reorders anything
// that already exists, and never moves a single Lead. Reuses the same
// FIVE_STAGE_LEAD_TEMPLATE/FIVE_STAGE_LEAD_GRAPH the automatic path uses,
// so both paths converge on the same end state.
export async function previewLeadStageTemplateUpgrade(client, context) {
  const stages = await client.query(
    `SELECT id,code,name,status FROM tenant.crm_lead_stages WHERE organization_id=$1`,
    [context.organizationId],
  );
  const byCode = Object.fromEntries(stages.rows.map((row) => [row.code, row]));
  const stagesToCreate = FIVE_STAGE_LEAD_TEMPLATE.filter((stage) => !byCode[stage.code]).map((stage) => ({
    code: stage.code,
    name: stage.name,
    description: stage.description,
  }));

  const edges = await client.query(
    `SELECT from_stage.code AS from_code,to_stage.code AS to_code
       FROM tenant.crm_lead_stage_transitions edge
       JOIN tenant.crm_lead_stages from_stage ON from_stage.organization_id=edge.organization_id AND from_stage.id=edge.from_stage_id
       JOIN tenant.crm_lead_stages to_stage ON to_stage.organization_id=edge.organization_id AND to_stage.id=edge.to_stage_id
      WHERE edge.organization_id=$1`,
    [context.organizationId],
  );
  const edgeKeySet = new Set(edges.rows.map((edge) => `${edge.from_code}->${edge.to_code}`));
  const edgesToAdd = FIVE_STAGE_LEAD_GRAPH.filter(([from, to]) => !edgeKeySet.has(`${from}->${to}`)).map(([from, to]) => ({
    fromCode: from,
    toCode: to,
  }));

  // An edge can only be safely added if both its endpoints will be active
  // stages after this preview's creations are applied — an existing stage
  // an admin has deliberately deactivated is a real conflict, not
  // something this workflow silently reactivates or routes around.
  const conflicts = [];
  const willBeActive = new Set(Object.values(byCode).filter((row) => row.status === "active").map((row) => row.code));
  for (const stage of stagesToCreate) willBeActive.add(stage.code);
  for (const [from, to] of FIVE_STAGE_LEAD_GRAPH) {
    for (const code of [from, to]) {
      if (byCode[code] && byCode[code].status !== "active" && !conflicts.some((conflict) => conflict.code === code)) {
        conflicts.push({
          code,
          issue: `"${byCode[code].name}" (${code}) exists but is inactive, so the recommended edge ${from}->${to} cannot be wired safely. Reactivate it first or resolve manually.`,
        });
      }
    }
  }

  const leadCounts = await client.query(
    `SELECT status,count(*)::int AS count FROM tenant.crm_leads WHERE organization_id=$1 AND record_status='active' GROUP BY status`,
    [context.organizationId],
  );
  const affectedLeadCount = leadCounts.rows.reduce((sum, row) => sum + Number(row.count || 0), 0);

  return {
    stagesToCreate,
    labelsToChange: [], // A customized organization's existing labels are never auto-renamed.
    edgesToAdd,
    edgesToRemove: [], // Never removes a customer-configured edge.
    affectedLeadCount,
    requiresLeadMigration: false, // Purely additive — no existing Lead ever needs to move.
    conflicts,
  };
}

export async function applyLeadStageTemplateUpgrade(client, context, input = {}) {
  try {
    if (input.confirm !== true) {
      throw new CrmError(
        400,
        "Explicit confirmation is required to apply the recommended Lead lifecycle template.",
        "CRM_LEAD_STAGE_TEMPLATE_CONFIRMATION_REQUIRED",
      );
    }
    const preview = await previewLeadStageTemplateUpgrade(client, context);
    if (preview.conflicts.length) {
      throw new CrmError(
        409,
        "Resolve the reported conflicts before applying the recommended template.",
        "CRM_LEAD_STAGE_TEMPLATE_CONFLICT",
        { conflicts: preview.conflicts },
      );
    }
    for (const stage of preview.stagesToCreate) {
      const template = FIVE_STAGE_LEAD_TEMPLATE.find((row) => row.code === stage.code);
      const nextOrder = Number(
        (await client.query(`SELECT coalesce(max(sort_order),0)+10 AS value FROM tenant.crm_lead_stages WHERE organization_id=$1`, [
          context.organizationId,
        ])).rows[0]?.value || 10,
      );
      await client.query(
        `INSERT INTO tenant.crm_lead_stages(organization_id,code,name,description,sort_order,status,is_system,is_initial,created_by,updated_by)
         VALUES ($1,$2,$3,$4,$5,'active',false,false,$6,$6)
         ON CONFLICT (organization_id,code) DO NOTHING`,
        [context.organizationId, template.code, template.name, template.description, nextOrder, context.userId],
      );
    }
    const byCode = Object.fromEntries(
      (await client.query(`SELECT id,code FROM tenant.crm_lead_stages WHERE organization_id=$1`, [context.organizationId])).rows.map((row) => [
        row.code,
        row.id,
      ]),
    );
    const edgesAdded = [];
    for (const edge of preview.edgesToAdd) {
      if (!byCode[edge.fromCode] || !byCode[edge.toCode]) continue;
      await client.query(
        `INSERT INTO tenant.crm_lead_stage_transitions(organization_id,from_stage_id,to_stage_id,created_by)
         VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
        [context.organizationId, byCode[edge.fromCode], byCode[edge.toCode], context.userId],
      );
      edgesAdded.push(edge);
    }
    await queueOutboxEvent(client, context, "crm.lead_stage_template.applied", "lead_stage_template", context.organizationId, {
      stagesCreated: preview.stagesToCreate.map((stage) => stage.code),
      edgesAdded,
    });
    return { applied: true, stagesCreated: preview.stagesToCreate, edgesAdded };
  } catch (error) {
    throw lifecycleError(error);
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
