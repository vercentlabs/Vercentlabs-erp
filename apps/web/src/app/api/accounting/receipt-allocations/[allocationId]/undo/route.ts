import { z } from "zod";

import { undoReceiptAllocation } from "@vercentlabs/api";

import { accountingMutation } from "@/features/accounting/shared/route-helpers";

type Params = { params: Promise<{ allocationId: string }> };

// Undoes one application of a receipt: the invoice is owed again and the receipt's money is free again; the application stays on record.
export async function POST(request: Request, { params }: Params) {
  const { allocationId } = await params;
  return accountingMutation(request, z.object({ reason: z.string().trim().min(1).max(500) }), async (client, context, input) => ({
    result: await undoReceiptAllocation(client, context, allocationId, input),
  }));
}
