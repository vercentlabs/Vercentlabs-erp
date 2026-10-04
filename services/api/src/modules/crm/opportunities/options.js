// Everything the opportunity screens need to render their pickers, in one
// read: the fixed vocabulary, the organization's stages, lost reasons,
// sources, people, teams and currencies, and what the caller may do.
import { listLeadAssignmentOptions } from "../leads/assignment.js";
import { listLeadSources } from "../leads/sources.js";
import { ensureDefaultSalesPipeline } from "../pipeline/default-pipeline.js";
import { opportunityCapabilities, requireOpportunityPermission } from "./access.js";
import {
  OPPORTUNITY_ACTIVITY_TYPES, OPPORTUNITY_CONTACT_ROLES, OPPORTUNITY_FOLLOW_UP_TYPES, OPPORTUNITY_PERMISSIONS, OPPORTUNITY_PRIORITIES, OPPORTUNITY_STALE_DAYS,
  OPPORTUNITY_STATUSES,
} from "./constants.js";
import { listOpportunityLostReasons } from "./outcome.js";
import { OPPORTUNITY_VIEWS } from "./records.js";
import { listOpportunityStages } from "./stages.js";

export async function getOpportunityOptions(client, context) {
  requireOpportunityPermission(context, OPPORTUNITY_PERMISSIONS.view, "You do not have permission to view opportunities.");
  await ensureDefaultSalesPipeline(client, context);
  const { users, teams } = await listLeadAssignmentOptions(client, context);
  const stages = await listOpportunityStages(client, context);
  const currencies = await client.query(
    `SELECT code, is_base FROM tenant.currencies WHERE organization_id = $1 AND status = 'active' ORDER BY is_base DESC, code`,
    [context.organizationId],
  );
  return {
    views: OPPORTUNITY_VIEWS,
    statuses: OPPORTUNITY_STATUSES,
    priorities: OPPORTUNITY_PRIORITIES,
    // The sales process: open stages only. Won and lost are outcomes, reached through Mark won and Mark lost.
    stages: stages.filter((stage) => stage.isOpen),
    lostReasons: await listOpportunityLostReasons(client, context),
    contactRoles: OPPORTUNITY_CONTACT_ROLES,
    activityTypes: OPPORTUNITY_ACTIVITY_TYPES.map(({ code, label }) => ({ code, label })),
    followUpTypes: OPPORTUNITY_FOLLOW_UP_TYPES,
    sources: await listLeadSources(client, context),
    users,
    teams,
    currencies: currencies.rows.map((row) => String(row.code).trim()),
    baseCurrency: String(currencies.rows.find((row) => row.is_base)?.code ?? currencies.rows[0]?.code ?? "INR").trim(),
    staleDays: OPPORTUNITY_STALE_DAYS,
    currentUserId: context.userId,
    capabilities: opportunityCapabilities(context),
  };
}
