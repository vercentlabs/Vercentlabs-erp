// Everything the Convert dialog shows, in one read: the lead summary, the
// conversion checks, matching accounts and contacts (with their differences
// from the lead), open deals already on the account, the lead's open work and
// the suggested values for the new opportunity. Nothing is written.
import { ensureDefaultSalesPipeline } from "../sales-stages/defaults.js";
import { getLeadQualificationSettings } from "../leads/qualification.js";
import { readLeadRow } from "../leads/records.js";
import { isUuid } from "../leads/validation.js";
import { conversionCapabilities, requireConversionPermission } from "./access.js";
import { CONVERSION_PERMISSIONS } from "./constants.js";
import { accountDifferences, accountMatches, contactConflicts, contactMatches, opportunityMatches } from "./matching.js";
import { blockedReason, conversionChecks, missingQualification, qualificationSummary } from "./readiness.js";
import { readConversionByLead, toConversion } from "./records.js";

const text = (value) => String(value ?? "").trim();
const TIMEFRAME_DAYS = Object.freeze({ immediate: 14, within_1_month: 30, within_3_months: 90, within_6_months: 180, within_12_months: 365 });

export function defaultOpportunityName(accountName, productInterest) {
  return `${text(accountName) || "New account"} — ${text(productInterest).slice(0, 80) || "New opportunity"}`.slice(0, 200);
}

// The purchase timeframe, as a suggested close date.
function suggestedCloseDate(timeframe) {
  const days = TIMEFRAME_DAYS[timeframe];
  if (!days) return null;
  const date = new Date(Date.now() + days * 86400000);
  return date.toISOString().slice(0, 10);
}

export function leadSummary(lead, requirements) {
  return {
    id: lead.id,
    code: lead.code,
    name: lead.full_name ?? null,
    firstName: lead.first_name ?? null,
    lastName: lead.last_name ?? null,
    company: lead.company_name ?? null,
    jobTitle: lead.job_title ?? null,
    email: lead.email ?? null,
    phone: lead.phone ?? null,
    mobile: lead.mobile ?? null,
    website: lead.website ?? null,
    city: lead.city ?? null,
    industry: lead.industry ?? null,
    ownerUserId: lead.owner_user_id ?? null,
    ownerName: lead.owner_name ?? null,
    teamId: lead.team_id ?? null,
    teamName: lead.team_name ?? null,
    sourceId: lead.source_id ?? null,
    sourceName: lead.source_name ?? null,
    productInterest: lead.product_interest ?? null,
    estimatedValue: lead.estimated_value === null || lead.estimated_value === undefined ? null : Number(lead.estimated_value),
    currencyCode: lead.currency_code?.trim() || null,
    rating: lead.rating ?? null,
    priority: lead.priority ?? null,
    status: lead.status,
    description: lead.description ?? null,
    createdAt: lead.created_at,
    qualifiedAt: lead.qualified_at ?? null,
    qualifiedByName: lead.qualified_by_name ?? null,
    qualification: qualificationSummary(lead, requirements),
  };
}

