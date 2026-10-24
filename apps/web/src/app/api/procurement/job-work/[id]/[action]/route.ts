import { cancelJobWork, recordJobWorkReturn, sendJobWork } from "@vercentlabs/api";

import { procurementMutation } from "@/features/procurement/shared/route-helpers";
import { bodySchema } from "@/features/procurement/suppliers/server/supplier-http";

// send { sentDate? } · cancel · returns { returnDate?, challanNumber?, challanDate?, goodsReceiptId?, lines: [{ lineId, processed?, unprocessed?, waste? }] }
type Params = { params: Promise<{ id: string; action: string }> };

export async function POST(request: Request, ctx: Params) {
  const { id, action } = await ctx.params;
  if (!["send", "cancel", "returns"].includes(action)) return Response.json({ ok: false, code: "NOT_FOUND", message: "Unknown action." }, { status: 404 });
  return procurementMutation(request, bodySchema, async (client, context, input) => ({
    result: action === "send" ? await sendJobWork(client, context, id, input as { sentDate?: string })
      : action === "cancel" ? await cancelJobWork(client, context, id) : await recordJobWorkReturn(client, context, id, input),
  }), 200, "procurement.view");
}
