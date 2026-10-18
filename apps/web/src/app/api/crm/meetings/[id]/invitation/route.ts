import { cancelMeetingInvitation, getMeetingInvitation, sendMeetingInvitation } from "@vercentlabs/api/crm";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody } from "@/features/crm/leads/server/lead-http";

// A meeting's calendar invitation (CRM plan 4.5): GET what was sent; POST { attendees, location?, durationMinutes?, message? } sends or
// updates it; DELETE { message? } cancels it.
type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  return workspaceRoute(request, { module: "crm" }, async ({ client, session, snapshot }) =>
    ok({ invitation: await getMeetingInvitation(client, crmContext(session, snapshot), id) }));
}

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  return workspaceRoute(request, { module: "crm", billingWrite: true }, async ({ client, session, snapshot }) =>
    ok({ result: await sendMeetingInvitation(client, crmContext(session, snapshot), id, await readBody(request) as never) }));
}

export async function DELETE(request: Request, { params }: Params) {
  const { id } = await params;
  return workspaceRoute(request, { module: "crm", billingWrite: true }, async ({ client, session, snapshot }) => {
    const body = await readBody(request).catch(() => ({} as Record<string, unknown>));
    return ok({ result: await cancelMeetingInvitation(client, crmContext(session, snapshot), id, { message: body.message ? String(body.message) : null }) });
  });
}
