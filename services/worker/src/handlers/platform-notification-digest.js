import { z } from "zod";
import { sendNotificationDigests } from "@vercentlabs/api";

export const JOB_TYPE = "platform.notifications.digest";

export const payloadSchema = z.object({ date: z.string().optional() }).strict();

// Once a day: each person who asked for the daily digest gets one email of their unread notifications from the last day.
export async function notificationDigestHandler(client, systemContext) {
  return sendNotificationDigests(client, systemContext.organizationId);
}
