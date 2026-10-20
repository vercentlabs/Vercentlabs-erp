import { z } from "zod";

import { receiveFundTransfer } from "@vercentlabs/api";

import { accountingMutation } from "@/features/accounting/shared/route-helpers";

type Params = { params: Promise<{ transferId: string }> };
const schema = z.object({ arrivalDate: z.string().date().optional() });

// Receives a transfer that was in transit, on the day the money arrived.
export async function POST(request: Request, { params }: Params) {
  const { transferId } = await params;
  return accountingMutation(request, schema, async (client, context, input) => ({ transfer: await receiveFundTransfer(client, context, transferId, input) }), 200, "accounting.bank.manage");
}
