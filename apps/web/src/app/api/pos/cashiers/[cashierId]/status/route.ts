import { z } from "zod";

import { setCashierStatus, validateCashierForDeactivation, validateCashierSetup } from "@vercentlabs/api";

import { posMutation, posRead } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ cashierId: string }> };

// What is missing before activation (setup) and what stands between the cashier and Inactive (blockers).
export async function GET(request: Request, { params }: Params) {
  const { cashierId } = await params;
  return posRead(request, async (client, context) => ({
    setup: await validateCashierSetup(client, context, cashierId),
    blockers: await validateCashierForDeactivation(client, context, cashierId),
  }), "pos.cashiers.view");
}

// body: { status: active | inactive, reason? }
export async function POST(request: Request, { params }: Params) {
  const { cashierId } = await params;
  return posMutation(request, z.object({ status: z.string(), reason: z.string().optional() }),
    async (client, context, input) => ({ cashier: await setCashierStatus(client, context, cashierId, input.status, input) }), 200, "pos.cashiers.view");
}
