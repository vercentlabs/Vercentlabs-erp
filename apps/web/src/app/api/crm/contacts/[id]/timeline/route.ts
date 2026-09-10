import { getCrmRecordTimelinePage } from "@vercentlabs/api";

import { getSessionContext } from "@/core/auth";
import { assertCrmIdentifier, requireCrmView } from "@/modules/crm/api";
import { crmApiContext, crmErrorResponse } from "@/modules/crm";
import { tenantTransaction } from "@/core/db";
import { HttpError, ok } from "@/core/http";

type Params = { params: Promise<{ id: string }> };

type TimelineKind = "activity" | "communication" | "note" | "attachment";
const KINDS = new Set<TimelineKind>(["activity", "communication", "note", "attachment"]);

// F019 — Contact 360 previously had no timeline/history at all. This
// route uses the ONE canonical cross-entity timeline projection
// (getCrmRecordTimelinePage) rather than a fourth hand-rolled
// implementation — see the Lead/Opportunity divergence this closes.
export async function GET(request: Request, { params }: Params) {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requireCrmView(session);
    const { id } = await params;
    assertCrmIdentifier(id);
    const url = new URL(request.url);
    const cursor = url.searchParams.get("cursor") || undefined;
    const limit = Number(url.searchParams.get("limit") || 30);
    const kindsParam = url.searchParams.get("kinds");
    const kinds = kindsParam
      ? kindsParam.split(",").map((value) => value.trim()).filter((value): value is TimelineKind => KINDS.has(value as TimelineKind))
      : undefined;
    const context = await crmApiContext(session);
    const page = await tenantTransaction(context.organizationId, (client) =>
      getCrmRecordTimelinePage(client, context, "contact", id, { cursor, limit, kinds }),
    );
    return ok(page);
  } catch (error) {
    return crmErrorResponse(error);
  }
}
