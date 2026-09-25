import { matchLeadTerritory } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext, requireCrmAccess } from "@/features/crm/shared/crm-context";

// F020: which territory a lead with these details would fall in — the same
// match territory-mode assignment rules use, so coverage can be checked
// before any lead arrives.
export async function GET(request: Request) {
  try {
    const session = await requireWorkspace();
    const params = new URL(request.url).searchParams;
    const lead = {
      countryCode: params.get("countryCode") ?? "",
      state: params.get("state") ?? "",
      city: params.get("city") ?? "",
      industry: params.get("industry") ?? "",
      sourceId: params.get("sourceId") ?? "",
    };
    const match = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session, CRM_PERMISSIONS.settingsManage);
      return matchLeadTerritory(client, crmContext(session), lead);
    });
    return ok({ match });
  } catch (error) {
    return errorResponse(error);
  }
}
