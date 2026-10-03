// Everything the lead screens need to render their pickers, in one read: the
// fixed vocabulary, the organization's sources, people, teams, tags and
// currencies, and what the caller is allowed to do.
import { leadCapabilities, requireLeadPermission } from "./access.js";
import { listLeadAssignmentOptions } from "./assignment.js";
import { getLeadAssignmentSettings } from "./assignment-rules.js";
import {
  LEAD_ACTIVITY_TYPES, LEAD_ASSIGNMENT_METHODS, LEAD_AUTHORITY_STATUSES, LEAD_BUDGET_STATUSES, LEAD_DISQUALIFICATION_REASONS, LEAD_NEED_STATUSES,
  LEAD_QUALIFICATION_STATUSES, LEAD_FOLLOW_UP_TYPES, LEAD_PERMISSIONS, LEAD_PURCHASE_TIMEFRAMES, LEAD_RULE_FIELDS, LEAD_RULE_OPERATORS,
  LEAD_STAGES, LEAD_STATUSES,
} from "./constants.js";
import { QUALIFICATION_CRITERIA } from "./qualification-criteria.js";
import { getLeadQualificationSettings } from "./qualification.js";
import { LEAD_VIEWS } from "./records.js";
import { listLeadSources } from "./sources.js";

export async function getLeadOptions(client, context) {
  requireLeadPermission(context, LEAD_PERMISSIONS.view, "You do not have permission to view leads.");
  const { users, teams } = await listLeadAssignmentOptions(client, context);
  const tags = await client.query(
    `SELECT id, name, color FROM tenant.crm_tags WHERE organization_id = $1 AND status = 'active' ORDER BY name`,
    [context.organizationId],
  );
  const settings = await getLeadAssignmentSettings(client, context);
  const currencies = await client.query(
    `SELECT code, is_base FROM tenant.currencies WHERE organization_id = $1 AND status = 'active' ORDER BY is_base DESC, code`,
    [context.organizationId],
  );
  return {
    views: LEAD_VIEWS,
    stages: LEAD_STAGES,
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
    followUpTypes: LEAD_FOLLOW_UP_TYPES,
    assignmentMethods: LEAD_ASSIGNMENT_METHODS,
    ruleFields: LEAD_RULE_FIELDS.map(({ code, label, kind }) => ({ code, label, kind })),
    ruleOperators: LEAD_RULE_OPERATORS,
    assignment: { allowSelfAssignment: settings.allowSelfAssignment, manualCreationMode: settings.manualCreationMode },
    sources: await listLeadSources(client, context),
    users,
    teams,
    tags: tags.rows,
    currencies: currencies.rows.map((row) => String(row.code).trim()),
    baseCurrency: String(currencies.rows.find((row) => row.is_base)?.code ?? currencies.rows[0]?.code ?? "INR").trim(),
    currentUserId: context.userId,
    capabilities: leadCapabilities(context),
  };
}
