import { z } from "zod";
import { notifyProjectAlerts } from "@vercentlabs/api";

export const JOB_TYPE = "projects.alerts.notify";

export const payloadSchema = z.object({ date: z.string().optional() }).strict();

// Projects: tells managers of approaching and passed target dates, and the team of a project left without an active manager. Each alert is
// recorded with its key (per target date or condition) in the same transaction, so a re-run or an overlapping tick never notifies twice.
export async function notifyProjectAlertsHandler(client, systemContext) {
  return notifyProjectAlerts(client, { organizationId: systemContext.organizationId, userId: null, roleSlugs: ["system_administrator"], permissions: [] });
}
