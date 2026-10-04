// The opportunity record: create, read, list, update, archive.
//
// Owner and team change only through assignment.js; stage through stages.js;
// status (won, lost, reopened) through outcome.js. This file never writes
// those columns except to set the starting stage and owner on create.
import { nextDocumentNumber } from "../../../core/platform/numbering/index.js";
import { accountScopeSql } from "../accounts/access.js";
import { recordAccountHistory } from "../accounts/history.js";
import { recordContactHistory } from "../contacts/history.js";
import { assertCrmOwnerAssignable } from "../data-management/crm-access-scope.js";
import { CrmError } from "../data-management/errors.js";
import { queueOutboxEvent } from "../data-management/outbox.js";
import { managedTeamMembersSql } from "../data-management/record-utils.js";
import { assertActiveTeam, assertEligibleLeadAssignee } from "../leads/assignment.js";
import { ensureDefaultSalesPipeline } from "../pipeline/default-pipeline.js";
import { opportunityCan, opportunityCapabilities, opportunityScopeSql, requireOpportunityPermission } from "./access.js";
import { OPPORTUNITY_NUMBER_DOCUMENT_TYPE, OPPORTUNITY_PERMISSIONS, OPPORTUNITY_PRIORITIES, OPPORTUNITY_STALE_DAYS } from "./constants.js";
import { recordOpportunityHistory } from "./history.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_VALUE = 1_000_000_000_000;
const PRIORITY_CODES = OPPORTUNITY_PRIORITIES.map((priority) => priority.code);
const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const text = (value) => String(value ?? "").trim();
const invalid = (message, field) => new CrmError(400, message, "CRM_OPPORTUNITY_VALIDATION", field ? { issues: [{ field, message }] } : {});

export const isUuid = (value) => UUID.test(String(value ?? ""));
export function requireUuid(value, label) {
  if (!isUuid(value)) throw new CrmError(400, `${label} is not valid.`, "CRM_OPPORTUNITY_VALIDATION");
  return String(value);
}

// Open stages only count as "the sales process"; won and lost are outcomes.
const ARCHIVED_SQL = "(opportunity.archived_at IS NOT NULL OR opportunity.status IN ('archived', 'abandoned'))";

export const OPPORTUNITY_SELECT = `
  SELECT opportunity.*, account.display_name AS account_name, account.code AS account_code, account.customer_number AS account_customer_number,
         contact.display_name AS contact_name, contact.email AS contact_email, owner.full_name AS owner_name, team.name AS team_name,
         stage.name AS stage_name, stage.code AS stage_code, stage.sequence AS stage_sequence, stage.probability AS stage_probability,
         stage.is_won AS stage_is_won, stage.is_lost AS stage_is_lost, pipeline.name AS pipeline_name,
         before_close.name AS stage_before_close_name, source.name AS source_name, lead.code AS lead_code,
         reason.name AS lost_reason_name, reason.code AS lost_reason_code,
         creator.full_name AS created_by_name, updater.full_name AS updated_by_name, winner.full_name AS won_by_name, loser.full_name AS lost_by_name,
         follow_up.next_follow_up_at AS pending_follow_up_at,
         -- calendar days, as text: a date has no time zone to shift it
         to_char(opportunity.expected_close_date, 'YYYY-MM-DD') AS expected_close_on, to_char(opportunity.actual_close_date, 'YYYY-MM-DD') AS actual_close_on,
         (opportunity.expected_close_date < current_date) AS past_expected_close,
         COALESCE(products.total, 0) AS products_total, COALESCE(products.lines, 0) AS product_count,
         quotation.id AS latest_quotation_id, quotation.quotation_number AS latest_quotation_number, quotation.lifecycle_status AS latest_quotation_status,
         quotation.grand_total AS latest_quotation_total, quotation.currency_code AS latest_quotation_currency, COALESCE(quotation.total_count, 0) AS quotation_count,
         floor(EXTRACT(epoch FROM now() - opportunity.stage_entered_at) / 86400)::int AS stage_age_days,
         floor(EXTRACT(epoch FROM now() - COALESCE(opportunity.last_activity_at, opportunity.created_at)) / 86400)::int AS days_since_activity
    FROM tenant.crm_opportunities opportunity
    LEFT JOIN tenant.business_parties account ON account.organization_id = opportunity.organization_id AND account.id = opportunity.party_id
    LEFT JOIN tenant.contacts contact ON contact.organization_id = opportunity.organization_id AND contact.id = opportunity.contact_id
    LEFT JOIN public.users owner ON owner.id = opportunity.owner_user_id
    LEFT JOIN public.users creator ON creator.id = opportunity.created_by
    LEFT JOIN public.users updater ON updater.id = opportunity.updated_by
    LEFT JOIN public.users winner ON winner.id = opportunity.won_by
    LEFT JOIN public.users loser ON loser.id = opportunity.lost_by
    LEFT JOIN tenant.crm_sales_teams team ON team.organization_id = opportunity.organization_id AND team.id = opportunity.team_id
    LEFT JOIN tenant.crm_pipeline_stages stage ON stage.organization_id = opportunity.organization_id AND stage.id = opportunity.stage_id
    LEFT JOIN tenant.crm_pipeline_stages before_close ON before_close.organization_id = opportunity.organization_id AND before_close.id = opportunity.stage_before_close_id
    LEFT JOIN tenant.crm_pipelines pipeline ON pipeline.organization_id = opportunity.organization_id AND pipeline.id = opportunity.pipeline_id
    LEFT JOIN tenant.crm_lead_sources source ON source.organization_id = opportunity.organization_id AND source.id = opportunity.source_id
    LEFT JOIN tenant.crm_leads lead ON lead.organization_id = opportunity.organization_id AND lead.id = opportunity.lead_id
    LEFT JOIN tenant.crm_lost_reasons reason ON reason.organization_id = opportunity.organization_id AND reason.id = opportunity.lost_reason_id
    LEFT JOIN LATERAL (
      SELECT min(activity.due_at) AS next_follow_up_at
        FROM tenant.crm_activities activity
       WHERE activity.organization_id = opportunity.organization_id AND activity.entity_type = 'opportunity' AND activity.entity_id = opportunity.id
         AND activity.activity_type = 'follow_up' AND activity.status IN ('planned', 'in_progress', 'overdue')
    ) follow_up ON true
    LEFT JOIN LATERAL (
      SELECT sum(item.line_subtotal) AS total, count(*) AS lines
        FROM tenant.crm_opportunity_items item
       WHERE item.organization_id = opportunity.organization_id AND item.opportunity_id = opportunity.id
    ) products ON true
    LEFT JOIN LATERAL (
      SELECT quote.id, quote.quotation_number, quote.lifecycle_status, version.grand_total, version.currency_code,
             count(*) OVER () AS total_count
        FROM tenant.sales_quotations quote
        LEFT JOIN tenant.sales_quotation_versions version ON version.organization_id = quote.organization_id AND version.id = quote.current_version_id
       WHERE quote.organization_id = opportunity.organization_id AND quote.source_opportunity_id = opportunity.id
       ORDER BY (quote.id = opportunity.primary_quotation_id) DESC, quote.created_at DESC
       LIMIT 1
    ) quotation ON true`;

