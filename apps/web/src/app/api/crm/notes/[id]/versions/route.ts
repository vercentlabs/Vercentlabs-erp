import { listCrmNoteVersions } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext, requireCrmAccess } from "@/features/crm/shared/crm-context";

type RouteContext = { params: Promise<{ id: string }> };

// F017 gap-closure — listCrmNoteVersions (the append-only edit history of a
// Note) existed, tested, with no route and no UI. getCrmNote inside it
// applies the same private-note and parent-record authorization as a read.
export async function GET(_request: Request, context: RouteContext) {
  try {
    const session = await requireWorkspace();
    const { id } = await context.params;
    const versions = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session);
      return listCrmNoteVersions(client, crmContext(session), id);
    });
    return ok({ versions });
  } catch (error) {
    return errorResponse(error);
  }
}
