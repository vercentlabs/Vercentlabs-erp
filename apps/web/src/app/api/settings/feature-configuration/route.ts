import { z } from "zod";

import { listTenantConfiguration, setTenantConfiguration } from "@vercentlabs/api";
import { CORE_PERMISSIONS } from "@vercentlabs/permissions";

import { ok, readJson } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

// Settings > Feature configuration: registered TENANT settings and flags only
// (operator rollout controls are never listed or writable here). Each change
// is a new effective-dated version; a future date schedules it.
export async function GET(request: Request) {
  return workspaceRoute(request, { permission: CORE_PERMISSIONS.platformConfigurationManage, action: "configuration.list", transaction: "none" }, async ({ client, session }) =>
    ok({ entries: await listTenantConfiguration(client, session.organizationId) }),
  );
}

const schema = z.object({
  namespace: z.string().max(120),
  key: z.string().max(160),
  value: z.union([z.number(), z.boolean()]),
  effectiveFrom: z.string().datetime({ offset: true }).nullable().optional(),
});

export async function PUT(request: Request) {
  return workspaceRoute(
    request,
    { permission: CORE_PERMISSIONS.platformConfigurationManage, action: "configuration.write", transaction: "platform", auditDenial: true },
    async ({ client, session }) => ok({ version: await setTenantConfiguration(client, session, schema.parse(await readJson(request))) }),
  );
}
