import { z } from "zod";

import { assertSameOriginOrMobile, audit, disableMfa, enforceRateLimit } from "@vercentlabs/api";

import { transaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireApiUser } from "@/core/session";

const disableSchema = z.object({ code: z.string().trim().min(6).max(11) });

// Disabling MFA requires a fresh code (enforced inside disableMfa itself,
// not just an already-authenticated session) and revokes every session for
// this user afterward — the same "a credential-relevant change must not
// leave an existing session running under the old security posture" rule
// auth-lifecycle.js's password-reset flow already applies.
export async function POST(request: Request) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireApiUser();
    const body = disableSchema.parse(await readJson(request));
    await transaction(async (client) => {
      await enforceRateLimit(client, `mfa-verify:${session.userId}`, 8, 300);
      await disableMfa(client, session.userId, body.code, process.env);
      await audit(client, {
        organizationId: session.organizationId,
        actorUserId: session.userId,
        eventType: "auth.mfa.disabled",
        entityType: "user",
        entityId: session.userId,
        request,
        env: process.env,
      });
    });
    return ok({ disabled: true });
  } catch (error) {
    return errorResponse(error);
  }
}
