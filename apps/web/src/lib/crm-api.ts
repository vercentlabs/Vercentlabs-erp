import type { CrmResourceKey } from "@vercent/shared-types";
import type { SessionContext } from "@/lib/auth";
import { crmDefinitions } from "@/lib/crm";
import { requirePermissionFromSession, PERMISSIONS } from "@/lib/authorization";
import { HttpError } from "@/lib/http";

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
export function requireCrmManage(
  session: SessionContext,
  resource: CrmResourceKey,
) {
  requirePermissionFromSession(session, crmDefinitions[resource].permission);
}