const number = (value) => (value === null || value === undefined ? null : Number(value));

export function toOpportunity(row) {
  const amount = Number(row.amount ?? 0);
  const probability = Number(row.probability ?? 0);
  const open = row.status === "open" && !row.archived_at;
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    accountId: row.party_id,
    accountName: row.account_name ?? null,
    accountCode: row.account_code ?? null,
    accountIsCustomer: Boolean(row.account_customer_number),
    contactId: row.contact_id,
    contactName: row.contact_name ?? null,
    contactEmail: row.contact_email ?? null,
    ownerUserId: row.owner_user_id,
    ownerName: row.owner_name ?? null,
    teamId: row.team_id,
    teamName: row.team_name ?? null,
    assignedAt: row.assigned_at,
    pipelineId: row.pipeline_id,
    pipelineName: row.pipeline_name ?? null,
    stageId: row.stage_id,
    stageName: row.stage_name ?? null,
    stageCode: row.stage_code ?? null,
    stageSequence: row.stage_sequence ?? null,
    stageEnteredAt: row.stage_entered_at,
    stageAgeDays: row.stage_age_days ?? 0,
    // the stage the deal was in when it was won or lost
    stageBeforeCloseId: row.stage_before_close_id ?? null,
    stageBeforeCloseName: row.stage_before_close_name ?? null,
    status: ["won", "lost"].includes(row.status) ? row.status : "open",
    priority: row.priority,
    productInterest: row.product_interest,
    amount,
    currencyCode: row.currency_code?.trim() ?? null,
    probability,
    probabilityOverridden: row.probability_overridden,
    // estimated value × probability
    weightedValue: Math.round(amount * probability) / 100,
    productsTotal: Number(row.products_total ?? 0),
    productCount: Number(row.product_count ?? 0),
    expectedCloseDate: row.expected_close_on ?? null,
    actualCloseDate: row.actual_close_on ?? null,
    sourceId: row.source_id,
    sourceName: row.source_name ?? null,
    leadId: row.lead_id,
    leadCode: row.lead_code ?? null,
    description: row.description,
    businessProblem: row.business_problem,
    requirements: row.requirements,
    proposedSolution: row.proposed_solution,
    commercialNotes: row.commercial_notes,
    nextStep: row.next_step,
    nextStepDueAt: row.next_step_due_at,
    nextFollowUpAt: row.pending_follow_up_at ?? null,
    lastActivityAt: row.last_activity_at,
    // calculated, never stored as a status
    daysSinceActivity: row.days_since_activity ?? 0,
    isStale: open && (row.days_since_activity ?? 0) >= OPPORTUNITY_STALE_DAYS,
    isOverdue: open && row.past_expected_close === true,
    // the outcome
    wonAmount: number(row.won_amount),
    wonAt: row.won_at,
    wonByName: row.won_by_name ?? null,
    lostAt: row.lost_at,
    lostByName: row.lost_by_name ?? null,
    closedAt: row.closed_at,
    lostReasonId: row.lost_reason_id,
    lostReasonName: row.lost_reason_name ?? null,
    lostReasonCode: row.lost_reason_code ?? null,
    lossNotes: row.loss_notes,
    outcomeNotes: row.outcome_notes,
    competitorName: row.competitor_name,
    winningQuotationId: row.winning_quotation_id,
    primaryQuotationId: row.primary_quotation_id,
    latestQuotationId: row.latest_quotation_id ?? null,
    latestQuotationNumber: row.latest_quotation_number ?? null,
    latestQuotationStatus: row.latest_quotation_status ?? null,
    latestQuotationTotal: number(row.latest_quotation_total),
    latestQuotationCurrency: row.latest_quotation_currency?.trim() ?? null,
    quotationCount: Number(row.quotation_count ?? 0),
    archivedAt: row.archived_at ?? (["archived", "abandoned"].includes(row.status) ? row.updated_at : null),
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
async function loadOpportunityRow(client, context, opportunityId, { lock = false, skipScope = false } = {}) {
  const values = [context.organizationId, requireUuid(opportunityId, "Opportunity")];
  const scope = skipScope ? "" : opportunityScopeSql(context, values, "opportunity");
  const { rows } = await client.query(
    `${OPPORTUNITY_SELECT} WHERE opportunity.organization_id = $1 AND opportunity.id = $2${scope}${lock ? " FOR UPDATE OF opportunity" : ""}`,
    values,
  );
  if (!rows[0]) throw new CrmError(404, "Opportunity not found.", "CRM_OPPORTUNITY_NOT_FOUND");
  return rows[0];
}

// Locks and returns the raw row for the domain operations in this folder.
export async function lockOpportunity(client, context, opportunityId) {
  return loadOpportunityRow(client, context, opportunityId, { lock: true });
}

export async function readOpportunityRow(client, context, opportunityId, options = {}) {
  return loadOpportunityRow(client, context, opportunityId, options);
}

export async function getOpportunity(client, context, opportunityId) {
  requireOpportunityPermission(context, OPPORTUNITY_PERMISSIONS.view, "You do not have permission to view opportunities.");
  return toOpportunity(await loadOpportunityRow(client, context, opportunityId));
}

// Two people changing the same deal at once: the second sees a conflict
// instead of silently overwriting the first.
export function assertNotStale(row, expectedUpdatedAt) {
  if (expectedUpdatedAt && new Date(expectedUpdatedAt).getTime() !== new Date(row.updated_at).getTime())
    throw new CrmError(409, "This opportunity was changed by someone else. Reload it and try again.", "CRM_STALE_WRITE");
}

export function assertOpen(row, action = "changed") {
  if (row.archived_at || ["archived", "abandoned"].includes(row.status))
    throw new CrmError(409, "Restore this opportunity before changing it.", "CRM_OPPORTUNITY_ARCHIVED");
  if (row.status !== "open")
    throw new CrmError(409, `A ${row.status} opportunity cannot be ${action}. Reopen it first.`, "CRM_OPPORTUNITY_CLOSED");
}

// ------------------------------------------------------------------ list

export const OPPORTUNITY_VIEWS = Object.freeze([
  { key: "all", label: "All Opportunities" },
  { key: "mine", label: "My Opportunities" },
  { key: "team", label: "Team Opportunities" },
  { key: "open", label: "Open Opportunities" },
  { key: "closing_this_month", label: "Closing This Month" },
  { key: "overdue", label: "Overdue Opportunities" },
  { key: "won", label: "Won Opportunities" },
  { key: "lost", label: "Lost Opportunities" },
  { key: "recent", label: "Recently Created" },
  { key: "stale", label: "Stale Opportunities" },
  { key: "archived", label: "Archived" },
]);

const SORT_COLUMNS = Object.freeze({
  code: "opportunity.code",
  name: "lower(opportunity.name)",
  accountName: "lower(account.display_name)",
  stage: "stage.sequence",
  status: "opportunity.status",
  amount: "opportunity.amount",
  probability: "opportunity.probability",
  weightedValue: "opportunity.amount * opportunity.probability",
  expectedCloseDate: "opportunity.expected_close_date",
  ownerName: "lower(owner.full_name)",
  priority: "CASE opportunity.priority WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END",
  nextFollowUpAt: "follow_up.next_follow_up_at",
  lastActivityAt: "opportunity.last_activity_at",
  createdAt: "opportunity.created_at",
  updatedAt: "opportunity.updated_at",
});

// The WHERE clause shared by the list, the export, the board and the report,
// so "what I see" and "what I export" can never differ.
export function buildOpportunityListWhere(context, filters = {}, values = []) {
  const bind = (value) => { values.push(value); return `$${values.length}`; };
  const where = [`opportunity.organization_id = ${bind(context.organizationId)}`];
  const view = filters.view || "all";
  where.push(view === "archived" ? ARCHIVED_SQL : `NOT ${ARCHIVED_SQL}`);
  if (view === "mine") where.push(`opportunity.owner_user_id = ${bind(context.userId)}`);
  if (view === "team") {
    const me = bind(context.userId);
    where.push(`(opportunity.owner_user_id = ${me} OR opportunity.owner_user_id IN (${managedTeamMembersSql("opportunity.organization_id", me)}))`);
  }
  if (view === "open" || view === "closing_this_month" || view === "overdue" || view === "stale") where.push("opportunity.status = 'open'");
  if (view === "closing_this_month")
    where.push("opportunity.expected_close_date >= date_trunc('month', current_date) AND opportunity.expected_close_date < date_trunc('month', current_date) + interval '1 month'");
  if (view === "overdue") where.push("opportunity.expected_close_date < current_date");
  if (view === "stale" || filters.stale === "yes")
    where.push(`opportunity.status = 'open' AND COALESCE(opportunity.last_activity_at, opportunity.created_at) < now() - interval '${OPPORTUNITY_STALE_DAYS} days'`);
  if (view === "won" || view === "lost") where.push(`opportunity.status = ${bind(view)}`);
  if (view === "recent") where.push("opportunity.created_at >= now() - interval '14 days'");

  if (["open", "won", "lost"].includes(filters.status)) where.push(`opportunity.status = ${bind(filters.status)}`);
  if (PRIORITY_CODES.includes(filters.priority)) where.push(`opportunity.priority = ${bind(filters.priority)}`);
  for (const [key, column] of Object.entries({
    stageId: "opportunity.stage_id", teamId: "opportunity.team_id", accountId: "opportunity.party_id", contactId: "opportunity.contact_id",
    sourceId: "opportunity.source_id", lostReasonId: "opportunity.lost_reason_id", leadId: "opportunity.lead_id",
  })) if (isUuid(filters[key])) where.push(`${column} = ${bind(filters[key])}`);
  if (filters.ownerId === "unassigned") where.push("opportunity.owner_user_id IS NULL");
  else if (filters.ownerId === "me") where.push(`opportunity.owner_user_id = ${bind(context.userId)}`);
  else if (isUuid(filters.ownerId)) where.push(`opportunity.owner_user_id = ${bind(filters.ownerId)}`);

  const contains = (value) => `%${String(value).trim().toLowerCase().replace(/[\\%_]/g, "\\$&")}%`;
  // What is being sold: the free-text interest, or a product on the deal.
  if (text(filters.product)) {
    const pattern = bind(contains(filters.product));
    where.push(`(lower(COALESCE(opportunity.product_interest, '')) LIKE ${pattern} OR EXISTS (
      SELECT 1 FROM tenant.crm_opportunity_items line JOIN tenant.items item ON item.organization_id = line.organization_id AND item.id = line.item_id
       WHERE line.organization_id = opportunity.organization_id AND line.opportunity_id = opportunity.id
         AND lower(item.name || ' ' || item.code || ' ' || COALESCE(line.description, '')) LIKE ${pattern}))`);
  }
  for (const [key, sql] of Object.entries({
    expectedCloseFrom: "opportunity.expected_close_date >= $::date", expectedCloseTo: "opportunity.expected_close_date <= $::date",
    createdFrom: "opportunity.created_at >= $::date", createdTo: "opportunity.created_at < $::date + interval '1 day'",
    closedFrom: "opportunity.actual_close_date >= $::date", closedTo: "opportunity.actual_close_date <= $::date",
  })) if (DATE.test(String(filters[key] ?? ""))) where.push(sql.replace("$", bind(filters[key])));
  for (const [key, operator] of Object.entries({ valueMin: ">=", valueMax: "<=" })) {
    const amount = Number(filters[key]);
    if (text(filters[key]) && Number.isFinite(amount)) where.push(`opportunity.amount ${operator} ${bind(amount)}`);
  }
  if (Array.isArray(filters.ids) && filters.ids.length) where.push(`opportunity.id = ANY (${bind(filters.ids.filter(isUuid))}::uuid[])`);

  const search = text(filters.search).toLowerCase();
  if (search)
    where.push(`lower(opportunity.code || ' ' || opportunity.name || ' ' || COALESCE(account.display_name, '') || ' ' || COALESCE(contact.display_name, '') || ' ' || COALESCE(opportunity.product_interest, '')) LIKE ${bind(contains(search))}`);
  return `WHERE ${where.join(" AND ")}${opportunityScopeSql(context, values, "opportunity")}`;
}

export async function listOpportunities(client, context, filters = {}) {
  requireOpportunityPermission(context, OPPORTUNITY_PERMISSIONS.view, "You do not have permission to view opportunities.");
  const limit = Math.min(Math.max(Number(filters.limit) || 25, 1), 500);
  const offset = Math.max(Number(filters.offset) || 0, 0);
  const sortColumn = SORT_COLUMNS[filters.sortBy] ?? SORT_COLUMNS.updatedAt;
  const sortDirection = String(filters.sortDirection).toLowerCase() === "asc" ? "ASC" : "DESC";
  const values = [];
  const where = buildOpportunityListWhere(context, filters, values);
  const totals = await client.query(
    `SELECT count(*)::int AS total, COALESCE(sum(counted.amount), 0)::float8 AS value, COALESCE(sum(counted.amount * counted.probability / 100), 0)::float8 AS weighted
       FROM (${OPPORTUNITY_SELECT} ${where}) counted`,
    values,
  );
  const { rows } = await client.query(
    `${OPPORTUNITY_SELECT} ${where} ORDER BY ${sortColumn} ${sortDirection} NULLS LAST, opportunity.id DESC LIMIT ${limit} OFFSET ${offset}`,
    values,
  );
  return {
    opportunities: rows.map(toOpportunity),
    total: totals.rows[0].total,
    totalValue: totals.rows[0].value,
    weightedValue: Math.round(totals.rows[0].weighted * 100) / 100,
    limit,
    offset,
    capabilities: opportunityCapabilities(context),
  };
}

// ------------------------------------------------------------------ validation

// camelCase input field -> [column, maximum length]
const TEXT_FIELDS = Object.freeze({
  name: ["name", 200],
  productInterest: ["product_interest", 2000],
  description: ["description", 10000],
  businessProblem: ["business_problem", 10000],
  requirements: ["requirements", 10000],
  proposedSolution: ["proposed_solution", 10000],
  commercialNotes: ["commercial_notes", 10000],
  nextStep: ["next_step", 300],
});

const GOVERNED = Object.freeze({
  status: "An opportunity is closed with Mark won or Mark lost, and reopened with Reopen.",
  stageId: "Use Change stage to move an opportunity between stages.",
  probability: "Use Set probability to override the stage's probability.",
  ownerUserId: "Use Assign to change the owner or team.",
  teamId: "Use Assign to change the owner or team.",
  code: "The opportunity number is generated automatically.",
  actualCloseDate: "The close date is set by Mark won or Mark lost.",
  lostReasonId: "The lost reason is set by Mark lost.",
  wonAmount: "The final value is set by Mark won.",
});

// Returns only the fields present in `input`, typed. Empty strings become null.
function normalize(input, { creating = false } = {}) {
  const out = {};
  for (const [field, [, maximum]] of Object.entries(TEXT_FIELDS)) {
    if (!has(input, field)) continue;
    out[field] = text(input[field]) || null;
    if (out[field] && out[field].length > maximum) throw invalid(`Must be ${maximum} characters or fewer.`, field);
  }
  if (has(input, "amount")) {
    const amount = input.amount === null || text(input.amount) === "" ? 0 : Number(input.amount);
    if (!Number.isFinite(amount) || amount < 0 || amount > MAX_VALUE) throw invalid("Enter an estimated value of zero or more.", "amount");
    out.amount = amount;
  }
  if (has(input, "currencyCode")) {
    out.currencyCode = text(input.currencyCode).toUpperCase() || null;
    if (out.currencyCode && !/^[A-Z]{3}$/.test(out.currencyCode)) throw invalid("Choose a currency.", "currencyCode");
  }
  if (has(input, "expectedCloseDate")) {
    out.expectedCloseDate = text(input.expectedCloseDate).slice(0, 10) || null;
    if (out.expectedCloseDate && !DATE.test(out.expectedCloseDate)) throw invalid("Enter a valid expected close date.", "expectedCloseDate");
  }
  if (has(input, "nextStepDueAt")) {
    out.nextStepDueAt = input.nextStepDueAt ? new Date(input.nextStepDueAt) : null;
    if (out.nextStepDueAt && Number.isNaN(out.nextStepDueAt.getTime())) throw invalid("Enter a valid date for the next step.", "nextStepDueAt");
  }
  if (has(input, "priority") && text(input.priority)) {
    out.priority = text(input.priority).toLowerCase();
    if (!PRIORITY_CODES.includes(out.priority)) throw invalid("Priority must be low, medium or high.", "priority");
  }
  for (const field of ["sourceId", "contactId"]) if (has(input, field)) out[field] = input[field] ? requireUuid(input[field], field === "sourceId" ? "Source" : "Contact") : null;
  if (creating && !out.name) throw invalid("Enter a name for this opportunity.", "name");
  if (has(out, "name") && !out.name) throw invalid("Enter a name for this opportunity.", "name");
  return out;
}

const COLUMNS = Object.freeze({
  ...Object.fromEntries(Object.entries(TEXT_FIELDS).map(([field, [column]]) => [field, column])),
  amount: "amount", currencyCode: "currency_code", expectedCloseDate: "expected_close_date", nextStepDueAt: "next_step_due_at", priority: "priority",
  sourceId: "source_id", contactId: "contact_id",
});

// Every opportunity belongs to an account the caller can see.
async function requireAccount(client, context, accountId) {
  const values = [context.organizationId, requireUuid(accountId, "Account")];
  const { rows } = await client.query(
    `SELECT account.id, account.display_name, account.owner_user_id, account.currency_code
       FROM tenant.business_parties account
      WHERE account.organization_id = $1 AND account.id = $2 AND account.status = 'active' AND account.party_type <> 'supplier'${accountScopeSql(context, values, "account")}`,
    values,
  );
  if (!rows[0]) throw new CrmError(404, "Choose an active account.", "CRM_OPPORTUNITY_ACCOUNT_INVALID");
  return rows[0];
}

// A contact on a deal is a person at the deal's account.
export async function requireAccountContact(client, context, contactId, accountId) {
  const { rows } = await client.query(
    `SELECT contact.id, contact.display_name FROM tenant.contacts contact
      WHERE contact.organization_id = $1 AND contact.id = $2 AND contact.status <> 'archived'
        AND (contact.party_id = $3 OR EXISTS (SELECT 1 FROM tenant.crm_contact_account_relationships link
              WHERE link.organization_id = contact.organization_id AND link.contact_id = contact.id AND link.party_id = $3 AND link.status = 'active'))`,
    [context.organizationId, requireUuid(contactId, "Contact"), accountId],
  );
  if (!rows[0]) throw new CrmError(409, "Choose a contact who belongs to this opportunity's account.", "CRM_OPPORTUNITY_CONTACT_INVALID");
  return rows[0];
}

async function requireCurrency(client, context, code) {
  const { rows } = await client.query(`SELECT 1 FROM tenant.currencies WHERE organization_id = $1 AND code = $2 AND status = 'active'`, [context.organizationId, code]);
  if (!rows[0]) throw invalid(`${code} is not one of your organization's currencies.`, "currencyCode");
}

async function baseCurrency(client, context) {
  const { rows } = await client.query(`SELECT code FROM tenant.currencies WHERE organization_id = $1 AND status = 'active' ORDER BY is_base DESC, code LIMIT 1`, [context.organizationId]);
  return rows[0]?.code?.trim() ?? null;
}

async function requireSource(client, context, sourceId) {
  if (!sourceId) return;
  const { rows } = await client.query(`SELECT 1 FROM tenant.crm_lead_sources WHERE organization_id = $1 AND id = $2`, [context.organizationId, sourceId]);
  if (!rows[0]) throw invalid("Choose a source from the list.", "sourceId");
}

// The stage a new deal starts in: the one given, or the first open stage of the default pipeline.
async function startingStage(client, context, stageId) {
  await ensureDefaultSalesPipeline(client, context);
  const { rows } = await client.query(
    `SELECT stage.id, stage.pipeline_id, stage.name, stage.probability, stage.forecast_category
       FROM tenant.crm_pipeline_stages stage
       JOIN tenant.crm_pipelines pipeline ON pipeline.organization_id = stage.organization_id AND pipeline.id = stage.pipeline_id AND pipeline.status = 'active'
      WHERE stage.organization_id = $1 AND stage.status = 'active' AND NOT stage.is_won AND NOT stage.is_lost AND ($2::uuid IS NULL OR stage.id = $2)
      ORDER BY pipeline.is_default DESC, stage.sequence LIMIT 1`,
    [context.organizationId, stageId ? requireUuid(stageId, "Sales stage") : null],
  );
  if (!rows[0]) throw new CrmError(409, "Choose an open sales stage.", "CRM_OPPORTUNITY_STAGE_INVALID");
  return rows[0];
}

// ------------------------------------------------------------------ create

// input: the opportunity fields plus accountId (required), contactId, stageId,
//        ownerUserId, teamId, leadId, campaignId.
// options.origin: "manual" | "account" | "lead_conversion" — recorded in history.
// Returns the opportunity; a similar open deal on the same account is a
// warning for the caller to show (findDuplicateOpportunities), never a refusal.
export async function createOpportunity(client, context, input = {}, { origin = "manual", historySummary = null } = {}) {
  requireOpportunityPermission(context, OPPORTUNITY_PERMISSIONS.create, "You do not have permission to create opportunities.");
  for (const [field, message] of Object.entries(GOVERNED))
    if (has(input, field) && !["stageId", "ownerUserId", "teamId"].includes(field)) throw new CrmError(409, message, "CRM_OPPORTUNITY_FIELD_GOVERNED");
  const fields = normalize(input, { creating: true });
  if (!input.accountId) throw invalid("Choose the account this opportunity is for.", "accountId");
  const account = await requireAccount(client, context, input.accountId);
  if (fields.contactId) await requireAccountContact(client, context, fields.contactId, account.id);
  await requireSource(client, context, fields.sourceId);
  fields.currencyCode = fields.currencyCode || account.currency_code?.trim() || (await baseCurrency(client, context));
  if (fields.currencyCode) await requireCurrency(client, context, fields.currencyCode);
  const stage = await startingStage(client, context, input.stageId);

  // Owner: the one given, else the creator. Giving it to someone else is an assignment.
  let ownerUserId = context.userId ?? null;
  if (has(input, "ownerUserId")) {
    ownerUserId = input.ownerUserId || null;
    if (ownerUserId && ownerUserId !== context.userId) {
      requireOpportunityPermission(context, OPPORTUNITY_PERMISSIONS.assign, "You do not have permission to assign opportunities.");
      await assertCrmOwnerAssignable(client, context, ownerUserId, "You can only assign opportunities to yourself or to members of a team you manage.", { resource: "opportunities" });
    }
  }
  if (ownerUserId) await assertEligibleLeadAssignee(client, context, ownerUserId);
  const teamId = input.teamId ? (await assertActiveTeam(client, context, input.teamId)).id : null;

  const code = await nextDocumentNumber(client, { organizationId: context.organizationId }, { documentType: OPPORTUNITY_NUMBER_DOCUMENT_TYPE });
  const present = Object.keys(fields).filter((field) => COLUMNS[field] && fields[field] !== null);
  const columns = ["organization_id", "code", "pipeline_id", "stage_id", "probability", "forecast_category", "party_id", "lead_id", "campaign_id",
    "owner_user_id", "team_id", "assigned_at", "assigned_by", "created_by", "updated_by", ...present.map((field) => COLUMNS[field])];
  const values = [context.organizationId, code, stage.pipeline_id, stage.id, stage.probability, stage.forecast_category, account.id,
    isUuid(input.leadId) ? input.leadId : null, isUuid(input.campaignId) ? input.campaignId : null,
    ownerUserId, teamId, ownerUserId ? new Date() : null, ownerUserId ? context.userId ?? null : null, context.userId ?? null, context.userId ?? null,
    ...present.map((field) => fields[field])];
  const inserted = await client.query(
    `INSERT INTO tenant.crm_opportunities (${columns.join(", ")}) VALUES (${values.map((_value, index) => `$${index + 1}`).join(", ")}) RETURNING id`,
    values,
  );
  const id = inserted.rows[0].id;
  await client.query(
    `INSERT INTO tenant.crm_opportunity_stage_history (organization_id, opportunity_id, from_stage_id, to_stage_id, probability, changed_by, status, changed_at)
     VALUES ($1, $2, NULL, $3, $4, $5, 'open', clock_timestamp())`,
    [context.organizationId, id, stage.id, stage.probability, context.userId ?? null],
  );
  if (fields.contactId)
    await client.query(
      `INSERT INTO tenant.crm_opportunity_contact_roles (organization_id, opportunity_id, contact_id, is_primary, created_by, updated_by)
       VALUES ($1, $2, $3, true, $4, $4) ON CONFLICT (organization_id, opportunity_id, contact_id) DO UPDATE SET is_primary = true, status = 'active'`,
      [context.organizationId, id, fields.contactId, context.userId ?? null],
    );
  if (ownerUserId || teamId)
    await client.query(
      `INSERT INTO tenant.crm_opportunity_assignment_history (organization_id, opportunity_id, new_owner_id, new_team_id, reason, assigned_by)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [context.organizationId, id, ownerUserId, teamId, origin === "lead_conversion" ? "Owner of the converted lead" : "Created", context.userId ?? null],
    );
  await recordOpportunityHistory(client, context, id, "created", historySummary ?? `Opportunity ${code} created`, { origin, stage: stage.name, amount: fields.amount ?? 0 });
  // The account and the contact each show the deal in their own history.
  await recordAccountHistory(client, context, account.id, "opportunity_created", `Opportunity ${code} created: ${fields.name}`, { opportunityId: id });
  if (fields.contactId)
    await recordContactHistory(client, context, fields.contactId, "opportunity_associated", `Primary contact of opportunity ${code} ${fields.name}`, { opportunityId: id });
  await queueOutboxEvent(client, context, "crm.opportunities.created", "opportunities", id, { partyId: account.id, ownerUserId, amount: fields.amount ?? 0 });
  return toOpportunity(await loadOpportunityRow(client, context, id, { skipScope: true }));
}

// ------------------------------------------------------------------ update

// Fields whose changes get their own line in the audit trail.
const AUDITED = Object.freeze({
  amount: ["value_changed", "Estimated value"],
  expectedCloseDate: ["close_date_changed", "Expected close date"],
});
const shown = (value) => (value === null || value === undefined || value === "" ? "not set" : value instanceof Date ? value.toISOString().slice(0, 10) : String(value));

// expectedUpdatedAt (optional): refuses the save when someone else changed
// the opportunity since the caller loaded it.
export async function updateOpportunity(client, context, opportunityId, input = {}, { expectedUpdatedAt = null } = {}) {
  requireOpportunityPermission(context, OPPORTUNITY_PERMISSIONS.edit, "You do not have permission to edit opportunities.");
  for (const [field, message] of Object.entries(GOVERNED)) if (has(input, field)) throw new CrmError(409, message, "CRM_OPPORTUNITY_FIELD_GOVERNED");
  const row = await loadOpportunityRow(client, context, opportunityId, { lock: true });
  assertOpen(row, "edited");
  assertNotStale(row, expectedUpdatedAt ?? input.expectedUpdatedAt);
  const before = toOpportunity(row);
  const fields = normalize(input);

  // The account can change only before anything was quoted against it.
  let accountId = row.party_id;
  if (has(input, "accountId") && input.accountId !== row.party_id) {
    if (Number(row.quotation_count) > 0) throw new CrmError(409, "This opportunity has quotations for its account. Create a new opportunity for another account.", "CRM_OPPORTUNITY_ACCOUNT_LOCKED");
    accountId = (await requireAccount(client, context, input.accountId)).id;
    fields.accountId = accountId;
  }
  if (fields.contactId) await requireAccountContact(client, context, fields.contactId, accountId);
  if (has(fields, "sourceId") && fields.sourceId !== row.source_id) await requireSource(client, context, fields.sourceId);
  if (fields.currencyCode && fields.currencyCode !== before.currencyCode) await requireCurrency(client, context, fields.currencyCode);

  const columns = { ...COLUMNS, accountId: "party_id" };
  const current = { ...before, nextStepDueAt: before.nextStepDueAt ? new Date(before.nextStepDueAt).toISOString() : null };
  const comparable = (field, value) => (value instanceof Date ? value.toISOString() : field === "expectedCloseDate" && value ? String(value).slice(0, 10) : value ?? null);
  const changed = Object.keys(fields).filter((field) => columns[field] && String(comparable(field, fields[field]) ?? "") !== String(current[field] ?? ""));
  if (!changed.length) return before;

  await client.query(
    `UPDATE tenant.crm_opportunities SET ${changed.map((field, index) => `${columns[field]} = $${index + 3}`).join(", ")}, updated_by = $${changed.length + 3}
      WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, row.id, ...changed.map((field) => fields[field]), context.userId ?? null],
  );
  if (changed.includes("contactId")) {
    await client.query(`UPDATE tenant.crm_opportunity_contact_roles SET is_primary = false, updated_by = $3 WHERE organization_id = $1 AND opportunity_id = $2 AND is_primary`,
      [context.organizationId, row.id, context.userId ?? null]);
    if (fields.contactId)
      await client.query(
        `INSERT INTO tenant.crm_opportunity_contact_roles (organization_id, opportunity_id, contact_id, is_primary, created_by, updated_by)
         VALUES ($1, $2, $3, true, $4, $4) ON CONFLICT (organization_id, opportunity_id, contact_id) DO UPDATE SET is_primary = true, status = 'active', updated_by = $4`,
        [context.organizationId, row.id, fields.contactId, context.userId ?? null],
      );
  }
  for (const field of changed.filter((name) => AUDITED[name]))
    await recordOpportunityHistory(client, context, row.id, AUDITED[field][0], `${AUDITED[field][1]}: ${shown(current[field])} → ${shown(comparable(field, fields[field]))}`, {
      field, from: current[field] ?? null, to: comparable(field, fields[field]),
    });
  const others = changed.filter((name) => !AUDITED[name]);
  if (others.length)
    await recordOpportunityHistory(client, context, row.id, "updated", `Updated ${others.length === 1 ? others[0] : `${others.length} fields`}`,
      Object.fromEntries(others.map((field) => [field, { from: current[field] ?? null, to: comparable(field, fields[field]) }])));
  await queueOutboxEvent(client, context, "crm.opportunities.updated", "opportunities", row.id, { changedFields: changed });
  return toOpportunity(await loadOpportunityRow(client, context, row.id));
}

