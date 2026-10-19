import { z } from "zod";
import { queueTimeTriggeredRuns } from "@vercentlabs/api";

export const JOB_TYPE = "platform.workflows.time_triggers";

export const payloadSchema = z.object({ date: z.string().optional() }).strict();

// Once a day: automations on a date ("3 days after an invoice is due") get one run per record that reaches its day; the workflow
// runner then executes them like any other run.
export async function workflowTimeTriggersHandler(client, systemContext, payload = {}) {
  return queueTimeTriggeredRuns(client, systemContext.organizationId, payload.date ?? null);
}
