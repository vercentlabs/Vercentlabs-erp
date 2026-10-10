import { z } from "zod";

import { configureOutletPaymentMethods, getOutletPaymentMethods } from "@vercentlabs/api";

import { posMutation, posRead } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ outletId: string }> };

export async function GET(request: Request, { params }: Params) {
  const { outletId } = await params;
  return posRead(request, async (client, context) => ({ methods: await getOutletPaymentMethods(client, context, outletId) }));
}

// body: { methods: [{ method, enabled, accountId?, providerKey? }] }
export async function PUT(request: Request, { params }: Params) {
  const { outletId } = await params;
  const method = z.object({ method: z.string(), enabled: z.boolean(), accountId: z.string().nullable().optional(), providerKey: z.string().nullable().optional() });
  return posMutation(request, z.object({ methods: z.array(method) }),
    async (client, context, input) => ({ methods: await configureOutletPaymentMethods(client, context, outletId, input.methods) }));
}