// ------------------------------------------------------------------ archive, restore, delete

// What makes an opportunity part of the record: it can be archived, never deleted.
async function usage(client, context, opportunityId) {
  const { rows } = await client.query(
    `SELECT (SELECT count(*) FROM tenant.sales_quotations WHERE organization_id = $1 AND source_opportunity_id = $2)::int AS quotations,
            (SELECT count(*) FROM tenant.sales_orders WHERE organization_id = $1 AND source_opportunity_id = $2)::int AS orders,
            (SELECT count(*) FROM tenant.crm_activities WHERE organization_id = $1 AND entity_type = 'opportunity' AND entity_id = $2)::int AS activities,
            (SELECT count(*) FROM tenant.crm_notes WHERE organization_id = $1 AND entity_type = 'opportunity' AND entity_id = $2)::int AS notes`,
    [context.organizationId, opportunityId],
  );
  return rows[0];
}

// Hides an opportunity from the working lists; everything on it stays.
export async function archiveOpportunity(client, context, opportunityId) {
  requireOpportunityPermission(context, OPPORTUNITY_PERMISSIONS.delete, "You do not have permission to archive opportunities.");
  const row = await loadOpportunityRow(client, context, opportunityId, { lock: true });
  if (row.archived_at) return { changed: false };
  await client.query(`UPDATE tenant.crm_opportunities SET archived_at = now(), archived_by = $3, updated_by = $3 WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, row.id, context.userId ?? null]);
  await recordOpportunityHistory(client, context, row.id, "archived", "Opportunity archived");
  return { changed: true };
}

export async function restoreOpportunity(client, context, opportunityId) {
  requireOpportunityPermission(context, OPPORTUNITY_PERMISSIONS.delete, "You do not have permission to restore opportunities.");
  const row = await loadOpportunityRow(client, context, opportunityId, { lock: true });
  if (!row.archived_at) return { changed: false };
  await client.query(`UPDATE tenant.crm_opportunities SET archived_at = NULL, archived_by = NULL, updated_by = $3 WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, row.id, context.userId ?? null]);
  await recordOpportunityHistory(client, context, row.id, "restored", "Opportunity restored");
  return { changed: true };
}

