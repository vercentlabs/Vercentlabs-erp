import { requireApiPermission } from "@/core/authorization";
import { errorResponse, ok } from "@/core/http";
import { assertSameOrigin, audit } from "@/core/security";
import { revokeOAuthConnection } from "@/core/shared-platform";

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const session = await requireApiPermission("integrations.manage");
    const { id } = await context.params;
    await revokeOAuthConnection(session, id);
    await audit({ organizationId: session.organizationId, actorUserId: session.userId, eventType: "platform.oauth.revoked", entityType: "oauth_connection", entityId: id, request });
    return ok({ message: "OAuth connection revoked." });
  } catch (error) {
    return errorResponse(error);
  }
}
