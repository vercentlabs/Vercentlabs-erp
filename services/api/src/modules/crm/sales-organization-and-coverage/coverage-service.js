import { audit } from "../../../core/security/request-security.js";
import { CrmError } from "../crm-data-operations-and-customization/errors.js";
import { assertCrmOwnerAssignable, crmAccountAccessSql } from "../crm-data-operations-and-customization/crm-access-scope.js";
import { queueOutboxEvent } from "../crm-data-operations-and-customization/outbox.js";
import { recordScope } from "../crm-data-operations-and-customization/record-policy.js";
import { addParameter, camelizeRow } from "../crm-data-operations-and-customization/record-utils.js";
import { definitionFor } from "../crm-data-operations-and-customization/resource-registry.js";
import { updateCrmRecord } from "../crm-data-operations-and-customization/resource-mutation-service.js";
import { assignLeadOwner } from "../lead-lifecycle-qualification-and-prioritization/lead-assignment.js";
import { ownerTeamCte } from "../pipeline-analytics-and-forecasting/opportunity-facts.js";
import { getMetricRollup, getQuotaSummary } from "../pipeline-analytics-and-forecasting/pipeline-metrics.js";
import { updateCrmAccount } from "../prospect-and-relationship-master-data/account-operations.js";

// F020 Sales organisation and coverage: who covers what, where coverage is
// missing, and governed moves of ownership. Teams and territories keep their
// effective-dated structure (crm_sales_team_members, crm_territory_assignments);
// record ownership moves only through each record's own governed command, so
// assignment rules, versions, history and events stay intact.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
export const COVERAGE_REASSIGN_LIMIT = 200;
const RECORD_TYPES = new Set(["leads", "opportunities", "accounts"]);

export function hasCrmPermission(context, permission) {
  return (context.roleSlugs || []).includes("organization_owner") || (context.permissions || []).includes(permission);
}

export function assertCrmPermission(context, permission, message = "You do not have permission to do this.") {
  if (!hasCrmPermission(context, permission)) throw new CrmError(403, message, "CRM_PERMISSION_REQUIRED");
}

const today = () => new Date().toISOString().slice(0, 10);

function companyClause(context, parameters, alias) {
  return context.activeCompanyId ? ` AND (${alias}.company_id IS NULL OR ${alias}.company_id=${addParameter(parameters, context.activeCompanyId)})` : "";
}

