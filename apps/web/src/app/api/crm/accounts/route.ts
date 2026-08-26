import { createCrmAccount, listCrmAccounts } from "@vercentlabs/api";

import { getSessionContext } from "@/core/auth";
import {
  incrementBillingUsage,
  requireBillingWriteAccess,
} from "@/core/billing";
import {
  requirePermissionFromSession,
  PERMISSIONS,
} from "@/core/authorization";
import { tenantTransaction } from "@/core/db";
import { HttpError, ok, readJson } from "@/core/http";
import { assertSameOrigin, audit } from "@/core/security";
import { crmApiContext, crmErrorResponse } from "@/modules/crm";
import { requireCrmView } from "@/modules/crm/api";

function accountInput(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(
      400,
      "Provide an account object.",
      "CRM_ACCOUNT_INPUT_INVALID",
    );
  }
  return value as Record<string, unknown>;
}

function auditSnapshot(record: Record<string, unknown>) {
  return {
    id: record.id,
    code: record.code,
    displayName: record.displayName,
    partyType: record.partyType,
    companyId: record.companyId,
    status: record.status,
  };
}

export async function GET(request: Request) {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId) {
      throw new HttpError(401, "Sign in to an organisation workspace.");
    }
    requireCrmView(session);
    const context = await crmApiContext(session);
    const url = new URL(request.url);
    const requestedStatus = url.searchParams.get("status") || "active";
    const status: "active" | "inactive" | "all" = [
      "active",
      "inactive",
      "all",
    ].includes(requestedStatus)
      ? (requestedStatus as "active" | "inactive" | "all")
      : "active";
    const result = await tenantTransaction(context.organizationId, (client) =>
      listCrmAccounts(client, context, {
        search: url.searchParams.get("search") || "",
        status,
        industry: url.searchParams.get("industry") || "",
        country: url.searchParams.get("country") || "",
        limit: Number(url.searchParams.get("limit") || "25"),
        offset: Number(url.searchParams.get("offset") || "0"),
      }),
    );
    return ok(result);
  } catch (error) {
    return crmErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await getSessionContext();
    if (!session?.organizationId) {
      throw new HttpError(401, "Sign in to an organisation workspace.");
    }
    requireCrmView(session);
    requirePermissionFromSession(session, PERMISSIONS.partiesManage);
    await requireBillingWriteAccess(session.organizationId);
    const context = await crmApiContext(session);
    const input = accountInput(await readJson(request));
    await incrementBillingUsage(session.organizationId, "api_requests_monthly");

    const record = await tenantTransaction(
      context.organizationId,
      async (client) => {
        const created = await createCrmAccount(client, context, input);
        await audit({
          organizationId: context.organizationId,
          actorUserId: context.userId,
          eventType: "crm.accounts.created",
          entityType: "account",
          entityId: String(created.id),
          afterData: auditSnapshot(created),
          request,
          client,
        });
        return created;
      },
    );

    return ok({ message: "Account created.", record }, 201);
  } catch (error) {
    return crmErrorResponse(error);
  }
}
