import { listMyTaskTeams } from "@vercentlabs/api";

import { withClient } from "@/core/db";
import { errorResponse, ok } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext } from "@/features/crm/shared/crm-context";

// Teams the caller can queue Tasks against — never every team in the org.
export async function GET() {
  try {
    const session = await requireWorkspace();
    const teams = await withClient((client) => listMyTaskTeams(client, crmContext(session)));
    return ok({ teams });
  } catch (error) {
    return errorResponse(error);
  }
}
