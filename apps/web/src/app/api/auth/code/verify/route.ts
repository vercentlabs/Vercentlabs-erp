import { z } from "zod";

import { assertSameOrigin, clientIp, codeError, enforceRateLimit, recordLoginEvent, startUserSession, verifySignInCode } from "@vercentlabs/api";

import { identityTransaction, ingressTransaction, withIngressClient } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { setSessionCookie } from "@/core/session";

const schema = z.object({ email: z.string().trim().toLowerCase().email().max(320), code: z.string().max(12) });

// Sign-in, step 2: the code. Every try is logged like a password sign-in; a wrong one is counted (committed) before it is reported. The
// session stays signed in for 30 days on this device; people with an authenticator app still enter its code next.
export async function POST(request: Request) {
  try {
    assertSameOrigin(request, process.env);
    const { email, code } = schema.parse(await readJson(request));
    await withIngressClient((client) => enforceRateLimit(client, `login:${clientIp(request, process.env)}`, 10, 300));
    const result = await ingressTransaction((client) => verifySignInCode(client, email, code, process.env));
    await withIngressClient((client) => recordLoginEvent(client, { request, email, userId: result.ok ? result.userId : null, succeeded: result.ok,
      reason: result.ok ? undefined : `code_${result.reason}`, env: process.env }));
    if (!result.ok) throw codeError(result.reason);
    const userId = result.userId;
    const session = await identityTransaction(userId, (client) =>
      startUserSession(client, { userId, ipAddress: clientIp(request, process.env), userAgent: request.headers.get("user-agent"), request, remember: true, env: process.env }));
    const response = ok({ next: "/start" });
    setSessionCookie(response, session);
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
