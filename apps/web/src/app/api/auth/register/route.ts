import { z } from "zod";

import {
  assertSameOrigin,
  audit,
  clientIp,
  createEmailVerificationToken,
  createSession,
  enforceRateLimit,
  registerOrganization,
  setSessionOrganization,
} from "@vercentlabs/api";

import { ingressTransaction, withIngressClient } from "@/core/db";
import { errorResponse, readJson, ok } from "@/core/http";
import { setSessionCookie } from "@/core/session";

const schema = z.object({
  fullName: z.string().trim().min(1).max(200),
  email: z.string().trim().toLowerCase().email().max(320),
  password: z.string().min(1).max(200),
  organizationName: z.string().trim().min(1).max(200),
  countryCode: z.string().trim().length(2),
  baseCurrency: z.string().trim().length(3),
  timezone: z.string().trim().min(1).max(100),
});

// Self-serve "create your own account" -- the counterpart to invitation
// acceptance, for a prospective customer with no existing relationship to
// any organization. Public by design (no session required to reach this),
// so it is rate-limited by IP the same way login/accept-invitation are,
// and never discloses more than "an account with this email already
// exists" (which, unlike login/reset, is normal and expected signup UX,
// not an account-enumeration concern).
export async function POST(request: Request) {
  try {
    assertSameOrigin(request, process.env);
    const body = schema.parse(await readJson(request));
    await withIngressClient((client) => enforceRateLimit(client, `register:${clientIp(request, process.env)}`, 5, 600));

    const result = await ingressTransaction(async (client) => {
      const registered = await registerOrganization(client, body);
      const session = await createSession(client, {
        userId: registered.userId,
        ipAddress: clientIp(request, process.env),
        userAgent: request.headers.get("user-agent"),
        env: process.env,
      });
      await setSessionOrganization(client, session.sessionId, registered.userId, registered.organizationId);
      await audit(client, {
        organizationId: registered.organizationId,
        actorUserId: registered.userId,
        eventType: "organization.registered",
        entityType: "organization",
        entityId: registered.organizationId,
        request,
        env: process.env,
      });
      return { registered, session };
    });

    // Verification email sent outside the transaction that created the
    // account (same convention as every other auth-mailer call site in
    // this codebase) -- a delivery failure must never roll back a
    // successful signup; the user can always request a fresh link from
    // /verify-email.
    await withIngressClient((client) => createEmailVerificationToken(client, result.registered.userId, process.env));

    const response = ok({ registered: true }, 201);
    setSessionCookie(response, result.session);
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
