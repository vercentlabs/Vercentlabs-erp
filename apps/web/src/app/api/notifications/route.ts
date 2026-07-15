import { getSessionContext } from "@/lib/auth";
import { query } from "@/lib/db";
import { errorResponse, HttpError, ok, readJson } from "@/lib/http";
import { assertSameOrigin } from "@/lib/security";
import { notificationActionSchema } from "@/lib/validation";

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
