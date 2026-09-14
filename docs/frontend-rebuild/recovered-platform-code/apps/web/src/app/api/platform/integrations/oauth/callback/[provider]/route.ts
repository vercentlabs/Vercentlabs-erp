import { NextResponse } from "next/server";

import { requireApiPermission } from "@/core/authorization";
import { HttpError } from "@/core/http";
import { audit, canonicalAppOrigin } from "@/core/security";
import { completeOAuthConnection, type PlatformOAuthProvider } from "@/core/shared-platform";

export async function GET(request: Request, context: { params: Promise<{ provider: string }> }) {
  const finish = (status: string, detail?: string) => {
    const url = new URL("/integrations", canonicalAppOrigin());
    url.searchParams.set("oauth", status);
    if (detail) url.searchParams.set("detail", detail.slice(0, 160));
    return NextResponse.redirect(url);
  };
  try {
    const session = await requireApiPermission("integrations.manage");
    const { provider: rawProvider } = await context.params;
    if (rawProvider !== "google" && rawProvider !== "microsoft") throw new HttpError(404, "OAuth provider is not supported.");
    const url = new URL(request.url);
    const error = url.searchParams.get("error");
    if (error) return finish("failed", error);
    const state = url.searchParams.get("state");
    const code = url.searchParams.get("code");
    const result = await completeOAuthConnection(session, rawProvider as PlatformOAuthProvider, { state, code });
    await audit({ organizationId: session.organizationId, actorUserId: session.userId, eventType: "platform.oauth.connected", entityType: "oauth_connection", entityId: result.id, afterData: { provider: rawProvider }, request });
    return finish("connected");
  } catch (error) {
    return finish("failed", error instanceof Error ? error.message : "OAuth connection failed");
  }
}
