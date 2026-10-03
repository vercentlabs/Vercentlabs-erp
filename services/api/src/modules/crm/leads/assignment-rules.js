// Automatic lead assignment: the organization's settings, the ordered rules
// and their evaluation.
//
// Rules run only when a lead is created (or imported with "run rules") and
// when someone presses Run assignment rules — never because a lead was
// edited, so an assigned lead is not rerouted behind its owner's back.
//
// Evaluation: active rules in priority order; the first whose every
// condition matches wins. A rule gives the lead to a user, to a team (no
// owner yet), or round-robin to the next member of a team. A rule whose
// target cannot take leads (inactive user, inactive team, team with nobody
// eligible) is skipped and its author is told. When nothing matches, the
// fallback setting decides: leave unassigned, a default user or a default team.
import { createNotification } from "../../../core/platform/notifications/index.js";
import { CrmError } from "../data-management/errors.js";
import { leadCan, requireLeadPermission } from "./access.js";
import { ACTIVE_TEAM_MEMBER_SQL, applyLeadAssignment, assertActiveTeam, assertEligibleLeadAssignee, lockVisibleLead } from "./assignment.js";
import { LEAD_PERMISSIONS, LEAD_RULE_FIELDS, LEAD_RULE_OPERATORS } from "./constants.js";
import { isUuid, requireUuid } from "./validation.js";

const FIELDS = new Map(LEAD_RULE_FIELDS.map((field) => [field.code, field]));
const OPERATORS = new Set(LEAD_RULE_OPERATORS.map((operator) => operator.code));
const VALUELESS = new Set(["is_empty", "is_not_empty"]);
const MAX_CONDITIONS = 10;

const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const text = (value) => String(value ?? "").trim();

function requireRuleManager(context) {
  // crm.settings.manage administered the rules before this permission existed.
  if (!leadCan(context, LEAD_PERMISSIONS.manageAssignmentRules) && !leadCan(context, "crm.settings.manage"))
    throw new CrmError(403, "You do not have permission to manage lead assignment rules.", "PERMISSION_DENIED");
}

// ------------------------------------------------------------------ settings

const DEFAULT_SETTINGS = Object.freeze({ allowSelfAssignment: true, manualCreationMode: "creator", fallbackMode: "unassigned", fallbackUserId: null, fallbackTeamId: null });

export async function getLeadAssignmentSettings(client, context) {
  const { rows } = await client.query(
    `SELECT settings.*, fallback_user.full_name AS fallback_user_name, fallback_team.name AS fallback_team_name
       FROM tenant.crm_lead_assignment_settings settings
       LEFT JOIN public.users fallback_user ON fallback_user.id = settings.fallback_user_id
       LEFT JOIN tenant.crm_sales_teams fallback_team ON fallback_team.organization_id = settings.organization_id AND fallback_team.id = settings.fallback_team_id
      WHERE settings.organization_id = $1`,
    [context.organizationId],
  );
  const row = rows[0];
  if (!row) return { ...DEFAULT_SETTINGS, fallbackUserName: null, fallbackTeamName: null };
  return {
    allowSelfAssignment: row.allow_self_assignment,
    manualCreationMode: row.manual_creation_mode,
    fallbackMode: row.fallback_mode,
    fallbackUserId: row.fallback_user_id,
    fallbackUserName: row.fallback_user_name ?? null,
    fallbackTeamId: row.fallback_team_id,
    fallbackTeamName: row.fallback_team_name ?? null,
  };
}

