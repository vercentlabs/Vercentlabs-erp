// Everything the lead screens need to render their pickers, in one read: the
// fixed vocabulary, the organization's sources, people, teams and
// currencies, and what the caller is allowed to do.
import { listCustomFields } from "../custom-fields/records.js";
import { activityTypeChoices } from "../activity-types/records.js";
import { CRM_MEDIUMS } from "@vercentlabs/shared-types";

import { listCampaignOptions } from "../campaigns/records.js";
import { listTags } from "../tags/records.js";
import { leadCapabilities, requireLeadPermission } from "./access.js";
import { listLeadAssignmentOptions } from "./assignment.js";
import { getLeadAssignmentSettings } from "./assignment-rules.js";
import {
  LEAD_ACTIVITY_TYPES, LEAD_ASSIGNMENT_METHODS, LEAD_AUTHORITY_STATUSES, LEAD_BUDGET_STATUSES, LEAD_DISQUALIFICATION_REASONS, LEAD_NEED_STATUSES,
  LEAD_QUALIFICATION_STATUSES, LEAD_PERMISSIONS, LEAD_PURCHASE_TIMEFRAMES, LEAD_RULE_FIELDS, LEAD_RULE_OPERATORS,
  LEAD_STALE_DAYS, LEAD_STATUSES, leadStaleDaysSql,
} from "./constants.js";
import { QUALIFICATION_CRITERIA } from "./qualification-criteria.js";
import { getLeadQualificationSettings } from "./qualification.js";
import { LEAD_VIEWS } from "./records.js";
import { listLeadSources } from "./sources.js";
import { QUALIFICATION_STAGE, listLeadStages } from "./stages.js";

export async function getLeadOptions(client, context) {
  requireLeadPermission(context, LEAD_PERMISSIONS.view, "You do not have permission to view leads.");
  const { users, teams } = await listLeadAssignmentOptions(client, context);
  const settings = await getLeadAssignmentSettings(client, context);
  const currencies = await client.query(
    `SELECT code, is_base FROM tenant.currencies WHERE organization_id = $1 AND status = 'active' ORDER BY is_base DESC, code`,
    [context.organizationId],
  );
  return {
    views: LEAD_VIEWS,
    stages: await listLeadStages(client, context),
    qualificationStage: QUALIFICATION_STAGE,
    staleDays: (await client.query(`SELECT ${leadStaleDaysSql("$1")} AS days`, [context.organizationId])).rows[0]?.days ?? LEAD_STALE_DAYS,
    statuses: LEAD_STATUSES,
    purchaseTimeframes: LEAD_PURCHASE_TIMEFRAMES,
    disqualificationReasons: LEAD_DISQUALIFICATION_REASONS,
    qualificationStatuses: LEAD_QUALIFICATION_STATUSES,
    needStatuses: LEAD_NEED_STATUSES,
    budgetStatuses: LEAD_BUDGET_STATUSES,
    authorityStatuses: LEAD_AUTHORITY_STATUSES,
    qualificationCriteria: QUALIFICATION_CRITERIA.map(({ key, label }) => ({ key, label })),
    qualificationRequirements: await getLeadQualificationSettings(client, context),
    activityTypes: LEAD_ACTIVITY_TYPES,
    // One type list everywhere (CRM plan 5.2): the organization's activity types; followUpTypes keeps their codes.
    followUpTypeOptions: await activityTypeChoices(client, context),
    // the organization's custom fields on leads (CRM plan 5.3)
    customFields: await listCustomFields(client, context, "lead"),
    followUpTypes: (await activityTypeChoices(client, context)).map((type) => type.code),
    assignmentMethods: LEAD_ASSIGNMENT_METHODS,
    ruleFields: LEAD_RULE_FIELDS.map(({ code, label, kind }) => ({ code, label, kind })),
    ruleOperators: LEAD_RULE_OPERATORS,
    assignment: { allowSelfAssignment: settings.allowSelfAssignment, manualCreationMode: settings.manualCreationMode },
    sources: await listLeadSources(client, context),
    // Where it came from, and its labels (CRM plan 3.4).
    campaigns: await listCampaignOptions(client, context),
    mediums: CRM_MEDIUMS.map(({ code, label }) => ({ code, label })),
    tags: await listTags(client, context),
    users,
    teams,
    currencies: currencies.rows.map((row) => String(row.code).trim()),
    baseCurrency: String(currencies.rows.find((row) => row.is_base)?.code ?? currencies.rows[0]?.code ?? "INR").trim(),
    currentUserId: context.userId,
    capabilities: leadCapabilities(context),
  };
}
