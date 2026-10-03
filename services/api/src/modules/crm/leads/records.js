// The lead record: create, read, list, update, change stage, archive.
//
// Owner and team change only through assignment.js; status only through
// qualification.js (qualify / disqualify / reopen) and conversion.js. This
// file never writes those columns except to set the initial owner on create.
import { nextDocumentNumber } from "../../../core/platform/numbering/index.js";
import { assertCrmOwnerAssignable } from "../data-management/crm-access-scope.js";
import { CrmError } from "../data-management/errors.js";
import { queueOutboxEvent } from "../data-management/outbox.js";
import { managedTeamMembersSql } from "../data-management/record-utils.js";
import { leadCan, leadCapabilities, leadScopeSql, projectLeadForContext, requireLeadPermission } from "./access.js";
import { applyLeadAssignment, matchLeadAssignmentRule } from "./assignment.js";
import { LEAD_NUMBER_DOCUMENT_TYPE, LEAD_PERMISSIONS, LEAD_STAGES, leadStageLabel } from "./constants.js";
import { assertNoBlockingLeadDuplicate } from "./duplicates.js";
import { recordLeadHistory } from "./history.js";
import { assertActiveLeadSource } from "./sources.js";
import { LEAD_WRITABLE_COLUMNS, assertValidLead, isUuid, normalizeLeadInput, requireUuid } from "./validation.js";

const STAGE_CODES = new Set(LEAD_STAGES.map((stage) => stage.code));
const DUPLICATE_IDENTITY_FIELDS = ["email", "phone", "mobile", "firstName", "lastName", "companyName"];
const BULK_LIMIT = 200;
const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

// The next pending follow-up comes from the follow-up activities themselves,
// so it can never drift from what the Follow-ups screen shows.
export const LEAD_SELECT = `
  SELECT lead.*, source.name AS source_name, owner.full_name AS owner_name, team.name AS team_name,
         creator.full_name AS created_by_name, updater.full_name AS updated_by_name,
         follow_up.next_follow_up_at AS pending_follow_up_at,
         COALESCE((SELECT jsonb_agg(jsonb_build_object('id', tag.id, 'name', tag.name, 'color', tag.color) ORDER BY tag.name)
                     FROM tenant.crm_lead_tags lead_tag
                     JOIN tenant.crm_tags tag ON tag.organization_id = lead_tag.organization_id AND tag.id = lead_tag.tag_id
                    WHERE lead_tag.organization_id = lead.organization_id AND lead_tag.lead_id = lead.id), '[]'::jsonb) AS tags
    FROM tenant.crm_leads lead
    LEFT JOIN tenant.crm_lead_sources source ON source.organization_id = lead.organization_id AND source.id = lead.source_id
    LEFT JOIN public.users owner ON owner.id = lead.owner_user_id
    LEFT JOIN public.users creator ON creator.id = lead.created_by
    LEFT JOIN public.users updater ON updater.id = lead.updated_by
    LEFT JOIN tenant.crm_sales_teams team ON team.organization_id = lead.organization_id AND team.id = lead.team_id
    LEFT JOIN LATERAL (
      SELECT min(activity.due_at) AS next_follow_up_at
        FROM tenant.crm_activities activity
       WHERE activity.organization_id = lead.organization_id AND activity.entity_type = 'lead' AND activity.entity_id = lead.id
         AND activity.activity_type = 'follow_up' AND activity.status IN ('planned', 'in_progress', 'overdue')
    ) follow_up ON true`;

