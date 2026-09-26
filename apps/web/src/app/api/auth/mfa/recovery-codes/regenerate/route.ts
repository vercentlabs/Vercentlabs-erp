import { z } from "zod";

import { assertSameOriginOrMobile, audit, enforceRateLimit, regenerateRecoveryCodes } from "@vercentlabs/api";

import { sessionTransaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireApiUser } from "@/core/session";

const regenerateSchema = z.object({ code: z.string().trim().min(6).max(11) });

// Requires a fresh code (enforced inside regenerateRecoveryCodes) — the
// same sensitive-action protection disableMfa uses. Every prior recovery
// code is invalidated the moment a new batch is issued, never just
// appended to.
export async function POST(request: Request) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireApiUser();
    const body = regenerateSchema.parse(await readJson(request));
    const result = await sessionTransaction(session, async (client) => {
      await enforceRateLimit(client, `mfa-verify:${session.userId}`, 8, 300);
      const regenerated = await regenerateRecoveryCodes(client, session.userId, body.code, process.env);
      await audit(client, {
        organizationId: session.organizationId,
        actorUserId: session.userId,
        eventType: "auth.mfa.recovery_codes_regenerated",
        entityType: "user",
        entityId: session.userId,
        request,
        env: process.env,
      });
      return regenerated;
    });
    return ok(result);
  } catch (error) {
    return errorResponse(error);
  }
}
