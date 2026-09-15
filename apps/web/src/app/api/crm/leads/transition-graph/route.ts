import { listLeadStageTransitions } from "@vercentlabs/api";

import { withClient } from "@/core/db";
import { errorResponse, ok } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext, requireCrmAccess } from "@/features/crm/shared/crm-context";

// F007: the governed, admin-authored directed edges between Lead stages —
// the "Move to stage…" UI must only ever offer a legal next stage, never
// every active stage in the pipeline.
export async function GET() {
  try {
    const session = await requireWorkspace();
    const transitions = await withClient(async (client) => {
      await requireCrmAccess(client, session);
      return listLeadStageTransitions(client, crmContext(session));
    });
    return ok({ transitions });
  } catch (error) {
    return errorResponse(error);
  }
}
