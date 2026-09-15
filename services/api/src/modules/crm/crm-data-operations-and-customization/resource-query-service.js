import { leadSearchColumnsForContext } from "../lead-lifecycle-qualification-and-prioritization/lead-security.js";
import { taskOverdueSql } from "../seller-activity-and-follow-up-workspace/task-operations.js";
import { CrmError } from "./errors.js";
import { projectCrmRecord, projectCrmRecords, recordScope } from "./record-policy.js";
import { definitionFor, resources } from "./resource-registry.js";
import { addParameter, camelizeRow, limitValue } from "./record-utils.js";



export async function nextCode(client, organizationId, entityType) {
  const result = await client.query(
    `UPDATE public.numbering_series SET next_number = next_number + 1 WHERE organization_id = $1 AND entity_type = $2 RETURNING prefix, next_number - 1 AS number, padding`,
    [organizationId, entityType],
  );
  if (!result.rows[0])
    throw new CrmError(
      409,
      `Numbering series ${entityType} is not configured.`,
    );
  const row = result.rows[0];
  return `${row.prefix}${String(row.number).padStart(Number(row.padding || 5), "0")}`;
}



export function buildSearch(
  definition,
  search,
  parameters,
  alias = "record",
  context = {},
) {
  const value = String(search || "").trim();
  if (!value || !definition.search?.length) return "";
  const columns =
    definition.table === "tenant.crm_leads"
      ? leadSearchColumnsForContext(context, definition.search)
      : definition.search;
  if (!columns.length) return "";
  const parameter = addParameter(parameters, `%${value}%`);
  return ` AND (${columns.map((column) => `COALESCE(${alias}.${column}::text, '') ILIKE ${parameter}`).join(" OR ")})`;
}



