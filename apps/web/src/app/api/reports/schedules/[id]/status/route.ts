import { z } from "zod";

import { setReportScheduleStatus } from "@vercentlabs/api";

import { ok, readJson } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

const schema = z.object({ status: z.enum(["active", "paused", "cancelled"]) });

// Pause, resume or cancel a schedule (its owner or a reports administrator).
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return workspaceRoute(
    request,
    { snapshot: true, action: "reports.schedules.status" },
    async ({ client, session }) => {
      const { id } = await context.params;
      const { status } = schema.parse(await readJson(request));
      return ok({
        schedule: await setReportScheduleStatus(client, session, id, status),
      });
    },
  );
}
