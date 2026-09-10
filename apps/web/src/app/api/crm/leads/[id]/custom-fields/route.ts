import { getCrmRecord, updateCrmRecord } from "@vercentlabs/api";

import { getSessionContext } from "@/core/auth";
import { PERMISSIONS, requirePermissionFromSession } from "@/core/authorization";
import { incrementBillingUsage, requireBillingWriteAccess } from "@/core/billing";
import { tenantTransaction } from "@/core/db";
import { HttpError, ok, readJson } from "@/core/http";
import { assertSameOriginOrMobile, audit } from "@/core/security";
import { crmApiContext, crmErrorResponse } from "@/modules/crm";
import { assertCrmIdentifier } from "@/modules/crm/crm-data-operations-and-customization/resource-access";

type Params = { params: Promise<{ id: string }> };
const KEY = /^[a-z][a-z0-9_]{0,39}$/;

export async function POST(request: Request, { params }: Params) {
  try {
    assertSameOriginOrMobile(request);
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmLeadsManage);
    requirePermissionFromSession(session, PERMISSIONS.crmLeadsViewSensitive);
    await requireBillingWriteAccess(session.organizationId);
    const { id } = await params;
    assertCrmIdentifier(id);
    const input = (await readJson(request)) as { fields?: unknown };
    if (!input.fields || typeof input.fields !== "object" || Array.isArray(input.fields)) throw new HttpError(400, "Custom fields must be an object.", "CRM_LEAD_CUSTOM_FIELDS_INVALID");
    const entries = Object.entries(input.fields as Record<string, unknown>);
    if (entries.length > 30) throw new HttpError(400, "A lead can have up to 30 custom fields.", "CRM_LEAD_CUSTOM_FIELDS_INVALID");
    const customData: Record<string, string> = {};
    for (const [rawKey, rawValue] of entries) {
      const key = rawKey.trim().toLowerCase();
      if (!KEY.test(key)) throw new HttpError(400, `Invalid custom field key: ${rawKey}`, "CRM_LEAD_CUSTOM_FIELDS_INVALID");
      const value = String(rawValue ?? "").trim().slice(0, 2_000);
      if (value) customData[key] = value;
    }
    await incrementBillingUsage(session.organizationId, "api_requests_monthly");
    const context = await crmApiContext(session);
    const lead = await tenantTransaction(context.organizationId, async (client) => {
      const before = await getCrmRecord(client, context, "leads", id);
      const after = await updateCrmRecord(client, context, "leads", id, { customData });
      await audit({
        organizationId: context.organizationId,
        actorUserId: session.userId,
        eventType: "crm.lead.custom_fields_updated",
        entityType: "lead",
        entityId: id,
        beforeData: { customData: before.customData || {} },
        afterData: { customData },
        request,
        client,
      });
      return after;
    });
    return ok({ message: "Custom fields updated.", lead });
  } catch (error) {
    return crmErrorResponse(error);
  }
}
