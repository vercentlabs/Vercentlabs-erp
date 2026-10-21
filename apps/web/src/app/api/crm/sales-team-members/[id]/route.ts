import { archiveSalesTeamMember } from "@vercentlabs/api/crm";

import { ok } from "@/core/http";
import { teamsRoute } from "@/features/settings/teams/server/teams-route";

type RouteContext = { params: Promise<{ id: string }> };

// Removes the person from the team (ends the membership): ?expectedUpdatedAt=
export async function DELETE(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const expectedUpdatedAt = new URL(request.url).searchParams.get("expectedUpdatedAt") ?? "";
  return teamsRoute(request, { manage: true }, async ({ client, context }) => {
    return ok({ record: await archiveSalesTeamMember(client, context, id, { expectedUpdatedAt }) });
  });
}
