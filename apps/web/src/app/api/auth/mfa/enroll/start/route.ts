import { assertSameOriginOrMobile, beginMfaEnrollment } from "@vercentlabs/api";

import { sessionTransaction } from "@/core/db";
import { errorResponse, ok } from "@/core/http";
import { requireApiUser } from "@/core/session";

// Starts (or restarts) TOTP enrollment for the caller's own account.
// Self-service — no permission beyond being authenticated, same rationale
// as sessions/route.ts's own comment (ownership IS the authorization).
export async function POST(request: Request) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireApiUser();
    const result = await sessionTransaction(session, (client) => beginMfaEnrollment(client, session.userId, process.env));
    return ok(result);
  } catch (error) {
    return errorResponse(error);
  }
}
