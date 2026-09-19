import { z } from "zod";

import { assertSameOriginOrMobile, audit, setMemberStatus } from "@vercentlabs/api";

import { transaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireApiWorkspace } from "@/core/session";

const putSchema = z.object({ status: z.enum(["active", "disabled"]) });

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireApiWorkspace();
    const { id } = await context.params;
    const body = putSchema.parse(await readJson(request));
    const result = await transaction(async (client) => {
      const updated = await setMemberStatus(client, session, id, body.status);
      await audit(client, {
        organizationId: session.organizationId,
        actorUserId: session.userId,
        eventType: "user.membership_status_changed",
        entityType: "organization_membership",
        entityId: id,
        request,
        env: process.env,
      });
      return updated;
    });
    return ok(result);
  } catch (error) {
    return errorResponse(error);
  }
}
