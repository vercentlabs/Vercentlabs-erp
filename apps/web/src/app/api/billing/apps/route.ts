import { z } from "zod";

import { chooseApps, getAppChoice } from "@vercentlabs/api";
import { BILLING_PERMISSIONS } from "@vercentlabs/permissions";

import { ok, readJson } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

const schema = z.object({ module: z.string().min(1).max(40) });

// The Free plan's app: what was chosen and when it may change (Shared Platform plan 2).
export async function GET(request: Request) {
  return workspaceRoute(request, { permission: BILLING_PERMISSIONS.view, action: "billing.apps" }, async ({ client, session }) =>
    ok({ appChoice: await getAppChoice(client, session.organizationId) }));
}

// Choose or switch the app (owner or administrator; once every 30 days after the first pick).
export async function POST(request: Request) {
  return workspaceRoute(
    request,
    { permission: BILLING_PERMISSIONS.manage, action: "billing.apps.choose", auditDenial: true },
    async ({ client, session }) => {
      const body = schema.parse(await readJson(request));
      const ctx = { organizationId: session.organizationId, userId: session.userId, roleSlugs: session.roleSlugs };
      return ok({ appChoice: await chooseApps(client, ctx, { module: body.module }) });
    },
  );
}
