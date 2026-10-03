// Lead ownership: assign, reassign, team assignment, the unassigned queue,
// bulk assignment and the automatic assignment rules.
//
// Giving an unassigned lead its first owner needs crm.leads.assign; moving a
// lead that already has an owner (or taking the owner away) needs
// crm.leads.reassign. Either way the caller can only hand a lead to people
// they are allowed to assign to (themselves, their team, or anyone for
// view-all holders).
import { createNotification } from "../../../core/platform/notifications/index.js";
import { assertCrmOwnerAssignable } from "../data-management/crm-access-scope.js";
import { CrmError } from "../data-management/errors.js";
import { queueOutboxEvent } from "../data-management/outbox.js";
import { leadScopeSql, requireLeadPermission } from "./access.js";
import { LEAD_PERMISSIONS } from "./constants.js";
import { recordLeadHistory } from "./history.js";
import { isUuid, requireUuid } from "./validation.js";

const SETTINGS_PERMISSION = "crm.settings.manage";
const BULK_LIMIT = 200;

const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const text = (value) => String(value ?? "").trim();

// ------------------------------------------------------------------ people and teams

// An owner must be an active member of the organization.
export async function assertEligibleLeadAssignee(client, context, userId) {
  const { rows } = await client.query(
    `SELECT app_user.id, app_user.full_name
       FROM organization_memberships membership
       JOIN users app_user ON app_user.id = membership.user_id AND app_user.status = 'active'
      WHERE membership.organization_id = $1 AND membership.user_id = $2 AND membership.status = 'active'`,
    [context.organizationId, requireUuid(userId, "Owner")],
  );
  if (!rows[0]) throw new CrmError(409, "Choose an active member of your organization.", "CRM_LEAD_ASSIGNEE_INVALID");
  return rows[0];
}

async function assertActiveTeam(client, context, teamId) {
  const { rows } = await client.query(
    `SELECT id, name FROM tenant.crm_sales_teams WHERE organization_id = $1 AND id = $2 AND status = 'active'`,
    [context.organizationId, requireUuid(teamId, "Team")],
  );
  if (!rows[0]) throw new CrmError(409, "Choose an active sales team.", "CRM_LEAD_TEAM_INVALID");
  return rows[0];
}

// People and teams the pickers offer.
export async function listLeadAssignmentOptions(client, context) {
  const users = await client.query(
    `SELECT app_user.id, app_user.full_name AS name, app_user.email
       FROM organization_memberships membership
       JOIN users app_user ON app_user.id = membership.user_id AND app_user.status = 'active'
      WHERE membership.organization_id = $1 AND membership.status = 'active'
      ORDER BY lower(app_user.full_name)`,
    [context.organizationId],
  );
  const teams = await client.query(
    `SELECT id, name FROM tenant.crm_sales_teams WHERE organization_id = $1 AND status = 'active' ORDER BY lower(name)`,
    [context.organizationId],
  );
  return { users: users.rows, teams: teams.rows };
}

// ------------------------------------------------------------------ assign / reassign

async function notifyAssignment(client, context, lead, { previousOwnerId, newOwnerId }) {
  const leadName = lead.full_name || lead.company_name || lead.code;
  const href = `/crm/leads/${lead.id}`;
  if (newOwnerId && newOwnerId !== context.userId) {
    await createNotification(client, {
      organizationId: context.organizationId,
      userId: newOwnerId,
      category: previousOwnerId ? "crm_lead_reassigned" : "crm_assignment",
      title: previousOwnerId ? "Lead reassigned to you" : "Lead assigned to you",
      message: `${leadName} (${lead.code}) is now yours.`,
      href,
      entityType: "lead",
      entityId: lead.id,
    });
  }
  if (previousOwnerId && previousOwnerId !== newOwnerId && previousOwnerId !== context.userId) {
    await createNotification(client, {
      organizationId: context.organizationId,
      userId: previousOwnerId,
      category: "crm_lead_reassigned",
      title: "Lead reassigned",
      message: `${leadName} (${lead.code}) was moved to another owner.`,
      href,
      entityType: "lead",
      entityId: lead.id,
    });
  }
}

