import { findPersonalData } from "@vercentlabs/api/crm";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";

// Everything CRM holds on one person, by email or phone (?email=&phone=), for a privacy request (CRM plan 4.3).
export async function GET(request: Request) {
  return workspaceRoute(request, { module: "crm" }, async ({ client, session, snapshot }) => {
    const url = new URL(request.url);
    return ok({ result: await findPersonalData(client, crmContext(session, snapshot), { email: url.searchParams.get("email"), phone: url.searchParams.get("phone") }) });
  });
}
