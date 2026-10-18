import { listContentHistory } from "@vercentlabs/api/crm";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { relatedRecordFromUrl } from "@/features/crm/notes/server/content-http";

// The note and file history of one record: ?relatedType&relatedId
export async function GET(request: Request) {
  return workspaceRoute(request, { module: "crm" }, async ({ client, session, snapshot }) => {
    const { relatedType, relatedId } = relatedRecordFromUrl(new URL(request.url));
    return ok({ history: await listContentHistory(client, crmContext(session, snapshot), relatedType, relatedId) });
  });
}
