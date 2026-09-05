import { z } from "zod";

import { requireApiPermission } from "@/core/authorization";
import { errorResponse, ok, readJson } from "@/core/http";
import { assertSameOrigin } from "@/core/security";
import { listNotificationPreferences, setNotificationPreference } from "@/core/shared-platform";

const preferenceSchema = z.object({
  channel: z.enum(["in_app", "email", "push"]),
  category: z.string().trim().min(1).max(120),
  enabled: z.boolean(),
  quietHoursStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/).optional().nullable(),
  quietHoursEnd: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/).optional().nullable(),
});

export async function GET() {
  try {
    const session = await requireApiPermission("notifications.view");
    return ok({ preferences: await listNotificationPreferences(session) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await requireApiPermission("notifications.view");
    const input = preferenceSchema.parse(await readJson(request));
    await setNotificationPreference(session, input);
    return ok({ message: "Notification preference updated." });
  } catch (error) {
    return errorResponse(error);
  }
}