// Applies an ownership change to a lead row already locked by the caller.
// `target` holds only the keys being changed: { ownerUserId?, teamId? }.
export async function applyLeadAssignment(client, context, lead, target, { reason = "manual", ruleName = null, notify = true } = {}) {
  const ownerChanging = has(target, "ownerUserId") && (target.ownerUserId || null) !== lead.owner_user_id;
  const teamChanging = has(target, "teamId") && (target.teamId || null) !== lead.team_id;
  if (!ownerChanging && !teamChanging) return false;

  const newOwner = ownerChanging && target.ownerUserId ? await assertEligibleLeadAssignee(client, context, target.ownerUserId) : null;
  const newTeam = teamChanging && target.teamId ? await assertActiveTeam(client, context, target.teamId) : null;
  const ownerUserId = ownerChanging ? newOwner?.id ?? null : lead.owner_user_id;
  const teamId = teamChanging ? newTeam?.id ?? null : lead.team_id;

  await client.query(
    `UPDATE tenant.crm_leads SET owner_user_id = $3, team_id = $4,
            assigned_at = CASE WHEN $5 THEN (CASE WHEN $3::uuid IS NULL THEN NULL ELSE now() END) ELSE assigned_at END,
            updated_by = $6
      WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, lead.id, ownerUserId, teamId, ownerChanging, context.userId ?? null],
  );
  if (ownerChanging) {
    const previous = lead.owner_user_id
      ? (await client.query(`SELECT full_name FROM users WHERE id = $1`, [lead.owner_user_id])).rows[0]?.full_name ?? "Unknown"
      : "Unassigned";
    await recordLeadHistory(client, context, lead.id, "owner_changed", `Owner: ${previous} → ${newOwner?.full_name ?? "Unassigned"}`, {
      from: lead.owner_user_id, to: ownerUserId, reason, ruleName,
    });
    if (notify) await notifyAssignment(client, context, lead, { previousOwnerId: lead.owner_user_id, newOwnerId: ownerUserId });
    await queueOutboxEvent(client, context, "crm.leads.assigned", "leads", lead.id, { previousOwnerUserId: lead.owner_user_id, ownerUserId, reason });
  }
  if (teamChanging) {
    const previous = lead.team_id
      ? (await client.query(`SELECT name FROM tenant.crm_sales_teams WHERE organization_id = $1 AND id = $2`, [context.organizationId, lead.team_id])).rows[0]?.name ?? "Unknown"
      : "No team";
    await recordLeadHistory(client, context, lead.id, "team_changed", `Team: ${previous} → ${newTeam?.name ?? "No team"}`, {
      from: lead.team_id, to: teamId, reason, ruleName,
    });
  }
  return true;
}

async function lockVisibleLead(client, context, leadId) {
  const values = [context.organizationId, requireUuid(leadId, "Lead")];
  const { rows } = await client.query(
    `SELECT lead.* FROM tenant.crm_leads lead
      WHERE lead.organization_id = $1 AND lead.id = $2 AND lead.archived_at IS NULL${leadScopeSql(context, values, "lead")}
      FOR UPDATE OF lead`,
    values,
  );
  if (!rows[0]) throw new CrmError(404, "Lead not found.", "CRM_LEAD_NOT_FOUND");
  return rows[0];
}

// input: { ownerUserId?: uuid | null, teamId?: uuid | null }. A key that is
// absent is left unchanged; null clears it (the lead returns to the
// unassigned queue).
export async function assignLead(client, context, leadId, input = {}) {
  if (!has(input, "ownerUserId") && !has(input, "teamId"))
    throw new CrmError(400, "Choose an owner or a team.", "CRM_LEAD_VALIDATION");
  const lead = await lockVisibleLead(client, context, leadId);
  if (lead.status === "converted")
    throw new CrmError(409, "A converted lead cannot be reassigned. Reassign its opportunity instead.", "CRM_LEAD_CONVERTED");

  const target = {};
  if (has(input, "ownerUserId")) target.ownerUserId = input.ownerUserId || null;
  if (has(input, "teamId")) target.teamId = input.teamId || null;
  const ownerChanging = has(target, "ownerUserId") && target.ownerUserId !== lead.owner_user_id;
  const teamChanging = has(target, "teamId") && target.teamId !== lead.team_id;
  if (!ownerChanging && !teamChanging) return { changed: false };

  // First owner / team of an unassigned lead is "assign"; anything that moves
  // an existing owner or team is "reassign".
  const moving = (ownerChanging && lead.owner_user_id) || (teamChanging && lead.team_id);
  requireLeadPermission(context, moving ? LEAD_PERMISSIONS.reassign : LEAD_PERMISSIONS.assign,
    moving ? "You do not have permission to reassign leads." : "You do not have permission to assign leads.");
  if (ownerChanging && target.ownerUserId)
    await assertCrmOwnerAssignable(client, context, target.ownerUserId, "You can only assign leads to yourself or to members of a team you manage.", { resource: "leads" });

  await applyLeadAssignment(client, context, lead, target, { reason: text(input.reason) || "manual" });
  return { changed: true };
}

// Assigns many leads in one request. Each lead succeeds or fails on its own.
export async function bulkAssignLeads(client, context, input = {}) {
  const leadIds = [...new Set(Array.isArray(input.leadIds) ? input.leadIds : [])];
  if (!leadIds.length) throw new CrmError(400, "Select at least one lead.", "CRM_LEAD_VALIDATION");
  if (leadIds.length > BULK_LIMIT) throw new CrmError(400, `Select up to ${BULK_LIMIT} leads at a time.`, "CRM_LEAD_BULK_LIMIT");
  const results = [];
  for (const leadId of leadIds) {
    await client.query("SAVEPOINT lead_bulk_assign");
    try {
      const outcome = await assignLead(client, context, leadId, input);
      await client.query("RELEASE SAVEPOINT lead_bulk_assign");
      results.push({ leadId, ok: true, changed: outcome.changed });
    } catch (error) {
      await client.query("ROLLBACK TO SAVEPOINT lead_bulk_assign");
      if (!(error instanceof CrmError)) throw error;
      results.push({ leadId, ok: false, message: error.message });
    }
  }
  return { results, succeeded: results.filter((entry) => entry.ok).length, failed: results.filter((entry) => !entry.ok).length };
}

// ------------------------------------------------------------------ automatic assignment rules

function toRule(row) {
  return {
    id: row.id,
    name: row.name,
    priority: row.priority,
    isActive: row.is_active,
    sourceId: row.source_id,
    sourceName: row.source_name ?? null,
    countryCode: row.country_code,
    state: row.state,
    city: row.city,
    productKeyword: row.product_keyword,
    ownerUserId: row.owner_user_id,
    ownerName: row.owner_name ?? null,
    teamId: row.team_id,
    teamName: row.team_name ?? null,
  };
}

const RULE_SELECT = `SELECT rule.*, source.name AS source_name, owner.full_name AS owner_name, team.name AS team_name
   FROM tenant.crm_lead_assignment_rules rule
   LEFT JOIN tenant.crm_lead_sources source ON source.organization_id = rule.organization_id AND source.id = rule.source_id
   LEFT JOIN public.users owner ON owner.id = rule.owner_user_id
   LEFT JOIN tenant.crm_sales_teams team ON team.organization_id = rule.organization_id AND team.id = rule.team_id`;

export async function listLeadAssignmentRules(client, context) {
  const { rows } = await client.query(
    `${RULE_SELECT} WHERE rule.organization_id = $1 ORDER BY rule.priority, rule.created_at`,
    [context.organizationId],
  );
  return rows.map(toRule);
}

async function normalizeRule(client, context, input, current = {}) {
  const pick = (field, column) => (has(input, field) ? input[field] : current[column]);
  const name = text(pick("name", "name"));
  if (!name || name.length > 120) throw new CrmError(400, "Enter a rule name of up to 120 characters.", "CRM_LEAD_RULE_VALIDATION");
  const priority = Number(pick("priority", "priority") ?? 100);
  if (!Number.isInteger(priority) || priority < 1 || priority > 10000)
    throw new CrmError(400, "Priority must be a whole number from 1 to 10000.", "CRM_LEAD_RULE_VALIDATION");
  const rule = {
    name,
    priority,
    isActive: pick("isActive", "is_active") !== false,
    sourceId: pick("sourceId", "source_id") || null,
    countryCode: text(pick("countryCode", "country_code")).toUpperCase() || null,
    state: text(pick("state", "state")) || null,
    city: text(pick("city", "city")) || null,
    productKeyword: text(pick("productKeyword", "product_keyword")) || null,
    ownerUserId: pick("ownerUserId", "owner_user_id") || null,
    teamId: pick("teamId", "team_id") || null,
  };
  if (!rule.sourceId && !rule.countryCode && !rule.state && !rule.city && !rule.productKeyword)
    throw new CrmError(400, "Add at least one condition: source, country, state, city or product keyword.", "CRM_LEAD_RULE_VALIDATION");
  if (!rule.ownerUserId && !rule.teamId)
    throw new CrmError(400, "Choose the salesperson or team that receives matching leads.", "CRM_LEAD_RULE_VALIDATION");
  if (rule.countryCode && !/^[A-Z]{2}$/.test(rule.countryCode)) throw new CrmError(400, "Choose a country.", "CRM_LEAD_RULE_VALIDATION");
  if (rule.sourceId) {
    const source = await client.query(`SELECT 1 FROM tenant.crm_lead_sources WHERE organization_id = $1 AND id = $2`, [context.organizationId, requireUuid(rule.sourceId, "Lead source")]);
    if (!source.rows[0]) throw new CrmError(400, "Choose a lead source from the list.", "CRM_LEAD_RULE_VALIDATION");
  }
  if (rule.ownerUserId) await assertEligibleLeadAssignee(client, context, rule.ownerUserId);
  if (rule.teamId) await assertActiveTeam(client, context, rule.teamId);
  return rule;
}

export async function saveLeadAssignmentRule(client, context, id, input = {}) {
  requireLeadPermission(context, SETTINGS_PERMISSION, "You do not have permission to manage assignment rules.");
  let current = {};
  if (id) {
    current = (await client.query(
      `SELECT * FROM tenant.crm_lead_assignment_rules WHERE organization_id = $1 AND id = $2 FOR UPDATE`,
      [context.organizationId, requireUuid(id, "Assignment rule")],
    )).rows[0];
    if (!current) throw new CrmError(404, "Assignment rule not found.", "CRM_LEAD_RULE_NOT_FOUND");
  }
  const rule = await normalizeRule(client, context, input, current);
  const values = [context.organizationId, rule.name, rule.priority, rule.isActive, rule.sourceId, rule.countryCode, rule.state, rule.city, rule.productKeyword, rule.ownerUserId, rule.teamId, context.userId];
  const saved = id
    ? await client.query(
        `UPDATE tenant.crm_lead_assignment_rules SET name=$2, priority=$3, is_active=$4, source_id=$5, country_code=$6, state=$7, city=$8,
                product_keyword=$9, owner_user_id=$10, team_id=$11, updated_by=$12
          WHERE organization_id=$1 AND id=$13 RETURNING id`,
        [...values, id],
      )
    : await client.query(
        `INSERT INTO tenant.crm_lead_assignment_rules (organization_id, name, priority, is_active, source_id, country_code, state, city, product_keyword, owner_user_id, team_id, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12) RETURNING id`,
        values,
      );
  const { rows } = await client.query(`${RULE_SELECT} WHERE rule.organization_id = $1 AND rule.id = $2`, [context.organizationId, saved.rows[0].id]);
  return toRule(rows[0]);
}

export async function deleteLeadAssignmentRule(client, context, id) {
  requireLeadPermission(context, SETTINGS_PERMISSION, "You do not have permission to manage assignment rules.");
  const { rowCount } = await client.query(
    `DELETE FROM tenant.crm_lead_assignment_rules WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, requireUuid(id, "Assignment rule")],
  );
  if (!rowCount) throw new CrmError(404, "Assignment rule not found.", "CRM_LEAD_RULE_NOT_FOUND");
}

