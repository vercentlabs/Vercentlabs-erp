import { z } from "zod";

import { suggestReconciliationMatches } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

// POST: deterministic match suggestions for an unmatched settlement or bank line (never applied automatically).
const schema = z.object({ externalType: z.enum(["payment_settlement_line", "accounting_bank_statement_line"]), externalId: z.string().uuid() });

export async function POST(request: Request) {
  return posMutation(request, schema, async (client, context, input) => ({ suggestions: await suggestReconciliationMatches(client, context, input) }), 200, "pos.view");
}
