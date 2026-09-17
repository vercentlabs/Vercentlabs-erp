import { assertSameOrigin, createEmailVerificationToken, enforceRateLimit, clientIp } from "@vercentlabs/api";

import { withClient } from "@/core/db";
import { errorResponse, ok } from "@/core/http";
import { requireUser } from "@/core/session";

// Deliberately requireUser(), not requireVerifiedUser() — the caller of
// this route is, by definition, not yet verified. Requires an
// authenticated session (not a bare public email input, unlike
// forgot-password) since we already know exactly which user is asking,
// no need to accept an arbitrary email and risk it being used to spam
// someone else's inbox.
export async function POST(request: Request) {
  try {
    assertSameOrigin(request, process.env);
    const session = await requireUser();
    await withClient((client) => enforceRateLimit(client, `resend-verification:${clientIp(request, process.env)}`, 5, 300));
    const result = await withClient((client) => createEmailVerificationToken(client, session.userId));
    return ok({ alreadyVerified: result.alreadyVerified, delivered: result.delivered ?? false });
  } catch (error) {
    return errorResponse(error);
  }
}
