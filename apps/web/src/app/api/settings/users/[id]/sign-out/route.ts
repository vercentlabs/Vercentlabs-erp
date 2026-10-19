import { signOutMember } from "@vercentlabs/api";
import { CORE_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

type Params = { params: Promise<{ id: string }> };

// End every session of a member without disabling them.
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  return workspaceRoute(request, { permission: CORE_PERMISSIONS.usersManage, action: "users.sessions.revoke", auditDenial: true }, async ({ client, session }) =>
    ok(await signOutMember(client, session, id)));
}
