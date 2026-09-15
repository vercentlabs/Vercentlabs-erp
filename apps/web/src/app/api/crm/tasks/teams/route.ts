import { listMyTaskTeams } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { withClient } from "@/core/db";
import { errorResponse, ok } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext, requireCrmAccess } from "@/features/crm/shared/crm-context";

// Teams the caller can queue Tasks against — never every team in the org.
export async function GET() {
  try {
    const session = await requireWorkspace();
    const teams = await withClient(async (client) => {
      await requireCrmAccess(client, session, CRM_PERMISSIONS.activitiesManage);
      return listMyTaskTeams(client, crmContext(session));
    });
    return ok({ teams });
  } catch (error) {
    return errorResponse(error);
  }
}