// options.accountId: the account chosen in the dialog, so its contacts and deals are matched.
export async function previewLeadConversion(client, context, leadId, options = {}) {
  requireConversionPermission(context, CONVERSION_PERMISSIONS.convert, "You do not have permission to convert leads.");
  const lead = await readLeadRow(client, context, leadId);
  const requirements = await getLeadQualificationSettings(client, context);
  const capabilities = conversionCapabilities(context);
  const blocked = blockedReason(lead);
  const summary = leadSummary(lead, requirements);
  if (lead.status === "converted") {
    const conversion = await readConversionByLead(client, context, lead.id);
    return { lead: summary, blocked, conversion: conversion ? toConversion(conversion) : null, capabilities };
  }

  const checks = conversionChecks(lead, requirements);
  const missing = missingQualification(checks);

  const accounts = await accountMatches(client, context, { displayName: lead.company_name, website: lead.website, email: lead.email, phone: lead.phone, city: lead.city });
  const visibleAccounts = accounts.filter((match) => match.canOpen);
  if (visibleAccounts.length) {
    const { rows } = await client.query(
      `SELECT id, display_name, website, industry FROM tenant.business_parties WHERE organization_id = $1 AND id = ANY ($2::uuid[])`,
      [context.organizationId, visibleAccounts.map((match) => match.id)],
    );
    const byId = new Map(rows.map((row) => [row.id, row]));
    for (const match of visibleAccounts) match.differences = byId.has(match.id) ? accountDifferences(lead, byId.get(match.id)) : [];
  }
  const chosenAccountId = isUuid(options.accountId) ? options.accountId : visibleAccounts.find((match) => match.strength === "exact")?.id ?? null;
  const chosenAccount = visibleAccounts.find((match) => match.id === chosenAccountId) ?? null;

  const contacts = text(lead.full_name) || lead.email || lead.mobile || lead.phone
    ? await contactMatches(client, context, { firstName: lead.first_name || lead.last_name, lastName: lead.first_name ? lead.last_name : null, email: lead.email, mobile: lead.mobile, phone: lead.phone }, chosenAccountId)
    : [];
  const visibleContacts = contacts.filter((match) => match.canOpen);
  if (visibleContacts.length) {
    const { rows } = await client.query(
      `SELECT id, email, mobile, phone, designation FROM tenant.contacts WHERE organization_id = $1 AND id = ANY ($2::uuid[])`,
      [context.organizationId, visibleContacts.map((match) => match.id)],
    );
    const byId = new Map(rows.map((row) => [row.id, row]));
    for (const match of visibleContacts) match.conflicts = byId.has(match.id) ? contactConflicts(lead, byId.get(match.id)) : [];
  }
  // The person the lead names, already at the chosen account: suggested for reuse.
  const suggestedContact = visibleContacts.find((match) => match.strength === "exact" && (!chosenAccountId || match.accountId === chosenAccountId))
    ?? visibleContacts.find((match) => match.strength === "exact") ?? null;

  const accountName = chosenAccount?.name ?? lead.company_name ?? lead.full_name;
  const opportunityName = defaultOpportunityName(accountName, lead.product_interest);
  // Open deals on the chosen account, or on any matching account while none is chosen.
  const deals = await opportunityMatches(client, context, chosenAccountId ? [chosenAccountId] : visibleAccounts.map((match) => match.id), { name: opportunityName, productInterest: lead.product_interest });

  await ensureDefaultSalesPipeline(client, context);
  const stages = await client.query(
    `SELECT stage.id, stage.name, stage.probability, pipeline.name AS pipeline_name, pipeline.is_default
       FROM tenant.crm_pipelines pipeline
       JOIN tenant.crm_pipeline_stages stage ON stage.organization_id = pipeline.organization_id AND stage.pipeline_id = pipeline.id
      WHERE pipeline.organization_id = $1 AND pipeline.status = 'active' AND stage.status = 'active' AND NOT stage.is_won AND NOT stage.is_lost
      ORDER BY pipeline.is_default DESC, pipeline.name, stage.sequence`,
    [context.organizationId],
  );
  const openWork = await client.query(
    `SELECT count(*) FILTER (WHERE activity_type = 'task')::int AS tasks, count(*) FILTER (WHERE activity_type = 'follow_up')::int AS follow_ups
       FROM tenant.crm_activities
      WHERE organization_id = $1 AND entity_type = 'lead' AND entity_id = $2 AND activity_type IN ('task', 'follow_up') AND status IN ('planned', 'in_progress', 'overdue')`,
    [context.organizationId, lead.id],
  );

  return {
    lead: summary,
    blocked,
    conversion: null,
    capabilities,
    checks,
    missing,
    requiresOverride: missing.length > 0,
    canConvert: !blocked && capabilities.convert && (missing.length === 0 || capabilities.overrideQualification),
    accountMatches: accounts,
    contactMatches: contacts,
    opportunityMatches: deals,
    stages: stages.rows.map((row) => ({ id: row.id, name: row.name, probability: Number(row.probability ?? 0), pipelineName: row.pipeline_name })),
    openWork: { tasks: openWork.rows[0].tasks, followUps: openWork.rows[0].follow_ups },
    defaults: {
      account: chosenAccount
        ? { mode: "existing", id: chosenAccount.id }
        : { mode: "new", name: lead.company_name ?? "", website: lead.website ?? "", industry: lead.industry ?? "", ownerUserId: lead.owner_user_id ?? context.userId },
      contact: suggestedContact
        ? { mode: "existing", id: suggestedContact.id }
        : { mode: "new", firstName: lead.first_name ?? "", lastName: lead.last_name ?? "", email: lead.email ?? "", mobile: lead.mobile ?? "", phone: lead.phone ?? "", jobTitle: lead.job_title ?? "", ownerUserId: lead.owner_user_id ?? context.userId },
      opportunity: {
        name: opportunityName,
        ownerUserId: lead.owner_user_id ?? context.userId,
        teamId: lead.team_id ?? null,
        stageId: stages.rows[0]?.id ?? null,
        amount: summary.estimatedValue,
        currencyCode: summary.currencyCode,
        expectedCloseDate: suggestedCloseDate(lead.purchase_timeframe),
        productInterest: lead.product_interest ?? "",
        description: lead.description ?? "",
        priority: lead.priority ?? "medium",
      },
      openWork: "move",
    },
  };
}
