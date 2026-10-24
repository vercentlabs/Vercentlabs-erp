import { z } from "zod";

import { getPaymentReminders, listReminderLog, setPaymentRemindersMode } from "@vercentlabs/api";

import { salesMutation, salesRead } from "@/features/sales/shared/route-helpers";

// Payment reminders (Sales report Phase 2): the mode, the rules and the latest of what was sent (or would be, in preview).
export async function GET(request: Request) {
  return salesRead(request, "sales.view", async (client, context) => ({ ...(await getPaymentReminders(client, context)), ...(await listReminderLog(client, context, { limit: 50 })) }));
}

// { mode: off | preview | send }
export async function POST(request: Request) {
  return salesMutation(request, "sales.settings.manage", z.object({ mode: z.enum(["off", "preview", "send"]) }), async (client, context, input) =>
    setPaymentRemindersMode(client, context, input.mode));
}
