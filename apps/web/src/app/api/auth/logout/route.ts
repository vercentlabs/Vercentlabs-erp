import { cookies } from "next/headers";

import { tokenHash, revokeSessionByTokenHash } from "@vercentlabs/api";

import { withClient } from "@/core/db";
import { errorResponse, ok } from "@/core/http";
import { clearSessionCookie } from "@/core/session";

const COOKIE_NAME = process.env.SESSION_COOKIE_NAME || "vercentlabs_session";

export async function POST() {
  try {
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
