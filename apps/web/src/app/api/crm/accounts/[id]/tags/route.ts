import { setRecordTags } from "@vercentlabs/api/crm";

import { HttpError, ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody } from "@/features/crm/leads/server/lead-http";

// Sets the company's tags to exactly these ({ tags: [{ id } | { name }] }; a new name makes the tag). Needs Edit companies.
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return workspaceRoute(request, { module: "crm", billingWrite: true }, async ({ client, session, snapshot }) => {
    const body = await readBody(request);
    if (!Array.isArray(body.tags)) throw new HttpError(400, "Give the tags as a list.");
    return ok({ tags: await setRecordTags(client, crmContext(session, snapshot), "party", id, body.tags) });
  });
}
