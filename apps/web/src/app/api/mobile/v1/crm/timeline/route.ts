import { getCrmRecordTimelinePage } from "@vercentlabs/api";
import { tenantTransaction } from "@/core/db";
import { mobileError, mobileOk } from "@/core/mobile-http";
import { requireMobileSession } from "@/core/mobile-session";
import { assertCrmIdentifier, requireCrmView } from "@/modules/crm/crm-data-operations-and-customization/resource-access";
import { crmApiContext, rethrowCrmError } from "@/modules/crm";

const ENTITY_TYPES = new Set(["lead", "opportunity", "party", "contact", "campaign"]);
type TimelineKind = "activity" | "communication" | "note" | "attachment";
const KINDS = new Set<TimelineKind>(["activity", "communication", "note", "attachment"]);

// Mobile/API parity (F019) — Lead/Account/Contact/Opportunity mobile
// surfaces all consume the SAME canonical getCrmRecordTimelinePage
// contract web uses (real cursor pagination, per-item audience/content
// authorization already enforced inside the domain function) — no
// separate mobile Timeline query, no raw SQL content bypass.
export async function GET(request: Request) {
  try {
    const session = await requireMobileSession(request);
    requireCrmView(session);
    const params = new URL(request.url).searchParams;
    const entityType = String(params.get("entityType") || "");
    const entityId = String(params.get("entityId") || "");
    if (!ENTITY_TYPES.has(entityType)) throw new Error("Unsupported entityType.");
    assertCrmIdentifier(entityId);
    const cursor = params.get("cursor") || undefined;
    const limit = Number(params.get("limit") || 30);
    const kindsParam = params.get("kinds");
    const kinds = kindsParam
      ? kindsParam.split(",").map((value) => value.trim()).filter((value): value is TimelineKind => KINDS.has(value as TimelineKind))
      : undefined;
    const context = await crmApiContext(session);
    const page = await tenantTransaction(context.organizationId, (client) =>
      getCrmRecordTimelinePage(client, context, entityType as "lead" | "opportunity" | "party" | "contact" | "campaign", entityId, { cursor, limit, kinds }),
    );
    return mobileOk(request, page);
  } catch (error) { try { rethrowCrmError(error); } catch (mapped) { return mobileError(request, mapped); } }
}
