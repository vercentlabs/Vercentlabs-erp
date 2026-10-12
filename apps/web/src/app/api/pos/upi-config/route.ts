import { z } from "zod";

import { listPosUpiConfigs, updatePosUpiConfig } from "@vercentlabs/api";

import { posMutation, posRead } from "@/features/pos/shared/route-helpers";

// UPI & digital set-up per outlet (administrators): provider, merchant name and account, readiness, the shop's static QR UPI ID (verified
// by an administrator before it can be switched on), provisional acceptance, payment links, UPI intent, other digital methods, QR validity,
// refunds and limits. Provider credentials are never sent here: only the name of the secret that holds them.
export async function GET(request: Request) {
  return posRead(request, async (client, context) => ({ configs: await listPosUpiConfigs(client, context) }), "pos.settings.manage");
}

const schema = z.object({
  storeId: z.string().uuid(),
  providerKey: z.string().trim().max(40).optional(),
  merchantDisplayName: z.string().trim().max(80).nullish(),
  merchantAccountReference: z.string().trim().max(80).nullish(),
  configurationStatus: z.enum(["ready", "incomplete", "disabled"]).optional(),
  staticQrVpa: z.string().trim().max(260).nullish(),
  verifyStaticQr: z.boolean().optional(),
  staticQrEnabled: z.boolean().optional(),
  provisionalAcceptance: z.boolean().optional(),
  approvalAbove: z.union([z.string().trim().max(20), z.number()]).nullish(),
  paymentLinksEnabled: z.boolean().optional(),
  intentEnabled: z.boolean().optional(),
  digitalMethods: z.array(z.enum(["wallet", "bank_transfer"])).optional(),
  qrValiditySeconds: z.number().int().optional(),
  refundEnabled: z.boolean().optional(),
  maxAmount: z.union([z.string().trim().max(20), z.number()]).nullish(),
  credentialReference: z.string().trim().max(80).nullish(),
});

export async function PUT(request: Request) {
  return posMutation(request, schema, async (client, context, input) => {
    const { storeId, ...rest } = input;
    return { config: await updatePosUpiConfig(client, context, storeId, rest) };
  }, 200, "pos.settings.manage");
}
