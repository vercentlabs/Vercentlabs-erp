import { getCrmOptions } from "@vercentlabs/api/crm";

import { ok } from "@/core/http";
import { crmContext } from "@/features/crm/shared/crm-context";
import { workspaceRoute } from "@/core/workspace-route";

// Dropdown/reference data (sources, sales stages, lost reasons, teams,
// teams, ...) for every CRM screen — one call, not a per-field
// browser-side fan-out.
export async function GET(request: Request) {
  return workspaceRoute(
    request,
    { module: "crm" },
    async ({ client, session, snapshot }) => {
      const options = await getCrmOptions(client, crmContext(session, snapshot));
      return ok({ options });
    },
  );
}
