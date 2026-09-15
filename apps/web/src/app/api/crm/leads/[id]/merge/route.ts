import { assertSameOriginOrMobile, mergeCrmLead } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext } from "@/features/crm/shared/crm-context";

// F008 duplicate merge. `id` is the surviving (target) lead; the
// request body names the source (losing) lead. Survivorship rules are
// mergeCrmLead's authority, not this route's.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const { id: targetId } = await context.params;
    const body = (await readJson(request)) as { sourceId: string };
    const result = await tenantTransaction(session.organizationId, (client) =>
      mergeCrmLead(client, crmContext(session), body.sourceId, targetId),
    );
    return ok({ result });
  } catch (error) {
    return errorResponse(error);
  }
}
