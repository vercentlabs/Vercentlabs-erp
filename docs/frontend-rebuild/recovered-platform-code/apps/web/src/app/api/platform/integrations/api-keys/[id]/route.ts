import { requireApiPermission } from "@/core/authorization";
import { errorResponse, ok } from "@/core/http";
import { assertSameOrigin, audit } from "@/core/security";
import { revokeDeveloperApiKey } from "@/core/shared-platform";

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const session = await requireApiPermission("integrations.manage");
    const { id } = await context.params;
    await revokeDeveloperApiKey(session, id);
    await audit({ organizationId: session.organizationId, actorUserId: session.userId, eventType: "platform.api_key.revoked", entityType: "api_key", entityId: id, request });
    return ok({ message: "API key revoked." });
  } catch (error) {
    return errorResponse(error);
  }
}
