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
import { applyLeadAssignment } from "./assignment.js";
import { evaluateLeadAssignment, fallbackLeadAssignment, getLeadAssignmentSettings } from "./assignment-rules.js";
import { LEAD_NUMBER_DOCUMENT_TYPE, LEAD_PERMISSIONS, LEAD_STALE_DAYS } from "./constants.js";
import { recordDuplicateOverride } from "../duplicates/policy.js";
import { assertNoBlockingLeadDuplicate } from "./duplicates.js";
import { leadQualificationScore, leadQualificationStatus, suggestedLeadRating } from "./qualification-criteria.js";
import { recordLeadHistory } from "./history.js";
import { assertActiveLeadSource } from "./sources.js";
import { applyLeadStage, ensureDefaultLeadStages, recordLeadStageEntry, requireStageChangePermission } from "./stages.js";
import { LEAD_WRITABLE_COLUMNS, assertValidLead, isUuid, normalizeLeadInput, requireUuid } from "./validation.js";

const DUPLICATE_IDENTITY_FIELDS = ["email", "phone", "mobile", "firstName", "lastName", "companyName"];
const BULK_LIMIT = 200;
const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

// The next pending follow-up comes from the follow-up activities themselves,
// so it can never drift from what the Follow-ups screen shows.
export const LEAD_SELECT = `
  SELECT lead.*, source.name AS source_name, owner.full_name AS owner_name, team.name AS team_name,
         creator.full_name AS created_by_name, updater.full_name AS updated_by_name,
         assigner.full_name AS assigned_by_name, assignment_rule.name AS assignment_rule_name,
         qualifier.full_name AS qualified_by_name, disqualifier.full_name AS disqualified_by_name,
         qualification.need_status AS q_need_status, qualification.need_description AS q_need_description,
         qualification.budget_status AS q_budget_status, qualification.budget_min AS q_budget_min, qualification.budget_max AS q_budget_max,
         qualification.authority_status AS q_authority_status, qualification.authority_detail AS q_authority_detail,
         qualification.notes AS q_notes, qualification.started_at AS q_started_at, qualification.override_reason AS q_override_reason,
         stage_def.name AS stage_name, stage_def.sequence AS stage_sequence,
         floor(EXTRACT(epoch FROM now() - lead.stage_changed_at) / 86400)::int AS stage_age_days,
         floor(EXTRACT(epoch FROM now() - COALESCE(lead.last_activity_at, lead.created_at)) / 86400)::int AS days_since_activity,
         converter.full_name AS converted_by_name, converted_account.display_name AS converted_account_name,
         converted_contact.display_name AS converted_contact_name, converted_opportunity.name AS converted_opportunity_name,
         converted_opportunity.code AS converted_opportunity_code, converted_opportunity.amount AS converted_opportunity_amount,
         lead.merged_into_lead_id AS merged_into_id, merged_lead.code AS merged_into_code,
         COALESCE(merged_lead.full_name, merged_lead.company_name) AS merged_into_name,
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
    LEFT JOIN public.users assigner ON assigner.id = lead.assigned_by
    LEFT JOIN tenant.crm_lead_stages stage_def ON stage_def.organization_id = lead.organization_id AND stage_def.code = lead.stage
    LEFT JOIN public.users converter ON converter.id = lead.converted_by
    LEFT JOIN tenant.business_parties converted_account ON converted_account.organization_id = lead.organization_id AND converted_account.id = lead.converted_party_id
    LEFT JOIN tenant.contacts converted_contact ON converted_contact.organization_id = lead.organization_id AND converted_contact.id = lead.converted_contact_id
    LEFT JOIN tenant.crm_opportunities converted_opportunity ON converted_opportunity.organization_id = lead.organization_id AND converted_opportunity.id = lead.converted_opportunity_id
    LEFT JOIN tenant.crm_leads merged_lead ON merged_lead.organization_id = lead.organization_id AND merged_lead.id = lead.merged_into_lead_id
    LEFT JOIN public.users qualifier ON qualifier.id = lead.qualified_by
    LEFT JOIN public.users disqualifier ON disqualifier.id = lead.disqualified_by
    LEFT JOIN tenant.crm_lead_qualifications qualification ON qualification.organization_id = lead.organization_id AND qualification.lead_id = lead.id
    LEFT JOIN tenant.crm_lead_assignment_rules assignment_rule ON assignment_rule.organization_id = lead.organization_id AND assignment_rule.id = lead.assignment_rule_id
    LEFT JOIN tenant.crm_sales_teams team ON team.organization_id = lead.organization_id AND team.id = lead.team_id
    LEFT JOIN LATERAL (
      SELECT min(activity.due_at) AS next_follow_up_at
        FROM tenant.crm_activities activity
       WHERE activity.organization_id = lead.organization_id AND activity.entity_type = 'lead' AND activity.entity_id = lead.id
         AND activity.activity_type = 'follow_up' AND activity.status IN ('planned', 'in_progress', 'overdue')
    ) follow_up ON true`;

