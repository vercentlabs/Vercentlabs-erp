import { getSessionContext, type WorkspaceSessionContext } from "@/lib/auth";
import { query } from "@/lib/db";
import { errorResponse, HttpError, ok, readJson } from "@/lib/http";
import { listMyNotifications } from "@/lib/my-work/notifications";
import { assertSameOrigin } from "@/lib/security";
import { notificationActionSchema } from "@/lib/validation";

// A compact preview for the topbar's notification popover (Part 16) — same
// query shape as apps/web/src/app/(app)/notifications/page.tsx, just
// capped smaller. Always scoped to the caller's own
// (organization_id, user_id) row, same as PATCH below and the full page —
// there is no path here for one user's notifications to reach another's.
const PREVIEW_LIMIT = 8;

export async function GET() {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId)
      throw new HttpError(401, "Sign in to continue.");
    const rows = await listMyNotifications(
      session as WorkspaceSessionContext,
      PREVIEW_LIMIT,
    );
    return ok({
      notifications: rows.map((row) => ({
        id: row.id,
        title: row.title,
        message: row.message,
        href: row.href,
        readAt: row.read_at?.toISOString() || null,
        createdAt: row.created_at.toISOString(),
      })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await getSessionContext();
    if (!session?.organizationId)
      throw new HttpError(401, "Sign in to continue.");
    const input = notificationActionSchema.parse(await readJson(request));
    if (input.action === "read-all") {
      await query(
        "UPDATE notifications SET read_at = COALESCE(read_at, now()) WHERE organization_id = $1 AND user_id = $2",
        [session.organizationId, session.userId],
      );
    } else {
      if (!input.id) throw new HttpError(400, "Notification id is required.");
      await query(
        "UPDATE notifications SET read_at = COALESCE(read_at, now()) WHERE id = $1 AND organization_id = $2 AND user_id = $3",
        [input.id, session.organizationId, session.userId],
      );
    }
    return ok({ message: "Notifications updated." });
  } catch (error) {
    return errorResponse(error);
  }
}
