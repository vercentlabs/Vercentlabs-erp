import { z } from "zod";

import {
  createInboundMailRoute,
  INBOUND_MAIL_TARGETS,
  listInboundMailEvents,
  listInboundMailRoutes,
} from "@vercentlabs/api";
import { CORE_PERMISSIONS } from "@vercentlabs/permissions";

import { ok, readJson } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

// Settings > Integrations > Inbound email. The route key (the provider's
// webhook URL) and its signing secret are in the create response once.
export async function GET(request: Request) {
  return workspaceRoute(
    request,
    {
      permission: CORE_PERMISSIONS.integrationsView,
      action: "integrations.inbound_mail.list",
    },
    async ({ client, session }) =>
      ok({
        routes: await listInboundMailRoutes(client, session.organizationId),
        events: await listInboundMailEvents(client, session.organizationId, {
          limit: 25,
        }),
        targets: INBOUND_MAIL_TARGETS,
      }),
  );
}

const schema = z.object({
  name: z.string().trim().min(1).max(120),
  target: z.string().max(80),
  recordedAsUserId: z.string().uuid().nullable().optional(),
});

export async function POST(request: Request) {
  return workspaceRoute(
    request,
    {
      permission: CORE_PERMISSIONS.integrationsManage,
      action: "integrations.inbound_mail.create",
      auditDenial: true,
    },
    async ({ client, session }) => {
      const created = await createInboundMailRoute(
        client,
        session,
        schema.parse(await readJson(request)),
      );
      const origin = new URL(request.url).origin;
      return ok(
        {
          route: created.route,
          webhookUrl: `${process.env.APP_URL?.replace(/\/+$/, "") || origin}/api/platform/mail/inbound/${created.routeKey}`,
          signingSecret: created.signingSecret,
        },
        201,
      );
    },
  );
}
