// The organization's won and lost reasons: listed for the Mark won / Mark
// lost dialogs, and managed by administrators (add, rename, reorder,
// activate, deactivate). A reason that was ever used is never deleted: it is
// deactivated, and closed opportunities keep showing it.
import { CrmError } from "../data-management/errors.js";
import { CLOSE_OUTCOMES, CLOSE_REASON_CATEGORIES, CLOSE_REASON_PERMISSIONS, DEFAULT_CLOSE_REASONS } from "./constants.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CATEGORIES = new Set(CLOSE_REASON_CATEGORIES.map((entry) => entry.code));
const text = (value) => String(value ?? "").trim();
const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const invalid = (message, field) => new CrmError(400, message, "CRM_CLOSE_REASON_VALIDATION", { field });

function canManage(context) {
  return Boolean(context.roleSlugs?.includes("organization_owner") || context.permissions?.includes(CLOSE_REASON_PERMISSIONS.manage));
}
function requireManage(context) {
  if (!canManage(context)) throw new CrmError(403, "You do not have permission to manage won and lost reasons.", "PERMISSION_DENIED");
}

export function toCloseReason(row) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    outcome: row.outcome_type,
    category: row.category,
    sequence: row.sequence,
    active: row.status === "active",
    requiresNotes: row.requires_notes,
    capturesCompetitor: row.captures_competitor || row.requires_competitor,
    requiresCompetitor: row.requires_competitor,
    offersFollowUp: row.offers_follow_up,
    linksDuplicate: row.links_duplicate,
    useCount: row.use_count === undefined ? undefined : Number(row.use_count),
  };
}

// Idempotent: adds the standard reasons an organization does not have yet.
export async function ensureDefaultCloseReasons(client, context) {
  const existing = await client.query(`SELECT code FROM tenant.crm_lost_reasons WHERE organization_id = $1`, [context.organizationId]);
  const codes = new Set(existing.rows.map((row) => row.code));
  const sequences = { won: 0, lost: 0 };
  for (const entry of DEFAULT_CLOSE_REASONS) {
    sequences[entry.outcome] += 10;
    if (codes.has(entry.code)) continue;
    await client.query(
      `INSERT INTO tenant.crm_lost_reasons (organization_id, name, code, category, outcome_type, sequence, requires_notes, captures_competitor, requires_competitor,
         offers_follow_up, links_duplicate, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12) ON CONFLICT (organization_id, code) DO NOTHING`,
      [context.organizationId, entry.name, entry.code, entry.category, entry.outcome, sequences[entry.outcome], entry.requiresNotes, entry.capturesCompetitor,
        entry.requiresCompetitor, entry.offersFollowUp, entry.linksDuplicate, context.userId ?? null],
    );
  }
}

const SELECT = `
  SELECT reason.*, (SELECT count(*) FROM tenant.crm_opportunity_close_history history
                     WHERE history.organization_id = reason.organization_id AND history.reason_id = reason.id) AS use_count
    FROM tenant.crm_lost_reasons reason`;

// options: { outcome?: "won" | "lost", includeInactive? }
export async function listCloseReasons(client, context, options = {}) {
  await ensureDefaultCloseReasons(client, context);
  const outcome = CLOSE_OUTCOMES.includes(options.outcome) ? options.outcome : null;
  const { rows } = await client.query(
    `${SELECT} WHERE reason.organization_id = $1 AND reason.outcome_type IN ('won', 'lost') AND ($2::text IS NULL OR reason.outcome_type = $2)
        AND ($3 OR reason.status = 'active')
      ORDER BY reason.outcome_type DESC, (reason.status = 'active') DESC, reason.sequence, reason.name`,
    [context.organizationId, outcome, options.includeInactive === true],
  );
  return rows.map(toCloseReason);
}

// A reason of the given kind, active, in the caller's organization.
export async function requireCloseReason(client, context, reasonId, outcome) {
  if (!UUID.test(text(reasonId)))
    throw new CrmError(400, outcome === "won" ? "Choose why this opportunity was won." : "Choose why this opportunity was lost.",
      outcome === "won" ? "CRM_OPPORTUNITY_WON_REASON_REQUIRED" : "CRM_OPPORTUNITY_LOST_REASON_REQUIRED");
  const { rows } = await client.query(
    `SELECT * FROM tenant.crm_lost_reasons WHERE organization_id = $1 AND id = $2 AND status = 'active' AND outcome_type = $3`,
    [context.organizationId, reasonId, outcome],
  );
  if (!rows[0])
    throw new CrmError(400, outcome === "won" ? "Choose an active won reason." : "Choose an active lost reason.",
      outcome === "won" ? "CRM_OPPORTUNITY_WON_REASON_REQUIRED" : "CRM_OPPORTUNITY_LOST_REASON_REQUIRED");
  return rows[0];
}

