// Everything the contact screens need to render their pickers, in one read.
import { activityTypeChoices } from "../activity-types/records.js";
import { listCustomFields } from "../custom-fields/records.js";
import { loadApps } from "../../../core/access/apps.js";
import { contactTabAllowed } from "./summary.js";
import { listLeadAssignmentOptions } from "../leads/assignment.js";
import { listLeadSources } from "../leads/sources.js";
import { contactCapabilities, requireContactPermission } from "./access.js";
import {
  CONTACT_ACTIVITY_TYPES, CONTACT_PERMISSIONS, CONTACT_ROLES, CONTACT_STATUSES, MARKETING_CONSENT, PREFERRED_CONTACT_METHODS,
} from "./constants.js";
import { CONTACT_VIEWS } from "./records.js";
import { CONTACT_RELATED_LISTS } from "./summary.js";

export async function getContactOptions(client, context) {
  await loadApps(client, context);
  requireContactPermission(context, CONTACT_PERMISSIONS.view, "You do not have permission to view contacts.");
  const { users, teams } = await listLeadAssignmentOptions(client, context);
  const organizationId = [context.organizationId];
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
    // One type list everywhere (CRM plan 5.2): the organization's activity types; followUpTypes keeps their codes.
    followUpTypeOptions: await activityTypeChoices(client, context),
    followUpTypes: (await activityTypeChoices(client, context)).map((type) => type.code),
    relatedLists: CONTACT_RELATED_LISTS,
    sources: await listLeadSources(client, context),
    users,
    teams,
    departments: departments.rows.map((row) => row.department),
    currentUserId: context.userId,
    capabilities: contactCapabilities(context),
    // The organization's own fields on this record (CRM audit M4), for the form, the record page and list filters.
    customFields: await listCustomFields(client, context, "contact"),
    moduleAccess: { sales: contactTabAllowed(context, "sales"), projects: contactTabAllowed(context, "projects"), support: contactTabAllowed(context, "support") },
  };
}
