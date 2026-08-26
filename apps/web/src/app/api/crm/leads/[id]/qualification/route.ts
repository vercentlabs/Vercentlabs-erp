import {
  decideLeadQualification,
  getLeadQualification,
} from "@vercentlabs/api";

import { getSessionContext } from "@/core/auth";
import { PERMISSIONS, requirePermissionFromSession } from "@/core/authorization";
import { incrementBillingUsage, requireBillingWriteAccess } from "@/core/billing";
import { tenantTransaction } from "@/core/db";
import { HttpError, ok, readJson } from "@/core/http";
import { assertSameOrigin, audit } from "@/core/security";
import { crmApiContext, crmErrorResponse } from "@/modules/crm";
import { assertCrmIdentifier } from "@/modules/crm/api";

type Params = { params: Promise<{ id: string }> };

async function requestContext(id: string) {
  const session = await getSessionContext();
  if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
  requirePermissionFromSession(session, PERMISSIONS.crmView);
  assertCrmIdentifier(id);
  return { session, context: await crmApiContext(session) };
}

export async function GET(_request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const { context } = await requestContext(id);
    const qualification = await tenantTransaction(
      context.organizationId,
      (client) => getLeadQualification(client, context, id),
    );
    return ok({ qualification });
  } catch (error) {
    return crmErrorResponse(error);
  }
}

export async function POST(request: Request, { params }: Params) {
  try {
    assertSameOrigin(request);
    const { id } = await params;
    const { session, context } = await requestContext(id);
    requirePermissionFromSession(session, PERMISSIONS.crmLeadsManage);
    await requireBillingWriteAccess(context.organizationId);
    await incrementBillingUsage(context.organizationId, "api_requests_monthly");
    const input = (await readJson(request)) as Record<string, unknown>;
    const result = await tenantTransaction(
      context.organizationId,
      async (client) => {
        const changed = await decideLeadQualification(client, context, id, input);
        if (changed.changed)
          await audit({
            organizationId: context.organizationId,
            actorUserId: context.userId,
            eventType:
              changed.event.previousState === "unqualified" &&
              changed.event.newState === "qualified"
                ? "crm.leads.requalified"
                : `crm.leads.${changed.event.newState}`,
            entityType: "lead",
            entityId: id,
            beforeData: { qualificationState: changed.event.previousState },
            afterData: {
              qualificationState: changed.event.newState,
              qualificationReasonCode: changed.event.reasonCode,
            },
            metadata: { qualificationEventId: changed.event.id },
            request,
            client,
          });
        return changed;
      },
    );
    return ok({
      message: result.changed
        ? result.qualification.state === "qualified"
          ? "Lead qualified."
          : "Lead marked unqualified."
        : "Qualification decision was already current.",
      ...result,
    });
  } catch (error) {
    return crmErrorResponse(error);
  }
}
