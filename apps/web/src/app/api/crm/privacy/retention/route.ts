import {
  getPrivacyRetentionDashboard,
  runPrivacyRetention,
  updatePrivacyRetentionPolicy,
} from "@vercentlabs/api";
import { getSessionContext } from "@/core/auth";
import { requirePermissionFromSession, PERMISSIONS } from "@/core/authorization";
import {
  requireBillingWriteAccess,
  incrementBillingUsage,
} from "@/core/billing";
import { crmAccountIntelligenceErrorResponse } from "@/modules/crm/prospect-and-relationship-master-data/account-intelligence";
import { crmApiContext } from "@/modules/crm";
import { tenantTransaction } from "@/core/db";
import { HttpError, ok, readJson } from "@/core/http";
import { assertSameOriginOrMobile, audit } from "@/core/security";

export async function GET() {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmPrivacyManage);
    const context = await crmApiContext(session);
    const dashboard = await tenantTransaction(
      context.organizationId,
      (client) => getPrivacyRetentionDashboard(client, context),
    );
    return ok({ dashboard });
  } catch (error) {
    return crmAccountIntelligenceErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    assertSameOriginOrMobile(request);
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmPrivacyManage);
    const body = (await readJson(request)) as Record<string, unknown>;
    if (!body.id) throw new HttpError(400, "Retention policy is required.");
    await requireBillingWriteAccess(session.organizationId);
    await incrementBillingUsage(session.organizationId, "api_requests_monthly");
    const context = await crmApiContext(session);
    const policy = await tenantTransaction(
      context.organizationId,
      async (client) => {
        const updated = await updatePrivacyRetentionPolicy(
          client,
          context,
          String(body.id),
          body,
        );
        await audit({
          organizationId: context.organizationId,
          actorUserId: session.userId,
          eventType: "crm.privacy.retention_policy.updated",
          entityType: "privacy_retention_policy",
          entityId: String(body.id),
          afterData: updated,
          request,
          client,
        });
        return updated;
      },
    );
    return ok({ message: "Retention policy updated.", policy });
  } catch (error) {
    return crmAccountIntelligenceErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOriginOrMobile(request);
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmPrivacyManage);
    const body = (await readJson(request)) as Record<string, unknown>;
    await requireBillingWriteAccess(session.organizationId);
    await incrementBillingUsage(session.organizationId, "api_requests_monthly");
    const context = await crmApiContext(session);
    const result = await tenantTransaction(
      context.organizationId,
      async (client) => {
        const execution = await runPrivacyRetention(client, context, body);
        await audit({
          organizationId: context.organizationId,
          actorUserId: session.userId,
          eventType: "crm.privacy.retention_run.completed",
          entityType: "privacy_retention",
          entityId: null,
          afterData: execution,
          request,
          client,
        });
        return execution;
      },
    );
    return ok({
      message: `Retention run completed; ${String(result.processed || 0)} subject(s) processed.`,
      result,
    });
  } catch (error) {
    return crmAccountIntelligenceErrorResponse(error);
  }
}
