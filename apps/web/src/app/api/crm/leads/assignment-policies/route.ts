import {
  archiveLeadAssignmentPolicy,
  listLeadAssignmentPolicies,
  saveLeadAssignmentPolicy,
} from "@vercentlabs/api";

import { getSessionContext } from "@/lib/auth";
import { PERMISSIONS, requirePermissionFromSession } from "@/lib/authorization";
import { incrementBillingUsage, requireBillingWriteAccess } from "@/lib/billing";
import { crmApiContext, rethrowCrmError } from "@/lib/crm";
import { tenantTransaction } from "@/lib/db";
import { errorResponse, HttpError, ok, readJson } from "@/lib/http";
import { assertSameOrigin } from "@/lib/security";

export async function GET() {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmView);
    const context = await crmApiContext(session);
    const policies = await tenantTransaction(context.organizationId, (client) =>
      listLeadAssignmentPolicies(client, context),
    );
    return ok({ policies });
  } catch (error) {
    try { rethrowCrmError(error); } catch (mapped) { return errorResponse(mapped); }
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmLeadsManage);
    requirePermissionFromSession(session, PERMISSIONS.crmRecordsViewAll);
    await requireBillingWriteAccess(session.organizationId);
    await incrementBillingUsage(session.organizationId, "api_requests_monthly");
    const context = await crmApiContext(session);
    const input = (await readJson(request)) as Record<string, unknown>;
    const result = await tenantTransaction(context.organizationId, (client) =>
      input.action === "archive"
        ? archiveLeadAssignmentPolicy(client, context, String(input.policyId || ""))
        : saveLeadAssignmentPolicy(client, context, input),
    );
    return ok({ result }, input.action === "archive" ? 200 : 201);
  } catch (error) {
    try { rethrowCrmError(error); } catch (mapped) { return errorResponse(mapped); }
  }
}
