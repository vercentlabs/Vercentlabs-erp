import { z } from "zod";
import { notifyOverdueProductionHolds } from "@vercentlabs/api";

export const JOB_TYPE = "manufacturing.production_hold.notify_overdue";

export const payloadSchema = z.object({}).strict();

// Production Hold: tells the order's owner, the hold owner and production of holds older than the company's limit. Each hold is claimed with
// SKIP LOCKED and stamped in the same transaction, so a re-run or an overlapping tick never notifies twice.
export async function notifyOverdueProductionHoldsHandler(client, systemContext) {
  return notifyOverdueProductionHolds(client, { organizationId: systemContext.organizationId, userId: null, roleSlugs: ["system_administrator"], permissions: [] });
}
