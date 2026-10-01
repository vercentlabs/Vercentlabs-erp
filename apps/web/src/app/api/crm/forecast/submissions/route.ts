import { submitForecast } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok, readJson } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";

// F025 a seller submits (or resubmits) their own forecast for an open period.
export async function POST(request: Request) {
  return workspaceRoute(
    request,
    {
      module: "crm",
      permission: CRM_PERMISSIONS.forecastSubmit,
      billingWrite: true,
      action: "crm.forecast.submit",
    },
    async ({ client, session }) => {
      const input = (await readJson(request)) as Record<string, unknown>;
      return ok(
        await submitForecast(client, crmContext(session), input as never),
      );
    },
  );
}