export function toLead(row) {
  return {
    id: row.id,
    code: row.code,
    firstName: row.first_name,
    lastName: row.last_name,
    fullName: row.full_name,
    companyName: row.company_name,
    jobTitle: row.job_title,
    email: row.email,
    phone: row.phone,
    mobile: row.mobile,
    website: row.website,
    city: row.city,
    state: row.state,
    countryCode: row.country_code?.trim() ?? null,
    sourceId: row.source_id,
    sourceName: row.source_name ?? null,
    sourceDetail: row.source_detail,
    industry: row.industry,
    productInterest: row.product_interest,
    estimatedValue: Number(row.estimated_value ?? 0),
    currencyCode: row.currency_code?.trim() ?? null,
    purchaseTimeframe: row.purchase_timeframe,
    priority: row.priority,
    rating: row.rating,
    description: row.description,
    tags: row.tags ?? [],
    ownerUserId: row.owner_user_id,
    ownerName: row.owner_name ?? null,
    teamId: row.team_id,
    teamName: row.team_name ?? null,
    assignedAt: row.assigned_at,
    stage: row.stage,
    stageChangedAt: row.stage_changed_at,
    status: row.status,
    needIdentified: row.need_identified,
    budgetStatus: row.budget_status,
    budgetAmount: row.budget_amount === null || row.budget_amount === undefined ? null : Number(row.budget_amount),
    decisionAuthority: row.decision_authority,
    qualificationNotes: row.qualification_notes,
    qualifiedAt: row.qualified_at,
    disqualificationReason: row.disqualification_reason,
    disqualificationNotes: row.disqualification_notes,
    disqualifiedAt: row.disqualified_at,
    convertedAt: row.converted_at,
    convertedBy: row.converted_by,
    convertedPartyId: row.converted_party_id,
    convertedContactId: row.converted_contact_id,
    convertedOpportunityId: row.converted_opportunity_id,
    lastActivityAt: row.last_activity_at,
    nextFollowUpAt: row.pending_follow_up_at ?? null,
    archivedAt: row.archived_at,
    createdBy: row.created_by,
    createdByName: row.created_by_name ?? null,
    createdAt: row.created_at,
    updatedBy: row.updated_by,
    updatedByName: row.updated_by_name ?? null,
    updatedAt: row.updated_at,
  };
}

// ------------------------------------------------------------------ read

// skipScope: only for returning a record the caller has just written.
async function loadLeadRow(client, context, leadId, { lock = false, includeArchived = false, skipScope = false } = {}) {
  const values = [context.organizationId, requireUuid(leadId, "Lead")];
  const scope = skipScope ? "" : leadScopeSql(context, values, "lead");
  const { rows } = await client.query(
    `${LEAD_SELECT} WHERE lead.organization_id = $1 AND lead.id = $2${includeArchived ? "" : " AND lead.archived_at IS NULL"}${scope}${lock ? " FOR UPDATE OF lead" : ""}`,
    values,
  );
  if (!rows[0]) throw new CrmError(404, "Lead not found.", "CRM_LEAD_NOT_FOUND");
  return rows[0];
}

// Locks and returns the raw row for the domain operations in this folder.
export async function lockLead(client, context, leadId, options = {}) {
  return loadLeadRow(client, context, leadId, { ...options, lock: true });
}

export async function getLead(client, context, leadId) {
  requireLeadPermission(context, LEAD_PERMISSIONS.view, "You do not have permission to view leads.");
  const row = await loadLeadRow(client, context, leadId, { includeArchived: true });
  return projectLeadForContext(context, toLead(row));
}

// ------------------------------------------------------------------ list

export const LEAD_VIEWS = Object.freeze([
  { key: "all", label: "All Leads" },
  { key: "mine", label: "My Leads" },
  { key: "unassigned", label: "Unassigned Leads" },
  { key: "new", label: "New Leads" },
  { key: "follow_up", label: "Requiring Follow-up" },
  { key: "due_today", label: "Follow-ups Due Today" },
  { key: "overdue", label: "Overdue Follow-ups" },
  { key: "qualified", label: "Qualified Leads" },
  { key: "disqualified", label: "Disqualified Leads" },
  { key: "converted", label: "Converted Leads" },
  { key: "archived", label: "Archived" },
]);

const SORT_COLUMNS = Object.freeze({
  code: "lead.code",
  name: "lower(COALESCE(lead.full_name, lead.company_name))",
  companyName: "lower(lead.company_name)",
  stage: "lead.stage",
  status: "lead.status",
  priority: "CASE lead.priority WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END",
  rating: "CASE lead.rating WHEN 'hot' THEN 3 WHEN 'warm' THEN 2 ELSE 1 END",
  estimatedValue: "lead.estimated_value",
  ownerName: "lower(owner.full_name)",
  sourceName: "lower(source.name)",
  nextFollowUpAt: "follow_up.next_follow_up_at",
  lastActivityAt: "lead.last_activity_at",
  createdAt: "lead.created_at",
  updatedAt: "lead.updated_at",
});

