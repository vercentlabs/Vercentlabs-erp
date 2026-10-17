import { getTimesheetSettings, saveTimesheetSettings } from "@vercentlabs/api";
import { z } from "zod";

import { projectsMutation, projectsRead } from "@/features/projects/shared/route-helpers";

// The company's time policy: week start, daily review and limit, increment, deadline, late submissions, the boundary-day rule, collaborators.
const schema = z.object({ weekStart: z.number().int().optional(), dailyReviewMinutes: z.number().int().optional(), dailyLimitMinutes: z.number().int().optional(), incrementMinutes: z.number().int().optional(),
  deadlineDays: z.number().int().optional(), lateAllowed: z.boolean().optional(), boundaryDayPolicy: z.enum(["REVIEW", "BLOCK"]).optional(), collaboratorsAllowed: z.boolean().optional() });
export async function GET(request: Request) {
  return projectsRead(request, async (client, context) => ({ settings: await getTimesheetSettings(client, context) }));
}
export async function POST(request: Request) {
  return projectsMutation(request, schema, async (client, context, input) => ({ settings: await saveTimesheetSettings(client, context, input) }));
}
