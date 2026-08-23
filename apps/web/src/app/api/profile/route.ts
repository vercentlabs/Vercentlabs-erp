import { requireApiPermission } from "@/core/authorization";
import { query, transaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { assertSameOrigin, audit } from "@/core/security";
import { profileSchema } from "@/core/validation";

export async function PATCH(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await requireApiPermission("profile.manage");
    const input = profileSchema.parse(await readJson(request));
    const before = await query<{
      full_name: string;
      locale: string;
      timezone: string | null;
      theme: string;
    }>(
      `
      SELECT u.full_name, COALESCE(p.locale, 'en-IN') AS locale,
        COALESCE(p.timezone, o.timezone) AS timezone, COALESCE(p.theme, 'system') AS theme
      FROM users u
      JOIN organizations o ON o.id = $2
      LEFT JOIN user_preferences p ON p.user_id = u.id AND p.organization_id = o.id
      WHERE u.id = $1
    `,
      [session.userId, session.organizationId],
    );

    await transaction(async (client) => {
      await client.query(
        "UPDATE users SET full_name=$2, updated_at=now() WHERE id=$1",
        [session.userId, input.fullName],
      );
      await client.query(
        `
        INSERT INTO user_preferences (organization_id, user_id, locale, timezone, theme)
        VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT (organization_id,user_id) DO UPDATE SET
          locale=EXCLUDED.locale, timezone=EXCLUDED.timezone, theme=EXCLUDED.theme, updated_at=now()
      `,
        [
          session.organizationId,
          session.userId,
          input.locale,
          input.timezone,
          input.theme,
        ],
      );
    });

    await audit({
      organizationId: session.organizationId,
      actorUserId: session.userId,
      eventType: "profile.updated",
      entityType: "user",
      entityId: session.userId,
      beforeData: before[0] || null,
      afterData: input,
      request,
    });
    return ok({ message: "Profile updated." });
  } catch (error) {
    return errorResponse(error);
  }
}
