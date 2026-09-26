import { z } from "zod";

import { setOrganizationModuleEnabled } from "@vercentlabs/api";
import { CORE_PERMISSIONS } from "@vercentlabs/permissions";

import { ok, readJson } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

const putSchema = z.object({ enabled: z.boolean() });

// Organization-wide enablement (modules.manage). Idempotent; audited with
// before/after; never deletes role assignments or business data.
export async function PUT(request: Request, context: { params: Promise<{ key: string }> }) {
  return workspaceRoute(
    request,
    { permission: CORE_PERMISSIONS.modulesManage, action: "settings.modules.update", auditDenial: true },
    async ({ client, session }) => {
      const { key } = await context.params;
      const body = putSchema.parse(await readJson(request));
      return ok(await setOrganizationModuleEnabled(client, session, key, body.enabled, { request, env: process.env }));
    },
  );
}
