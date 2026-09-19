import { z } from "zod";

import { assertSameOriginOrMobile, audit, confirmMfaEnrollment, enforceRateLimit } from "@vercentlabs/api";

import { transaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireApiUser } from "@/core/session";

const confirmSchema = z.object({ code: z.string().trim().min(6).max(11) });

// Confirms enrollment with a real, currently-valid code from the pending
// secret — this is the proof step that turns "scanned a QR code" into
// "actually has a working authenticator," and is the only place recovery
// codes are ever returned (once, in the response body — never stored or
// logged in plaintext, never retrievable again after this call).
export async function POST(request: Request) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireApiUser();
    const body = confirmSchema.parse(await readJson(request));
    const result = await transaction(async (client) => {
      await enforceRateLimit(client, `mfa-verify:${session.userId}`, 8, 300);
      const confirmed = await confirmMfaEnrollment(client, session.userId, body.code, process.env);
      await audit(client, {
        organizationId: session.organizationId,
        actorUserId: session.userId,
        eventType: "auth.mfa.enrolled",
        entityType: "user",
        entityId: session.userId,
        request,
        env: process.env,
      });
      return confirmed;
    });
    return ok(result);
  } catch (error) {
    return errorResponse(error);
  }
}
