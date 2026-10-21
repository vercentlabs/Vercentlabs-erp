import { listSalesAccess, setSalesAccessLevel } from "@vercentlabs/api";

import { ok, readJson } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

// Sales access levels for the team (Sales audit): Salesperson, Billing, Dispatch, Sales manager. Needs the permission to assign roles.
export async function GET(request: Request) {
  return workspaceRoute(request, { module: "sales" }, async ({ client, session }) => ok(await listSalesAccess(client, session)));
}

// Body: { userId, level: none | salesperson | billing | dispatch | manager }
export async function PUT(request: Request) {
  return workspaceRoute(request, { module: "sales", billingWrite: true }, async ({ client, session }) => {
    const body = (await readJson(request).catch(() => ({}))) as Record<string, unknown>;
    return ok({ member: await setSalesAccessLevel(client, session, String(body.userId ?? ""), String(body.level ?? "")) });
  });
}