export function buildFilters(
  definition,
  filters,
  parameters,
  alias = "record",
  context = {},
) {
  let sql = "";
  if (filters.status && filters.status !== "all" && definition.statusColumn) {
    if (
      definition.table === "tenant.crm_leads" &&
      ["archived", "converted"].includes(String(filters.status))
    )
      sql += ` AND ${alias}.record_status = ${addParameter(parameters, filters.status)}`;
    else
      sql += ` AND ${alias}.${definition.statusColumn} = ${addParameter(parameters, filters.status)}`;
  }
  const ownerFilter = String(filters.ownerId || "");
  if (definition.fields.ownerUserId && ownerFilter) {
    if (ownerFilter === "me")
      sql += ` AND ${alias}.owner_user_id = ${addParameter(parameters, context.userId)}`;
    else if (ownerFilter === "unassigned")
      sql += ` AND ${alias}.owner_user_id IS NULL`;
    else if (
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        ownerFilter,
      )
    )
      sql += ` AND ${alias}.owner_user_id = ${addParameter(parameters, ownerFilter)}`;
    else sql += " AND false";
  }
  for (const [key, column] of [
    ["stageId", "stage_id"],
    ["pipelineId", "pipeline_id"],
    ["sourceId", "source_id"],
    ["campaignId", "campaign_id"],
    // F020 Tranche D (Stage A) — sales-team-members/territory-assignments
    // are inherently parent-scoped (a membership belongs to exactly one
    // team, an assignment to exactly one territory); listing either
    // without this filter would return every membership/assignment across
    // the organization, a real cross-team/cross-territory data exposure,
    // not just a UX inconvenience.
    ["teamId", "team_id"],
    ["territoryId", "territory_id"],
    // F002 Tranche E (Stage A) — same reasoning for account-plans/
    // account-stakeholders/communications: each row belongs to exactly one
    // Account (party_id) or, for stakeholders, one account plan
    // (account_plan_id). Without these keys an Account 360's plan/
    // stakeholder/communications panel would have had to list the whole
    // organization's rows and filter client-side, which is both wasteful
    // and a real cross-account data exposure over the wire.
    ["partyId", "party_id"],
    ["accountPlanId", "account_plan_id"],
    // F003 Tranche F (Stage A) — same reasoning for communications scoped
    // to a Contact rather than an Account (tenant.crm_communications has
    // both party_id and contact_id columns).
    ["contactId", "contact_id"],
  ]) {
    if (filters[key] && Object.values(definition.fields).includes(column))
      sql += ` AND ${alias}.${column} = ${addParameter(parameters, filters[key])}`;
  }
  if (definition.table === "tenant.crm_leads") {
    // Lifecycle stage is independent from conversion/archive record state.
    // Preserve the historical status=archived|converted query contract while
    // using record_status as the canonical retention boundary.
    if (
      !["archived", "converted"].includes(String(filters.status || ""))
    )
      sql += ` AND ${alias}.record_status = 'active'`;
    for (const [key, column] of [
      ["priority", "priority"],
      ["rating", "rating"],
    ]) {
      if (filters[key] && filters[key] !== "all")
        sql += ` AND ${alias}.${column} = ${addParameter(parameters, filters[key])}`;
    }
    if (
      filters.qualification &&
      ["not_reviewed", "qualified", "unqualified"].includes(
        String(filters.qualification),
      )
    )
      sql += ` AND ${alias}.qualification_state = ${addParameter(parameters, filters.qualification)}`;
    const followup = filters.followup || "all";
    if (followup === "overdue")
      sql += ` AND ${alias}.next_follow_up_at < now()`;
    if (followup === "today")
      sql += ` AND ${alias}.next_follow_up_at >= current_date AND ${alias}.next_follow_up_at < current_date + interval '1 day'`;
    if (followup === "upcoming")
      sql += ` AND ${alias}.next_follow_up_at >= now()`;
    if (followup === "none") sql += ` AND ${alias}.next_follow_up_at IS NULL`;
  }
  if (definition.table === "tenant.crm_activities") {
    const activityType = String(filters.activityType || "all");
    if (
      ["task", "call", "meeting", "email", "whatsapp", "sms", "note"].includes(
        activityType,
      )
    )
      sql += ` AND ${alias}.activity_type = ${addParameter(parameters, activityType)}`;
    const due = filters.due || "all";
    if (due === "today")
      sql +=
        " AND record.due_at >= current_date AND record.due_at < current_date + interval '1 day'";
    if (due === "overdue")
      sql += ` AND ${taskOverdueSql("record")}`;
    if (due === "upcoming")
      sql +=
        " AND record.due_at >= now() AND record.status NOT IN ('completed', 'cancelled')";
  }
  // Generic Opportunity-scoped listing (deal-risks, buying-committees, ...):
  // any resource whose fields map declares an opportunityId column can be
  // filtered down to one Opportunity's child rows, rather than every caller
  // having to know the underlying column name.
  if (definition.fields.opportunityId && filters.opportunityId) {
    const opportunityId = String(filters.opportunityId);
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(opportunityId))
      sql += ` AND ${alias}.${definition.fields.opportunityId} = ${addParameter(parameters, opportunityId)}`;
    else sql += " AND false";
  }
  if (definition.fields.committeeId && filters.committeeId) {
    const committeeId = String(filters.committeeId);
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(committeeId))
      sql += ` AND ${alias}.${definition.fields.committeeId} = ${addParameter(parameters, committeeId)}`;
    else sql += " AND false";
  }
  return sql;
}



