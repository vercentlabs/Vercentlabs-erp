import { getCrmOptions } from "@vercentlabs/api";

import { ok } from "@/core/http";
import { crmContext } from "@/features/crm/shared/crm-context";
import { workspaceRoute } from "@/core/workspace-route";

// Dropdown/reference data (sources, sales stages, lost reasons, teams,
// territories, ...) for every CRM screen — one call, not a per-field
// browser-side fan-out.
export async function GET(request: Request) {
  return workspaceRoute(request, { module: "crm" }, async ({ client, session }) => {
    const options = await getCrmOptions(client, crmContext(session));
    return ok({ options });
  });
}
