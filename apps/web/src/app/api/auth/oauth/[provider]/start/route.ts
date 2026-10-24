import { beginSocialSignIn, canonicalAppOrigin, clientIp, enforceRateLimit } from "@vercentlabs/api";

import { ingressTransaction, withIngressClient } from "@/core/db";
import { getSessionContext } from "@/core/session";

// Sign in with Google / Microsoft, step 1: ?purpose=sign_in (from the sign-in page) or link (from the profile, signed in).
export async function GET(request: Request, context: { params: Promise<{ provider: string }> }) {
  const { provider } = await context.params;
  const url = new URL(request.url);
  const purpose = url.searchParams.get("purpose") === "link" ? "link" : "sign_in";
  const failed = (code: string) => Response.redirect(new URL(purpose === "link" ? `/settings/profile?signInError=${code}` : `/login?error=${code}`, canonicalAppOrigin(process.env)).toString(), 303);
  try {
    await withIngressClient((client) => enforceRateLimit(client, `social-sign-in:${clientIp(request, process.env)}`, 20, 300));
    const session = purpose === "link" ? await getSessionContext() : null;
    if (purpose === "link" && !session) return failed("AUTH_REQUIRED");
    const started = await ingressTransaction((client) =>
      beginSocialSignIn(client, { provider, purpose, userId: session?.userId ?? null, returnTo: url.searchParams.get("returnTo") }, process.env));
    return Response.redirect(started.url, 303);
  } catch (error) {
    return failed(String((error as { code?: string })?.code ?? "AUTH_SOCIAL_SIGN_IN_FAILED"));
  }
}