const numberOrNull = (value) => (value === null || value === undefined ? null : Number(value));

export function toLead(row) {
  const qualificationScore = leadQualificationScore(row);
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
    assignedBy: row.assigned_by ?? null,
    assignedByName: row.assigned_by_name ?? null,
    assignmentMethod: row.assignment_method ?? null,
    assignmentRuleId: row.assignment_rule_id ?? null,
    assignmentRuleName: row.assignment_rule_name ?? null,
    firstActivityAt: row.first_activity_at ?? null,
    stage: row.stage,
    stageName: row.stage_name ?? row.stage,
    stageChangedAt: row.stage_changed_at,
    // calculated, never stored: how long in this stage, and whether it has gone quiet
    stageAgeDays: row.stage_age_days ?? 0,
    daysSinceActivity: row.days_since_activity ?? 0,
    isStale: row.status === "open" && !row.archived_at && (row.days_since_activity ?? 0) >= LEAD_STALE_DAYS,
    status: row.status,
    // qualification: the answers, and what they add up to
    qualificationStatus: leadQualificationStatus(row),
    qualificationStartedAt: row.q_started_at ?? null,
    needStatus: row.q_need_status ?? "unknown",
    businessNeed: row.q_need_description ?? null,
    budgetStatus: row.q_budget_status ?? "unknown",
    budgetMin: numberOrNull(row.q_budget_min),
    budgetMax: numberOrNull(row.q_budget_max),
    authorityStatus: row.q_authority_status ?? "unknown",
    authorityDetail: row.q_authority_detail ?? null,
    qualificationNotes: row.q_notes ?? null,
    qualificationScore,
    suggestedRating: suggestedLeadRating(qualificationScore),
    qualificationOverrideReason: row.q_override_reason ?? null,
    qualifiedAt: row.qualified_at,
    qualifiedBy: row.qualified_by ?? null,
    qualifiedByName: row.qualified_by_name ?? null,
    disqualificationReason: row.disqualification_reason,
    disqualificationNotes: row.disqualification_notes,
    disqualifiedAt: row.disqualified_at,
    disqualifiedByName: row.disqualified_by_name ?? null,
    convertedAt: row.converted_at,
    convertedBy: row.converted_by,
    convertedByName: row.converted_by_name ?? null,
    convertedAccountName: row.converted_account_name ?? null,
    convertedContactName: row.converted_contact_name ?? null,
    convertedOpportunityName: row.converted_opportunity_name ?? null,
    convertedOpportunityCode: row.converted_opportunity_code ?? null,
    convertedOpportunityAmount: numberOrNull(row.converted_opportunity_amount),
    convertedPartyId: row.converted_party_id,
    convertedContactId: row.converted_contact_id,
    convertedOpportunityId: row.converted_opportunity_id,
    lastActivityAt: row.last_activity_at,
    nextFollowUpAt: row.pending_follow_up_at ?? null,
    archivedAt: row.archived_at,
    // set when this lead was merged into another: the lead that carries on
    mergedIntoLeadId: row.merged_into_id ?? null,
    mergedIntoLeadCode: row.merged_into_code ?? null,
    mergedIntoLeadName: row.merged_into_name ?? null,
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

// The raw row (the lead with its qualification answers) without locking it.
export async function readLeadRow(client, context, leadId) {
  return loadLeadRow(client, context, leadId, { includeArchived: true });
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
  { key: "no_activity", label: "Assigned, No Activity" },
  { key: "new", label: "New Leads" },
  { key: "follow_up", label: "Requiring Follow-up" },
  { key: "due_today", label: "Follow-ups Due Today" },
  { key: "overdue", label: "Overdue Follow-ups" },
  { key: "no_follow_up", label: "No Follow-up Scheduled" },
  { key: "qualified", label: "Qualified Leads" },
  { key: "disqualified", label: "Disqualified Leads" },
  { key: "converted", label: "Converted Leads" },
  { key: "archived", label: "Archived" },
]);

