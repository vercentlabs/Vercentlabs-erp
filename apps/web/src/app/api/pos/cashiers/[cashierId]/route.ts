import { z } from "zod";

import { deleteCashier, getCashier, updateCashier } from "@vercentlabs/api";

import { posMutation, posRead } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ cashierId: string }> };

export async function GET(request: Request, { params }: Params) {
  const { cashierId } = await params;
  return posRead(request, async (client, context) => ({ cashier: await getCashier(client, context, cashierId) }), "pos.cashiers.view");
}

// displayName, notes, employeeId, defaultOutletId; code and userId only while unused; expectedVersion, reason.
export async function PATCH(request: Request, { params }: Params) {
  const { cashierId } = await params;
  return posMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => ({ cashier: await updateCashier(client, context, cashierId, input) }), 200,
    "pos.cashiers.view");
}

// Only a cashier who never opened a session or recorded a sale or return; anyone else is deactivated.
export async function DELETE(request: Request, { params }: Params) {
  const { cashierId } = await params;
  return posMutation(request, z.record(z.string(), z.unknown()), (client, context) => deleteCashier(client, context, cashierId), 200, "pos.cashiers.view");
}
