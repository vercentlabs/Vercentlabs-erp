import { listNoteVersions } from "@vercentlabs/api/crm";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import type { ContentRouteParams } from "@/features/crm/notes/server/content-http";

// The earlier text of a note, newest first.
export async function GET(request: Request, { params }: ContentRouteParams) {
  return workspaceRoute(request, { module: "crm" }, async ({ client, session }) =>
    ok({ versions: await listNoteVersions(client, crmContext(session), (await params).id) }),
  );
}
