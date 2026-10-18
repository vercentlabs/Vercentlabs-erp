import { addHoliday, listHolidays } from "@vercentlabs/api/crm";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody } from "@/features/crm/leads/server/lead-http";

// Holidays (CRM plan 5.6): ?year=, else this year and next.
export async function GET(request: Request) {
  const year = Number(new URL(request.url).searchParams.get("year")) || null;
  return workspaceRoute(request, { module: "crm" }, async ({ client, session, snapshot }) => ok({ holidays: await listHolidays(client, crmContext(session, snapshot), { year }) }));
}

// Body: { date, name }
export async function POST(request: Request) {
  return workspaceRoute(request, { module: "crm", billingWrite: true }, async ({ client, session, snapshot }) => {
    const body = await readBody(request);
    return ok({ holiday: await addHoliday(client, crmContext(session, snapshot), { date: String(body.date ?? ""), name: String(body.name ?? "") }) }, 201);
  });
}
