import { z } from "zod";

import { cancelScheduledConfiguration } from "@vercentlabs/api";
import { CORE_PERMISSIONS } from "@vercentlabs/permissions";

import { ok, readJson } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

// Cancels a scheduled (not yet effective) change.
const schema = z.object({ namespace: z.string().max(120), key: z.string().max(160), version: z.number().int().min(1) });

export async function POST(request: Request) {
  return workspaceRoute(
    request,
    { permission: CORE_PERMISSIONS.platformConfigurationManage, action: "configuration.cancel_schedule", transaction: "platform", auditDenial: true },
    async ({ client, session }) => ok(await cancelScheduledConfiguration(client, session, schema.parse(await readJson(request)))),
  );
}
