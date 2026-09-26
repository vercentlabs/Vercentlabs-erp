import { previewAccountMergeForCaller } from "@vercentlabs/api";

import { HttpError, ok, readJson } from "@/core/http";
import { crmContext } from "@/features/crm/shared/crm-context";
import { workspaceRoute } from "@/core/workspace-route";

// Read-only preview, module-access-only — same convention as Lead
// conversion's own preview route. previewAccountMergeForCaller (not the
// raw previewAccountMerge) is deliberate: it projects source/survivor
// through the caller's own sensitive-content permissions before this ever
// reaches the browser (see the function's own CRM-VNEXT-085 comment).
export async function POST(request: Request) {
  return workspaceRoute(request, { module: "crm" }, async ({ client, session }) => {
    const body = (await readJson(request)) as { sourceId?: string; survivorId?: string };
    if (!body.sourceId || !body.survivorId) throw new HttpError(400, "Both sourceId and survivorId are required.");
    const preview = await previewAccountMergeForCaller(client, crmContext(session), body.sourceId!, body.survivorId!);
    return ok(preview);
  });
}