/** The coverage workspace: team and territory hierarchies with coverage, gaps and unassigned work. */
export async function getSalesCoverage(client, context, { asOf } = {}) {
  assertCrmPermission(context, "crm.coverage.view", "You do not have access to sales coverage.");
  const date = ISO_DATE.test(String(asOf || "")) ? String(asOf) : today();

  const teamParameters = [context.organizationId, date];
  const teams = await client.query(
    `SELECT team.id, team.code, team.name, team.parent_team_id, team.manager_user_id, manager.full_name AS manager_name, team.status,
            COALESCE(json_agg(json_build_object(
              'userId', member.user_id, 'name', member_user.full_name, 'role', member.member_role, 'allocationPercent', member.allocation_percent,
              'effectiveFrom', member.effective_from, 'effectiveTo', member.effective_to,
              'state', CASE WHEN member.status<>'active' OR (member.effective_to IS NOT NULL AND member.effective_to < $2::date) THEN 'ended'
                            WHEN member.effective_from > $2::date THEN 'scheduled' ELSE 'current' END)
              ORDER BY member_user.full_name) FILTER (WHERE member.id IS NOT NULL), '[]') AS members
       FROM tenant.crm_sales_teams team
       LEFT JOIN public.users manager ON manager.id=team.manager_user_id
       LEFT JOIN tenant.crm_sales_team_members member ON member.organization_id=team.organization_id AND member.team_id=team.id
         AND (member.effective_to IS NULL OR member.effective_to >= $2::date - 365)
       LEFT JOIN public.users member_user ON member_user.id=member.user_id
      WHERE team.organization_id=$1${companyClause(context, teamParameters, "team")}
      GROUP BY team.id, manager.full_name
      ORDER BY team.name`,
    teamParameters,
  );

  const territoryParameters = [context.organizationId, date];
  const territories = await client.query(
    `SELECT territory.id, territory.code, territory.name, territory.parent_territory_id, territory.territory_type, territory.status,
            territory.manager_user_id, manager.full_name AS manager_name,
            primary_assignment.assignee_type AS primary_assignee_type, primary_assignment.assignee_id AS primary_assignee_id,
            primary_assignment.effective_from AS primary_effective_from,
            COALESCE(primary_user.full_name, primary_team.name) AS primary_assignee_name,
            (SELECT count(*)::int FROM tenant.crm_territory_assignments other WHERE other.organization_id=territory.organization_id AND other.territory_id=territory.id
               AND other.assignment_role<>'primary' AND other.effective_from<=$2::date AND (other.effective_to IS NULL OR other.effective_to>=$2::date)) AS secondary_assignments
       FROM tenant.crm_territories territory
       LEFT JOIN public.users manager ON manager.id=territory.manager_user_id
       LEFT JOIN LATERAL (
         SELECT assignment.* FROM tenant.crm_territory_assignments assignment
          WHERE assignment.organization_id=territory.organization_id AND assignment.territory_id=territory.id AND assignment.assignment_role='primary'
            AND assignment.assignee_type IN ('user','team') AND assignment.effective_from<=$2::date AND (assignment.effective_to IS NULL OR assignment.effective_to>=$2::date)
          ORDER BY assignment.effective_from DESC LIMIT 1) primary_assignment ON true
       LEFT JOIN public.users primary_user ON primary_assignment.assignee_type='user' AND primary_user.id=primary_assignment.assignee_id
       LEFT JOIN tenant.crm_sales_teams primary_team ON primary_assignment.assignee_type='team' AND primary_team.organization_id=territory.organization_id AND primary_team.id=primary_assignment.assignee_id
      WHERE territory.organization_id=$1 AND territory.status IN ('draft','active','inactive')${companyClause(context, territoryParameters, "territory")}
      ORDER BY territory.name`,
    territoryParameters,
  );

  // Work per team: opportunities from the canonical metric layer (caller's
  // visibility, reporting currency); leads by their owner's primary team;
  // both within the caller's own record scope.
  const opportunityRollup = await getMetricRollup(client, context, { dimension: "team", metrics: ["open_opportunities", "open_pipeline"], filters: { asOf: date } });
  const leadParameters = [context.organizationId];
  const leadScope = recordScope(definitionFor("leads"), context, leadParameters, "record");
  const leadAsOf = `${addParameter(leadParameters, date)}::date`;
  const leadRollup = await client.query(
    `WITH ${ownerTeamCte("$1", leadAsOf)}
     SELECT owner_team.team_id::text AS team_id, count(*)::int AS open_leads
       FROM tenant.crm_leads record
       LEFT JOIN owner_team ON owner_team.user_id=record.owner_user_id
      WHERE record.organization_id=$1 AND record.record_status='active'${leadScope}
      GROUP BY 1`,
    leadParameters,
  );
  const perTeam = new Map();
  for (const row of opportunityRollup.rows) perTeam.set(row.key ?? "none", { openOpportunities: row.values.open_opportunities, openPipeline: row.values.open_pipeline, openLeads: 0 });
  for (const row of leadRollup.rows) {
    const key = row.team_id ?? "none";
    perTeam.set(key, { openOpportunities: 0, openPipeline: 0, ...perTeam.get(key), openLeads: row.open_leads });
  }

  const unassigned = await countUnassigned(client, context);
  const teamRows = teams.rows.map((row) => {
    const team = camelizeRow(row);
    const current = team.members.filter((member) => member.state === "current");
    return { ...team, work: perTeam.get(String(team.id)) ?? { openOpportunities: 0, openPipeline: 0, openLeads: 0 }, currentMemberCount: current.length };
  });
  const territoryRows = territories.rows.map(camelizeRow);

  const gaps = [];
  for (const territory of territoryRows.filter((row) => row.status === "active" && !row.primaryAssigneeId))
    gaps.push({ kind: "territory_without_owner", id: territory.id, label: territory.name, detail: "No primary owner is effective today." });
  for (const team of teamRows.filter((row) => row.status === "active")) {
    if (!team.managerUserId) gaps.push({ kind: "team_without_manager", id: team.id, label: team.name, detail: "Nobody manages this team." });
    if (!team.currentMemberCount) gaps.push({ kind: "team_without_members", id: team.id, label: team.name, detail: "No current members." });
  }
  const orphanParameters = [context.organizationId, date];
  const orphanScope = recordScope(definitionFor("opportunities"), context, orphanParameters, "record");
  const orphans = await client.query(
    `WITH ${ownerTeamCte("$1", "$2::date")}
     SELECT record.owner_user_id, owner.full_name, count(*)::int AS open_records
       FROM tenant.crm_opportunities record JOIN public.users owner ON owner.id=record.owner_user_id
       LEFT JOIN owner_team ON owner_team.user_id=record.owner_user_id
      WHERE record.organization_id=$1 AND record.status='open' AND record.owner_user_id IS NOT NULL
        AND owner_team.user_id IS NULL${orphanScope}
      GROUP BY record.owner_user_id, owner.full_name ORDER BY open_records DESC LIMIT 50`,
    orphanParameters,
  );
  for (const row of orphans.rows)
    gaps.push({ kind: "seller_without_team", id: row.owner_user_id, label: row.full_name, detail: `${row.open_records} open opportunit${row.open_records === 1 ? "y" : "ies"}, but no current sales team.` });

  const quota = await getQuotaSummary(client, context, { asOf: date });
  return {
    asOf: date,
    teams: teamRows,
    territories: territoryRows,
    unattributedWork: perTeam.get("none") ?? { openOpportunities: 0, openPipeline: 0, openLeads: 0 },
    unassigned,
    gaps,
    quota,
    permissions: {
      manageTeams: hasCrmPermission(context, "crm.teams.manage"),
      manageTerritories: hasCrmPermission(context, "crm.territories.manage"),
      reassign: hasCrmPermission(context, "crm.coverage.assign"),
    },
  };
}

