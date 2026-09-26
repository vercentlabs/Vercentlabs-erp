import { listCrmNoteVersions } from "@vercentlabs/api";

import { ok } from "@/core/http";
import { crmContext } from "@/features/crm/shared/crm-context";
import { workspaceRoute } from "@/core/workspace-route";

type RouteContext = { params: Promise<{ id: string }> };

// F017 gap-closure — listCrmNoteVersions (the append-only edit history of a
// Note) existed, tested, with no route and no UI. getCrmNote inside it
// applies the same private-note and parent-record authorization as a read.
export async function GET(request: Request, context: RouteContext) {
  return workspaceRoute(request, { module: "crm" }, async ({ client, session }) => {
    const { id } = await context.params;
    const versions = await listCrmNoteVersions(client, crmContext(session), id);
    return ok({ versions });
  });
}
