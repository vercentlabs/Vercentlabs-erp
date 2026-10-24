import { saveReminderRule } from "@vercentlabs/api";

import { reminderRuleSchema } from "@/features/sales/settings/reminder-schema";
import { salesMutation } from "@/features/sales/shared/route-helpers";

export async function POST(request: Request) {
  return salesMutation(request, "sales.settings.manage", reminderRuleSchema, async (client, context, input) => saveReminderRule(client, context, input), 201);
}
