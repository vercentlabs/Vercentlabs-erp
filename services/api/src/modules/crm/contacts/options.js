// Everything the contact screens need to render their pickers, in one read.
import { listLeadAssignmentOptions } from "../leads/assignment.js";
import { listLeadSources } from "../leads/sources.js";
import { contactCan, contactCapabilities, requireContactPermission } from "./access.js";
import {
  CONTACT_ACTIVITY_TYPES, CONTACT_FOLLOW_UP_TYPES, CONTACT_PERMISSIONS, CONTACT_ROLES, CONTACT_STATUSES, MARKETING_CONSENT, PREFERRED_CONTACT_METHODS,
} from "./constants.js";
import { CONTACT_VIEWS } from "./records.js";
import { CONTACT_RELATED_LISTS } from "./summary.js";

export async function getContactOptions(client, context) {
  requireContactPermission(context, CONTACT_PERMISSIONS.view, "You do not have permission to view contacts.");
  const { users, teams } = await listLeadAssignmentOptions(client, context);
  const organizationId = [context.organizationId];
  const tags = await client.query(`SELECT id, name, color FROM tenant.crm_tags WHERE organization_id = $1 AND status = 'active' ORDER BY name`, organizationId);
  const departments = await client.query(
    `SELECT DISTINCT department FROM tenant.contacts WHERE organization_id = $1 AND department IS NOT NULL AND btrim(department) <> '' ORDER BY department LIMIT 200`,
    organizationId,
  );
  return {
    views: CONTACT_VIEWS,
    statuses: CONTACT_STATUSES,
    roles: CONTACT_ROLES,
    preferredContactMethods: PREFERRED_CONTACT_METHODS,
    marketingConsent: MARKETING_CONSENT,
    activityTypes: CONTACT_ACTIVITY_TYPES,
    followUpTypes: CONTACT_FOLLOW_UP_TYPES,
    relatedLists: CONTACT_RELATED_LISTS,
    sources: await listLeadSources(client, context),
    users,
    teams,
    tags: tags.rows,
    departments: departments.rows.map((row) => row.department),
    currentUserId: context.userId,
    capabilities: contactCapabilities(context),
    moduleAccess: { sales: contactCan(context, "sales.view"), projects: contactCan(context, "projects.view"), support: contactCan(context, "support.view") },
  };
}
