import { z } from "zod";

import { closeFinancialYear } from "@vercentlabs/api";

import { accountingMutation } from "@/features/accounting/shared/route-helpers";

type Params = { params: Promise<{ yearId: string }> };

// Closes a financial year whose months are all closed: its profit moves to retained earnings and every month is locked.
export async function POST(request: Request, { params }: Params) {
  const { yearId } = await params;
  return accountingMutation(request, z.object({ note: z.string().max(1000).optional() }), async (client, context, input) => ({ year: await closeFinancialYear(client, context, yearId, input) }));
}
