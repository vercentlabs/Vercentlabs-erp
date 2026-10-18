import { addSalesTeamMember, listSalesTeamMembers } from "@vercentlabs/api/crm";
import { requireSessionPermission } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody } from "@/features/crm/leads/server/lead-http";

// A team's members: ?teamId= (required), &status=&limit=&offset=.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const filters = { teamId: url.searchParams.get("teamId") ?? "", status: url.searchParams.get("status") ?? undefined,
    limit: Number(url.searchParams.get("limit")) || undefined, offset: Number(url.searchParams.get("offset")) || undefined };
  return workspaceRoute(request, { module: "crm" }, async ({ client, session, snapshot }) => ok(await listSalesTeamMembers(client, crmContext(session, snapshot), filters)));
}

// Body: { teamId, userId, memberRole, allocationPercent, effectiveFrom, effectiveTo }
export async function POST(request: Request) {
  return workspaceRoute(request, { module: "crm", billingWrite: true }, async ({ client, session, snapshot }) => {
    requireSessionPermission(session, CRM_PERMISSIONS.teamsManage);
    return ok({ record: await addSalesTeamMember(client, crmContext(session, snapshot), await readBody(request)) }, 201);
  });
}