// input: { allowSelfAssignment?, manualCreationMode?: creator | rules, fallbackMode?: unassigned | user | team, fallbackUserId?, fallbackTeamId? }
export async function saveLeadAssignmentSettings(client, context, input = {}) {
  requireRuleManager(context);
  const current = await getLeadAssignmentSettings(client, context);
  const next = {
    allowSelfAssignment: has(input, "allowSelfAssignment") ? input.allowSelfAssignment === true : current.allowSelfAssignment,
    manualCreationMode: has(input, "manualCreationMode") ? text(input.manualCreationMode) : current.manualCreationMode,
    fallbackMode: has(input, "fallbackMode") ? text(input.fallbackMode) : current.fallbackMode,
    fallbackUserId: has(input, "fallbackUserId") ? input.fallbackUserId || null : current.fallbackUserId,
    fallbackTeamId: has(input, "fallbackTeamId") ? input.fallbackTeamId || null : current.fallbackTeamId,
  };
  if (!["creator", "rules"].includes(next.manualCreationMode)) throw new CrmError(400, "Choose what happens to leads typed in by hand.", "CRM_LEAD_SETTINGS_VALIDATION");
  if (!["unassigned", "user", "team"].includes(next.fallbackMode)) throw new CrmError(400, "Choose what happens when no rule matches.", "CRM_LEAD_SETTINGS_VALIDATION");
  if (next.fallbackMode === "user") {
    if (!next.fallbackUserId) throw new CrmError(400, "Choose the default user.", "CRM_LEAD_SETTINGS_VALIDATION");
    await assertEligibleLeadAssignee(client, context, next.fallbackUserId);
  } else next.fallbackUserId = null;
  if (next.fallbackMode === "team") {
    if (!next.fallbackTeamId) throw new CrmError(400, "Choose the default team.", "CRM_LEAD_SETTINGS_VALIDATION");
    await assertActiveTeam(client, context, next.fallbackTeamId);
  } else next.fallbackTeamId = null;
  await client.query(
    `INSERT INTO tenant.crm_lead_assignment_settings (organization_id, allow_self_assignment, manual_creation_mode, fallback_mode, fallback_user_id, fallback_team_id, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now())
     ON CONFLICT (organization_id) DO UPDATE SET allow_self_assignment = EXCLUDED.allow_self_assignment, manual_creation_mode = EXCLUDED.manual_creation_mode,
       fallback_mode = EXCLUDED.fallback_mode, fallback_user_id = EXCLUDED.fallback_user_id, fallback_team_id = EXCLUDED.fallback_team_id,
       updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [context.organizationId, next.allowSelfAssignment, next.manualCreationMode, next.fallbackMode, next.fallbackUserId, next.fallbackTeamId, context.userId ?? null],
  );
  return getLeadAssignmentSettings(client, context);
}

// ------------------------------------------------------------------ rules

const RULE_SELECT = `SELECT rule.*, target_user.full_name AS target_user_name, target_team.name AS target_team_name, target_team.status AS target_team_status,
         creator.full_name AS created_by_name,
         (SELECT count(*) FROM tenant.crm_leads lead WHERE lead.organization_id = rule.organization_id AND lead.assignment_rule_id = rule.id)::int AS lead_count
    FROM tenant.crm_lead_assignment_rules rule
    LEFT JOIN public.users target_user ON target_user.id = rule.target_user_id
    LEFT JOIN tenant.crm_sales_teams target_team ON target_team.organization_id = rule.organization_id AND target_team.id = rule.target_team_id
    LEFT JOIN public.users creator ON creator.id = rule.created_by`;

function toRule(row) {
  return {
    id: row.id,
    name: row.name,
    priority: row.priority,
    isActive: row.is_active,
    conditions: row.conditions ?? [],
    targetType: row.target_type,
    targetUserId: row.target_user_id,
    targetUserName: row.target_user_name ?? null,
    targetTeamId: row.target_team_id,
    targetTeamName: row.target_team_name ?? null,
    strategy: row.strategy,
    leadCount: row.lead_count ?? 0,
    createdByName: row.created_by_name ?? null,
    updatedAt: row.updated_at,
  };
}

export async function listLeadAssignmentRules(client, context) {
  requireRuleManager(context);
  const { rows } = await client.query(`${RULE_SELECT} WHERE rule.organization_id = $1 ORDER BY rule.priority, rule.created_at`, [context.organizationId]);
  return rows.map(toRule);
}

async function normalizeConditions(client, context, input) {
  const list = Array.isArray(input) ? input : [];
  if (list.length > MAX_CONDITIONS) throw new CrmError(400, `Use up to ${MAX_CONDITIONS} conditions in a rule.`, "CRM_LEAD_RULE_VALIDATION");
  const conditions = [];
  for (const entry of list) {
    const field = FIELDS.get(text(entry?.field));
    const operator = text(entry?.operator);
    if (!field) throw new CrmError(400, "Choose a lead field for each condition.", "CRM_LEAD_RULE_VALIDATION");
    if (!OPERATORS.has(operator)) throw new CrmError(400, `Choose how to compare ${field.label}.`, "CRM_LEAD_RULE_VALIDATION");
    if (VALUELESS.has(operator)) { conditions.push({ field: field.code, operator }); continue; }
    const value = text(entry?.value).slice(0, 200);
    if (!value) throw new CrmError(400, `Enter a value for ${field.label}.`, "CRM_LEAD_RULE_VALIDATION");
    if (field.kind === "source") {
      if (operator === "contains") throw new CrmError(400, "Lead source can only be compared with equals or does not equal.", "CRM_LEAD_RULE_VALIDATION");
      const source = await client.query(`SELECT 1 FROM tenant.crm_lead_sources WHERE organization_id = $1 AND id = $2`, [context.organizationId, isUuid(value) ? value : null]);
      if (!source.rows[0]) throw new CrmError(400, "Choose a lead source from the list.", "CRM_LEAD_RULE_VALIDATION");
    }
    if (field.kind === "country" && operator !== "contains" && !/^[A-Za-z]{2}$/.test(value)) throw new CrmError(400, "Choose a country.", "CRM_LEAD_RULE_VALIDATION");
    conditions.push({ field: field.code, operator, value: field.kind === "country" ? value.toUpperCase() : value });
  }
  return conditions;
}

async function normalizeRule(client, context, input, current = null) {
  const pick = (field, column) => (has(input, field) ? input[field] : current?.[column]);
  const name = text(pick("name", "name"));
  if (!name || name.length > 120) throw new CrmError(400, "Enter a rule name of up to 120 characters.", "CRM_LEAD_RULE_VALIDATION");
  const targetType = text(pick("targetType", "target_type"));
  if (!["user", "team"].includes(targetType)) throw new CrmError(400, "Choose whether matching leads go to a user or a team.", "CRM_LEAD_RULE_VALIDATION");
  const rule = {
    name,
    isActive: pick("isActive", "is_active") !== false,
    conditions: await normalizeConditions(client, context, has(input, "conditions") ? input.conditions : current?.conditions),
    targetType,
    targetUserId: targetType === "user" ? pick("targetUserId", "target_user_id") || null : null,
    targetTeamId: targetType === "team" ? pick("targetTeamId", "target_team_id") || null : null,
    strategy: targetType === "team" && text(pick("strategy", "strategy")) === "round_robin" ? "round_robin" : "direct",
  };
  if (targetType === "user") {
    if (!rule.targetUserId) throw new CrmError(400, "Choose the salesperson who receives matching leads.", "CRM_LEAD_RULE_VALIDATION");
    await assertEligibleLeadAssignee(client, context, rule.targetUserId);
  } else {
    if (!rule.targetTeamId) throw new CrmError(400, "Choose the team that receives matching leads.", "CRM_LEAD_RULE_VALIDATION");
    await assertActiveTeam(client, context, rule.targetTeamId);
  }
  return rule;
}

// A new rule goes to the end of the order; priority changes only through reorder.
export async function saveLeadAssignmentRule(client, context, id, input = {}) {
  requireRuleManager(context);
  let current = null;
  if (id) {
    current = (await client.query(`SELECT * FROM tenant.crm_lead_assignment_rules WHERE organization_id = $1 AND id = $2 FOR UPDATE`,
      [context.organizationId, requireUuid(id, "Assignment rule")])).rows[0];
    if (!current) throw new CrmError(404, "Assignment rule not found.", "CRM_LEAD_RULE_NOT_FOUND");
  }
  const rule = await normalizeRule(client, context, input, current);
  const values = [context.organizationId, rule.name, rule.isActive, JSON.stringify(rule.conditions), rule.targetType, rule.targetUserId, rule.targetTeamId, rule.strategy, context.userId ?? null];
  const saved = id
    ? await client.query(
        `UPDATE tenant.crm_lead_assignment_rules SET name = $2, is_active = $3, conditions = $4, target_type = $5, target_user_id = $6, target_team_id = $7,
                strategy = $8, updated_by = $9 WHERE organization_id = $1 AND id = $10 RETURNING id`,
        [...values, id],
      )
    : await client.query(
        `INSERT INTO tenant.crm_lead_assignment_rules (organization_id, name, is_active, conditions, target_type, target_user_id, target_team_id, strategy, created_by, updated_by, priority)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9,
                 (SELECT COALESCE(max(priority), 0) + 10 FROM tenant.crm_lead_assignment_rules WHERE organization_id = $1))
         RETURNING id`,
        values,
      );
  const { rows } = await client.query(`${RULE_SELECT} WHERE rule.organization_id = $1 AND rule.id = $2`, [context.organizationId, saved.rows[0].id]);
  return toRule(rows[0]);
}

export async function setLeadAssignmentRuleActive(client, context, id, isActive) {
  requireRuleManager(context);
  const { rowCount } = await client.query(`UPDATE tenant.crm_lead_assignment_rules SET is_active = $3, updated_by = $4 WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, requireUuid(id, "Assignment rule"), isActive === true, context.userId ?? null]);
  if (!rowCount) throw new CrmError(404, "Assignment rule not found.", "CRM_LEAD_RULE_NOT_FOUND");
  return { changed: true };
}

