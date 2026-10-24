import { z } from "zod";
import { runPaymentReminders } from "@vercentlabs/api";

export const JOB_TYPE = "sales.automation.payment_reminders";

export const payloadSchema = z.object({ date: z.string().optional() }).strict();

// Sales (Sales report Phase 2): once a day, the company's payment reminder rules — off, preview (logged, not sent) or sending. Each rule
// reminds about an invoice once (the reminder log is the stamp), so a re-run or an overlapping tick sends nothing twice.
export async function paymentRemindersHandler(client, systemContext) {
  return runPaymentReminders(client, { organizationId: systemContext.organizationId, userId: null, roleSlugs: ["system_administrator"], permissions: [] });
}
