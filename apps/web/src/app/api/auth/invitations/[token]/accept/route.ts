import { z } from "zod";

import {
  acceptOrganizationInvitation,
  assertSameOrigin,
  clientIp,
  createSession,
  enforceRateLimit,
  passwordPolicyIssues,
  setSessionOrganization,
} from "@vercentlabs/api";

import { transaction, withClient } from "@/core/db";
import { errorResponse, HttpError, ok, readJson } from "@/core/http";
import { setSessionCookie } from "@/core/session";

const schema = z.object({
  fullName: z.string().trim().min(1).max(200).optional(),
  password: z.string().min(1).max(200).optional(),
});

export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  try {
    assertSameOrigin(request, process.env);
    const { token } = await context.params;
    const body = schema.parse(await readJson(request));
    await withClient((client) => enforceRateLimit(client, `accept-invitation:${clientIp(request, process.env)}`, 10, 300));

    if (body.password) {
      const issues = passwordPolicyIssues(body.password);
      if (issues.length > 0) throw new HttpError(422, issues[0], "AUTH_PASSWORD_POLICY", { issues });
    }

    const session = await transaction(async (client) => {
      const accepted = await acceptOrganizationInvitation(client, token, body);
      const created = await createSession(client, {
        userId: accepted.userId,
        ipAddress: clientIp(request, process.env),
        userAgent: request.headers.get("user-agent"),
        env: process.env,
      });
      await setSessionOrganization(client, created.sessionId, accepted.userId, accepted.organizationId);
      return created;
    });

    const response = ok({ accepted: true }, 201);
    setSessionCookie(response, session);
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
