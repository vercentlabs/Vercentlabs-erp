import { matchLeadTerritory } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { crmContext } from "@/features/crm/shared/crm-context";
import { workspaceRoute } from "@/core/workspace-route";

// F020: which territory a lead with these details would fall in — the same
// match territory-mode assignment rules use, so coverage can be checked
// before any lead arrives.
export async function GET(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.settingsManage }, async ({ client, session }) => {
    const params = new URL(request.url).searchParams;
    const lead = {
      countryCode: params.get("countryCode") ?? "",
      state: params.get("state") ?? "",
      city: params.get("city") ?? "",
      industry: params.get("industry") ?? "",
      sourceId: params.get("sourceId") ?? "",
    };
    const match = await matchLeadTerritory(client, crmContext(session), lead);
    return ok({ match });
  });
}
