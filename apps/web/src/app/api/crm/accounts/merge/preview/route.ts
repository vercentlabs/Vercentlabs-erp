import { assertSameOriginOrMobile, previewAccountMergeForCaller } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, HttpError, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext, requireCrmAccess } from "@/features/crm/shared/crm-context";

// Read-only preview, module-access-only — same convention as Lead
// conversion's own preview route. previewAccountMergeForCaller (not the
// raw previewAccountMerge) is deliberate: it projects source/survivor
// through the caller's own sensitive-content permissions before this ever
// reaches the browser (see the function's own CRM-VNEXT-085 comment).
export async function POST(request: Request) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const body = (await readJson(request)) as { sourceId?: string; survivorId?: string };
    if (!body.sourceId || !body.survivorId) throw new HttpError(400, "Both sourceId and survivorId are required.");
    const preview = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session);
      return previewAccountMergeForCaller(client, crmContext(session), body.sourceId!, body.survivorId!);
    });
    return ok(preview);
  } catch (error) {
    return errorResponse(error);
  }
}
