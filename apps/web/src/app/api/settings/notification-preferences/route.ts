import { z } from "zod";

import {
  getNotificationDigest,
  listNotificationPreferences,
  setNotificationDigest,
  setNotificationPreference,
} from "@vercentlabs/api";

import { ok, readJson } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

// The caller's own notification preferences: in-app and email per category,
// and the daily digest email. Only registered, configurable categories exist;
// security email (sign-in, password reset, MFA) is never affected.
export async function GET(request: Request) {
  return workspaceRoute(
    request,
    { action: "notification_preferences.list" },
    async ({ client, session }) =>
      ok({
        preferences: await listNotificationPreferences(client, session),
        digest: await getNotificationDigest(client, session),
      }),
  );
}

const schema = z.union([
  z.object({
    category: z.string().trim().min(1).max(120),
    channel: z.enum(["in_app", "email"]).default("in_app"),
    enabled: z.boolean(),
  }),
  z.object({ digest: z.boolean() }),
]);

export async function PUT(request: Request) {
  return workspaceRoute(
    request,
    { action: "notification_preferences.update" },
    async ({ client, session }) => {
      const body = schema.parse(await readJson(request));
      if ("digest" in body)
        return ok({ digest: await setNotificationDigest(client, session, body.digest) });
      return ok({
        preference: await setNotificationPreference(client, session, body),
      });
    },
  );
}
