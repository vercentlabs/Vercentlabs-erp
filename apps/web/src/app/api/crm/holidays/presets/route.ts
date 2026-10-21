import { addPresetHolidays, holidayPresets, HOLIDAY_PRESET_YEARS } from "@vercentlabs/api/crm";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody } from "@/features/crm/leads/server/lead-http";

// Holiday presets by state (CRM audit). GET ?year=&state= what would be added; POST { year, state?, dates? } adds them.
export async function GET(request: Request) {
  return workspaceRoute(request, { module: "crm" }, async () => {
    const params = new URL(request.url).searchParams;
    return ok({ years: HOLIDAY_PRESET_YEARS, presets: holidayPresets(Number(params.get("year")), params.get("state") || null) });
  });
}

export async function POST(request: Request) {
  return workspaceRoute(request, { module: "crm", billingWrite: true }, async ({ client, session, snapshot }) => {
    const body = await readBody(request);
    return ok(await addPresetHolidays(client, crmContext(session, snapshot), {
      year: Number(body.year), state: body.state ? String(body.state) : null, dates: Array.isArray(body.dates) ? body.dates.map(String) : undefined,
    }));
  });
}
