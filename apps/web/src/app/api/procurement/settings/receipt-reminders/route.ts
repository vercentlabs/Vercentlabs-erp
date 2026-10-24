import { getReceiptReminderSettings, updateReceiptReminderSettings } from "@vercentlabs/api";

import { procurementMutation, procurementRead } from "@/features/procurement/shared/route-helpers";
import { bodySchema } from "@/features/procurement/suppliers/server/supplier-http";

// Receipt reminders to suppliers: { mode: off | preview | sending, daysBefore, daysAfter }.
export async function GET(request: Request) {
  return procurementRead(request, async (client, context) => ({ settings: await getReceiptReminderSettings(client, context) }));
}

export async function PATCH(request: Request) {
  return procurementMutation(request, bodySchema, async (client, context, input) => ({ settings: await updateReceiptReminderSettings(client, context, input) }), 200, "procurement.settings.manage");
}
