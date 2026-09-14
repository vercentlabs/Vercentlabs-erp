import { z } from "zod";

import {
  verifyPasswordOrDummy,
  createSession,
  setSessionOrganization,
} from "@vercentlabs/api";
import {
  assertSameOrigin,
  clientIp,
  enforceRateLimit,
  audit,
  recordLoginEvent,
} from "@vercentlabs/api";

import { transaction, withClient } from "@/core/db";
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

    await withClient((client) =>
      enforceRateLimit(
        client,
        `login:${clientIp(request, process.env)}`,
        10,
        300,
      ),
    );

    const user = await withClient(async (client) => {
      const rows = await client.query(
        `SELECT id, email, password_hash, status FROM users WHERE lower(email) = $1 LIMIT 1`,
        [body.email],
      );
      return rows.rows[0] as
        | {
            id: string;
            email: string;
            password_hash: string | null;
            status: string;
          }
        | undefined;
    });

    const passwordOk = await verifyPasswordOrDummy(
      body.password,
      user?.password_hash ?? null,
    );
    const succeeded = Boolean(user && user.status === "active" && passwordOk);

    await withClient((client) =>
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

    const session = await transaction(async (client) => {
      const created = await createSession(client, {
        userId: user.id,
        ipAddress: clientIp(request, process.env),
        userAgent: request.headers.get("user-agent"),
        env: process.env,
      });
      // Attach the user's most recently active organization, if any —
      // getSessionContext()'s own membership query re-resolves and
      // corrects this on first use, this is only a helpful default.
      const membership = await client.query(
        `SELECT organization_id FROM organization_memberships
          WHERE user_id = $1 AND status = 'active'
          ORDER BY created_at ASC LIMIT 1`,
        [user.id],
      );
      const organizationId = membership.rows[0]?.organization_id as
        string | undefined;
      if (organizationId) {
        await setSessionOrganization(
          client,
          created.sessionId,
          user.id,
          organizationId,
        );
      }
      await audit(client, {
        organizationId: organizationId ?? null,
        actorUserId: user.id,
        eventType: "auth.session.created",
        entityType: "session",
        entityId: created.sessionId,
        request,
        env: process.env,
      });
      return created;
    });

    const response = ok({ message: "Signed in." });
    setSessionCookie(response, session);
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
