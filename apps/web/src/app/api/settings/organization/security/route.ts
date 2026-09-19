import { z } from "zod";

import { assertSameOriginOrMobile, audit, setOrganizationMfaEnforcement } from "@vercentlabs/api";

import { transaction, withClient } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireApiWorkspace } from "@/core/session";

// SP007 "Organization-enforced MFA" — platform.security.manage (enforced
// inside setOrganizationMfaEnforcement itself, not just here) restricts
// this to organization_owner/system_administrator.
export async function GET() {
  try {
    const session = await requireApiWorkspace();
    const row = await withClient((client) =>
      client.query(`SELECT mfa_enforced FROM organizations WHERE id = $1`, [session.organizationId]),
    );
    return ok({ mfaEnforced: Boolean(row.rows[0]?.mfa_enforced) });
  } catch (error) {
    return errorResponse(error);
  }
}

const putSchema = z.object({ mfaEnforced: z.boolean() });

export async function PUT(request: Request) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireApiWorkspace();
    const body = putSchema.parse(await readJson(request));
    const result = await transaction(async (client) => {
      const updated = await setOrganizationMfaEnforcement(client, session, body.mfaEnforced);
      await audit(client, {
        organizationId: session.organizationId,
        actorUserId: session.userId,
        eventType: "auth.mfa.organization_policy_changed",
        entityType: "organization",
        entityId: session.organizationId,
        request,
        env: process.env,
      });
      return updated;
    });
    return ok(result);
  } catch (error) {
    return errorResponse(error);
  }
}
