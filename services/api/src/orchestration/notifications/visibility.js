// Read-time notification projection: applies the platform's module check and
// the record-visibility adapters registered by business modules. Domain
// adapters own record checks; the platform never guesses.
import { listNotifications, projectNotificationsForViewer } from "../../core/platform/notifications/index.js";
import { redactInaccessibleCrmNotifications } from "../../modules/crm/crm-data-operations-and-customization/notification-visibility.js";

function moduleContext(session) {
  return {
    organizationId: session.organizationId,
    userId: session.userId,
    activeCompanyId: session.activeCompanyId,
    activeBranchId: session.activeBranchId,
    allowAllCompanies: session.roleSlugs.includes("organization_owner") || session.roleSlugs.includes("system_administrator"),
    permissions: session.permissions,
    roleSlugs: session.roleSlugs,
  };
}

// moduleKey -> adapter(client, session) => (notifications) => projected notifications
export const NOTIFICATION_VISIBILITY_ADAPTERS = Object.freeze({
  crm: (client, session) => (items) => redactInaccessibleCrmNotifications(client, moduleContext(session), items, { canUseCrm: true }),
});

// Lists the viewer's notifications as they may see them now. Runs inside a
// tenant transaction (adapters read tenant tables).
export async function listNotificationsForViewer(client, session, { status = "all", accessibleModules = [] } = {}) {
  const notifications = await listNotifications(client, session, { status });
  const adapters = Object.fromEntries(Object.entries(NOTIFICATION_VISIBILITY_ADAPTERS).map(([moduleKey, build]) => [moduleKey, build(client, session)]));
  return projectNotificationsForViewer(notifications, { accessibleModules, adapters });
}