// The first active rule (lowest priority number) whose every condition
// matches the lead. A lead that matches no rule stays unassigned.
export async function matchLeadAssignmentRule(client, context, lead) {
  const { rows } = await client.query(
    `SELECT rule.* FROM tenant.crm_lead_assignment_rules rule
      WHERE rule.organization_id = $1 AND rule.is_active
        AND (rule.source_id IS NULL OR rule.source_id = $2)
        AND (rule.country_code IS NULL OR rule.country_code = $3)
        AND (rule.state IS NULL OR lower(btrim(rule.state)) = lower(btrim(COALESCE($4, ''))))
        AND (rule.city IS NULL OR lower(btrim(rule.city)) = lower(btrim(COALESCE($5, ''))))
        AND (rule.product_keyword IS NULL OR position(lower(rule.product_keyword) IN lower(COALESCE($6, ''))) > 0)
        AND (rule.owner_user_id IS NULL OR EXISTS (SELECT 1 FROM organization_memberships membership
              WHERE membership.organization_id = rule.organization_id AND membership.user_id = rule.owner_user_id AND membership.status = 'active'))
      ORDER BY rule.priority, rule.created_at
      LIMIT 1`,
    [context.organizationId, isUuid(lead.sourceId) ? lead.sourceId : null, lead.countryCode ?? null, lead.state ?? null, lead.city ?? null, lead.productInterest ?? null],
  );
  return rows[0] ? { ruleId: rows[0].id, ruleName: rows[0].name, ownerUserId: rows[0].owner_user_id, teamId: rows[0].team_id } : null;
}
