import { z } from "zod";

import { assertSameOriginOrMobile, audit, enforceRateLimit, verifyMfaForSession } from "@vercentlabs/api";

import { sessionTransaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireApiUser } from "@/core/session";

const verifySchema = z.object({ code: z.string().trim().min(6).max(11) });

// The login-time step-up check: marks THIS session's mfa_verified_at once
// a real TOTP code (or a single-use recovery code) is proven. Reachable
// precisely when requireApiWorkspace would otherwise reject the session —
// requireApiUser only requires authenticated + email-verified, not
// mfaVerified, which is the whole point of this route.
export async function POST(request: Request) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireApiUser();
    const body = verifySchema.parse(await readJson(request));
    await sessionTransaction(session, async (client) => {
      // A 6-digit TOTP code has only 10^6 possibilities; without a limit
      // here an attacker holding an authenticated-but-not-MFA-verified
      // session could brute-force the step-up check directly. Keyed by
      // user, not just IP, so distributing guesses across source
      // addresses doesn't bypass it -- mirrors how POST /api/auth/login
      // rate-limits by IP via the same enforceRateLimit primitive.
      await enforceRateLimit(client, `mfa-verify:${session.userId}`, 8, 300);
      await verifyMfaForSession(client, { sessionId: session.sessionId, userId: session.userId, code: body.code }, process.env);
      await audit(client, {
        organizationId: session.organizationId,
        actorUserId: session.userId,
        eventType: "auth.mfa.verified",
        entityType: "session",
        entityId: session.sessionId,
        request,
        env: process.env,
      });
    });
    return ok({ verified: true });
  } catch (error) {
    return errorResponse(error);
  }
}
