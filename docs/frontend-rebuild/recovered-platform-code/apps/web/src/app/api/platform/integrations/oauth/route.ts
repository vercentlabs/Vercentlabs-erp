import { z } from "zod";

import { requireApiPermission } from "@/core/authorization";
import { requireBillingWriteAccess } from "@/core/billing";
import { errorResponse, ok, readJson } from "@/core/http";
import { assertSameOrigin, audit, canonicalAppOrigin } from "@/core/security";
import {
  beginOAuthConnection,
  listOAuthConnections,
  type PlatformOAuthProvider,
} from "@/core/shared-platform";

const beginSchema = z.object({
  provider: z.enum(["google", "microsoft"]),
  scopes: z.array(z.string().trim().min(1).max(120)).max(32).default([]),
});

export async function GET() {
  try {
    const session = await requireApiPermission("integrations.manage");
    const connections = await listOAuthConnections(session.organizationId);
    return ok({ connections: connections.map((item) => ({ ...item, expires_at: item.expires_at?.toISOString() || null, updated_at: item.updated_at.toISOString() })) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await requireApiPermission("integrations.manage");
    await requireBillingWriteAccess(session.organizationId);
    const input = beginSchema.parse(await readJson(request));
    const redirectUri = `${canonicalAppOrigin()}/api/platform/integrations/oauth/callback/${input.provider}`;
    const result = await beginOAuthConnection(session, input.provider as PlatformOAuthProvider, { redirectUri, scopes: input.scopes });
    await audit({ organizationId: session.organizationId, actorUserId: session.userId, eventType: "platform.oauth.started", entityType: "oauth_connection", entityId: input.provider, afterData: { provider: input.provider, scopes: input.scopes }, request });
    return ok({ authorizeUrl: result.authorizeUrl, expiresInSeconds: result.expiresInSeconds });
  } catch (error) {
    return errorResponse(error);
  }
}
