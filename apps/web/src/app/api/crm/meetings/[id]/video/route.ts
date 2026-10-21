import { getMeetingVideo, setMeetingVideo } from "@vercentlabs/api/crm";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody } from "@/features/crm/leads/server/lead-http";

// A meeting's video call (CRM audit): GET the call and which kinds can be made; PUT { provider: google_meet | teams | zoom | link | null, link? }.
type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  return workspaceRoute(request, { module: "crm" }, async ({ client, session, snapshot }) => ok({ video: await getMeetingVideo(client, crmContext(session, snapshot), id) }));
}

export async function PUT(request: Request, { params }: Params) {
  const { id } = await params;
  return workspaceRoute(request, { module: "crm", billingWrite: true }, async ({ client, session, snapshot }) =>
    ok({ video: await setMeetingVideo(client, crmContext(session, snapshot), id, await readBody(request)) }));
}