// The WHERE clause shared by the list, the export and the bulk operations,
// so "what I see" and "what I export" can never differ.
export function buildLeadListWhere(context, filters = {}, values = []) {
  const bind = (value) => { values.push(value); return `$${values.length}`; };
  const where = [`lead.organization_id = ${bind(context.organizationId)}`];
  const view = filters.view || "all";
  where.push(view === "archived" ? "lead.archived_at IS NOT NULL" : "lead.archived_at IS NULL");
  if (view === "mine") where.push(`lead.owner_user_id = ${bind(context.userId)}`);
  if (view === "unassigned") where.push("lead.owner_user_id IS NULL AND lead.status = 'open'");
  if (view === "new") where.push("lead.stage = 'new' AND lead.status = 'open'");
  if (view === "follow_up") where.push("follow_up.next_follow_up_at IS NOT NULL");
  if (view === "due_today") where.push("follow_up.next_follow_up_at >= current_date AND follow_up.next_follow_up_at < current_date + interval '1 day'");
  if (view === "overdue") where.push("follow_up.next_follow_up_at < now()");
  if (["qualified", "disqualified", "converted"].includes(view)) where.push(`lead.status = ${bind(view)}`);

  const exact = { status: "lead.status", stage: "lead.stage", priority: "lead.priority", rating: "lead.rating" };
  for (const [key, column] of Object.entries(exact)) if (filters[key]) where.push(`${column} = ${bind(String(filters[key]))}`);
  for (const [key, column] of Object.entries({ sourceId: "lead.source_id", teamId: "lead.team_id" }))
    if (isUuid(filters[key])) where.push(`${column} = ${bind(filters[key])}`);
  if (filters.ownerId === "unassigned") where.push("lead.owner_user_id IS NULL");
  else if (filters.ownerId === "me") where.push(`lead.owner_user_id = ${bind(context.userId)}`);
  else if (filters.ownerId === "team") {
    // The caller and the active members of the sales teams they manage.
    const me = bind(context.userId);
    where.push(`(lead.owner_user_id = ${me} OR lead.owner_user_id IN (${managedTeamMembersSql("lead.organization_id", me)}))`);
  }
  else if (isUuid(filters.ownerId)) where.push(`lead.owner_user_id = ${bind(filters.ownerId)}`);
  if (isUuid(filters.tagId))
    where.push(`EXISTS (SELECT 1 FROM tenant.crm_lead_tags filter_tag WHERE filter_tag.organization_id = lead.organization_id AND filter_tag.lead_id = lead.id AND filter_tag.tag_id = ${bind(filters.tagId)})`);
  if (filters.createdFrom) where.push(`lead.created_at >= ${bind(filters.createdFrom)}::date`);
  if (filters.createdTo) where.push(`lead.created_at < ${bind(filters.createdTo)}::date + interval '1 day'`);
  if (Array.isArray(filters.ids) && filters.ids.length) where.push(`lead.id = ANY (${bind(filters.ids.filter(isUuid))}::uuid[])`);

  const search = String(filters.search ?? "").trim().toLowerCase();
  if (search) {
    // Contact details are searchable only by callers allowed to see them.
    const haystack = leadCan(context, LEAD_PERMISSIONS.viewSensitive)
      ? "lower(COALESCE(lead.code, '') || ' ' || COALESCE(lead.full_name, '') || ' ' || COALESCE(lead.company_name, '') || ' ' || COALESCE(lead.email, '') || ' ' || COALESCE(lead.mobile, '') || ' ' || COALESCE(lead.phone, ''))"
      : "lower(COALESCE(lead.code, '') || ' ' || COALESCE(lead.full_name, '') || ' ' || COALESCE(lead.company_name, ''))";
    where.push(`${haystack} LIKE ${bind(`%${search.replace(/[\\%_]/g, "\\$&")}%`)}`);
  }
  return `WHERE ${where.join(" AND ")}${leadScopeSql(context, values, "lead")}`;
}

