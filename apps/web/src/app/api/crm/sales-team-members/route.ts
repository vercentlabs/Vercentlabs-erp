import { addSalesTeamMember, listSalesTeamMembers } from "@vercentlabs/api/crm";

import { ok } from "@/core/http";
import { teamsRoute } from "@/features/settings/teams/server/teams-route";
import { readBody } from "@/features/crm/leads/server/lead-http";

// A team's members: ?teamId= (required), &status=&limit=&offset=.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const filters = { teamId: url.searchParams.get("teamId") ?? "", status: url.searchParams.get("status") ?? undefined,
    limit: Number(url.searchParams.get("limit")) || undefined, offset: Number(url.searchParams.get("offset")) || undefined };
  return teamsRoute(request, {}, async ({ client, context }) => ok(await listSalesTeamMembers(client, context, filters)));
}

// Body: { teamId, userId, memberRole, allocationPercent, effectiveFrom, effectiveTo }
export async function POST(request: Request) {
  return teamsRoute(request, { manage: true }, async ({ client, context }) => {
    return ok({ record: await addSalesTeamMember(client, context, await readBody(request)) }, 201);
  });
}
