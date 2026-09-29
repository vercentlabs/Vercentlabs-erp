import { z } from "zod";

import { createReportSchedule, listReportSchedules } from "@vercentlabs/api";

import { ok, readJson } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

// Scheduled delivery of saved reports. Each recipient's copy is generated
// with that recipient's own authority; the domain validates the dataset's
// schedule permission, the owner and every recipient.
export async function GET(request: Request) {
  return workspaceRoute(
    request,
    { snapshot: true, action: "reports.schedules.list" },
    async ({ client, session }) =>
      ok({ schedules: await listReportSchedules(client, session) }),
  );
}

const schema = z.object({
  definitionId: z.string().uuid(),
  frequency: z.enum(["daily", "weekly", "monthly"]),
  timeOfDay: z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/),
  timezone: z.string().min(1).max(64),
  weekday: z.number().int().min(0).max(6).nullable().optional(),
  monthDay: z.number().int().min(1).max(28).nullable().optional(),
  recipients: z.array(z.string().uuid()).min(1).max(25),
});

export async function POST(request: Request) {
  return workspaceRoute(
    request,
    { snapshot: true, billingWrite: true, action: "reports.schedules.create" },
    async ({ client, session, snapshot }) =>
      ok(
        {
          schedule: await createReportSchedule(
            client,
            session,
            snapshot?.accessibleModules ?? [],
            schema.parse(await readJson(request)),
          ),
        },
        201,
      ),
  );
}
