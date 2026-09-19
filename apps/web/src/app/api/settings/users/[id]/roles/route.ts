import { z } from "zod";

import { assertSameOriginOrMobile, setUserRoles } from "@vercentlabs/api";

import { transaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireApiWorkspace } from "@/core/session";

const putSchema = z.object({
  roleIds: z.array(z.string().uuid()).min(1).max(50),
  primaryRoleId: z.string().uuid(),
  acknowledgeWarningConflicts: z.boolean().optional(),
});

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireApiWorkspace();
    const { id } = await context.params;
    const body = putSchema.parse(await readJson(request));
    const access = await transaction((client) =>
      setUserRoles(client, session, { targetUserId: id, roleIds: body.roleIds, primaryRoleId: body.primaryRoleId, acknowledgeWarningConflicts: body.acknowledgeWarningConflicts }),
    );
    return ok({ access });
  } catch (error) {
    return errorResponse(error);
  }
}
