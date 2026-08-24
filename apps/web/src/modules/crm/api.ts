import type { CrmResourceKey } from "@vercentlabs/shared-types";
import type { SessionContext } from "@/core/auth";
import { crmDefinitions } from "@/modules/crm";
import { isCrmApiResource, isCrmReport } from "@/modules/crm/scope";
import {
  hasPermission,
  requirePermissionFromSession,
  PERMISSIONS,
} from "@/core/authorization";
import { HttpError } from "@/core/http";

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
  if (!isCrmApiResource(resource)) return false;
  return (
    hasPermission(session, PERMISSIONS.crmView) &&
    (resource === "leads" ||
      resource === "opportunities" ||
      resource === "activities" ||
      resource === "communications" ||
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
  return isCrmReport(report) && hasPermission(session, PERMISSIONS.crmReportsView);
}

export function requireCrmReportView(session: SessionContext, report: string) {
  if (!canViewCrmReport(session, report))
    throw new HttpError(
      403,
      "You do not have permission to view this CRM report.",
    );
}
