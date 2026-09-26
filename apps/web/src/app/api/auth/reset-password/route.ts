import { z } from "zod";

import { assertSameOrigin, clientIp, enforceRateLimit, passwordPolicyIssues, resetPasswordWithToken } from "@vercentlabs/api";

import { ingressTransaction, withIngressClient } from "@/core/db";
import { errorResponse, HttpError, ok, readJson } from "@/core/http";

const schema = z.object({ token: z.string().min(1).max(500), password: z.string().min(1).max(200) });

export async function POST(request: Request) {
  try {
    assertSameOrigin(request, process.env);
    const body = schema.parse(await readJson(request));
    await withIngressClient((client) => enforceRateLimit(client, `reset-password:${clientIp(request, process.env)}`, 10, 300));

    const issues = passwordPolicyIssues(body.password);
    if (issues.length > 0) throw new HttpError(422, issues[0], "AUTH_PASSWORD_POLICY", { issues });

    // ingressTransaction(), not withIngressClient() — token consumption, the password
    // update, and session revocation must commit or roll back together
    // (2C: a crash between steps must never leave a token marked used
    // with the password unchanged, or a password changed with old
    // sessions still live).
    const result = await ingressTransaction((client) => resetPasswordWithToken(client, body.token, body.password));
    return ok({ reset: true, userId: result.userId });
  } catch (error) {
    return errorResponse(error);
  }
}