export async function listLeads(client, context, filters = {}) {
  requireLeadPermission(context, LEAD_PERMISSIONS.view, "You do not have permission to view leads.");
  const limit = Math.min(Math.max(Number(filters.limit) || 25, 1), 200);
  const offset = Math.max(Number(filters.offset) || 0, 0);
  const sortColumn = SORT_COLUMNS[filters.sortBy] ?? SORT_COLUMNS.updatedAt;
  const sortDirection = String(filters.sortDirection).toLowerCase() === "asc" ? "ASC" : "DESC";

  const values = [];
  const where = buildLeadListWhere(context, filters, values);
  const total = await client.query(
    `SELECT count(*)::int AS total FROM (${LEAD_SELECT} ${where}) counted`,
    values,
  );
  const { rows } = await client.query(
    `${LEAD_SELECT} ${where} ORDER BY ${sortColumn} ${sortDirection} NULLS LAST, lead.id DESC LIMIT ${limit} OFFSET ${offset}`,
    values,
  );
  return {
    leads: rows.map((row) => projectLeadForContext(context, toLead(row))),
    total: total.rows[0].total,
    limit,
    offset,
    capabilities: leadCapabilities(context),
  };
}

// ------------------------------------------------------------------ create

async function setLeadTags(client, context, leadId, tagIds) {
  const ids = [...new Set((Array.isArray(tagIds) ? tagIds : []).filter(isUuid))];
  await client.query(
    `DELETE FROM tenant.crm_lead_tags WHERE organization_id = $1 AND lead_id = $2 AND NOT (tag_id = ANY ($3::uuid[]))`,
    [context.organizationId, leadId, ids],
  );
  if (!ids.length) return;
  await client.query(
    `INSERT INTO tenant.crm_lead_tags (organization_id, lead_id, tag_id, created_by)
     SELECT $1, $2, tag.id, $4 FROM tenant.crm_tags tag
      WHERE tag.organization_id = $1 AND tag.id = ANY ($3::uuid[]) AND tag.status = 'active'
     ON CONFLICT DO NOTHING`,
    [context.organizationId, leadId, ids, context.userId ?? null],
  );
}

// options:
//   allowDuplicate  the caller confirmed a blocking duplicate is a different record
//   defaultOwner    "creator" (manual entry) or "none" (import, integrations):
//                   who owns the lead when no owner is given and no rule matches
//   origin          recorded in history: "manual" | "import" | "integration"
export async function createLead(client, context, input = {}, { allowDuplicate = false, defaultOwner = "creator", origin = "manual" } = {}) {
  requireLeadPermission(context, LEAD_PERMISSIONS.create, "You do not have permission to create leads.");
  const normalized = normalizeLeadInput(input);
  assertValidLead(normalized);
  await assertActiveLeadSource(client, context, normalized.sourceId);
  const duplicates = await assertNoBlockingLeadDuplicate(client, context, normalized, { allowDuplicate });

  // Owner: an explicit choice wins, then the first matching assignment rule,
  // then the default for this kind of creation.
  let assignment = { reason: "manual" };
  if (has(input, "ownerUserId") || has(input, "teamId")) {
    if (input.ownerUserId && input.ownerUserId !== context.userId) {
      requireLeadPermission(context, LEAD_PERMISSIONS.assign, "You do not have permission to assign leads.");
      await assertCrmOwnerAssignable(client, context, input.ownerUserId, "You can only assign leads to yourself or to members of a team you manage.", { resource: "leads" });
    }
    assignment = { ...assignment, ownerUserId: input.ownerUserId || null, teamId: input.teamId || null };
  } else {
    const rule = await matchLeadAssignmentRule(client, context, normalized);
    assignment = rule
      ? { ownerUserId: rule.ownerUserId, teamId: rule.teamId, reason: "rule", ruleName: rule.ruleName }
      : { ownerUserId: defaultOwner === "creator" ? context.userId : null, teamId: null, reason: "creator" };
  }

  const code = await nextDocumentNumber(client, { organizationId: context.organizationId }, { documentType: LEAD_NUMBER_DOCUMENT_TYPE });
  const fields = Object.keys(normalized).filter((field) => LEAD_WRITABLE_COLUMNS[field] && normalized[field] !== null);
  const columns = ["organization_id", "code", "created_by", "updated_by", ...fields.map((field) => LEAD_WRITABLE_COLUMNS[field])];
  const values = [context.organizationId, code, context.userId ?? null, context.userId ?? null, ...fields.map((field) => normalized[field])];
  const inserted = await client.query(
    `INSERT INTO tenant.crm_leads (${columns.join(", ")}) VALUES (${values.map((_value, index) => `$${index + 1}`).join(", ")}) RETURNING *`,
    values,
  );
  const lead = inserted.rows[0];

  await recordLeadHistory(client, context, lead.id, "created", `Lead ${code} created`, {
    origin,
    ...(duplicates.hasBlockingMatch ? { duplicateConfirmed: duplicates.matches.filter((match) => match.strength === "exact").map((match) => ({ kind: match.kind, id: match.id })) } : {}),
  });
  await applyLeadAssignment(client, context, lead, { ownerUserId: assignment.ownerUserId, teamId: assignment.teamId }, { reason: assignment.reason, ruleName: assignment.ruleName ?? null });
  if (has(input, "tagIds")) await setLeadTags(client, context, lead.id, input.tagIds);
  await queueOutboxEvent(client, context, "crm.leads.created", "leads", lead.id, { status: lead.status, sourceId: lead.source_id, ownerUserId: assignment.ownerUserId ?? null });
  // A rule may have routed the lead to someone outside the creator's own
  // visibility; they still get back what they created.
  return projectLeadForContext(context, toLead(await loadLeadRow(client, context, lead.id, { skipScope: true })));
}