// orderedIds: every rule id, first = highest priority.
export async function reorderLeadAssignmentRules(client, context, orderedIds) {
  requireRuleManager(context);
  const ids = [...new Set((Array.isArray(orderedIds) ? orderedIds : []).filter(isUuid))];
  const existing = await client.query(`SELECT id FROM tenant.crm_lead_assignment_rules WHERE organization_id = $1 ORDER BY priority, created_at FOR UPDATE`, [context.organizationId]);
  const known = new Set(existing.rows.map((row) => row.id));
  if (ids.length !== known.size || ids.some((id) => !known.has(id)))
    throw new CrmError(409, "The rules changed while you were reordering them. Reload and try again.", "CRM_LEAD_RULE_ORDER_STALE");
  for (const [index, id] of ids.entries())
    await client.query(`UPDATE tenant.crm_lead_assignment_rules SET priority = $3, updated_by = $4 WHERE organization_id = $1 AND id = $2`,
      [context.organizationId, id, (index + 1) * 10, context.userId ?? null]);
  return listLeadAssignmentRules(client, context);
}

// Only a rule that never routed a lead can be deleted; others are deactivated
// so the assignment history keeps pointing at them.
export async function deleteLeadAssignmentRule(client, context, id) {
  requireRuleManager(context);
  const ruleId = requireUuid(id, "Assignment rule");
  const used = await client.query(
    `SELECT (SELECT count(*) FROM tenant.crm_leads WHERE organization_id = $1 AND assignment_rule_id = $2)
          + (SELECT count(*) FROM tenant.crm_lead_assignment_history WHERE organization_id = $1 AND assignment_rule_id = $2) AS n`,
    [context.organizationId, ruleId],
  );
  if (Number(used.rows[0].n) > 0)
    throw new CrmError(409, "This rule has already assigned leads. Deactivate it instead of deleting it.", "CRM_LEAD_RULE_IN_USE");
  const { rowCount } = await client.query(`DELETE FROM tenant.crm_lead_assignment_rules WHERE organization_id = $1 AND id = $2`, [context.organizationId, ruleId]);
  if (!rowCount) throw new CrmError(404, "Assignment rule not found.", "CRM_LEAD_RULE_NOT_FOUND");
}

