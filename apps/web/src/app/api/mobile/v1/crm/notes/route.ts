import { createCrmNote, listCrmNotes } from "@vercentlabs/api";
import { requireBillingWriteAccess, incrementBillingUsage } from "@/core/billing";
import { requirePermissionFromSession, PERMISSIONS } from "@/core/authorization";
import { tenantTransaction } from "@/core/db";
import { readJson } from "@/core/http";
import { mobileError, mobileOk } from "@/core/mobile-http";
import { requireMobileSession } from "@/core/mobile-session";
import { withMobileIdempotency } from "@/core/mobile-idempotency";
import { assertSameOriginOrMobile, audit } from "@/core/security";
import { assertCrmIdentifier, requireCrmView } from "@/modules/crm/crm-data-operations-and-customization/resource-access";
import { crmApiContext, rethrowCrmError } from "@/modules/crm";

const ENTITY_TYPES = new Set(["lead", "opportunity", "party", "contact", "campaign"]);

// Mobile/API parity (F017) — ONE generic entity-scoped mobile route for
// Notes (query/body carries entityType+entityId), calling the SAME
// canonical listCrmNotes/createCrmNote domain module every web entity-
// specific route delegates to (private-Note visibility, parent-record
// authorization, versioning) — no raw Note SQL here, and no per-entity
// mobile route duplicated four times.
export async function GET(request: Request) {
  try {
    const session = await requireMobileSession(request);
    requireCrmView(session);
    const params = new URL(request.url).searchParams;
    const entityType = String(params.get("entityType") || "");
    const entityId = String(params.get("entityId") || "");
    if (!ENTITY_TYPES.has(entityType)) throw new Error("Unsupported entityType.");
    assertCrmIdentifier(entityId);
    const includeArchived = params.get("includeArchived") === "true";
    const context = await crmApiContext(session);
    const notes = await tenantTransaction(context.organizationId, (client) =>
      listCrmNotes(client, context, entityType, entityId, { includeArchived }),
    );
    return mobileOk(request, { notes });
  } catch (error) { try { rethrowCrmError(error); } catch (mapped) { return mobileError(request, mapped); } }
}

export async function POST(request: Request) {
  try {
    assertSameOriginOrMobile(request);
    const session = await requireMobileSession(request);
    requirePermissionFromSession(session, PERMISSIONS.crmActivitiesManage);
    requirePermissionFromSession(session, PERMISSIONS.crmLeadsViewSensitive);
    await requireBillingWriteAccess(session.organizationId!);
    const input = (await readJson(request)) as Record<string, unknown>;
    const entityType = String(input.entityType || "");
    const entityId = String(input.entityId || "");
    if (!ENTITY_TYPES.has(entityType)) throw new Error("Unsupported entityType.");
    assertCrmIdentifier(entityId);
    await incrementBillingUsage(session.organizationId!, "api_requests_monthly");
    const context = await crmApiContext(session);
    const response = await tenantTransaction(context.organizationId, (client) =>
      withMobileIdempotency(client, session, request, input, async () => {
        const created = await createCrmNote(client, context, entityType, entityId, input);
        await audit({
          organizationId: context.organizationId,
          actorUserId: session.userId,
          eventType: "crm.note_created",
          entityType,
          entityId,
          afterData: created,
          request,
          client,
        });
        return { note: created };
      }),
    );
    return mobileOk(request, response, 201);
  } catch (error) { try { rethrowCrmError(error); } catch (mapped) { return mobileError(request, mapped); } }
}
