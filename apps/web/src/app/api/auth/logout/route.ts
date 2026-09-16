import { cookies } from "next/headers";

import { assertSameOriginOrMobile, tokenHash, revokeSessionByTokenHash } from "@vercentlabs/api";

import { withClient } from "@/core/db";
import { errorResponse, ok } from "@/core/http";
import { clearSessionCookie } from "@/core/session";

const COOKIE_NAME = process.env.SESSION_COOKIE_NAME || "vercentlabs_session";

// Checkpoint audit (ERP completion gap register, Phase 2.3): every other
// cookie-authenticated mutation calls assertSameOriginOrMobile — this one
// didn't. The session cookie is SameSite=Lax (session.ts), which already
// blocks it from being attached to a cross-site POST, so this wasn't a
// live, exploitable "force someone else's browser to log them out" CSRF
// path — but it was the one inconsistent mutation route, relying on a
// cookie attribute instead of the app's own explicit check, which would
// silently stop protecting this route if that attribute ever changed.
export async function POST(request: Request) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const store = await cookies();
    const token = store.get(COOKIE_NAME)?.value;
    if (token) {
      await withClient((client) =>
        revokeSessionByTokenHash(client, tokenHash(token), "logout"),
      );
    }
    const response = ok({ message: "Signed out." });
    clearSessionCookie(response);
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
