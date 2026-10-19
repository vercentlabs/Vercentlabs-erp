import { z } from "zod";
import { remindDueRecordActivities } from "@vercentlabs/api";

export const JOB_TYPE = "platform.record_activities.remind";

export const payloadSchema = z.object({ date: z.string().optional() }).strict();

// Once a day: every open activity on a record (call, meeting, to-do, email) that is due is reminded to its assignee, once a day.
export async function remindRecordActivitiesHandler(client, systemContext) {
  return remindDueRecordActivities(client, systemContext.organizationId);
}
