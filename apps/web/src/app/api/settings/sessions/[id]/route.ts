import { assertSameOriginOrMobile, revokeSessionById } from "@vercentlabs/api";
import { z } from "zod";

import { withClient } from "@/core/db";
import { errorResponse, HttpError, ok } from "@/core/http";
import { requireWorkspace } from "@/core/session";

const paramsSchema = z.object({ id: z.string().uuid() });

type RouteContext = { params: Promise<{ id: string }> };

// SESSION-DEVICE-UI. Self-service remote revocation — scoped to the
// caller's own userId inside revokeSessionById itself, so this route
// cannot be used to revoke anyone else's session regardless of what id is
// passed (a mismatched id simply matches zero rows and 404s).
export async function DELETE(request: Request, context: RouteContext) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const { id } = paramsSchema.parse(await context.params);
    const revoked = await withClient((client) => revokeSessionById(client, session.userId, id, "user_revoked"));
    if (!revoked) throw new HttpError(404, "Session not found.");
    return ok({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
