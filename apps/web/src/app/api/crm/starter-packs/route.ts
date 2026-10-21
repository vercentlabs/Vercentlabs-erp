import { applyStarterPack, listStarterPacks } from "@vercentlabs/api/crm";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody } from "@/features/crm/leads/server/lead-http";

// Industry starter packs. GET: what each sets up. POST { key }: apply one (CRM settings managers).
export async function GET(request: Request) {
  return workspaceRoute(request, { module: "crm" }, async () => ok({ packs: listStarterPacks() }));
}

export async function POST(request: Request) {
  return workspaceRoute(request, { module: "crm", billingWrite: true }, async ({ client, session, snapshot }) => {
    const body = await readBody(request);
    return ok({ result: await applyStarterPack(client, crmContext(session, snapshot), String(body.key ?? "")) });
  });
}
