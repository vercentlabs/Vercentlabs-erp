import { z } from "zod";

import { listPosCardConfigs, updatePosCardConfig } from "@vercentlabs/api";

import { posMutation, posRead } from "@/features/pos/shared/route-helpers";

// Card set-up per outlet (administrators): provider, merchant account, integrated / standalone, standalone recording and provisional
// acceptance, the approval threshold, refunds, settlement source, readiness and limits, with each outlet's card terminals.
export async function GET(request: Request) {
  return posRead(request, async (client, context) => ({ configs: await listPosCardConfigs(client, context) }), "pos.settings.manage");
}

// Provider credentials are never sent here: only the name of the secret that holds them.
const schema = z.object({
  storeId: z.string().uuid(),
  providerKey: z.string().trim().max(40).optional(),
  active: z.boolean().optional(),
  merchantAccountReference: z.string().trim().max(80).nullish(),
  integrationMode: z.enum(["integrated", "standalone", "both"]).optional(),
  standaloneEnabled: z.boolean().optional(),
  provisionalAcceptance: z.boolean().optional(),
  standaloneApprovalAbove: z.union([z.string().trim().max(20), z.number()]).nullish(),
  refundEnabled: z.boolean().optional(),
  settlementSource: z.enum(["provider_api", "import"]).optional(),
  configurationStatus: z.enum(["ready", "incomplete", "disabled"]).optional(),
  maxAmount: z.union([z.string().trim().max(20), z.number()]).nullish(),
  credentialReference: z.string().trim().max(80).nullish(),
});

export async function PUT(request: Request) {
  return posMutation(request, schema, async (client, context, input) => {
    const { storeId, ...rest } = input;
    return { config: await updatePosCardConfig(client, context, storeId, rest) };
  }, 200, "pos.settings.manage");
}
