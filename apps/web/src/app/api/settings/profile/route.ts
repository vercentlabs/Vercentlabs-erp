import { getOwnProfile, updateOwnProfile } from "@vercentlabs/api";

import { ok, readJson } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

// The signed-in person's own profile and preferences (Shared Platform plan 3).
export async function GET(request: Request) {
  return workspaceRoute(request, { action: "profile.view" }, async ({ client, session }) => ok({ profile: await getOwnProfile(client, session) }));
}

export async function PUT(request: Request) {
  return workspaceRoute(request, { action: "profile.update" }, async ({ client, session }) =>
    ok({ profile: await updateOwnProfile(client, session, (await readJson(request)) as Record<string, unknown>) }));
}
