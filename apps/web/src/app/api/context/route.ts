import { getSessionContext } from "@/core/auth";
import { query } from "@/core/db";
import { errorResponse, HttpError, ok, readJson } from "@/core/http";
import { assertSameOrigin, audit } from "@/core/security";
import { contextSchema } from "@/core/validation";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await getSessionContext();
    if (!session?.organizationId)
      throw new HttpError(401, "Sign in to an organisation workspace.");
    const input = contextSchema.parse(await readJson(request));
    const owner =
      session.roleSlugs.includes("organization_owner") ||
      session.roleSlugs.includes("system_administrator");

    const company = await query<{ id: string }>(
      `
      SELECT c.id FROM companies c
      WHERE c.id = $1 AND c.organization_id = $2 AND c.status = 'active'
        AND ($4::boolean OR EXISTS (
          SELECT 1 FROM membership_company_access a
          WHERE a.organization_id = $2 AND a.user_id = $3 AND a.company_id = c.id
        ))
    `,
      [input.companyId, session.organizationId, session.userId, owner],
    );
    if (!company[0])
      throw new HttpError(403, "This company is outside your access scope.");

    if (input.branchId) {
      const branch = await query<{ id: string }>(
        `
        SELECT b.id FROM branches b
        WHERE b.id = $1 AND b.organization_id = $2 AND b.company_id = $3 AND b.status = 'active'
          AND ($5::boolean OR EXISTS (
            SELECT 1 FROM membership_branch_access a
            WHERE a.organization_id = $2 AND a.user_id = $4 AND a.branch_id = b.id
          ))
      `,
        [
          input.branchId,
          session.organizationId,
          input.companyId,
          session.userId,
          owner,
        ],
      );
      if (!branch[0])
        throw new HttpError(403, "This branch is outside your access scope.");
    }

    await query(
      `
      INSERT INTO user_preferences (organization_id, user_id, active_company_id, active_branch_id)
      VALUES ($1,$2,$3,$4)
      ON CONFLICT (organization_id, user_id) DO UPDATE SET
        active_company_id = EXCLUDED.active_company_id,
        active_branch_id = EXCLUDED.active_branch_id,
        updated_at = now()
    `,
      [session.organizationId, session.userId, input.companyId, input.branchId],
    );

    await audit({
      organizationId: session.organizationId,
      actorUserId: session.userId,
      eventType: "workspace.context_changed",
      entityType: "user_preference",
      entityId: session.userId,
      afterData: input,
      request,
    });
    return ok({ message: "Operating context updated." });
  } catch (error) {
    return errorResponse(error);
  }
}
