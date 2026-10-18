import { calendarAuthorizeUrl } from "@vercentlabs/api/crm";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";

// Where to send the person to allow CRM to keep their calendar ({ url }); the browser goes there.
export async function GET(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  return workspaceRoute(request, { module: "crm" }, async ({ session, snapshot }) =>
    ok({ url: await calendarAuthorizeUrl(crmContext(session, snapshot), provider) }));
}
