import { z } from "zod";

import { assertSameOriginOrMobile, audit, updateBranch } from "@vercentlabs/api";

import { transaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireApiWorkspace } from "@/core/session";

const putSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  timezone: z.string().trim().min(1).max(100).optional(),
  status: z.enum(["active", "inactive"]).optional(),
});

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireApiWorkspace();
    const { id } = await context.params;
    const body = putSchema.parse(await readJson(request));
    const branch = await transaction(async (client) => {
      const updated = await updateBranch(client, session, id, body);
      await audit(client, {
        organizationId: session.organizationId,
        actorUserId: session.userId,
        eventType: "branch.updated",
        entityType: "branch",
        entityId: id,
        request,
        env: process.env,
      });
      return updated;
    });
    return ok({ branch });
  } catch (error) {
    return errorResponse(error);
  }
}
