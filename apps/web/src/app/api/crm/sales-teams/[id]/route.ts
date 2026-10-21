import { archiveSalesTeam, getSalesTeam, updateSalesTeam } from "@vercentlabs/api/crm";

import { ok } from "@/core/http";
import { teamsRoute } from "@/features/settings/teams/server/teams-route";
import { readBody } from "@/features/crm/leads/server/lead-http";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { id } = await context.params;
  return teamsRoute(request, {}, async ({ client, context }) => ok({ record: await getSalesTeam(client, context, id) }));
}

// Body: { input, expectedUpdatedAt } — the version the editor loaded.
export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  return teamsRoute(request, { manage: true }, async ({ client, context }) => {
    const body = await readBody(request);
    const input = (body.input && typeof body.input === "object" ? body.input : {}) as Record<string, unknown>;
    return ok({ record: await updateSalesTeam(client, context, id, input, { expectedUpdatedAt: String(body.expectedUpdatedAt ?? "") }) });
  });
}

// Archives the team (status inactive): ?expectedUpdatedAt=
export async function DELETE(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const expectedUpdatedAt = new URL(request.url).searchParams.get("expectedUpdatedAt") ?? "";
  return teamsRoute(request, { manage: true }, async ({ client, context }) => {
    return ok({ record: await archiveSalesTeam(client, context, id, { expectedUpdatedAt }) });
  });
}
