import { z } from "zod";

import { setOutletStatus, validateOutletForDeactivation, validateOutletSetup } from "@vercentlabs/api";

import { posMutation, posRead } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ outletId: string }> };

// What is missing before activation (setup) and what stands between the outlet and Inactive (blockers).
export async function GET(request: Request, { params }: Params) {
  const { outletId } = await params;
  return posRead(request, async (client, context) => ({
    setup: await validateOutletSetup(client, context, outletId),
    blockers: await validateOutletForDeactivation(client, context, outletId),
  }));
}

// body: { status: active | inactive, reason? }
export async function POST(request: Request, { params }: Params) {
  const { outletId } = await params;
  return posMutation(request, z.object({ status: z.string(), reason: z.string().optional() }),
    async (client, context, input) => ({ outlet: await setOutletStatus(client, context, outletId, input.status, input) }));
}
