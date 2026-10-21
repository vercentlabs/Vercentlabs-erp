import { z } from "zod";

import { assertSameOrigin, clientIp, codeError, enforceRateLimit, startUserSession, verifySignupCode } from "@vercentlabs/api";

import { identityTransaction, ingressTransaction, withIngressClient } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { setSessionCookie } from "@/core/session";
import { clearSignupCookie, readSignupToken } from "@/features/auth/signup-cookie";

const schema = z.object({ code: z.string().max(12) });

// Screen 2: the code. A wrong try is counted (committed) before it is reported. An email that already has a workspace is signed in to it.
export async function POST(request: Request) {
  try {
    assertSameOrigin(request, process.env);
    const { code } = schema.parse(await readJson(request));
    await withIngressClient((client) => enforceRateLimit(client, `signup-code:${clientIp(request, process.env)}`, 30, 600));
    const token = (await readSignupToken()) ?? "";
    const result = await ingressTransaction((client) => verifySignupCode(client, token, code, process.env));
    if (!result.ok) throw codeError(result.reason);
    if (!result.existingUserId) return ok({ next: "continue" });
    const userId = result.existingUserId;
    const session = await identityTransaction(userId, (client) =>
      startUserSession(client, { userId, ipAddress: clientIp(request, process.env), userAgent: request.headers.get("user-agent"), request, remember: true, env: process.env }));
    const response = ok({ next: "/start?welcome=back" });
    setSessionCookie(response, session);
    clearSignupCookie(response);
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