async function countUnassigned(client, context) {
  const leadParameters = [context.organizationId];
  const leadScope = recordScope(definitionFor("leads"), context, leadParameters, "record");
  const opportunityParameters = [context.organizationId];
  const opportunityScope = recordScope(definitionFor("opportunities"), context, opportunityParameters, "record");
  const accountParameters = [context.organizationId];
  const accountScope = crmAccountAccessSql(context, (value) => addParameter(accountParameters, value), "record");
  // Sequential: one client never runs overlapping queries.
  const leads = await client.query(`SELECT count(*)::int AS total FROM tenant.crm_leads record WHERE record.organization_id=$1 AND record.record_status='active' AND record.owner_user_id IS NULL${leadScope}`, leadParameters);
  const opportunities = await client.query(`SELECT count(*)::int AS total FROM tenant.crm_opportunities record WHERE record.organization_id=$1 AND record.status='open' AND record.owner_user_id IS NULL${opportunityScope}`, opportunityParameters);
  const accounts = await client.query(`SELECT count(*)::int AS total FROM tenant.business_parties record WHERE record.organization_id=$1 AND record.status='active' AND record.party_type IN ('customer','prospect') AND record.owner_user_id IS NULL${accountScope}`, accountParameters);
  return { leads: leads.rows[0].total, opportunities: opportunities.rows[0].total, accounts: accounts.rows[0].total };
}

function decodeCursor(cursor) {
  if (!cursor) return null;
  try {
    const value = JSON.parse(Buffer.from(String(cursor), "base64url").toString("utf8"));
    if (!UUID.test(String(value.id)) || !/^\d{4}-\d{2}-\d{2}[ T]/.test(String(value.at))) throw new Error("shape");
    return value;
  } catch {
    throw new CrmError(400, "The page cursor is invalid.", "CRM_COVERAGE_CURSOR_INVALID");
  }
}

