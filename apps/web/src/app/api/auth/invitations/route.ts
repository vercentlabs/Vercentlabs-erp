import { z } from "zod";

import { assertSameOriginOrMobile, createOrganizationInvitation, requireSessionPermission } from "@vercentlabs/api";
import { CORE_PERMISSIONS } from "@vercentlabs/permissions";

import { withClient } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";

const schema = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  roleId: z.string().uuid(),
});

export async function POST(request: Request) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    requireSessionPermission(session, CORE_PERMISSIONS.usersManage);
    const body = schema.parse(await readJson(request));
    const result = await withClient((client) =>
      createOrganizationInvitation(client, {
        organizationId: session.organizationId,
        invitedByUserId: session.userId,
        email: body.email,
        roleId: body.roleId,
        inviter: { roleSlugs: session.roleSlugs, permissions: session.permissions },
      }),
    );
    return ok({ invitationId: result.invitationId, delivered: result.delivered }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
