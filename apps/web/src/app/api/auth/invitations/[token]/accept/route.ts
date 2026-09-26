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

import { ingressTransaction, withIngressClient } from "@/core/db";
import { errorResponse, HttpError, ok, readJson } from "@/core/http";
import { getSessionContext, setSessionCookie } from "@/core/session";

const schema = z.object({
  fullName: z.string().trim().min(1).max(200).optional(),
  password: z.string().min(1).max(200).optional(),
});

export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  try {
    assertSameOrigin(request, process.env);
    const { token } = await context.params;
    const body = schema.parse(await readJson(request));
    await withIngressClient((client) => enforceRateLimit(client, `accept-invitation:${clientIp(request, process.env)}`, 10, 300));

    if (body.password) {
      const issues = passwordPolicyIssues(body.password);
      if (issues.length > 0) throw new HttpError(422, issues[0], "AUTH_PASSWORD_POLICY", { issues });
    }

    // getSessionContext(), not requireUser() — an anonymous visitor
    // accepting a brand-new-account invitation is a valid, expected case
    // here, not an error to redirect away from. Whatever it resolves to is
    // the only "already this account" proof acceptOrganizationInvitation
    // will accept for an EXISTING account — never anything from the
    // request body, which a caller fully controls.
    const currentSession = await getSessionContext();

    const result = await ingressTransaction(async (client) => {
      const accepted = await acceptOrganizationInvitation(client, token, body, currentSession?.userId ?? null);
      if (!accepted.mintNewSession) {
        // Existing account, already authenticated as itself — reuse its
        // live session rather than minting a second one; just point it at
        // the newly joined organization. acceptOrganizationInvitation only
        // returns mintNewSession: false via its "existing account" branch,
        // which requires authenticatedUserId to match — currentSession
        // must be non-null here, TypeScript just can't see across the call.
        if (!currentSession) throw new HttpError(500, "Expected an authenticated session for an existing-account acceptance.");
        await setSessionOrganization(client, currentSession.sessionId, accepted.userId, accepted.organizationId);
        return { accepted, newSession: null };
      }
      const created = await createSession(client, {
        userId: accepted.userId,
        ipAddress: clientIp(request, process.env),
        userAgent: request.headers.get("user-agent"),
        env: process.env,
      });
      await setSessionOrganization(client, created.sessionId, accepted.userId, accepted.organizationId);
      return { accepted, newSession: created };
    });

    const response = ok({ accepted: true }, 201);
    if (result.newSession) setSessionCookie(response, result.newSession);
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
