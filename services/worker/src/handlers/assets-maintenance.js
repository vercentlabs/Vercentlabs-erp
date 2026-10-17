import { z } from "zod";
import { runMaintenanceSchedule } from "@vercentlabs/api";

export const JOB_TYPE = "assets.maintenance.schedule";

export const payloadSchema = z.object({ date: z.string().optional() }).strict();

// Assets — Asset Maintenance: every preventive service now due (within its lead time) becomes one Work Order, then overdue work is notified.
// Re-running is safe: an occurrence is unique per plan and due date, and an overdue notice is recorded once per Work Order and day.
export async function runMaintenanceScheduleHandler(client, systemContext) {
  return runMaintenanceSchedule(client, { organizationId: systemContext.organizationId, userId: null, roleSlugs: ["system_worker"], permissions: [] }, {});
}