// Only an opportunity created by mistake and never used can be deleted:
// still open, with no quotations, orders, activities or notes.
export async function deleteOpportunity(client, context, opportunityId) {
  requireOpportunityPermission(context, OPPORTUNITY_PERMISSIONS.delete, "You do not have permission to delete opportunities.");
  const row = await loadOpportunityRow(client, context, opportunityId, { lock: true });
  const used = await usage(client, context, row.id);
  const reasons = [
    row.status !== "open" && `it is ${row.status}`,
    used.quotations > 0 && "it has quotations",
    used.orders > 0 && "it has sales orders",
    used.activities > 0 && "it has activities",
    used.notes > 0 && "it has notes",
    row.lead_id && "it came from a converted lead",
  ].filter(Boolean);
  if (reasons.length) throw new CrmError(409, `This opportunity cannot be deleted because ${reasons.join(", ")}. Archive it instead.`, "CRM_OPPORTUNITY_IN_USE", { reasons });
  await client.query(`DELETE FROM tenant.crm_opportunities WHERE organization_id = $1 AND id = $2`, [context.organizationId, row.id]);
  await queueOutboxEvent(client, context, "crm.opportunities.deleted", "opportunities", row.id, { code: row.code });
  return { deleted: true };
}

export { opportunityCan };
