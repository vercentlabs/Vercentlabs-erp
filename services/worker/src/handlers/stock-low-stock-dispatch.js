import { z } from "zod";
import { dispatchLowStockAlertNotifications } from "@vercentlabs/api";

export const JOB_TYPE = "stock.low_stock.dispatch_notifications";

export const payloadSchema = z.object({}).strict();

// Low-Stock Alerts: delivers the queued alert transitions (opened, reopened, escalated) as in-app notifications. Each transition is claimed
// with SKIP LOCKED and marked dispatched in the same transaction, so a re-run or an overlapping tick never notifies twice.
export async function dispatchLowStockNotificationsHandler(client, systemContext) {
  return dispatchLowStockAlertNotifications(client, { organizationId: systemContext.organizationId, userId: null, roleSlugs: ["system_administrator"], permissions: [] });
}