function readRules(input, current = {}) {
  const flag = (key, column) => (has(input, key) ? input[key] === true : Boolean(current[column]));
  const rules = {
    requires_notes: flag("requiresNotes", "requires_notes"),
    requires_competitor: flag("requiresCompetitor", "requires_competitor"),
    captures_competitor: flag("capturesCompetitor", "captures_competitor"),
    offers_follow_up: flag("offersFollowUp", "offers_follow_up"),
    links_duplicate: flag("linksDuplicate", "links_duplicate"),
  };
  if (rules.requires_competitor) rules.captures_competitor = true;
  return rules;
}

async function assertUniqueName(client, context, outcome, name, exceptId = null) {
  const clash = await client.query(
    `SELECT 1 FROM tenant.crm_lost_reasons WHERE organization_id = $1 AND outcome_type = $2 AND status = 'active' AND lower(name) = lower($3) AND ($4::uuid IS NULL OR id <> $4)`,
    [context.organizationId, outcome, name, exceptId],
  );
  if (clash.rows[0]) throw invalid(`Another active ${outcome} reason is already called "${name}".`, "name");
}

function validName(value) {
  const name = text(value);
  if (!name) throw invalid("Enter a name for the reason.", "name");
  if (name.length > 120) throw invalid("Use 120 characters or fewer.", "name");
  return name;
}

// input: { outcome: "won" | "lost", name, category?, requiresNotes?, capturesCompetitor?, requiresCompetitor?, offersFollowUp?, linksDuplicate? }
export async function createCloseReason(client, context, input = {}) {
  requireManage(context);
  const outcome = input.outcome;
  if (!CLOSE_OUTCOMES.includes(outcome)) throw invalid("Choose whether this is a won or a lost reason.", "outcome");
  const name = validName(input.name);
  const category = text(input.category) || "other";
  if (!CATEGORIES.has(category)) throw invalid("Choose a category.", "category");
  await assertUniqueName(client, context, outcome, name);
  const rules = readRules(input);
  const sequence = (await client.query(
    `SELECT COALESCE(max(sequence), 0) + 10 AS next FROM tenant.crm_lost_reasons WHERE organization_id = $1 AND outcome_type = $2 AND sequence < 100000`,
    [context.organizationId, outcome],
  )).rows[0].next;
  const code = `${outcome}_${name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40)}_${Date.now().toString(36)}`;
  const { rows } = await client.query(
    `INSERT INTO tenant.crm_lost_reasons (organization_id, name, code, category, outcome_type, sequence, requires_notes, captures_competitor, requires_competitor,
       offers_follow_up, links_duplicate, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12) RETURNING *`,
    [context.organizationId, name, code, category, outcome, Math.min(Number(sequence), 99990), rules.requires_notes, rules.captures_competitor, rules.requires_competitor,
      rules.offers_follow_up, rules.links_duplicate, context.userId ?? null],
  );
  return toCloseReason({ ...rows[0], use_count: 0 });
}

async function lockReason(client, context, reasonId) {
  if (!UUID.test(text(reasonId))) throw new CrmError(404, "Reason not found.", "CRM_CLOSE_REASON_NOT_FOUND");
  const { rows } = await client.query(`SELECT * FROM tenant.crm_lost_reasons WHERE organization_id = $1 AND id = $2 FOR UPDATE`, [context.organizationId, reasonId]);
  if (!rows[0]) throw new CrmError(404, "Reason not found.", "CRM_CLOSE_REASON_NOT_FOUND");
  return rows[0];
}

