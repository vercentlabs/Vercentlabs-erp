import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

// The company's active members (id and name only), for @mentions and assigning activities. Any member may see who is in the company.
export async function GET(request: Request) {
  return workspaceRoute(request, { action: "people.list" }, async ({ client, session }) => {
    const { rows } = await client.query(
      `SELECT membership.user_id AS id, app_user.full_name AS name FROM public.organization_memberships membership JOIN public.users app_user ON app_user.id = membership.user_id
        WHERE membership.organization_id = $1 AND membership.status = 'active' ORDER BY app_user.full_name`, [session.organizationId]);
    return ok({ people: rows });
  });
}
