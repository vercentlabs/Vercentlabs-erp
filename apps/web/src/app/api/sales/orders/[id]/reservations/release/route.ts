import { z } from "zod";

import { releaseSalesOrderStockReservations } from "@vercentlabs/api";

import { stockContextFor } from "@/features/sales/orders/server/stock-context";
import { salesMutation } from "@/features/sales/shared/route-helpers";

const schema = z.object({
  reason: z
    .string()
    .trim()
    .min(5, "Say why the reservation is released (at least 5 characters).")
    .max(1000),
});

// F046: release the stock held for this order, with a reason on the order trail.
export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  return salesMutation(
    request,
    "sales.fulfillment.request",
    schema,
    async (client, context, input) => {
      const stock = stockContextFor(
        {
          organizationId: context.organizationId,
          userId: context.userId ?? "",
        },
        "reserve",
      );
      return {
        result: await releaseSalesOrderStockReservations(
          client,
          context,
          stock,
          id,
          input.reason,
        ),
      };
    },
  );
}
