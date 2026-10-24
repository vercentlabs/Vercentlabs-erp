import { z } from "zod";
import { runReceiptReminders } from "@vercentlabs/api";

export const JOB_TYPE = "procurement.automation.receipt_reminders";

export const payloadSchema = z.object({ date: z.string().optional() }).strict();

// Procurement (report Phase 2): once a day, ask suppliers about goods still to come — before the expected date and when it has passed —
// by the company's setting (off, preview or sending). The reminder log stamps each order once per kind, so a re-run sends nothing twice.
export async function receiptRemindersHandler(client, systemContext) {
  return runReceiptReminders(client, { organizationId: systemContext.organizationId, userId: null, roleSlugs: ["system_administrator"], permissions: [] });
}
