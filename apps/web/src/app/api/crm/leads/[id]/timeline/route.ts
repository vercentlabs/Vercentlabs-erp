import { getCrmTimelinePageBySource } from "@vercentlabs/api";
import { getSessionContext } from "@/core/auth";
import { assertCrmIdentifier, requireCrmView } from "@/modules/crm/api";
import { crmApiContext, crmErrorResponse } from "@/modules/crm";
import { tenantTransaction } from "@/core/db";
import { HttpError, ok } from "@/core/http";

type Params = { params: Promise<{ id: string }> };

// F019 §16 closeout — this route previously delegated to Lead's own
// hand-rolled OFFSET-paginated, re-derived-security implementation. It now
// delegates to the SAME canonical Timeline domain module (seller-activity-
// and-follow-up-workspace/timeline/timeline.js) that Account/Contact/
// Opportunity's timeline routes already use — resolveCrmEntityAccess is
// the one authorization gate, visibilityPredicate is the one place each
// source kind's privacy rule is written. The route's own contract
// (source/offset/limit -> rows/hasMore) is unchanged so lead-detail-
// workspace.tsx's two dedicated Activities-only/Communications-only tabs
// needed no client-side changes.
const SOURCE_ALIAS: Record<string, "activity" | "communication"> = {
  activities: "activity",
  communications: "communication",
};

export async function GET(request: Request, { params }: Params) {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requireCrmView(session);
    const { id } = await params;
    assertCrmIdentifier(id);
    const url = new URL(request.url);
    const rawSource = String(url.searchParams.get("source") || "activities");
    const source = SOURCE_ALIAS[rawSource];
    const offset = Number(url.searchParams.get("offset") || 0);
    const limit = Number(url.searchParams.get("limit") || 50);
    if (!source)
      throw new HttpError(400, "Unsupported timeline source.", "CRM_LEAD_TIMELINE_SOURCE_INVALID");
    const context = await crmApiContext(session);
    const page = await tenantTransaction(context.organizationId, (client) =>
      getCrmTimelinePageBySource(client, context, "lead", id, { source, offset, limit }),
    );
    return ok(page);
  } catch (error) {
    return crmErrorResponse(error);
  }
}