export async function listSalesStageResourceRecords(client, context, filters = {}) {
  const parameters = [context.organizationId];
  let where = "stage.organization_id=$1";
  if (context.activeCompanyId) {
    where += ` AND (pipeline.company_id IS NULL OR pipeline.company_id=${addParameter(parameters, context.activeCompanyId)})`;
  } else if (!context.allowAllCompanies) {
    where += " AND false";
  }
  if (filters.status && filters.status !== "all")
    where += ` AND stage.status=${addParameter(parameters, String(filters.status))}`;
  if (filters.pipelineId) {
    const pipelineId = String(filters.pipelineId);
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(pipelineId))
      where += ` AND stage.pipeline_id=${addParameter(parameters, pipelineId)}`;
    else where += " AND false";
  }
  const search = String(filters.search || "").trim();
  if (search) {
    const query = `%${search.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
    where += ` AND (stage.name ILIKE ${addParameter(parameters, query)} ESCAPE '\\' OR stage.code ILIKE ${addParameter(parameters, query)} ESCAPE '\\' OR stage.forecast_category ILIKE ${addParameter(parameters, query)} ESCAPE '\\')`;
  }
  const limit = limitValue(filters.limit);
  const offset = Math.max(0, Math.min(10_000_000, Math.trunc(Number(filters.offset || 0) || 0)));
  const countResult = await client.query(
    `SELECT count(*)::int AS total FROM tenant.crm_pipeline_stages stage
       JOIN tenant.crm_pipelines pipeline ON pipeline.organization_id=stage.organization_id AND pipeline.id=stage.pipeline_id
      WHERE ${where}`,
    parameters,
  );
  const total = Number(countResult.rows[0]?.total || 0);
  const result = await client.query(
    `SELECT stage.*,pipeline.name AS pipeline_name,pipeline.company_id AS pipeline_company_id
       FROM tenant.crm_pipeline_stages stage
       JOIN tenant.crm_pipelines pipeline ON pipeline.organization_id=stage.organization_id AND pipeline.id=stage.pipeline_id
      WHERE ${where}
      ORDER BY stage.pipeline_id,stage.status='active' DESC,stage.sequence,stage.id
      LIMIT ${addParameter(parameters, limit)} OFFSET ${addParameter(parameters, offset)}`,
    parameters,
  );
  return { rows: result.rows.map(camelizeRow), total, limit, offset };
}



export async function getSalesStageResourceRecord(client, context, id) {
  const parameters = [context.organizationId, id];
  let scope = "";
  if (context.activeCompanyId)
    scope += ` AND (pipeline.company_id IS NULL OR pipeline.company_id=${addParameter(parameters, context.activeCompanyId)})`;
  else if (!context.allowAllCompanies) scope += " AND false";
  const result = await client.query(
    `SELECT stage.*,pipeline.name AS pipeline_name,pipeline.company_id AS pipeline_company_id
       FROM tenant.crm_pipeline_stages stage
       JOIN tenant.crm_pipelines pipeline ON pipeline.organization_id=stage.organization_id AND pipeline.id=stage.pipeline_id
      WHERE stage.organization_id=$1 AND stage.id=$2${scope} LIMIT 1`,
    parameters,
  );
  if (!result.rows[0]) throw new CrmError(404, "CRM record not found.");
  return camelizeRow(result.rows[0]);
}



export async function listCrmRecords(client, context, resource, filters = {}) {
  if (resource === "stages") return listSalesStageResourceRecords(client, context, filters);
  const definition = definitionFor(resource);
  const parameters = [context.organizationId];
  let where = "record.organization_id = $1";
  where += recordScope(definition, context, parameters);
  where += buildSearch(definition, filters.search, parameters, "record", context);
  where += buildFilters(definition, filters, parameters, "record", context);
  const limit = limitValue(filters.limit);
  const offset = Math.max(
    0,
    Math.min(10_000_000, Math.trunc(Number(filters.offset || 0) || 0)),
  );
  const countResult = await client.query(
    `SELECT count(*)::int AS total FROM ${definition.table} record WHERE ${where}`,
    parameters,
  );
  const total = Number(countResult.rows[0]?.total || 0);
  const result = await client.query(
    `SELECT record.* FROM ${definition.table} record WHERE ${where} ORDER BY ${definition.orderBy} LIMIT ${addParameter(parameters, limit)} OFFSET ${addParameter(parameters, offset)}`,
    parameters,
  );
  return {
    rows: await projectCrmRecords(
      client,
      context,
      resource,
      result.rows.map((row) => camelizeRow(row)),
    ),
    total,
    limit,
    offset,
  };
}




export async function snapshotLeadBulkJobSelection(
  client,
  context,
  jobId,
  selection = {},
  { maximum = 50_000 } = {},
) {
  const definition = resources.leads;
  const parameters = [context.organizationId, jobId];
  let where = "record.organization_id = $1";
  where += recordScope(definition, context, parameters);

  const type = String(selection.type || "explicit");
  if (type === "explicit") {
    const ids = Array.isArray(selection.ids)
      ? [...new Set(selection.ids.map((value) => String(value)))]
      : [];
    if (!ids.length) return { requested: 0, snapshotted: 0 };
    where += ` AND record.id = ANY(${addParameter(parameters, ids)}::uuid[])`;
    // Explicit bulk edits are only valid for active Lead records.
    where += buildFilters(definition, {}, parameters, "record", context);
  } else if (type === "filter") {
    const filters = selection.filters && typeof selection.filters === "object"
      ? selection.filters
      : {};
    where += buildSearch(definition, filters.search, parameters, "record", context);
    where += buildFilters(definition, filters, parameters, "record", context);
  } else {
    throw new CrmError(400, "Unsupported Lead bulk selection.", "CRM_LEAD_BULK_SELECTION_INVALID");
  }

  const countResult = await client.query(
    `SELECT count(*)::int AS total FROM tenant.crm_leads record WHERE ${where}`,
    parameters,
  );
  const total = Number(countResult.rows[0]?.total || 0);
  if (total > maximum) {
    throw new CrmError(
      413,
      `This bulk operation matches ${total} Leads. Narrow the selection to ${maximum} or fewer records.`,
      "CRM_LEAD_BULK_SELECTION_TOO_LARGE",
      { total, maximum },
    );
  }
  if (!total) return { requested: 0, snapshotted: 0 };

  const inserted = await client.query(
    `INSERT INTO tenant.crm_lead_bulk_job_items
       (organization_id,job_id,lead_id,expected_updated_at)
     SELECT $1,$2,record.id,record.updated_at
       FROM tenant.crm_leads record
      WHERE ${where}
      ORDER BY record.id
     ON CONFLICT (organization_id,job_id,lead_id) DO NOTHING`,
    parameters,
  );
  return { requested: total, snapshotted: inserted.rowCount };
}



// F029 (Bulk actions) — LAST PROMPT 1/3 closeout: Opportunities had no async
// bulk path (see enqueueOpportunityBulkUpdateJob in opportunity-operations.js
// for the rest of the job lifecycle). Mirrors snapshotLeadBulkJobSelection
// exactly; the one Opportunity-specific addition is the hard `status='open'`
// constraint, matching the invariant bulkUpdateOpportunities' synchronous
// path already enforces (closed/archived Opportunities are not bulk-editable
// through either path).
export async function snapshotOpportunityBulkJobSelection(
  client,
  context,
  jobId,
  selection = {},
  { maximum = 50_000 } = {},
) {
  const definition = resources.opportunities;
  const parameters = [context.organizationId, jobId];
  let where = "record.organization_id = $1 AND record.status = 'open'";
  where += recordScope(definition, context, parameters);

  const type = String(selection.type || "explicit");
  if (type === "explicit") {
    const ids = Array.isArray(selection.ids)
      ? [...new Set(selection.ids.map((value) => String(value)))]
      : [];
    if (!ids.length) return { requested: 0, snapshotted: 0 };
    where += ` AND record.id = ANY(${addParameter(parameters, ids)}::uuid[])`;
  } else if (type === "filter") {
    const filters = selection.filters && typeof selection.filters === "object"
      ? selection.filters
      : {};
    where += buildSearch(definition, filters.search, parameters, "record", context);
    where += buildFilters(definition, filters, parameters, "record", context);
  } else {
    throw new CrmError(400, "Unsupported Opportunity bulk selection.", "CRM_OPPORTUNITY_BULK_SELECTION_INVALID");
  }

  const countResult = await client.query(
    `SELECT count(*)::int AS total FROM tenant.crm_opportunities record WHERE ${where}`,
    parameters,
  );
  const total = Number(countResult.rows[0]?.total || 0);
  if (total > maximum) {
    throw new CrmError(
      413,
      `This bulk operation matches ${total} Opportunities. Narrow the selection to ${maximum} or fewer records.`,
      "CRM_OPPORTUNITY_BULK_SELECTION_TOO_LARGE",
      { total, maximum },
    );
  }
  if (!total) return { requested: 0, snapshotted: 0 };

  const inserted = await client.query(
    `INSERT INTO tenant.crm_opportunity_bulk_job_items
       (organization_id,job_id,opportunity_id,expected_updated_at)
     SELECT $1,$2,record.id,record.updated_at
       FROM tenant.crm_opportunities record
      WHERE ${where}
      ORDER BY record.id
     ON CONFLICT (organization_id,job_id,opportunity_id) DO NOTHING`,
    parameters,
  );
  return { requested: total, snapshotted: inserted.rowCount };
}



export async function getCrmRecord(client, context, resource, id) {
  if (resource === "stages") return getSalesStageResourceRecord(client, context, id);
  const definition = definitionFor(resource);
  const parameters = [context.organizationId, id];
  const result = await client.query(
    `SELECT record.* FROM ${definition.table} record WHERE record.organization_id = $1 AND record.id = $2${recordScope(definition, context, parameters)} LIMIT 1`,
    parameters,
  );
  if (!result.rows[0]) throw new CrmError(404, "CRM record not found.");
  return projectCrmRecord(client, context, resource, camelizeRow(result.rows[0]));
}
