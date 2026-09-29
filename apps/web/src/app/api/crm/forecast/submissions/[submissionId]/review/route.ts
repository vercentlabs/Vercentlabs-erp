import { reviewForecast } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok, readJson } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";

// F025 manager review: approve, reject or adjust (with a reason).
export async function POST(
  request: Request,
  context: { params: Promise<{ submissionId: string }> },
) {
  return workspaceRoute(
    request,
    {
      module: "crm",
      permission: CRM_PERMISSIONS.forecastReview,
      billingWrite: true,
      action: "crm.forecast.review",
    },
    async ({ client, session }) => {
      const { submissionId } = await context.params;
      const input = (await readJson(request)) as Record<string, unknown>;
      return ok(
        await reviewForecast(client, crmContext(session), {
          ...(input as object),
          submissionId,
        } as never),
      );
    },
  );
}