const SORT_COLUMNS = Object.freeze({
  code: "lead.code",
  name: "lower(COALESCE(lead.full_name, lead.company_name))",
  companyName: "lower(lead.company_name)",
  stage: "stage_def.sequence",
  stageChangedAt: "lead.stage_changed_at",
  status: "lead.status",
  priority: "CASE lead.priority WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END",
  rating: "CASE lead.rating WHEN 'hot' THEN 3 WHEN 'warm' THEN 2 ELSE 1 END",
  estimatedValue: "lead.estimated_value",
  ownerName: "lower(owner.full_name)",
  sourceName: "lower(source.name)",
  nextFollowUpAt: "follow_up.next_follow_up_at",
  lastActivityAt: "lead.last_activity_at",
  assignedAt: "lead.assigned_at",
  teamName: "lower(team.name)",
  createdAt: "lead.created_at",
  updatedAt: "lead.updated_at",
});

// The derived qualification status as SQL over the LEAD_SELECT aliases.
export const QUALIFICATION_STATUS_SQL = Object.freeze({
  not_started: "(lead.status = 'open' AND qualification.lead_id IS NULL)",
  in_progress: "(lead.status = 'open' AND qualification.lead_id IS NOT NULL)",
  qualified: "lead.status IN ('qualified', 'converted')",
  disqualified: "lead.status = 'disqualified'",
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
  // Has an owner, but nobody has logged a call, email or meeting yet.
  if (view === "no_activity") where.push("lead.owner_user_id IS NOT NULL AND lead.status = 'open' AND lead.first_activity_at IS NULL");
  if (view === "new") where.push("lead.stage = 'new' AND lead.status = 'open'");
  if (view === "follow_up") where.push("follow_up.next_follow_up_at IS NOT NULL");
  if (view === "due_today") where.push("follow_up.next_follow_up_at >= current_date AND follow_up.next_follow_up_at < current_date + interval '1 day'");
  if (view === "overdue") where.push("follow_up.next_follow_up_at < now()");
  if (view === "no_follow_up") where.push("lead.status = 'open' AND follow_up.next_follow_up_at IS NULL");
  if (["qualified", "disqualified", "converted"].includes(view)) where.push(`lead.status = ${bind(view)}`);
  const qualification = QUALIFICATION_STATUS_SQL[filters.qualificationStatus];
  if (qualification) where.push(qualification);
  if (filters.disqualificationReason) where.push(`lead.disqualification_reason = ${bind(String(filters.disqualificationReason))}`);

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
  // The unassigned queue is worked by geography, product and age.
  const contains = (value) => `%${String(value).trim().toLowerCase().replace(/[\\%_]/g, "\\$&")}%`;
  if (/^[A-Za-z]{2}$/.test(String(filters.countryCode ?? ""))) where.push(`lead.country_code = ${bind(String(filters.countryCode).toUpperCase())}`);
  for (const [key, column] of Object.entries({ state: "lead.state", city: "lead.city", productInterest: "lead.product_interest" }))
    if (String(filters[key] ?? "").trim()) where.push(`lower(COALESCE(${column}, '')) LIKE ${bind(contains(filters[key]))}`);
  const olderThanDays = Number(filters.olderThanDays);
  if (Number.isInteger(olderThanDays) && olderThanDays > 0 && olderThanDays <= 3650) where.push(`lead.created_at < now() - make_interval(days => ${bind(olderThanDays)}::int)`);
  if (filters.stale === "yes" || filters.stale === true)
    where.push(`lead.status = 'open' AND COALESCE(lead.last_activity_at, lead.created_at) < now() - interval '${LEAD_STALE_DAYS} days'`);
  if (filters.stageEnteredFrom) where.push(`lead.stage_changed_at >= ${bind(filters.stageEnteredFrom)}::date`);
  if (filters.stageEnteredTo) where.push(`lead.stage_changed_at < ${bind(filters.stageEnteredTo)}::date + interval '1 day'`);
  if (filters.assignedFrom) where.push(`lead.assigned_at >= ${bind(filters.assignedFrom)}::date`);
  if (filters.assignedTo) where.push(`lead.assigned_at < ${bind(filters.assignedTo)}::date + interval '1 day'`);
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

// The owner a new lead starts with. An explicit owner or team wins. Otherwise
// `routing` decides:
//   "auto"      typed in by hand: the organization's setting (creator, or the
//               rules); imported or captured: the rules
//   "rules"     the rules, then the fallback
//   "fallback"  skip the rules, straight to the fallback (an import row whose
//               owner could not be used)
//   "none"      leave it unassigned
async function initialLeadAssignment(client, context, input, normalized, { origin, routing }) {
  const explicitMethod = origin === "manual" ? "manual" : origin;
  if (input.ownerUserId || input.teamId) {
    if (input.ownerUserId && input.ownerUserId !== context.userId) {
      requireLeadPermission(context, LEAD_PERMISSIONS.assign, "You do not have permission to assign leads.");
      if (!leadCan(context, LEAD_PERMISSIONS.assignAcrossTeams))
        await assertCrmOwnerAssignable(client, context, input.ownerUserId, "You can only assign leads to yourself or to members of a team you manage.", { resource: "leads" });
    }
    return { ownerUserId: input.ownerUserId || null, teamId: input.teamId || null, method: explicitMethod, rule: null };
  }
  if (routing === "none") return { ownerUserId: null, teamId: null, method: null, rule: null };
  if (routing === "fallback") return fallbackLeadAssignment(client, context);
  if (routing === "auto" && origin === "manual" && (await getLeadAssignmentSettings(client, context)).manualCreationMode === "creator")
    return { ownerUserId: context.userId, teamId: null, method: "creator", rule: null };
  return evaluateLeadAssignment(client, context, normalized);
}

// options:
//   allowDuplicate  the caller confirmed a blocking duplicate is a different record
//   origin          "manual" | "import" | "integration": recorded in history and as the assignment method
//   routing         see initialLeadAssignment
//   assignmentReason  recorded in the assignment history
//   duplicateReason   why a strong duplicate is saved anyway (with allowDuplicate; needs crm.duplicates.override)
//   onDuplicateCheck  receives what the duplicate check found (imports count possible duplicates)
export async function createLead(client, context, input = {}, {
  allowDuplicate = false, duplicateReason = null, onDuplicateCheck = null, origin = "manual", routing = "auto", assignmentReason = null,
} = {}) {
  requireLeadPermission(context, LEAD_PERMISSIONS.create, "You do not have permission to create leads.");
  const normalized = normalizeLeadInput(input);
  assertValidLead(normalized);
  await assertActiveLeadSource(client, context, normalized.sourceId);
  const duplicates = await assertNoBlockingLeadDuplicate(client, context, normalized, { allowDuplicate, reason: duplicateReason ?? input.duplicateReason });
  onDuplicateCheck?.(duplicates);
  const assignment = await initialLeadAssignment(client, context, input, normalized, { origin, routing });

  await ensureDefaultLeadStages(client, context);
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
  await recordDuplicateOverride(client, context, "lead", lead.id, duplicates);
  await recordLeadStageEntry(client, context, lead.id, { to: lead.stage });
  if (assignment.method)
    await applyLeadAssignment(client, context, lead, { ownerUserId: assignment.ownerUserId, teamId: assignment.teamId }, {
      method: assignment.method, rule: assignment.rule, reason: assignmentReason,
    });
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
    await recordDuplicateOverride(client, context, "lead", row.id,
      await assertNoBlockingLeadDuplicate(client, context, { ...before, ...normalized }, { excludeLeadId: row.id, allowDuplicate, reason: input.duplicateReason }));

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

// Stage moves freely, forwards or backwards, between the organization's
// stages while the lead is open. A qualified, disqualified or converted lead
// keeps the stage it ended in. input: { stage: code, note? }
export async function changeLeadStage(client, context, leadId, input = {}) {
  requireStageChangePermission(context);
  const stage = String(input.stage ?? "").trim();
  if (!stage) throw new CrmError(400, "Choose a stage.", "CRM_LEAD_STAGE_INVALID");
  const row = await loadLeadRow(client, context, leadId, { lock: true });
  const changed = await applyLeadStage(client, context, row, stage, { note: input.note });
  if (changed) await queueOutboxEvent(client, context, "crm.lead.stage_changed", "leads", row.id, { source: "manual", before: { status: row.stage }, after: { status: stage } });
  return { changed };
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
