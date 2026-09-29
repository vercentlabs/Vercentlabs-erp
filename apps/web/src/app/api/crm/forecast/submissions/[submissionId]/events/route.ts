import { listForecastSubmissionEvents } from "@vercentlabs/api";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";

// F025 submission history (submitted, resubmitted, adjusted, approved,
// rejected) for the owner, their managers and forecast governors.
export async function GET(
  request: Request,
  context: { params: Promise<{ submissionId: string }> },
) {
  return workspaceRoute(
    request,
    { module: "crm" },
    async ({ client, session }) => {
      const { submissionId } = await context.params;
      return ok({
        events: await listForecastSubmissionEvents(
          client,
          crmContext(session),
          submissionId,
        ),
      });
    },
  );
}
