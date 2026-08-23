import type { CrmResourceKey } from "@vercentlabs/shared-types";
import type { SessionContext } from "@/core/auth";
import { crmDefinitions } from "@/modules/crm";
import {
  hasPermission,
  requirePermissionFromSession,
  PERMISSIONS,
} from "@/core/authorization";
import { HttpError } from "@/core/http";

const restrictedResources = new Set<CrmResourceKey>([
  "integrations",
  "webhook-subscriptions",
  "sales-teams",
  "sales-team-members",
  "territories",
  "territory-assignments",
  "quota-plans",
  "forecast-periods",
  "forecast-submissions",
  "account-plans",
  "account-stakeholders",
  "playbooks",
  "playbook-questions",
  "playbook-responses",
  "consent-events",
  "privacy-requests",
  "data-quality-scores",
  "engagement-templates",
  "meeting-links",
  "sync-accounts",
  "conversations",
  "conversation-insights",
  "pipeline-inspections",
  "deal-risks",
  "recommendations",
  "buying-committees",
  "buying-committee-members",
  "relationship-edges",
  "account-signals",
  "partner-accounts",
  "partner-deals",
  "report-definitions",
  "dashboards",
  "dashboard-widgets",
  "custom-object-definitions",
  "custom-field-definitions",
  "custom-records",
  "field-visits",
  "enrichment-jobs",
  "ai-predictions",
  "ai-feedback",
]);

const reportPermissions: Record<string, string> = {
  "revenue-operations": PERMISSIONS.crmRevenueManage,
  "account-health": PERMISSIONS.crmAccountsManage,
  privacy: PERMISSIONS.crmPrivacyManage,
  "pipeline-intelligence": PERMISSIONS.crmAnalyticsManage,
  "engagement-intelligence": PERMISSIONS.crmAnalyticsManage,
  "relationship-coverage": PERMISSIONS.crmAccountsManage,
  "partner-pipeline": PERMISSIONS.crmPartnersManage,
  "ai-governance": PERMISSIONS.crmAnalyticsManage,
};

export function assertCrmIdentifier(value: string) {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    throw new HttpError(400, "Invalid CRM record identifier.");
}

export function requireCrmView(session: SessionContext) {
  requirePermissionFromSession(session, PERMISSIONS.crmView);
}

export function canViewCrmResource(
  session: SessionContext,
  resource: CrmResourceKey,
) {
  return (
    hasPermission(session, PERMISSIONS.crmView) &&
    (!restrictedResources.has(resource) ||
      hasPermission(session, crmDefinitions[resource].permission))
  );
}

export function requireCrmResourceView(
  session: SessionContext,
  resource: CrmResourceKey,
) {
  if (!canViewCrmResource(session, resource))
    throw new HttpError(
      403,
      "You do not have permission to view this CRM resource.",
    );
}

export function requireCrmManage(
  session: SessionContext,
  resource: CrmResourceKey,
) {
  requirePermissionFromSession(session, crmDefinitions[resource].permission);
}

export function canViewCrmReport(session: SessionContext, report: string) {
  return (
    hasPermission(session, PERMISSIONS.crmReportsView) &&
    (!reportPermissions[report] ||
      hasPermission(session, reportPermissions[report]))
  );
}

export function requireCrmReportView(session: SessionContext, report: string) {
  if (!canViewCrmReport(session, report))
    throw new HttpError(
      403,
      "You do not have permission to view this CRM report.",
    );
}
