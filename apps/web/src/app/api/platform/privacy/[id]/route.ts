import { z } from "zod";

import { requireApiPermission } from "@/core/authorization";
import { errorResponse, ok, readJson } from "@/core/http";
import { assertSameOrigin, audit } from "@/core/security";
import { transitionPrivacyRequest } from "@/core/shared-platform";

const schema = z.object({ status: z.enum(["verified", "in_progress", "completed", "rejected", "cancelled"]), result: z.unknown().optional() });

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const session = await requireApiPermission("platform.privacy.manage");
    const { id } = await context.params;
    const input = schema.parse(await readJson(request));
    const result = await transitionPrivacyRequest(session, id, input.status, input.result);
    await audit({ organizationId: session.organizationId, actorUserId: session.userId, eventType: "platform.privacy.request.transitioned", entityType: "privacy_request", entityId: id, afterData: { status: result.status }, request });
    return ok({ status: result.status, completedAt: result.completed_at?.toISOString() || null });
  } catch (error) {
    return errorResponse(error);
  }
}
