import { z } from "zod";

import { assertSameOrigin, clientIp, completeSignup, startUserSession } from "@vercentlabs/api";

import { identityTransaction, ingressTransaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { setSessionCookie } from "@/core/session";
import { clearSignupCookie, readSignupToken } from "@/features/auth/signup-cookie";

const schema = z.object({ apps: z.array(z.string().max(40)).min(1).max(12) });

// Screen 5: creates the workspace in one transaction (nothing is half-created), signs the owner in and opens the home page.
export async function POST(request: Request) {
  try {
    assertSameOrigin(request, process.env);
    const { apps } = schema.parse(await readJson(request));
    const token = (await readSignupToken()) ?? "";
    const created = await ingressTransaction((client) => completeSignup(client, token, { apps }, { request, env: process.env }));
    const session = await identityTransaction(created.userId, (client) =>
      startUserSession(client, { userId: created.userId, ipAddress: clientIp(request, process.env), userAgent: request.headers.get("user-agent"), request, remember: true, env: process.env }));
    const response = ok({ href: "/", apps: created.apps });
    setSessionCookie(response, session);
    clearSignupCookie(response);
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
