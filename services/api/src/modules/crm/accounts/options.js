// Everything the account screens need to render their pickers, in one read:
// the fixed vocabulary, the organization's sources, people, teams, tags,
// industries, payment terms and currencies, and what the caller may do.
import { listLeadAssignmentOptions } from "../leads/assignment.js";
import { listLeadSources } from "../leads/sources.js";
import { accountCan, accountCapabilities, requireAccountPermission } from "./access.js";
import {
  ACCOUNT_ACTIVITY_TYPES, ACCOUNT_FOLLOW_UP_TYPES, ACCOUNT_PERMISSIONS, ACCOUNT_STATUSES, ACCOUNT_TYPES, ADDRESS_TYPES, EMPLOYEE_RANGES,
} from "./constants.js";
import { ACCOUNT_VIEWS } from "./records.js";
import { ACCOUNT_RELATED_LISTS } from "./summary.js";

export async function getAccountOptions(client, context) {
  requireAccountPermission(context, ACCOUNT_PERMISSIONS.view, "You do not have permission to view accounts.");
  const { users, teams } = await listLeadAssignmentOptions(client, context);
  const organizationId = [context.organizationId];
  const tags = await client.query(`SELECT id, name, color FROM tenant.crm_tags WHERE organization_id = $1 AND status = 'active' ORDER BY name`, organizationId);
  const currencies = await client.query(`SELECT code, is_base FROM tenant.currencies WHERE organization_id = $1 AND status = 'active' ORDER BY is_base DESC, code`, organizationId);
  const industries = await client.query(
    `SELECT DISTINCT industry FROM tenant.business_parties WHERE organization_id = $1 AND industry IS NOT NULL AND btrim(industry) <> '' ORDER BY industry LIMIT 200`,
    organizationId,
  );
  const paymentTerms = await client.query(`SELECT id, code, name, default_due_days FROM tenant.payment_terms WHERE organization_id = $1 AND status = 'active' ORDER BY default_due_days, name`, organizationId);
  return {
    views: ACCOUNT_VIEWS,
    types: ACCOUNT_TYPES,
    statuses: ACCOUNT_STATUSES,
    employeeRanges: EMPLOYEE_RANGES,
    addressTypes: ADDRESS_TYPES,
    activityTypes: ACCOUNT_ACTIVITY_TYPES,
    followUpTypes: ACCOUNT_FOLLOW_UP_TYPES,
    relatedLists: ACCOUNT_RELATED_LISTS,
    sources: await listLeadSources(client, context),
    users,
    teams,
    tags: tags.rows,
    industries: industries.rows.map((row) => row.industry),
    paymentTerms: paymentTerms.rows.map((row) => ({ id: row.id, code: row.code, name: row.name, dueDays: row.default_due_days })),
    currencies: currencies.rows.map((row) => String(row.code).trim()),
    baseCurrency: String(currencies.rows.find((row) => row.is_base)?.code ?? currencies.rows[0]?.code ?? "INR").trim(),
    currentUserId: context.userId,
    capabilities: accountCapabilities(context),
    // Which read-only Customer 360 tabs the caller may open.
    moduleAccess: {
      sales: accountCan(context, "sales.view"),
      finance: accountCan(context, "accounting.view"),
      projects: accountCan(context, "projects.view"),
      support: accountCan(context, "support.view"),
    },
  };
}
