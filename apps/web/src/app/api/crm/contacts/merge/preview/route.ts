import { assertSameOriginOrMobile, previewContactMergeForCaller } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, HttpError, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext, requireCrmAccess } from "@/features/crm/shared/crm-context";

// Mirrors /api/crm/accounts/merge/preview exactly. previewContactMergeForCaller
// (not the raw previewContactMerge) projects source/survivor through the
// caller's own sensitive-content permissions before this reaches the browser.
export async function POST(request: Request) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const body = (await readJson(request)) as { sourceId?: string; survivorId?: string };
    if (!body.sourceId || !body.survivorId) throw new HttpError(400, "Both sourceId and survivorId are required.");
    const preview = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session);
      return previewContactMergeForCaller(client, crmContext(session), body.sourceId!, body.survivorId!);
    });
    return ok(preview);
  } catch (error) {
    return errorResponse(error);
  }
}