// ------------------------------------------------------------------ evaluation

// `lead` is the camelCase lead (createLead's normalized input, or toLead()).
export function leadMatchesConditions(lead, conditions = []) {
  return conditions.every((condition) => {
    const actual = text(lead[condition.field]).toLowerCase();
    const expected = text(condition.value).toLowerCase();
    if (condition.operator === "is_empty") return actual === "";
    if (condition.operator === "is_not_empty") return actual !== "";
    if (condition.operator === "equals") return actual === expected;
    if (condition.operator === "not_equals") return actual !== expected;
    if (condition.operator === "contains") return actual.includes(expected);
    return false;
  });
}

// The next eligible member of the team after the one who got the last lead.
async function nextRoundRobinMember(client, context, teamId, excludeUserId) {
  await client.query(
    `INSERT INTO tenant.crm_lead_round_robin_state (organization_id, team_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [context.organizationId, teamId]);
  // The pointer row is locked so two leads arriving together get two different people.
  const state = (await client.query(`SELECT last_user_id FROM tenant.crm_lead_round_robin_state WHERE organization_id = $1 AND team_id = $2 FOR UPDATE`,
    [context.organizationId, teamId])).rows[0];
  const members = (await client.query(
    `SELECT app_user.id, app_user.full_name
       FROM organization_memberships membership
       JOIN users app_user ON app_user.id = membership.user_id AND app_user.status = 'active'
      WHERE membership.organization_id = $1 AND membership.status = 'active'
        AND EXISTS (SELECT 1 FROM tenant.crm_sales_team_members member WHERE member.organization_id = $1 AND member.team_id = $2 AND member.user_id = app_user.id
                     AND member.status = 'active' AND member.effective_from <= current_date AND (member.effective_to IS NULL OR member.effective_to >= current_date))
        AND EXISTS (SELECT 1 FROM user_role_assignments assignment JOIN roles role ON role.id = assignment.role_id
                      LEFT JOIN role_permissions grant_row ON grant_row.role_id = role.id
                     WHERE assignment.organization_id = $1 AND assignment.user_id = app_user.id AND assignment.status = 'active'
                       AND (role.slug = 'organization_owner' OR grant_row.permission_key LIKE 'crm.%'))
        AND ($3::uuid IS NULL OR app_user.id <> $3)
      ORDER BY lower(app_user.full_name), app_user.id`,
    [context.organizationId, teamId, excludeUserId ?? null],
  )).rows;
  if (!members.length) return null;
  const lastIndex = members.findIndex((member) => member.id === state?.last_user_id);
  const next = members[(lastIndex + 1) % members.length];
  await client.query(`UPDATE tenant.crm_lead_round_robin_state SET last_user_id = $3, updated_at = now() WHERE organization_id = $1 AND team_id = $2`,
    [context.organizationId, teamId, next.id]);
  return next;
}

async function reportUnusableRule(client, context, rule, why) {
  const recipient = rule.updated_by || rule.created_by;
  if (!recipient) return;
  await createNotification(client, {
    organizationId: context.organizationId,
    userId: recipient,
    category: "crm_lead_assignment_failed",
    title: `Assignment rule "${rule.name}" could not assign a lead`,
    message: `${why} The lead was passed to the next rule. Update or deactivate the rule.`,
    href: "/crm/settings/assignment",
    entityType: "lead_assignment_rule",
    entityId: rule.id,
  });
}

async function userCanTakeLeads(client, context, userId, teamId = null) {
  try {
    await assertEligibleLeadAssignee(client, context, userId, { teamId });
    return true;
  } catch (error) {
    if (error instanceof CrmError) return false;
    throw error;
  }
}

async function teamIsActive(client, context, teamId) {
  return Boolean((await client.query(`SELECT 1 FROM tenant.crm_sales_teams WHERE organization_id = $1 AND id = $2 AND status = 'active'`, [context.organizationId, teamId])).rows[0]);
}

// Decides who a lead goes to. Returns { ownerUserId, teamId, method, rule }
// — method is "rule", "round_robin" or "fallback"; all null when the lead
// stays unassigned. Advances the round-robin pointer when it uses it.
// options.excludeUserId: never pick this user (they are giving their leads away).
export async function evaluateLeadAssignment(client, context, lead, { excludeUserId = null } = {}) {
  const { rows: rules } = await client.query(
    `SELECT * FROM tenant.crm_lead_assignment_rules WHERE organization_id = $1 AND is_active ORDER BY priority, created_at`, [context.organizationId]);
  for (const rule of rules) {
    if (!leadMatchesConditions(lead, rule.conditions)) continue;
    const summary = { id: rule.id, name: rule.name };
    if (rule.target_type === "user") {
      if (rule.target_user_id && rule.target_user_id !== excludeUserId && await userCanTakeLeads(client, context, rule.target_user_id))
        return { ownerUserId: rule.target_user_id, teamId: null, method: "rule", rule: summary };
      if (rule.target_user_id !== excludeUserId) await reportUnusableRule(client, context, rule, "Its user is inactive or no longer has CRM access.");
      continue;
    }
    if (!rule.target_team_id || !await teamIsActive(client, context, rule.target_team_id)) {
      await reportUnusableRule(client, context, rule, "Its team is inactive.");
      continue;
    }
    if (rule.strategy !== "round_robin") return { ownerUserId: null, teamId: rule.target_team_id, method: "rule", rule: summary };
    const member = await nextRoundRobinMember(client, context, rule.target_team_id, excludeUserId);
    if (member) return { ownerUserId: member.id, teamId: rule.target_team_id, method: "round_robin", rule: summary };
    await reportUnusableRule(client, context, rule, "Its team has no active member who can take leads.");
  }
  return fallbackLeadAssignment(client, context, { excludeUserId });
}

// What happens to a lead no rule claims.
export async function fallbackLeadAssignment(client, context, { excludeUserId = null } = {}) {
  const settings = await getLeadAssignmentSettings(client, context);
  if (settings.fallbackMode === "user" && settings.fallbackUserId && settings.fallbackUserId !== excludeUserId
      && await userCanTakeLeads(client, context, settings.fallbackUserId))
    return { ownerUserId: settings.fallbackUserId, teamId: null, method: "fallback", rule: null };
  if (settings.fallbackMode === "team" && settings.fallbackTeamId && await teamIsActive(client, context, settings.fallbackTeamId))
    return { ownerUserId: null, teamId: settings.fallbackTeamId, method: "fallback", rule: null };
  return { ownerUserId: null, teamId: null, method: null, rule: null };
}

// "Run assignment rules" on one lead: useful when it was unassigned, the
// rules changed, or imported data was completed later.
export async function runLeadAssignmentRules(client, context, leadId, input = {}) {
  const lead = await lockVisibleLead(client, context, leadId);
  if (lead.status === "converted") throw new CrmError(409, "A converted lead cannot be reassigned.", "CRM_LEAD_CONVERTED");
  requireLeadPermission(context, lead.owner_user_id ? LEAD_PERMISSIONS.reassign : LEAD_PERMISSIONS.assign,
    lead.owner_user_id ? "You do not have permission to reassign leads." : "You do not have permission to assign leads.");
  const { toLead } = await import("./records.js");
  const routed = await evaluateLeadAssignment(client, context, toLead(lead));
  if (!routed.method) return { changed: false, matched: false, message: "No rule matches this lead, and there is no default owner or team." };
  const changed = await applyLeadAssignment(client, context, lead, { ownerUserId: routed.ownerUserId ?? lead.owner_user_id, teamId: routed.teamId ?? lead.team_id }, {
    method: routed.method, rule: routed.rule, reason: text(input.reason) || "Assignment rules run manually",
  });
  return { changed, matched: true, ruleName: routed.rule?.name ?? null, method: routed.method };
}

// Used by Team settings and the member screen: is this team allowed to
// receive leads right now.
export { ACTIVE_TEAM_MEMBER_SQL };