// ------------------------------------------------------------------ update

function assertEditable(lead) {
  if (lead.archived_at) throw new CrmError(409, "Restore this lead before changing it.", "CRM_LEAD_ARCHIVED");
  if (lead.status === "converted")
    throw new CrmError(409, "A converted lead is read-only. Work on its opportunity instead.", "CRM_LEAD_CONVERTED");
}

// expectedUpdatedAt (optional): refuses the save when someone else changed
// the lead since the caller loaded it.
export async function updateLead(client, context, leadId, input = {}, { allowDuplicate = false, expectedUpdatedAt = null } = {}) {
  requireLeadPermission(context, LEAD_PERMISSIONS.edit, "You do not have permission to edit leads.");
  if (has(input, "ownerUserId") || has(input, "teamId"))
    throw new CrmError(409, "Use Assign to change the owner or team.", "CRM_LEAD_FIELD_GOVERNED");
  const row = await loadLeadRow(client, context, leadId, { lock: true, includeArchived: true });
  assertEditable(row);
  if (expectedUpdatedAt && new Date(expectedUpdatedAt).getTime() !== new Date(row.updated_at).getTime())
    throw new CrmError(409, "This lead was changed by someone else. Reload it and try again.", "CRM_LEAD_VERSION_CONFLICT");

  const before = toLead(row);
  const normalized = normalizeLeadInput(input);
  assertValidLead(normalized, before);
  if (has(normalized, "sourceId") && normalized.sourceId !== before.sourceId) await assertActiveLeadSource(client, context, normalized.sourceId);

  const changedFields = Object.keys(normalized).filter((field) => LEAD_WRITABLE_COLUMNS[field] && (normalized[field] ?? null) !== (before[field] ?? null));
  if (changedFields.some((field) => DUPLICATE_IDENTITY_FIELDS.includes(field)))
    await assertNoBlockingLeadDuplicate(client, context, { ...before, ...normalized }, { excludeLeadId: row.id, allowDuplicate });

  if (changedFields.length) {
    const assignments = changedFields.map((field, index) => `${LEAD_WRITABLE_COLUMNS[field]} = $${index + 3}`);
    await client.query(
      `UPDATE tenant.crm_leads SET ${assignments.join(", ")}, updated_by = $${changedFields.length + 3} WHERE organization_id = $1 AND id = $2`,
      [context.organizationId, row.id, ...changedFields.map((field) => normalized[field]), context.userId ?? null],
    );
    const changes = Object.fromEntries(changedFields.map((field) => [field, { from: before[field] ?? null, to: normalized[field] ?? null }]));
    await recordLeadHistory(client, context, row.id, "updated", `Updated ${changedFields.length === 1 ? changedFields[0] : `${changedFields.length} fields`}`, changes);
    await queueOutboxEvent(client, context, "crm.leads.updated", "leads", row.id, { before, after: { ...before, ...normalized }, changedFields });
  }
  if (has(input, "tagIds")) await setLeadTags(client, context, row.id, input.tagIds);
  return projectLeadForContext(context, toLead(await loadLeadRow(client, context, row.id)));
}

// ------------------------------------------------------------------ stage

