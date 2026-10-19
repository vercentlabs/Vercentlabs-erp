import { getMailSettings, listMailLog, saveMailSettings } from "@vercentlabs/api";
import { CORE_PERMISSIONS } from "@vercentlabs/permissions";

import { ok, readJson } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

// Settings > Email (Shared Platform plan 4): how the company's email is sent, and the delivery log.
export async function GET(request: Request) {
  return workspaceRoute(request, { permission: CORE_PERMISSIONS.organizationManage, action: "mail.settings.view" }, async ({ client, session }) =>
    ok({ settings: await getMailSettings(client, session.organizationId), log: await listMailLog(client, session.organizationId, { limit: 100 }) }));
}

export async function PUT(request: Request) {
  return workspaceRoute(request, { permission: CORE_PERMISSIONS.organizationManage, action: "mail.settings.update" }, async ({ client, session }) =>
    ok({ settings: await saveMailSettings(client, session, (await readJson(request)) as Record<string, unknown>) }));
}
