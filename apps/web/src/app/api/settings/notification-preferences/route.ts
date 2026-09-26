import { z } from "zod";

import { listNotificationPreferences, setNotificationPreference } from "@vercentlabs/api";

import { ok, readJson } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

// The caller's own in-app notification preferences. Only registered,
// configurable categories exist; there is no email or push channel here, and
// security email (sign-in, password reset, MFA) is never affected.
export async function GET(request: Request) {
  return workspaceRoute(request, { action: "notification_preferences.list" }, async ({ client, session }) =>
    ok({ preferences: await listNotificationPreferences(client, session) }),
  );
}

const schema = z.object({ category: z.string().trim().min(1).max(120), enabled: z.boolean() });

export async function PUT(request: Request) {
  return workspaceRoute(request, { action: "notification_preferences.update" }, async ({ client, session }) => {
    const body = schema.parse(await readJson(request));
    return ok({ preference: await setNotificationPreference(client, session, { ...body, channel: "in_app" }) });
  });
}
