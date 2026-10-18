import { listCrmAccess, setCrmAccessLevel } from "@vercentlabs/api/crm";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { readBody } from "@/features/crm/leads/server/lead-http";

// CRM access levels for the team (CRM plan 5.7). Needs the permission to assign roles.
export async function GET(request: Request) {
  return workspaceRoute(request, { module: "crm" }, async ({ client, session }) => ok(await listCrmAccess(client, session)));
}

// Body: { userId, level: none | salesperson | manager | admin }
export async function PUT(request: Request) {
  return workspaceRoute(request, { module: "crm", billingWrite: true }, async ({ client, session }) => {
    const body = await readBody(request);
    return ok({ member: await setCrmAccessLevel(client, session, String(body.userId ?? ""), String(body.level ?? "")) });
  });
}