// Rename or change the rules. The kind (won or lost) never changes: closed
// opportunities would otherwise show a reason of the wrong kind.
// input: { name?, category?, requiresNotes?, capturesCompetitor?, requiresCompetitor?, offersFollowUp?, linksDuplicate? }
export async function updateCloseReason(client, context, reasonId, input = {}) {
  requireManage(context);
  const current = await lockReason(client, context, reasonId);
  if (has(input, "outcome") && input.outcome !== current.outcome_type) throw invalid("A reason stays a won or a lost reason. Create a new one instead.", "outcome");
  const name = has(input, "name") ? validName(input.name) : current.name;
  if (name.toLowerCase() !== current.name.toLowerCase() && current.status === "active") await assertUniqueName(client, context, current.outcome_type, name, current.id);
  const category = has(input, "category") ? text(input.category) : current.category;
  if (!CATEGORIES.has(category)) throw invalid("Choose a category.", "category");
  const rules = readRules(input, current);
  if (["other", "won_other"].includes(current.code)) rules.requires_notes = true;
  const { rows } = await client.query(
    `UPDATE tenant.crm_lost_reasons SET name = $3, category = $4, requires_notes = $5, captures_competitor = $6, requires_competitor = $7, offers_follow_up = $8,
            links_duplicate = $9, updated_by = $10, updated_at = now()
      WHERE organization_id = $1 AND id = $2 RETURNING *`,
    [context.organizationId, current.id, name, category, rules.requires_notes, rules.captures_competitor, rules.requires_competitor, rules.offers_follow_up,
      rules.links_duplicate, context.userId ?? null],
  );
  return toCloseReason(rows[0]);
}

// Deactivated reasons leave the dialogs; closed opportunities keep showing them.
export async function setCloseReasonActive(client, context, reasonId, active) {
  requireManage(context);
  const current = await lockReason(client, context, reasonId);
  if (active && current.status !== "active") await assertUniqueName(client, context, current.outcome_type, current.name, current.id);
  if (!active) {
    const remaining = await client.query(
      `SELECT count(*)::int AS n FROM tenant.crm_lost_reasons WHERE organization_id = $1 AND outcome_type = $2 AND status = 'active' AND id <> $3`,
      [context.organizationId, current.outcome_type, current.id],
    );
    if (remaining.rows[0].n === 0) throw new CrmError(409, `Keep at least one active ${current.outcome_type} reason.`, "CRM_CLOSE_REASON_LAST_ACTIVE");
  }
  await client.query(`UPDATE tenant.crm_lost_reasons SET status = $3, updated_by = $4, updated_at = now() WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, current.id, active ? "active" : "inactive", context.userId ?? null]);
  return { id: current.id, active };
}

// input: { outcome, reasonIds: [...] } — the new order of that kind's active reasons.
export async function reorderCloseReasons(client, context, input = {}) {
  requireManage(context);
  if (!CLOSE_OUTCOMES.includes(input.outcome)) throw invalid("Choose won or lost reasons to reorder.", "outcome");
  const ids = Array.isArray(input.reasonIds) ? input.reasonIds.map(text) : [];
  const { rows } = await client.query(
    `SELECT id FROM tenant.crm_lost_reasons WHERE organization_id = $1 AND outcome_type = $2 AND status = 'active' FOR UPDATE`,
    [context.organizationId, input.outcome],
  );
  const active = new Set(rows.map((row) => row.id));
  if (ids.length !== active.size || ids.some((id) => !active.has(id)) || new Set(ids).size !== ids.length)
    throw invalid("Send every active reason of this kind, once each, in the new order.", "reasonIds");
  for (const [index, id] of ids.entries())
    await client.query(`UPDATE tenant.crm_lost_reasons SET sequence = $3, updated_by = $4, updated_at = now() WHERE organization_id = $1 AND id = $2`,
      [context.organizationId, id, (index + 1) * 10, context.userId ?? null]);
  return listCloseReasons(client, context, { outcome: input.outcome });
}

// Only a reason that was never used may be deleted; a used one is deactivated instead.
export async function deleteCloseReason(client, context, reasonId) {
  requireManage(context);
  const current = await lockReason(client, context, reasonId);
  const used = await client.query(
    `SELECT (SELECT count(*) FROM tenant.crm_opportunity_close_history WHERE organization_id = $1 AND reason_id = $2)
          + (SELECT count(*) FROM tenant.crm_opportunities WHERE organization_id = $1 AND (outcome_reason_id = $2 OR lost_reason_id = $2))
          + (SELECT count(*) FROM tenant.crm_opportunity_stage_history WHERE organization_id = $1 AND outcome_reason_id = $2) AS uses`,
    [context.organizationId, current.id],
  );
  if (Number(used.rows[0].uses) > 0)
    throw new CrmError(409, "This reason has been used on closed opportunities. Deactivate it instead, so they keep showing it.", "CRM_CLOSE_REASON_IN_USE");
  if (DEFAULT_CLOSE_REASONS.some((entry) => entry.code === current.code))
    throw new CrmError(409, "A standard reason cannot be deleted. Deactivate it instead.", "CRM_CLOSE_REASON_STANDARD");
  await client.query(`DELETE FROM tenant.crm_lost_reasons WHERE organization_id = $1 AND id = $2`, [context.organizationId, current.id]);
  return { deleted: true };
}
