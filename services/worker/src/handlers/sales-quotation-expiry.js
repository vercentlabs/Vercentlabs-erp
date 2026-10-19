import { z } from "zod";
import { noteExpiredQuotations } from "@vercentlabs/api";

export const JOB_TYPE = "sales.automation.detect_expired_quotations";

export const payloadSchema = z.object({ date: z.string().optional() }).strict();

// Sales: once a day, every open quotation past its Valid Until date gets "Expired" on its history and its salesperson is told — once per
// quotation (the history event is the stamp), so a re-run or an overlapping tick tells nobody twice.
export async function noteExpiredQuotationsHandler(client, systemContext) {
  return noteExpiredQuotations(client, { organizationId: systemContext.organizationId, userId: null, roleSlugs: ["system_administrator"], permissions: [] });
}
