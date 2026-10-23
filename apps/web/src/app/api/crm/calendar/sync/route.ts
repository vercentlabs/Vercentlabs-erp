import { syncMyCalendar } from "@vercentlabs/api/crm";

import { ok, readJson } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";

// "Sync now": the signed-in person's connected calendars brought up to date at once, both ways (the worker also does it every minute).
// pastDays (optional, up to 365): also add the person's past meetings, calls, follow-ups and tasks of that many days.
export async function POST(request: Request) {
  return workspaceRoute(request, { module: "crm" }, async ({ client, session, snapshot }) => {
    const body = (await readJson(request).catch(() => ({}))) as { pastDays?: unknown };
    const pastDays = Math.min(365, Math.max(0, Math.trunc(Number(body?.pastDays) || 0)));
    return ok({ result: await syncMyCalendar(client, crmContext(session, snapshot), { pastDays }) });
  });
}
