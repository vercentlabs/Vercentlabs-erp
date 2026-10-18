import { listSavedViews, saveView } from "@vercentlabs/api/crm";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody } from "@/features/crm/leads/server/lead-http";

// Your saved views (CRM plan 5.5): ?screen=leads|opportunities|pipeline.
export async function GET(request: Request) {
  const screen = new URL(request.url).searchParams.get("screen") ?? "";
  return workspaceRoute(request, { module: "crm" }, async ({ client, session, snapshot }) => ok({ views: await listSavedViews(client, crmContext(session, snapshot), screen) }));
}

// Body: { screen, name, query, isDefault? }
export async function POST(request: Request) {
  return workspaceRoute(request, { module: "crm" }, async ({ client, session, snapshot }) => {
    const body = await readBody(request);
    return ok({ view: await saveView(client, crmContext(session, snapshot), { screen: String(body.screen ?? ""), name: String(body.name ?? ""), query: String(body.query ?? ""), isDefault: body.isDefault === true }) }, 201);
  });
}
