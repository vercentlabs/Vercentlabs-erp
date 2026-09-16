import { assertSameOriginOrMobile, markNotificationRead } from "@vercentlabs/api";

import { withClient } from "@/core/db";
import { errorResponse, ok } from "@/core/http";
import { requireWorkspace } from "@/core/session";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const { id } = await context.params;
    const result = await withClient((client) =>
      markNotificationRead(client, session, id),
    );
    return ok({ notification: result });
  } catch (error) {
    return errorResponse(error);
  }
}
