import { rotateInboundMailRouteKeys } from "@vercentlabs/api";
import { CORE_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

// New webhook URL and signing secret for an address (the old ones stop working at once); shown once, like creation.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return workspaceRoute(
    request,
    { permission: CORE_PERMISSIONS.integrationsManage, action: "integrations.inbound_mail.rotate", auditDenial: true },
    async ({ client, session }) => {
      const rotated = await rotateInboundMailRouteKeys(client, session, id);
      const origin = new URL(request.url).origin;
      return ok({
        route: rotated.route,
        webhookUrl: `${process.env.APP_URL?.replace(/\/+$/, "") || origin}/api/platform/mail/inbound/${rotated.routeKey}`,
        signingSecret: rotated.signingSecret,
      });
    },
  );
}