// Stage moves freely between the five stages while the lead is open. A
// qualified, disqualified or converted lead keeps the stage it ended in.
export async function changeLeadStage(client, context, leadId, input = {}) {
  requireLeadPermission(context, LEAD_PERMISSIONS.edit, "You do not have permission to change the stage of leads.");
  const stage = String(input.stage ?? "");
  if (!STAGE_CODES.has(stage)) throw new CrmError(400, "Choose a stage.", "CRM_LEAD_STAGE_INVALID");
  const row = await loadLeadRow(client, context, leadId, { lock: true });
  if (row.status !== "open")
    throw new CrmError(409, `The stage cannot change while the lead is ${row.status}. Reopen the lead first.`, "CRM_LEAD_STAGE_STATUS_CONFLICT");
  if (row.stage === stage) return { changed: false };
  await client.query(
    `UPDATE tenant.crm_leads SET stage = $3, stage_changed_at = now(), updated_by = $4 WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, row.id, stage, context.userId ?? null],
  );
  await recordLeadHistory(client, context, row.id, "stage_changed", `Stage: ${leadStageLabel(row.stage)} → ${leadStageLabel(stage)}`, {
    from: row.stage, to: stage, note: String(input.note ?? "").trim().slice(0, 500) || null,
  });
  await queueOutboxEvent(client, context, "crm.lead.stage_changed", "leads", row.id, { source: "manual", before: { status: row.stage }, after: { status: stage } });
  return { changed: true };
}

// Runs one operation per lead; each lead succeeds or fails on its own.
export async function runLeadBulkOperation(client, leadIds, operation) {
  const ids = [...new Set(Array.isArray(leadIds) ? leadIds : [])];
  if (!ids.length) throw new CrmError(400, "Select at least one lead.", "CRM_LEAD_VALIDATION");
  if (ids.length > BULK_LIMIT) throw new CrmError(400, `Select up to ${BULK_LIMIT} leads at a time.`, "CRM_LEAD_BULK_LIMIT");
  const results = [];
  for (const leadId of ids) {
    await client.query("SAVEPOINT lead_bulk_operation");
    try {
      await operation(leadId);
      await client.query("RELEASE SAVEPOINT lead_bulk_operation");
      results.push({ leadId, ok: true });
    } catch (error) {
      await client.query("ROLLBACK TO SAVEPOINT lead_bulk_operation");
      if (!(error instanceof CrmError)) throw error;
      results.push({ leadId, ok: false, message: error.message });
    }
  }
  return { results, succeeded: results.filter((entry) => entry.ok).length, failed: results.filter((entry) => !entry.ok).length };
}

export async function bulkChangeLeadStage(client, context, input = {}) {
  return runLeadBulkOperation(client, input.leadIds, (leadId) => changeLeadStage(client, context, leadId, { stage: input.stage }));
}

// ------------------------------------------------------------------ archive

// Leads are never hard-deleted. Archiving hides a lead from the working
// lists; its history, notes, files and activities stay. A converted lead
// cannot be archived: it is the record behind an account and an opportunity.
export async function archiveLead(client, context, leadId) {
  requireLeadPermission(context, LEAD_PERMISSIONS.delete, "You do not have permission to archive leads.");
  const row = await loadLeadRow(client, context, leadId, { lock: true, includeArchived: true });
  if (row.archived_at) return { changed: false };
  if (row.status === "converted") throw new CrmError(409, "A converted lead cannot be archived.", "CRM_LEAD_CONVERTED");
  await client.query(
    `UPDATE tenant.crm_leads SET archived_at = now(), archived_by = $3, updated_by = $3 WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, row.id, context.userId ?? null],
  );
  await recordLeadHistory(client, context, row.id, "archived", "Lead archived");
  await queueOutboxEvent(client, context, "crm.leads.archived", "leads", row.id, {});
  return { changed: true };
}

export async function restoreLead(client, context, leadId) {
  requireLeadPermission(context, LEAD_PERMISSIONS.delete, "You do not have permission to restore leads.");
  const row = await loadLeadRow(client, context, leadId, { lock: true, includeArchived: true });
  if (!row.archived_at) return { changed: false };
  await client.query(
    `UPDATE tenant.crm_leads SET archived_at = NULL, archived_by = NULL, updated_by = $3 WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, row.id, context.userId ?? null],
  );
  await recordLeadHistory(client, context, row.id, "restored", "Lead restored");
  return { changed: true };
}
