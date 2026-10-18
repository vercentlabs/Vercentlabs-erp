import { addNationalHolidays } from "@vercentlabs/api/crm";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody } from "@/features/crm/leads/server/lead-http";

// Body: { year } — Republic Day, Independence Day and Gandhi Jayanti.
export async function POST(request: Request) {
  return workspaceRoute(request, { module: "crm", billingWrite: true }, async ({ client, session, snapshot }) =>
    ok(await addNationalHolidays(client, crmContext(session, snapshot), Number((await readBody(request)).year))));
}
