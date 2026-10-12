import { z } from "zod";

import { recordShiftClosingPrint } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

// POST: print or reprint the closing report — recorded; nothing else changes.
const schema = z.object({ variant: z.enum(["CASHIER", "RECONCILIATION"]).optional(), format: z.enum(["THERMAL", "A4"]).optional(), reason: z.string().trim().max(300).optional() });

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  return posMutation(request, schema, async (client, context, input) => ({ report: await recordShiftClosingPrint(client, context, id, input) }), 201, "pos.view");
}
