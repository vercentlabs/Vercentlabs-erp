import { setForecastPeriodStatus } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok, readJson } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";

// F025 period lifecycle: open -> frozen -> closed (frozen -> open allowed).
// Freeze and close capture a snapshot in the same transaction.
export async function POST(
  request: Request,
  context: { params: Promise<{ periodId: string }> },
) {
  return workspaceRoute(
    request,
    {
      module: "crm",
      permission: CRM_PERMISSIONS.forecastManage,
      billingWrite: true,
      action: "crm.forecast.period_status",
    },
    async ({ client, session }) => {
      const { periodId } = await context.params;
      const input = (await readJson(request)) as {
        status?: string;
        expectedUpdatedAt?: string;
      };
      return ok(
        await setForecastPeriodStatus(client, crmContext(session), {
          periodId,
          status: String(input.status ?? ""),
          expectedUpdatedAt: input.expectedUpdatedAt,
        }),
      );
    },
  );
}
