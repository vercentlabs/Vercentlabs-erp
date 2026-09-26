import { z } from "zod";

import { assertSameOrigin, clientIp, enforceRateLimit, findUserForSignIn, recordLoginEvent, startUserSession, verifyPasswordOrDummy } from "@vercentlabs/api";

import { identityTransaction, withIngressClient } from "@/core/db";
import { errorResponse, HttpError, ok, readJson } from "@/core/http";
import { setSessionCookie } from "@/core/session";

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  password: z.string().min(1).max(200),
});

export async function POST(request: Request) {
  try {
    assertSameOrigin(request, process.env);
    const body = loginSchema.parse(await readJson(request));

    await withIngressClient((client) =>
      enforceRateLimit(
        client,
        `login:${clientIp(request, process.env)}`,
        10,
        300,
      ),
    );

    const user = await withIngressClient((client) => findUserForSignIn(client, body.email));

    const passwordOk = await verifyPasswordOrDummy(
      body.password,
      user?.password_hash ?? null,
    );
    const succeeded = Boolean(user && user.status === "active" && passwordOk);

    await withIngressClient((client) =>
      recordLoginEvent(client, {
        request,
        email: body.email,
        userId: user?.id ?? null,
        succeeded,
        reason: succeeded ? undefined : "invalid_credentials",
        env: process.env,
      }),
    );

    if (!succeeded || !user) {
      throw new HttpError(
        401,
        "Incorrect email or password.",
        "AUTH_INVALID_CREDENTIALS",
      );
    }

    // Identity context for the user whose password was just verified.
    const session = await identityTransaction(user.id, (client) =>
      startUserSession(client, { userId: user.id, ipAddress: clientIp(request, process.env), userAgent: request.headers.get("user-agent"), request, env: process.env }),
    );

    const response = ok({ message: "Signed in." });
    setSessionCookie(response, session);
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