/** Unassigned leads, open opportunities or accounts — keyset pages, oldest first. */
export async function listUnassignedRecords(client, context, { type, cursor = null, limit = 50 } = {}) {
  assertCrmPermission(context, "crm.coverage.view", "You do not have access to sales coverage.");
  if (!RECORD_TYPES.has(type)) throw new CrmError(400, "Choose leads, opportunities or accounts.", "CRM_COVERAGE_TYPE_INVALID");
  const pageSize = Math.max(1, Math.min(200, Math.trunc(Number(limit)) || 50));
  const after = decodeCursor(cursor);
  const parameters = [context.organizationId];
  let sql;
  if (type === "leads") {
    const scope = recordScope(definitionFor("leads"), context, parameters, "record");
    sql = `SELECT record.id, record.code, trim(concat_ws(' ', record.first_name, record.last_name)) AS name, record.company_name AS detail, record.city, record.country_code, record.created_at, record.updated_at
             FROM tenant.crm_leads record WHERE record.organization_id=$1 AND record.record_status='active' AND record.owner_user_id IS NULL${scope}`;
  } else if (type === "opportunities") {
    const scope = recordScope(definitionFor("opportunities"), context, parameters, "record");
    sql = `SELECT record.id, record.code, record.name, record.amount::text || ' ' || COALESCE(record.currency_code,'') AS detail, NULL::text AS city, NULL::text AS country_code, record.created_at, record.updated_at
             FROM tenant.crm_opportunities record WHERE record.organization_id=$1 AND record.status='open' AND record.owner_user_id IS NULL${scope}`;
  } else {
    const scope = crmAccountAccessSql(context, (value) => addParameter(parameters, value), "record");
    sql = `SELECT record.id, record.code, record.display_name AS name, record.party_type AS detail, NULL::text AS city, NULL::text AS country_code, record.created_at, record.updated_at
             FROM tenant.business_parties record WHERE record.organization_id=$1 AND record.status='active' AND record.party_type IN ('customer','prospect') AND record.owner_user_id IS NULL${scope}`;
  }
  if (after) sql = sql.replace("SELECT record.id,", "SELECT record.created_at::text AS sort_at, record.id,") + ` AND (record.created_at, record.id) > (${addParameter(parameters, after.at)}::timestamptz, ${addParameter(parameters, after.id)}::uuid)`;
  else sql = sql.replace("SELECT record.id,", "SELECT record.created_at::text AS sort_at, record.id,");
  sql += ` ORDER BY record.created_at, record.id LIMIT ${addParameter(parameters, pageSize + 1)}`;
  const { rows } = await client.query(sql, parameters);
  const page = rows.slice(0, pageSize).map(camelizeRow);
  const last = page[page.length - 1];
  for (const record of page) delete record.sortAt;
  return {
    type,
    records: page,
    // Full-precision (microsecond) timestamp text, so a page boundary never repeats a row.
    nextCursor: rows.length > pageSize && last ? Buffer.from(JSON.stringify({ at: rows[pageSize - 1].sort_at, id: last.id })).toString("base64url") : null,
  };
}

function classify(error) {
  const status = Number(error?.status || 500);
  if (status === 409) return { status: "conflict", code: error.code || "CRM_STALE_WRITE", message: String(error.message || "").slice(0, 300) };
  if (status === 404) return { status: "skipped", code: "CRM_COVERAGE_RECORD_OUT_OF_SCOPE", message: "The record is not in your permitted scope." };
  if (status === 403) return { status: "skipped", code: error.code || "CRM_PERMISSION_REQUIRED", message: String(error.message || "Not permitted.").slice(0, 300) };
  if (status === 400) return { status: "failed", code: error.code || "CRM_COVERAGE_REASSIGN_INVALID", message: String(error.message || "").slice(0, 300) };
  throw error;
}

/**
 * Moves ownership of up to 200 records through each record's own governed
 * command (lead assignment, account update, opportunity update), one
 * savepoint per record, and reports every outcome. Larger moves use the F029
 * bulk jobs. The target must be someone the caller may assign to.
 */
