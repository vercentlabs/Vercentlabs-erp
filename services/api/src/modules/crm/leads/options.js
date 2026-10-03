// Everything the lead screens need to render their pickers, in one read: the
// fixed vocabulary, the organization's sources, people, teams, tags and
// currencies, and what the caller is allowed to do.
import { leadCapabilities, requireLeadPermission } from "./access.js";
import { listLeadAssignmentOptions } from "./assignment.js";
import {
  LEAD_ACTIVITY_TYPES, LEAD_DISQUALIFICATION_REASONS, LEAD_FOLLOW_UP_TYPES, LEAD_PERMISSIONS, LEAD_PURCHASE_TIMEFRAMES, LEAD_STAGES, LEAD_STATUSES,
} from "./constants.js";
import { LEAD_VIEWS } from "./records.js";
import { listLeadSources } from "./sources.js";

export async function getLeadOptions(client, context) {
  requireLeadPermission(context, LEAD_PERMISSIONS.view, "You do not have permission to view leads.");
  const { users, teams } = await listLeadAssignmentOptions(client, context);
  const tags = await client.query(
    `SELECT id, name, color FROM tenant.crm_tags WHERE organization_id = $1 AND status = 'active' ORDER BY name`,
    [context.organizationId],
  );
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
    activityTypes: LEAD_ACTIVITY_TYPES,
    followUpTypes: LEAD_FOLLOW_UP_TYPES,
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
