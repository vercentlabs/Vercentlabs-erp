import { endContractAllocation, reverseInvoiceAllocation } from "@vercentlabs/api";
import { z } from "zod";

import { HttpError } from "@/core/http";
import { projectsMutation } from "@/features/projects/shared/route-helpers";

// POST end-contract-allocation { allocationId, reason } · reverse-invoice-allocation { allocationId, reason }
type Params = { params: Promise<{ action: string }> };
export async function POST(request: Request, ctx: Params) {
  const { action } = await ctx.params;
  return projectsMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => {
    if (action === "end-contract-allocation") return endContractAllocation(client, context, String(input.allocationId ?? ""), input);
    if (action === "reverse-invoice-allocation") return reverseInvoiceAllocation(client, context, String(input.allocationId ?? ""), input);
    throw new HttpError(404, "Unknown action.", "NOT_FOUND");
  });
}
