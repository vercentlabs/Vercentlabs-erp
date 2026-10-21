import { getCrmSetupChecklist } from "@vercentlabs/api/crm";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";

// The first-run checklist on CRM Setup (CRM audit).
export async function GET(request: Request) {
  return workspaceRoute(request, { module: "crm" }, async ({ client, session, snapshot }) => ok(await getCrmSetupChecklist(client, crmContext(session, snapshot))));
}
