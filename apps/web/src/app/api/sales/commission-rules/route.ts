import { listCommissionRules, saveCommissionRule } from "@vercentlabs/api";

import { commissionRuleSchema } from "@/features/sales/settings/commission-schema";
import { salesMutation, salesRead } from "@/features/sales/shared/route-helpers";

// Commission rules (Sales audit): listed to Sales users; created by whoever manages Sales settings (checked by the operation).
export async function GET(request: Request) {
  return salesRead(request, "sales.view", async (client, context) => listCommissionRules(client, context));
}

export async function POST(request: Request) {
  return salesMutation(request, "sales.settings.manage", commissionRuleSchema, async (client, context, input) => ({ rule: await saveCommissionRule(client, context, input) }));
}
