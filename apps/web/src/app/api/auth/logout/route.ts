import { cookies } from "next/headers";

import {
  assertSameOriginOrMobile,
  tokenHash,
  revokeSessionByTokenHash,
} from "@vercentlabs/api";

import { withIngressClient } from "@/core/db";
import { errorResponse, ok } from "@/core/http";
import { clearSessionCookie } from "@/core/session";

const COOKIE_NAME = process.env.SESSION_COOKIE_NAME || "vercentlabs_session";

// Like every cookie-authenticated mutation, this calls
// assertSameOriginOrMobile rather than relying on the session cookie's
// SameSite=Lax attribute (session.ts) alone, which would silently stop
// protecting this route if that attribute ever changed.
export async function POST(request: Request) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const store = await cookies();
    const token = store.get(COOKIE_NAME)?.value;
    if (token) {
      await withIngressClient((client) =>
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
