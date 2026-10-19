import { NextResponse } from "next/server";

import {
  clientIp,
  consumeSocialSignInState,
  exchangeSocialSignInCode,
  recordLoginEvent,
  resolveSocialSignIn,
  startUserSession,
} from "@vercentlabs/api";

import { identityTransaction, ingressTransaction, withIngressClient } from "@/core/db";
import { setSessionCookie } from "@/core/session";

// Sign in with Google / Microsoft, step 2: the provider sends the browser back here (APP_URL + /api/auth/oauth/<provider>/callback,
// registered with the provider). The state is used once before anything else; the session starts exactly as a password sign-in.
export async function GET(request: Request, context: { params: Promise<{ provider: string }> }) {
  const { provider } = await context.params;
  const url = new URL(request.url);
  let purpose: "sign_in" | "link" = "sign_in";
  const back = (path: string) => NextResponse.redirect(new URL(path, url.origin), 303);
  try {
    const state = await ingressTransaction((client) => consumeSocialSignInState(client, provider, url.searchParams.get("state"), process.env));
    purpose = state.purpose;
    if (url.searchParams.get("error")) return back(purpose === "link" ? "/settings/profile?signInError=AUTH_SOCIAL_CANCELLED" : "/login?error=AUTH_SOCIAL_CANCELLED");
    const identity = await exchangeSocialSignInCode(state, url.searchParams.get("code"), process.env);
    const userId = await ingressTransaction((client) => resolveSocialSignIn(client, state, identity));
    if (purpose === "link") return back(`/settings/profile?linked=${provider}`);
    await withIngressClient((client) =>
      recordLoginEvent(client, { request, email: identity.email ?? `${provider}:${identity.subject}`, userId, succeeded: true, env: process.env }));
    const session = await identityTransaction(userId, (client) =>
      startUserSession(client, { userId, ipAddress: clientIp(request, process.env), userAgent: request.headers.get("user-agent"), request, env: process.env }));
    const response = back(state.returnTo ?? "/");
    setSessionCookie(response, session);
    return response;
  } catch (error) {
    const code = String((error as { code?: string })?.code ?? "AUTH_SOCIAL_SIGN_IN_FAILED");
    return back(purpose === "link" ? `/settings/profile?signInError=${code}` : `/login?error=${code}`);
  }
}