export async function reassignCoverage(client, context, input = {}) {
  assertCrmPermission(context, "crm.coverage.assign", "You do not have permission to reassign coverage.");
  const type = String(input.type || "");
  if (!RECORD_TYPES.has(type)) throw new CrmError(400, "Choose leads, opportunities or accounts.", "CRM_COVERAGE_TYPE_INVALID");
  const ids = [...new Set((Array.isArray(input.ids) ? input.ids : []).map(String))];
  if (!ids.length) throw new CrmError(400, "Select at least one record.", "CRM_COVERAGE_SELECTION_EMPTY");
  if (ids.length > COVERAGE_REASSIGN_LIMIT) throw new CrmError(400, `Reassign at most ${COVERAGE_REASSIGN_LIMIT} records at a time, or use a bulk update.`, "CRM_COVERAGE_SELECTION_TOO_LARGE");
  if (ids.some((id) => !UUID.test(id))) throw new CrmError(400, "A selected record is invalid.", "CRM_COVERAGE_SELECTION_INVALID");
  const ownerUserId = input.ownerUserId ? String(input.ownerUserId) : null;
  if (ownerUserId && !UUID.test(ownerUserId)) throw new CrmError(400, "Select a valid owner.", "CRM_COVERAGE_OWNER_INVALID");
  const reason = String(input.reason ?? "").trim();
  if (reason.length < 3 || reason.length > 500) throw new CrmError(400, "Give a reason for the reassignment (3–500 characters).", "CRM_COVERAGE_REASON_REQUIRED");
  await assertCrmOwnerAssignable(client, context, ownerUserId, "You can only assign records to yourself or to members of a team you manage.", { resource: type === "accounts" ? null : type });
  const expected = input.expectedUpdatedAt && typeof input.expectedUpdatedAt === "object" ? input.expectedUpdatedAt : {};

  const results = [];
  for (const id of ids) {
    await client.query("SAVEPOINT crm_coverage_reassign");
    try {
      const version = expected[id] ? { expectedUpdatedAt: String(expected[id]), requireVersion: true } : {};
      if (type === "leads") await assignLeadOwner(client, context, id, ownerUserId, { ...version, reason: `coverage:${reason.slice(0, 80)}` });
      else if (type === "accounts") await updateCrmAccount(client, context, id, { ownerUserId }, version);
      else await updateCrmRecord(client, context, "opportunities", id, { ownerUserId }, version);
      await client.query("RELEASE SAVEPOINT crm_coverage_reassign");
      results.push({ id, status: "applied" });
    } catch (error) {
      await client.query("ROLLBACK TO SAVEPOINT crm_coverage_reassign");
      await client.query("RELEASE SAVEPOINT crm_coverage_reassign");
      results.push({ id, ...classify(error) });
    }
  }
  const applied = results.filter((result) => result.status === "applied").map((result) => result.id);
  await audit(client, {
    organizationId: context.organizationId,
    actorUserId: context.userId,
    eventType: "crm.coverage.reassigned",
    entityType: `crm.${type}`,
    entityId: null,
    metadata: { type, ownerUserId, reason, requested: ids.length, applied: applied.length, recordIds: applied.slice(0, COVERAGE_REASSIGN_LIMIT) },
  });
  if (applied.length)
    await queueOutboxEvent(client, context, "crm.coverage.reassigned", "coverage", context.organizationId, { type, ownerUserId, count: applied.length });
  return {
    type,
    ownerUserId,
    summary: {
      requested: ids.length,
      applied: applied.length,
      conflict: results.filter((result) => result.status === "conflict").length,
      skipped: results.filter((result) => result.status === "skipped").length,
      failed: results.filter((result) => result.status === "failed").length,
    },
    results,
  };
}

/**
 * Hands a territory's primary coverage to a user or team from a date: the
 * current primary assignment ends the day before, the new one starts on the
 * date, so history stays effective-dated and gap-free. Serialized on the
 * territory row; a same-day repeat with the same assignee is a no-op.
 */
