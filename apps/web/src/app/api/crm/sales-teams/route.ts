import { createSalesTeam, listSalesTeams } from "@vercentlabs/api/crm";

import { ok } from "@/core/http";
import { teamsRoute } from "@/features/settings/teams/server/teams-route";
import { readBody } from "@/features/crm/leads/server/lead-http";

// Teams (Settings › Teams): ?status=&search=&limit=&offset=. Changes need crm.teams.manage or sales.settings.manage (Sales audit B10).
export async function GET(request: Request) {
  const url = new URL(request.url);
  const filters = { status: url.searchParams.get("status") ?? undefined, search: url.searchParams.get("search") ?? undefined,
    limit: Number(url.searchParams.get("limit")) || undefined, offset: Number(url.searchParams.get("offset")) || undefined };
  return teamsRoute(request, {}, async ({ client, context }) => ok(await listSalesTeams(client, context, filters)));
}

export async function POST(request: Request) {
  return teamsRoute(request, { manage: true }, async ({ client, context }) => {
    return ok({ record: await createSalesTeam(client, context, await readBody(request)) }, 201);
  });
}
