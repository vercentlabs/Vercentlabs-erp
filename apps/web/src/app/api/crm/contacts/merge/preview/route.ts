import { previewContactMergeForCaller } from "@vercentlabs/api";

import { HttpError, ok, readJson } from "@/core/http";
import { crmContext } from "@/features/crm/shared/crm-context";
import { workspaceRoute } from "@/core/workspace-route";

// Mirrors /api/crm/accounts/merge/preview exactly. previewContactMergeForCaller
// (not the raw previewContactMerge) projects source/survivor through the
// caller's own sensitive-content permissions before this reaches the browser.
export async function POST(request: Request) {
  return workspaceRoute(request, { module: "crm" }, async ({ client, session }) => {
    const body = (await readJson(request)) as { sourceId?: string; survivorId?: string };
    if (!body.sourceId || !body.survivorId) throw new HttpError(400, "Both sourceId and survivorId are required.");
    const preview = await previewContactMergeForCaller(client, crmContext(session), body.sourceId!, body.survivorId!);
    return ok(preview);
  });
}