export async function transferTerritoryCoverage(client, context, territoryId, input = {}) {
  if (!hasCrmPermission(context, "crm.territories.manage") && !hasCrmPermission(context, "crm.coverage.assign"))
    throw new CrmError(403, "You do not have permission to change territory coverage.", "CRM_PERMISSION_REQUIRED");
  if (!UUID.test(String(territoryId || ""))) throw new CrmError(404, "Territory not found.", "CRM_TERRITORY_NOT_FOUND");
  const assigneeType = String(input.assigneeType || "");
  if (!["user", "team"].includes(assigneeType)) throw new CrmError(400, "Choose a user or a sales team.", "CRM_TERRITORY_ASSIGNEE_INVALID");
  const assigneeId = String(input.assigneeId || "");
  if (!UUID.test(assigneeId)) throw new CrmError(400, "Choose who takes over the territory.", "CRM_TERRITORY_ASSIGNEE_INVALID");
  const effectiveFrom = ISO_DATE.test(String(input.effectiveFrom || "")) ? String(input.effectiveFrom) : today();
  if (effectiveFrom < today()) throw new CrmError(400, "A coverage change cannot start in the past.", "CRM_TERRITORY_EFFECTIVE_DATE_INVALID");
  const reason = String(input.reason ?? "").trim();
  if (reason.length < 3 || reason.length > 500) throw new CrmError(400, "Give a reason for the change (3–500 characters).", "CRM_COVERAGE_REASON_REQUIRED");

  const parameters = [context.organizationId, territoryId];
  const territory = await client.query(
    `SELECT territory.* FROM tenant.crm_territories territory WHERE territory.organization_id=$1 AND territory.id=$2${companyClause(context, parameters, "territory")} FOR UPDATE`,
    parameters,
  );
  if (!territory.rows[0]) throw new CrmError(404, "Territory not found.", "CRM_TERRITORY_NOT_FOUND");
  if (territory.rows[0].status !== "active") throw new CrmError(409, "Only an active territory can change coverage.", "CRM_TERRITORY_INACTIVE");
  const assignee =
    assigneeType === "user"
      ? await client.query(
          `SELECT 1 FROM public.organization_memberships WHERE organization_id=$1 AND user_id=$2 AND status='active'`,
          [context.organizationId, assigneeId],
        )
      : await client.query(`SELECT 1 FROM tenant.crm_sales_teams WHERE organization_id=$1 AND id=$2 AND status='active'`, [context.organizationId, assigneeId]);
  if (!assignee.rows[0]) throw new CrmError(400, "The new owner is not an active member or team.", "CRM_TERRITORY_ASSIGNEE_INVALID");

  const current = await client.query(
    // Dates as text: node-postgres turns `date` into a local-midnight Date,
    // which shifts a day in zones east of UTC.
    `SELECT id, assignee_type, assignee_id, effective_from::text AS effective_from FROM tenant.crm_territory_assignments
      WHERE organization_id=$1 AND territory_id=$2 AND assignment_role='primary' AND (effective_to IS NULL OR effective_to>=$3::date)
      ORDER BY effective_from`,
    [context.organizationId, territoryId, effectiveFrom],
  );
  const same = current.rows.find((row) => row.assignee_type === assigneeType && String(row.assignee_id) === assigneeId && row.effective_from <= effectiveFrom);
  if (same && current.rows.length === 1) return { territoryId, changed: false, assignmentId: same.id };
  if (current.rows.some((row) => row.effective_from >= effectiveFrom))
    throw new CrmError(409, "Another coverage change already starts on or after that date. Remove it first.", "CRM_TERRITORY_COVERAGE_OVERLAP");

  await client.query(
    `UPDATE tenant.crm_territory_assignments SET effective_to=$3::date - 1, updated_by=$4, updated_at=now()
      WHERE organization_id=$1 AND territory_id=$2 AND assignment_role='primary' AND (effective_to IS NULL OR effective_to>=$3::date)`,
    [context.organizationId, territoryId, effectiveFrom, context.userId],
  );
  const inserted = await client.query(
    `INSERT INTO tenant.crm_territory_assignments(organization_id,company_id,territory_id,assignee_type,assignee_id,assignment_role,effective_from,source,created_by)
     VALUES($1,$2,$3,$4,$5,'primary',$6,'manual',$7) RETURNING id`,
    [context.organizationId, territory.rows[0].company_id, territoryId, assigneeType, assigneeId, effectiveFrom, context.userId],
  );
  const previous = current.rows.map((row) => ({ assigneeType: row.assignee_type, assigneeId: row.assignee_id }));
  await audit(client, {
    organizationId: context.organizationId,
    actorUserId: context.userId,
    eventType: "crm.territory.coverage_transferred",
    entityType: "crm.territory",
    entityId: territoryId,
    beforeData: { primary: previous },
    afterData: { primary: { assigneeType, assigneeId, effectiveFrom } },
    metadata: { reason },
  });
  await queueOutboxEvent(client, context, "crm.territory.coverage_transferred", "territories", territoryId, { assigneeType, assigneeId, effectiveFrom });
  return { territoryId, changed: true, assignmentId: inserted.rows[0].id, effectiveFrom, previous };
}
